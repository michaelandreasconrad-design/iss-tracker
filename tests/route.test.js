import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { GET } from '../app/api/ships/route.js';

const url = (query) => `http://localhost/api/ships?${query}`;
const call = (query, ip) =>
  GET(new Request(url(query), { headers: { 'x-forwarded-for': ip } }));
const VALID = 'south=50&west=0&north=60&east=10';

test('400 bei ungültigem Ausschnitt, ohne AISStream anzusprechen', async () => {
  let wsConstructed = false;
  const originalWS = globalThis.WebSocket;
  try {
    globalThis.WebSocket = class {
      constructor() {
        wsConstructed = true;
      }
    };
    for (const [i, query] of [
      '',
      'south=50&west=0&north=60',
      'south=abc&west=0&north=60&east=10',
      'south=60&west=0&north=50&east=10',
      'south=-80&west=-170&north=80&east=170',
    ].entries()) {
      wsConstructed = false;
      const res = await call(query, `10.0.0.${i}`);
      assert.equal(res.status, 400, query);
      assert.match((await res.json()).error, /Ausschnitt/);
      assert.equal(wsConstructed, false, `WebSocket should not be constructed for invalid query: ${query}`);
    }
  } finally {
    globalThis.WebSocket = originalWS;
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
    const res = await call('', '10.0.2.1');
    if (res.status === 429) {
      limitedAt = i;
      assert.equal(res.headers.get('retry-after'), '60');
      break;
    }
  }
  assert.ok(limitedAt !== null && limitedAt > 1, 'Rate Limit greift');
  const other = await call('', '10.0.2.2');
  assert.equal(other.status, 400);
});

test('fehlender x-forwarded-for-Header bricht nichts', async () => {
  const res = await GET(new Request(url('')));
  assert.equal(res.status, 400, 'Expected 400 for missing x-forwarded-for with empty query');
});

// WebSocket-level tests using stubs
test('collect: Abonnementmeldung enthält APIKey und BoundingBoxes, nicht in HTTP-Response', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  let sentMessage = null;
  const originalWS = globalThis.WebSocket;
  const originalError = console.error;

  try {
    console.error = () => {};

    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        setImmediate(() => this.onopen?.());
      }

      send(msg) {
        sentMessage = JSON.parse(msg);
      }

      close() {}
    };

    const res = await call('south=51&west=1&north=59&east=9', '10.0.3.1');

    assert.equal(res.status, 200);
    assert.ok(sentMessage);
    assert.equal(sentMessage.APIKey, 'test-key');
    assert.ok(sentMessage.BoundingBoxes);
    assert.ok(sentMessage.FilterMessageTypes);

    const body = await res.text();
    assert.doesNotMatch(body, /test-key|APIKey/i);
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});

test('collect: PositionReport-Meldungen + Timer -> 200 mit Schiffen', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  const originalWS = globalThis.WebSocket;
  const originalError = console.error;

  try {
    console.error = () => {};

    let wsInstance = null;
    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        wsInstance = this;
        setImmediate(() => this.onopen?.());
      }

      send() {}

      close() {}
    };

    const resPromise = call('south=52&west=2&north=58&east=8', '10.0.3.2');

    setImmediate(() => {
      if (wsInstance?.onmessage) {
        wsInstance.onmessage({
          data: JSON.stringify({
            MessageType: 'PositionReport',
            MMSI: 123456,
            Latitude: 55,
            Longitude: 5,
            SOG: 10,
          }),
        });
        wsInstance.onmessage({
          data: new TextEncoder().encode(
            JSON.stringify({
              MessageType: 'PositionReport',
              MMSI: 234567,
              Latitude: 54,
              Longitude: 4,
              SOG: 12,
            })
          ),
        });
      }
    });

    const res = await resPromise;

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.ships));
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});

test('collect: opened aber null Meldungen bis Timer -> 200 {"ships":[]}', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  const originalWS = globalThis.WebSocket;
  const originalError = console.error;

  try {
    console.error = () => {};

    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        setImmediate(() => this.onopen?.());
      }

      send() {}

      close() {}
    };

    const resPromise = call('south=53&west=3&north=57&east=7', '10.0.3.3');
    const res = await resPromise;

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { ships: [] });
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});

test('collect: nie geöffnet bis Timer -> 502', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  const originalWS = globalThis.WebSocket;
  const originalError = console.error;

  try {
    console.error = () => {};

    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {}

      send() {}

      close() {}
    };

    const resPromise = call('south=54&west=4&north=56&east=6', '10.0.3.4');
    const res = await resPromise;

    assert.equal(res.status, 502);
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});

test('collect: {"error":"Api Key Is Not Valid"} -> 502, Antwort verrät nichts', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  const originalWS = globalThis.WebSocket;
  const originalError = console.error;

  try {
    console.error = () => {};

    let wsInstance = null;
    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        wsInstance = this;
        setImmediate(() => this.onopen?.());
      }

      send() {}

      close() {}
    };

    const resPromise = call('south=55&west=5&north=55.5&east=5.5', '10.0.3.5');

    setImmediate(() => {
      if (wsInstance?.onmessage) {
        wsInstance.onmessage({
          data: JSON.stringify({ error: 'Api Key Is Not Valid' }),
        });
      }
    });

    const res = await resPromise;

    assert.equal(res.status, 502);
    const body = await res.text();
    assert.doesNotMatch(body, /Api Key Is Not Valid/);
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});

test('collect: close vor Message -> 502', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  const originalWS = globalThis.WebSocket;
  const originalError = console.error;

  try {
    console.error = () => {};

    let wsInstance = null;
    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        wsInstance = this;
        setImmediate(() => this.onopen?.());
      }

      send() {}

      close() {}
    };

    const resPromise = call('south=51.5&west=1.5&north=58.5&east=8.5', '10.0.3.6');

    setImmediate(() => {
      if (wsInstance?.onclose) {
        wsInstance.onclose();
      }
    });

    const res = await resPromise;

    assert.equal(res.status, 502);
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});

test('collect: zwei parallele Anfragen für denselben Ausschnitt öffnen ein WebSocket', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  const originalWS = globalThis.WebSocket;
  let constructionCount = 0;
  const originalError = console.error;

  try {
    console.error = () => {};

    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        constructionCount++;
        setImmediate(() => this.onopen?.());
      }

      send() {}

      close() {}
    };

    const res1Promise = call('south=52.5&west=2.5&north=57.5&east=7.5', '10.0.3.7');
    const res2Promise = call('south=52.5&west=2.5&north=57.5&east=7.5', '10.0.3.7');

    await res1Promise;
    await res2Promise;

    assert.equal(constructionCount, 1, 'Only one WebSocket for same bbox');
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});

test('collect: gescheiterte Anfrage wird nicht gecacht', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  const originalWS = globalThis.WebSocket;
  let constructionCountPhase1 = 0;
  let constructionCountPhase2 = 0;
  const originalError = console.error;

  try {
    console.error = () => {};

    // Phase 1: fehlgeschlagene Anfrage
    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        constructionCountPhase1++;
        setImmediate(() => this.onerror?.());
      }

      send() {}

      close() {}
    };

    const res1Promise = call('south=53.5&west=3.5&north=56.5&east=6.5', '10.0.3.8');
    const res1 = await res1Promise;
    assert.equal(res1.status, 502);

    // Phase 2: neue Anfrage mit gleichem Ausschnitt sollte neue Socket öffnen
    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        constructionCountPhase2++;
        setImmediate(() => this.onopen?.());
      }

      send() {}

      close() {}
    };

    const res2Promise = call('south=53.5&west=3.5&north=56.5&east=6.5', '10.0.3.8');
    const res2 = await res2Promise;
    assert.equal(res2.status, 200);
    assert.equal(constructionCountPhase2, 1, 'Failed request not cached, new socket needed');
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});
