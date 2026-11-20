// Seeds and starts the fictional simulation that the marketing screenshots show, in a running emcc.
//
//   node sim-scene.mjs [base-url]       (default http://127.0.0.1:18103; after scene.mjs, no login)
//
// It finds the Simulation workspace's layer over the live picture WebSocket, creates tracks and three
// routes there as change requests, puts the tracks on the routes and starts every route through the
// simulator's endpoints (plugins/simulator/README.md, "Endpoints"), as the integration tests do. All
// names and positions are made up. Positions are WGS84, longitude first; speeds in m/s.
import { randomUUID } from "node:crypto";

const BASE = process.argv[2] ?? "http://127.0.0.1:18103";
const LABEL = { policyIdentifier: { name: "NATO" }, classification: "UNCLASSIFIED" };
const SOURCE = { plugin: "marketing-scene" };

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
if (!sim) throw new Error("no Simulation layer in " + JSON.stringify(layers.map((l) => l.name)));

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
async function post(path, body) {
  const r = await fetch(`${BASE}/api/plugins/simulator${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const HOSTILE_JET = "10060100001101000000";
const FRIEND_JET = "10030100001101000000";
const FRIEND_SHIP = "10033000001201000000";

// The tracks first, then the routes (a route created before its tracks would lose them).
const raid = [await track(HOSTILE_JET, [21.0, 58.05], 6000), await track(HOSTILE_JET, [21.0, 58.05], 6000), await track(HOSTILE_JET, [21.0, 58.05], 6000)];
const cap = [await track(FRIEND_JET, [18.2, 58.4], 8000), await track(FRIEND_JET, [18.2, 58.4], 8000)];
const ships = [await track(FRIEND_SHIP, [17.3, 57.0], 0), await track(FRIEND_SHIP, [17.3, 57.0], 0), await track(FRIEND_SHIP, [17.3, 57.0], 0)];

const raven = await route("RAVEN", [[21.0, 58.05], [20.0, 57.95], [19.3, 57.75], [18.9, 57.35], [20.2, 57.2], [21.0, 58.05]], 240, "restart", "#d4382c");
const eagle = await route("EAGLE", [[18.2, 58.4], [19.1, 58.25], [19.4, 57.9], [18.6, 57.95], [18.2, 58.4]], 200, "restart", "#1f78b4");
const gull = await route("GULL", [[17.3, 57.0], [17.9, 57.15], [18.15, 57.45], [18.05, 57.9], [18.6, 58.5]], 9, "stop", "#2c784c");

await post("/put-on-route", { route: raven, kind: "convoy", spacing: 6000, objects: raid });
await post("/put-on-route", { route: eagle, kind: "convoy", spacing: 8000, objects: cap });
await post("/put-on-route", { route: gull, kind: "convoy", spacing: 2500, objects: ships });
await post("/routes/start", {});
await new Promise((resolve) => {
  socket.addEventListener("close", resolve);
  socket.close(1000);
});
console.log("simulation placed and started");
process.exit(0);
