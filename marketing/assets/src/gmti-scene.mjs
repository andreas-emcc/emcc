// Seeds the fictional GMTI picture (gmti.jpg) in a running emcc: a friendly radar aircraft west of
// Gotland whose ground radar looks to its right, and hostile columns moving on the island.
//
//   node gmti-scene.mjs [base-url]       (default http://127.0.0.1:18103; no login; on a freshly reset
//                                         release, without sim-scene.mjs, so that nothing else moves)
//
// As the manual's "Trying it without a radar" (GMTI on the map) does it: two gmti links on loopback,
// one that sends and one that receives into a layer of its own, and a sensor whose output is the
// sending link. The links go in through Settings' endpoint, the tracks and routes as change requests,
// the sensor through the simulator's endpoints (plugins/simulator/README.md). All names and
// positions are made up. Positions are WGS84, longitude first; speeds in m/s, ranges in metres.
import { randomUUID } from "node:crypto";

const BASE = process.argv[2] ?? "http://127.0.0.1:18103";
const LABEL = { policyIdentifier: { name: "NATO" }, classification: "UNCLASSIFIED" };
const SOURCE = { plugin: "marketing-scene" };
const PORT = 47617; // the DMA's own pair (47607, the manual's example, may be taken by another test on the same computer)

async function call(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// The two links (Settings > GMTI); the receiving one makes the layer "GMTI in".
const settings = (await call("GET", "/api/settings/plugins/gmti")).values;
settings.links = [
  { name: "gmti-out", mode: "udp", direction: "out", host: "127.0.0.1", port: PORT, enabled: true },
  { name: "gmti-in", mode: "udp", direction: "in", listen: { address: "127.0.0.1", port: PORT }, targetLayer: { name: "GMTI in" }, platformIdentity: "friend", enabled: true },
];
await call("PUT", "/api/settings/plugins/gmti", settings);
// Slightly larger detection marks for the picture (Settings > Symbology; 10 px as delivered).
const symbology = (await call("GET", "/api/settings/plugins/symbology")).values;
await call("PUT", "/api/settings/plugins/symbology", { ...symbology, sensorReportSize: 13 });

const socket = new WebSocket(`${BASE.replace(/^http/, "ws")}/api/live`);
const waiting = new Map();
let layers = null;
await new Promise((resolve, reject) => {
  socket.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    if (m.type === "welcome") socket.send(JSON.stringify({ type: "subscribe", subscription: "layers", objects: false, workspaces: ["*"] }));
    if (m.layers && !layers) {
      layers = m.layers;
      resolve();
    }
    if (m.type === "change-outcome") waiting.get(m.requestId)?.(m);
  });
  socket.addEventListener("close", () => reject(new Error("connection closed")));
});
const sim = layers.find((l) => l.workspace === "simulator.simulation");
if (!sim) throw new Error("no Simulation layer");

function create(data) {
  const requestId = randomUUID();
  const entityId = randomUUID();
  return new Promise((resolve, reject) => {
    waiting.set(requestId, (m) => (m.outcome === "applied" ? resolve(entityId) : reject(new Error(JSON.stringify(m.rejection ?? m)))));
    socket.send(JSON.stringify({ type: "change-request", request: { requestId, entityType: "object", operation: "create", entityId, data, source: SOURCE } }));
  });
}
const track = (sidc, [lon, lat], altitude) =>
  create({
    type: "core.symbol",
    dataType: "core.general",
    dataSource: "manual",
    layerId: sim.id,
    geometry: { type: "Point", coordinates: altitude === undefined ? [lon, lat] : [lon, lat, altitude] },
    symbol: { standard: "APP-6D", sidc },
    label: LABEL,
  });
const route = (name, points, speed, end, colour) =>
  create({
    type: "core.shape",
    dataType: "simulator.route",
    dataSource: "manual",
    layerId: sim.id,
    geometry: { type: "LineString", coordinates: points },
    style: { strokeColor: colour, strokeWidth: 2, strokeDash: "dash", pointMarkers: "circle" },
    properties: { name },
    label: LABEL,
    extensions: { simulator: { points: points.map(() => ({ speedKind: "instant", speed })), groups: [], end } },
  });
const sim_ = (path, body) => call("POST", `/api/plugins/simulator${path}`, body);

const FRIEND_JET = "10030100001101000000";
const HOSTILE_ARMOUR = "10061000141205000000"; // hostile armoured platoon
const HOSTILE_MECH = "10061000141211020000"; // hostile mechanized infantry platoon

// The tracks first, then the routes (a route created before its tracks would lose them).
const hawk = await track(FRIEND_JET, [17.72, 57.0], 7000);
const colA = [];
for (let i = 0; i < 8; i++) colA.push(await track(HOSTILE_ARMOUR, [18.25, 57.43]));
const colB = [];
for (let i = 0; i < 7; i++) colB.push(await track(HOSTILE_MECH, [18.3, 57.13]));
const colC = [];
for (let i = 0; i < 6; i++) colC.push(await track(HOSTILE_ARMOUR, [18.53, 57.2]));

const r0 = await route("HAWK", [[17.72, 57.0], [17.74, 57.95]], 140, "stop", "#1f78b4");
const rA = await route("COLUMN A", [[18.25, 57.43], [18.38, 57.41], [18.5, 57.38], [18.6, 57.37]], 20, "stop", "#d4382c");
const rB = await route("COLUMN B", [[18.3, 57.13], [18.32, 57.22], [18.36, 57.3], [18.38, 57.36]], 20, "stop", "#d4382c");
const rC = await route("COLUMN C", [[18.53, 57.2], [18.45, 57.18], [18.38, 57.17]], 18, "stop", "#d4382c");

await sim_("/put-on-route", { route: r0, kind: "single", objects: [hawk] });
await sim_("/put-on-route", { route: rA, kind: "convoy", spacing: 600, objects: colA });
await sim_("/put-on-route", { route: rB, kind: "convoy", spacing: 600, objects: colB });
await sim_("/put-on-route", { route: rC, kind: "convoy", spacing: 600, objects: colC });

// The ground radar on HAWK: to its right (60 to 120 degrees from its heading), 10 to 50 km out, with
// small dwells that scan the area (some of them empty) and some measurement error, so that each
// column shows as a cloud of detections.
const offered = await sim_("/sensors", { platform: hawk, create: true, type: "GROUND_RADAR" }).then(() => call("GET", "/api/plugins/simulator/sensors"));
const out = offered.channels.find((c) => c.plugin === "gmti" && /gmti-out/.test(c.id));
if (!out) throw new Error("no gmti output channel offered: " + JSON.stringify(offered.channels));
await sim_("/sensors", { platform: hawk, minRange: 10000, maxRange: 50000, startBearing: 60, endBearing: 120, preset: "custom", searchWidth: 6, dwellDepth: 12000, dwellInterval: 0.5, emptyShare: 0.4, rangeError: 100, crossRangeError: 250, outputs: [out.id] });
for (const r of [r0, rA, rB, rC]) await sim_(`/routes/${r}/start`, {});

await new Promise((resolve) => {
  socket.addEventListener("close", resolve);
  socket.close(1000);
});
console.log("gmti scene placed and started; output", out.id, "- take gmti.jpg about 4 minutes later, when the columns are strung out");
process.exit(0);
