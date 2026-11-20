// Seeds a demo scenario into a running emc2 server through the live picture (/api/live), with the
// same change requests a browser sends. Used by tools/release.mjs --scenario. The scenario file
// lists layers, each with its symbols (APP-6D SIDC, position as [lon, lat], an optional name and
// direction); see tools/demo/scenario.json.
import { randomUUID } from 'node:crypto';

const LABEL = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' };
const TIMEOUT_MS = 15_000;

/** The change request that creates a layer. */
export function layerRequest(layer, source) {
  return {
    requestId: randomUUID(),
    entityType: 'layer',
    operation: 'create',
    entityId: randomUUID(),
    data: { name: layer.name, drawOrder: layer.drawOrder, visible: true, label: LABEL },
    source: { plugin: source },
  };
}

/** The change request that creates a symbol on a layer (data model 1.0.0: core.general, manual). */
export function symbolRequest(symbol, layerId, source) {
  const modifiers = {};
  if (symbol.name) modifiers.uniqueDesignation = symbol.name;
  if (symbol.direction !== undefined) modifiers.direction = symbol.direction;
  return {
    requestId: randomUUID(),
    entityType: 'object',
    operation: 'create',
    entityId: randomUUID(),
    data: {
      type: 'core.symbol',
      dataType: 'core.general',
      dataSource: 'manual',
      layerId,
      geometry: { type: 'Point', coordinates: [symbol.at[0], symbol.at[1]] },
      symbol: { standard: 'APP-6D', sidc: symbol.sidc, ...(Object.keys(modifiers).length ? { modifiers } : {}) },
      label: LABEL,
    },
    source: { plugin: source },
  };
}

/** Every change request of a scenario, in order: each layer, then its symbols. */
export function scenarioRequests(scenario) {
  const source = scenario.source ?? 'demo-scenario';
  const requests = [];
  for (const layer of scenario.layers) {
    const create = layerRequest(layer, source);
    requests.push(create);
    for (const symbol of layer.symbols ?? []) requests.push(symbolRequest(symbol, create.entityId, source));
  }
  return requests;
}

/** Sends the scenario to the server at baseUrl (http://host:port) and waits until every request is applied. */
export async function seedScenario(baseUrl, scenario) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/api/live`);
  const outcomes = new Map();
  const waiting = new Map();
  let failure;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type !== 'change-outcome') return;
    const resolve = waiting.get(message.requestId);
    if (resolve) resolve(message);
    else outcomes.set(message.requestId, message);
  });
  socket.addEventListener('close', (event) => { failure ??= new Error(`the live connection closed (${event.code})`); });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error(`cannot connect to ${baseUrl}/api/live`)), { once: true });
  });
  const outcome = (requestId) => outcomes.has(requestId) ? Promise.resolve(outcomes.get(requestId)) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(failure ?? new Error(`no outcome for ${requestId} within ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
    waiting.set(requestId, (message) => { clearTimeout(timer); resolve(message); });
  });
  try {
    // One at a time: a symbol's layer must exist first, and the scenario is small.
    for (const request of scenarioRequests(scenario)) {
      socket.send(JSON.stringify({ type: 'change-request', request }));
      const result = await outcome(request.requestId);
      if (result.outcome !== 'applied') throw new Error(`${request.entityType} ${request.data.name ?? request.data.symbol?.modifiers?.uniqueDesignation ?? request.entityId}: ${JSON.stringify(result)}`);
    }
  } finally {
    socket.close();
  }
  return scenario.layers.reduce((n, l) => ({ layers: n.layers + 1, symbols: n.symbols + (l.symbols?.length ?? 0) }), { layers: 0, symbols: 0 });
}
