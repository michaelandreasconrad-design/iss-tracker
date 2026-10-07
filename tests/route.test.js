import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/ships/route.js';

const url = (query) => `http://localhost/api/ships?${query}`;
const call = (query, ip) =>
  GET(new Request(url(query), { headers: { 'x-forwarded-for': ip } }));
const VALID = 'south=50&west=0&north=60&east=10';

test('400 bei ungültigem Ausschnitt, ohne AISStream anzusprechen', async () => {
  for (const [i, query] of [
    '',
    'south=50&west=0&north=60',
    'south=abc&west=0&north=60&east=10',
    'south=60&west=0&north=50&east=10',
    'south=-80&west=-170&north=80&east=170',
  ].entries()) {
    const res = await call(query, `10.0.0.${i}`);
    assert.equal(res.status, 400, query);
    assert.match((await res.json()).error, /Ausschnitt/);
  }
});

test('503 ohne API-Key, Antwort verrät nichts', async () => {
  delete process.env.AISSTREAM_API_KEY;
  const res = await call(VALID, '10.0.1.1');
  assert.equal(res.status, 503);
  const body = await res.text();
  assert.doesNotMatch(body, /APIKey|AISSTREAM_API_KEY/i);
});

test('429 nach zu vielen Anfragen, mit Retry-After', async () => {
  let limitedAt = null;
  for (let i = 1; i <= 40; i++) {
    const res = await call('', '10.0.2.1'); // 400er zählen mit
    if (res.status === 429) {
      limitedAt = i;
      assert.equal(res.headers.get('retry-after'), '60');
      break;
    }
  }
  assert.ok(limitedAt !== null && limitedAt > 1, 'Rate Limit greift');
  const other = await call('', '10.0.2.2');
  assert.equal(other.status, 400); // anderer Client ist nicht betroffen
});

test('fehlender x-forwarded-for-Header bricht nichts', async () => {
  const res = await GET(new Request(url('')));
  assert.ok([400, 429].includes(res.status));
});
