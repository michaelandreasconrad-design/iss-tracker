import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SHIPS,
  bboxKey,
  createCollector,
  hasValidPosition,
  isInsideBaltic,
  limitBbox,
  mergeShips,
  normalizeMessage,
  parseBbox,
  sanitizeText,
  snapBbox,
  vesselFromProps,
} from '../app/aisCore.js';

const q = (obj) => new URLSearchParams(obj);

test('parseBbox: gültiger Ausschnitt', () => {
  assert.deepEqual(parseBbox(q({ south: '50', west: '0', north: '60', east: '10' })), {
    south: 50, west: 0, north: 60, east: 10,
  });
});

test('parseBbox: ungültige Eingaben ergeben null', () => {
  assert.equal(parseBbox(q({ south: '50', west: '0', north: '60' })), null); // east fehlt
  assert.equal(parseBbox(q({ south: '', west: '0', north: '60', east: '10' })), null);
  assert.equal(parseBbox(q({ south: 'abc', west: '0', north: '60', east: '10' })), null);
  assert.equal(parseBbox(q({ south: 'Infinity', west: '0', north: '60', east: '10' })), null);
  assert.equal(parseBbox(q({ south: '60', west: '0', north: '50', east: '10' })), null); // vertauscht
  assert.equal(parseBbox(q({ south: '-85', west: '-180', north: '85', east: '180' })), null); // zu groß
});

test('parseBbox: Länge außerhalb ±180 wird geklemmt statt abgelehnt', () => {
  assert.deepEqual(parseBbox(q({ south: '10', west: '-200', north: '20', east: '-150' })), {
    south: 10, west: -180, north: 20, east: -150,
  });
  assert.equal(parseBbox(q({ south: '10', west: '190', north: '20', east: '200' })), null); // nach Klemmen leer
});

test('snapBbox rundet nach außen auf das Raster, bboxKey ist stabil', () => {
  const snapped = snapBbox({ south: 50.1, west: 0.3, north: 59.9, east: 9.7 });
  assert.deepEqual(snapped, { south: 50, west: 0, north: 60, east: 10 });
  assert.equal(bboxKey(snapped), '50:0:60:10');
});

test('limitBbox schrumpft zu große Ausschnitte um die Mitte', () => {
  const limited = limitBbox({ south: -40, west: -100, north: 40, east: 100 });
  assert.ok(limited.north - limited.south <= 80);
  assert.ok(limited.east - limited.west <= 120);
  assert.equal((limited.west + limited.east) / 2, 0);
  const small = { south: 1, west: 2, north: 3, east: 4 };
  assert.deepEqual(limitBbox(small), small);
});

test('isInsideBaltic', () => {
  assert.equal(isInsideBaltic({ south: 55, west: 12, north: 60, east: 25 }), true);
  assert.equal(isInsideBaltic({ south: 50, west: 0, north: 60, east: 10 }), false);
});

test('sanitizeText entfernt Steuerzeichen, kürzt und liefert null bei leer', () => {
  assert.equal(sanitizeText('  HELSINKI  \u0000\n'), 'HELSINKI');
  assert.equal(sanitizeText('x'.repeat(100)).length, 40);
  assert.equal(sanitizeText('   '), null);
  assert.equal(sanitizeText(42), null);
  assert.equal(sanitizeText('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>'); // bleibt Text, wird nur per textContent gezeigt
});

const position = (over = {}) => ({
  MessageType: 'PositionReport',
  MetaData: { MMSI: 211000000, ShipName: 'TESTSHIP  ' },
  Message: {
    PositionReport: { UserID: 211000000, Latitude: 54.1, Longitude: 7.9, Sog: 12.3, Cog: 87, TrueHeading: 85, ...over },
  },
});

test('normalizeMessage: Positionsmeldung', () => {
  const r = normalizeMessage(position());
  assert.equal(r.kind, 'position');
  assert.deepEqual(r.feature.geometry.coordinates, [7.9, 54.1]);
  assert.equal(r.feature.properties.mmsi, 211000000);
  assert.equal(r.feature.properties.source, 'ais');
  assert.equal(r.feature.properties.name, 'TESTSHIP');
  assert.equal(r.feature.properties.sog, 12.3);
});

test('normalizeMessage: Sog „nicht verfügbar" (102.3) wird null, ungültige Koordinaten werden verworfen', () => {
  assert.equal(normalizeMessage(position({ Sog: 102.3 })).feature.properties.sog, null);
  assert.equal(normalizeMessage(position({ Latitude: 91 })), null);
  assert.equal(normalizeMessage(position({ Longitude: 181 })), null);
  assert.equal(normalizeMessage(position({ UserID: 0 })), null);
});

test('normalizeMessage: Klasse-B-Meldung und Stammdaten', () => {
  const b = {
    MessageType: 'StandardClassBPositionReport',
    MetaData: { MMSI: 5 },
    Message: { StandardClassBPositionReport: { UserID: 5, Latitude: 1, Longitude: 2, Sog: 0, Cog: 360, TrueHeading: 511 } },
  };
  assert.equal(normalizeMessage(b).kind, 'position');
  const s = normalizeMessage({
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: 5 },
    Message: { ShipStaticData: { UserID: 5, Name: 'BOAT ', Type: 70, Destination: 'HAMBURG' } },
  });
  assert.deepEqual(s, { kind: 'static', mmsi: 5, name: 'BOAT', shipType: 70, destination: 'HAMBURG' });
});

test('normalizeMessage: Müll ergibt null', () => {
  for (const bad of [null, undefined, 'x', 5, {}, { Message: null }, { MessageType: 'Unknown', Message: {} }, { error: 'Api Key Is Not Valid' }]) {
    assert.equal(normalizeMessage(bad), null);
  }
});

test('createCollector: letzte Position je MMSI, Stammdaten werden angehängt, Obergrenze gilt', () => {
  const c = createCollector(2);
  c.add(position());
  c.add(position({ Latitude: 55 })); // gleiche MMSI überschreibt
  c.add({ MessageType: 'ShipStaticData', MetaData: { MMSI: 211000000 }, Message: { ShipStaticData: { UserID: 211000000, Name: 'NEU', Type: 80, Destination: 'KIEL' } } });
  const other = (id) => ({ MessageType: 'PositionReport', MetaData: { MMSI: id }, Message: { PositionReport: { UserID: id, Latitude: 1, Longitude: 1 } } });
  c.add(other(2));
  c.add(other(3)); // über der Obergrenze
  const result = c.result();
  assert.equal(c.size(), 2);
  assert.equal(result.length, 2);
  const first = result.find((f) => f.properties.mmsi === 211000000);
  assert.equal(first.geometry.coordinates[1], 55);
  assert.equal(first.properties.name, 'NEU');
  assert.equal(first.properties.shipType, 80);
  assert.equal(first.properties.destination, 'KIEL');
  assert.equal(MAX_SHIPS, 500);
});

test('mergeShips: primary gewinnt bei gleicher MMSI', () => {
  const f = (mmsi, tag) => ({ geometry: { coordinates: [1, 2] }, properties: { mmsi, tag } });
  const merged = mergeShips([f(1, 'a'), f(2, 'a')], [f(2, 'b'), f(3, 'b')]);
  assert.deepEqual(merged.map((x) => [x.properties.mmsi, x.properties.tag]), [[1, 'a'], [2, 'a'], [3, 'b']]);
});

test('hasValidPosition und vesselFromProps', () => {
  assert.equal(hasValidPosition({ geometry: { coordinates: [1, 2] }, properties: { mmsi: 1 } }), true);
  assert.equal(hasValidPosition({ geometry: { coordinates: [1, 200] }, properties: { mmsi: 1 } }), false);
  assert.equal(hasValidPosition({ geometry: { coordinates: [1, 2] }, properties: { mmsi: 1.5 } }), false);
  assert.equal(hasValidPosition({}), false);
  assert.deepEqual(vesselFromProps({ name: 'A', shipType: 70, destination: 'B' }), { name: 'A', shipType: 70, destination: 'B' });
  assert.deepEqual(vesselFromProps({}), { name: null, shipType: null, destination: null });
});
