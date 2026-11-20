// Tests for tools/demo/seed.mjs: the change requests a scenario turns into, and the shipped scenario.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { scenarioRequests } from './seed.mjs';

const scenario = JSON.parse(readFileSync(new URL('./scenario.json', import.meta.url), 'utf8'));

test('a scenario gives each layer, then its symbols on that layer, as data model 1.0.0 change requests', () => {
  const requests = scenarioRequests({ source: 'demo-scenario', layers: [
    { name: 'Own forces', drawOrder: 40, symbols: [{ sidc: '10031000001211000000', at: [18.02, 59.4], name: '1 INF', direction: 70 }] },
  ] });
  assert.equal(requests.length, 2);
  const [layer, symbol] = requests;
  assert.deepEqual([layer.entityType, layer.operation, layer.data.name, layer.data.drawOrder, layer.data.visible], ['layer', 'create', 'Own forces', 40, true]);
  assert.equal(symbol.data.layerId, layer.entityId);
  assert.deepEqual(symbol.data.geometry, { type: 'Point', coordinates: [18.02, 59.4] }, 'lon, lat (ADR-0007)');
  assert.deepEqual([symbol.data.dataType, symbol.data.dataSource], ['core.general', 'manual']);
  assert.deepEqual(symbol.data.symbol, { standard: 'APP-6D', sidc: '10031000001211000000', modifiers: { uniqueDesignation: '1 INF', direction: 70 } });
  assert.equal(symbol.source.plugin, 'demo-scenario');
  assert.notEqual(layer.requestId, symbol.requestId);
});

test('the shipped scenario is valid: 20-digit SIDCs, positions on the globe with latitude different from longitude', () => {
  let symbols = 0;
  for (const layer of scenario.layers) {
    assert.equal(typeof layer.name, 'string');
    for (const s of layer.symbols) {
      symbols++;
      assert.match(s.sidc, /^\d{20}$/, s.name);
      const [lon, lat] = s.at;
      assert.ok(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90, `${s.name} on the globe`);
      assert.notEqual(lon, lat, s.name);
    }
  }
  assert.ok(symbols > 0);
  assert.ok(scenario.layers.some((l) => l.symbols.some((s) => s.at[1] > 84)), 'something beyond 84 N for the polar map');
  assert.ok(scenario.layers.some((l) => l.symbols.some((s) => s.at[1] < -80)), 'something beyond 80 S for the polar map');
});
