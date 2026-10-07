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
    if (originalWS === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalWS;
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

// WebSocket-level tests with mock.timers
test('collect: Abonnementmeldung enthält APIKey, BoundingBoxes (snapped), FilterMessageTypes', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  let sentMessage = null;
  const originalWS = globalThis.WebSocket;
  const originalError = console.error;

  try {
    console.error = () => {};
    await mock.timers.enable({ apis: ['setTimeout'] });

    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        setTimeout(() => this.onopen?.(), 0);
      }

      send(msg) {
        sentMessage = JSON.parse(msg);
      }

      close() {}
    };

    const resPromise = call('south=50.1&west=0.3&north=59.9&east=9.7', '10.0.3.1');
    mock.timers.tick(0); // Allow onopen to fire
    mock.timers.tick(4000); // Expire collection timer
    const res = await resPromise;

    assert.equal(res.status, 200);
    assert.ok(sentMessage);
    assert.equal(sentMessage.APIKey, 'test-key');
    assert.deepEqual(sentMessage.BoundingBoxes, [[[50, 0], [60, 10]]]);
    assert.deepEqual(sentMessage.FilterMessageTypes, ['PositionReport', 'StandardClassBPositionReport', 'ShipStaticData']);

    const body = await res.text();
    assert.doesNotMatch(body, /test-key|APIKey/i);
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    await mock.timers.reset();
    if (originalWS === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});

test('collect: PositionReport-Meldungen (string + binary) -> 200 mit Schiffen', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  const originalWS = globalThis.WebSocket;
  const originalError = console.error;

  try {
    console.error = () => {};
    await mock.timers.enable({ apis: ['setTimeout'] });

    let wsInstance = null;
    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        wsInstance = this;
      }

      send() {}

      close() {}
    };

    const resPromise = call('south=52&west=2&north=58&east=8', '10.0.3.2');

    // Call onopen first to set the "opened" flag
    wsInstance.onopen?.();
    // Now send messages with exact coordinates for assertions
    // String frame: MMSI 111111, lon=5, lat=55
    wsInstance.onmessage({
      data: JSON.stringify({
        MessageType: 'PositionReport',
        MetaData: { MMSI: 111111 },
        Message: {
          PositionReport: {
            Latitude: 55,
            Longitude: 5,
            Sog: 10,
          },
        },
      }),
    });
    // String frame: MMSI 222222, lon=4, lat=54
    wsInstance.onmessage({
      data: JSON.stringify({
        MessageType: 'PositionReport',
        MetaData: { MMSI: 222222 },
        Message: {
          PositionReport: {
            Latitude: 54,
            Longitude: 4,
            Sog: 12,
          },
        },
      }),
    });
    // Binary ArrayBuffer frame: MMSI 333333, lon=3, lat=53
    const msg3 = JSON.stringify({
      MessageType: 'PositionReport',
      MetaData: { MMSI: 333333 },
      Message: {
        PositionReport: {
          Latitude: 53,
          Longitude: 3,
          Sog: 8,
        },
      },
    });
    wsInstance.onmessage({
      data: new TextEncoder().encode(msg3).buffer,
    });

    mock.timers.tick(4000); // Expire collection timer
    const res = await resPromise;

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ships.length, 3);

    // Map MMSI to expected coordinates [lon, lat]
    const expectedCoordinates = {
      111111: [5, 55],
      222222: [4, 54],
      333333: [3, 53],
    };

    // Verify each ship's exact coordinates and source
    const mmsis = json.ships.map(s => s.properties.mmsi).sort((a, b) => a - b);
    assert.deepEqual(mmsis, [111111, 222222, 333333]);

    for (const ship of json.ships) {
      const mmsi = ship.properties.mmsi;
      assert.equal(ship.properties.source, 'ais');
      assert.deepEqual(ship.geometry.coordinates, expectedCoordinates[mmsi], `MMSI ${mmsi}`);
    }
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    await mock.timers.reset();
    if (originalWS === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});

test('collect: opened aber null Meldungen -> 200 {"ships":[]}', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  const originalWS = globalThis.WebSocket;
  const originalError = console.error;

  try {
    console.error = () => {};
    await mock.timers.enable({ apis: ['setTimeout'] });

    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        setTimeout(() => this.onopen?.(), 0);
      }

      send() {}

      close() {}
    };

    const resPromise = call('south=53&west=3&north=57&east=7', '10.0.3.3');
    mock.timers.tick(0); // Allow onopen
    mock.timers.tick(4000); // Expire collection timer
    const res = await resPromise;

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { ships: [] });
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    await mock.timers.reset();
    if (originalWS === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});

test('collect: nie geöffnet -> 502', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  const originalWS = globalThis.WebSocket;
  const originalError = console.error;

  try {
    console.error = () => {};
    await mock.timers.enable({ apis: ['setTimeout'] });

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
    mock.timers.tick(4000); // Expire collection timer without opening
    const res = await resPromise;

    assert.equal(res.status, 502);
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    await mock.timers.reset();
    if (originalWS === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});

test('collect: error message -> 502, Antwort verrät nichts', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  const originalWS = globalThis.WebSocket;
  const originalError = console.error;

  try {
    console.error = () => {};
    await mock.timers.enable({ apis: ['setTimeout'] });

    let wsInstance = null;
    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        wsInstance = this;
      }

      send() {}

      close() {}
    };

    const resPromise = call('south=55&west=5&north=55.5&east=5.5', '10.0.3.5');

    // Manually call onopen
    wsInstance.onopen?.();
    // Send error message
    wsInstance.onmessage({
      data: JSON.stringify({ error: 'Api Key Is Not Valid' }),
    });

    mock.timers.tick(4000); // Expire collection timer
    const res = await resPromise;

    assert.equal(res.status, 502);
    const body = await res.text();
    assert.doesNotMatch(body, /Api Key Is Not Valid/);
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    await mock.timers.reset();
    if (originalWS === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});

test('collect: close -> 502', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  const originalWS = globalThis.WebSocket;
  const originalError = console.error;

  try {
    console.error = () => {};
    await mock.timers.enable({ apis: ['setTimeout'] });

    let wsInstance = null;
    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        wsInstance = this;
      }

      send() {}

      close() {}
    };

    const resPromise = call('south=51.5&west=1.5&north=58.5&east=8.5', '10.0.3.6');

    // GET läuft bis zum Konstruktor asynchron; ohne Timer-Tick kurz auf die Instanz warten.
    for (let i = 0; i < 20 && !wsInstance; i++) await new Promise((r) => setImmediate(r));
    assert.ok(wsInstance, 'WebSocket wurde erzeugt');

    wsInstance.onopen?.();
    assert.equal(typeof wsInstance.onclose, 'function', 'onclose-Handler ist gesetzt');
    wsInstance.onclose(); // ohne jede Nachricht schließen

    // Kein Timer-Tick: die Antwort muss allein durch das Schließen entstehen.
    const res = await resPromise;

    assert.equal(res.status, 502);
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    await mock.timers.reset();
    if (originalWS === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});

test('collect: concurrent requests für denselben Ausschnitt sharen ein WebSocket', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  const originalWS = globalThis.WebSocket;
  let constructionCount = 0;
  const originalError = console.error;

  try {
    console.error = () => {};
    await mock.timers.enable({ apis: ['setTimeout'] });

    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        constructionCount++;
        setTimeout(() => this.onopen?.(), 0);
      }

      send() {}

      close() {}
    };

    const res1Promise = call('south=52.5&west=2.5&north=57.5&east=7.5', '10.0.3.7');
    const res2Promise = call('south=52.5&west=2.5&north=57.5&east=7.5', '10.0.3.7');

    mock.timers.tick(0); // Allow onopen
    mock.timers.tick(4000); // Expire collection timer

    await res1Promise;
    await res2Promise;

    assert.equal(constructionCount, 1, 'Only one WebSocket for same bbox');
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    await mock.timers.reset();
    if (originalWS === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});

test('collect: fehlgeschlagene Anfrage wird nicht gecacht', async () => {
  process.env.AISSTREAM_API_KEY = 'test-key';
  const originalWS = globalThis.WebSocket;
  let constructionCountPhase1 = 0;
  let constructionCountPhase2 = 0;
  const originalError = console.error;

  try {
    console.error = () => {};
    await mock.timers.enable({ apis: ['setTimeout'] });

    // Phase 1: fehlgeschlagene Anfrage
    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        constructionCountPhase1++;
        setTimeout(() => this.onerror?.(), 0);
      }

      send() {}

      close() {}
    };

    const res1Promise = call('south=53.5&west=3.5&north=56.5&east=6.5', '10.0.3.8');
    mock.timers.tick(0); // Allow onerror
    mock.timers.tick(4000); // Expire collection timer
    const res1 = await res1Promise;
    assert.equal(res1.status, 502);
    assert.equal(constructionCountPhase1, 1);

    // Phase 2: neue Anfrage mit gleichem Ausschnitt sollte neue Socket öffnen
    globalThis.WebSocket = class {
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onerror = null;
      onclose = null;

      constructor() {
        constructionCountPhase2++;
        setTimeout(() => this.onopen?.(), 0);
      }

      send() {}

      close() {}
    };

    const res2Promise = call('south=53.5&west=3.5&north=56.5&east=6.5', '10.0.3.8');
    mock.timers.tick(0); // Allow onopen
    mock.timers.tick(4000); // Expire collection timer
    const res2 = await res2Promise;
    assert.equal(res2.status, 200);
    assert.equal(constructionCountPhase2, 1, 'Failed request not cached, new socket needed');
  } finally {
    delete process.env.AISSTREAM_API_KEY;
    await mock.timers.reset();
    if (originalWS === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalWS;
    console.error = originalError;
  }
});
