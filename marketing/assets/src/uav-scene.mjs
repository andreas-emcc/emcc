// Sets up the fictional UAV picture (uav.jpg) in a running emcc (M9 or later, no login): a friendly UAV
// track that orbits Sundsvall's harbour in the Simulation workspace, a simulated camera on it
// (uav-simulation) that tracks the harbour, an fmv output link that draws and sends its video, and an
// fmv input link on the same loopback port, so that View shows the camera, its field of view and the video.
//
//   node uav-scene.mjs [base-url] [port]       (default http://127.0.0.1:18103 and 15610)
//
// The release draws the video from the imagery and heights in its settings folder (manual chapter
// "FMV output links, imagery and terrain"): the Sundsvall demo heights (SRTM, public domain) and an
// imagery set of Lantmäteriet's historical orthophotos of 2001 (CC0), both put there by hand
// (marketing/README.md). The track, its name and the mission are made up. Positions are WGS84,
// longitude first; speeds in m/s, heights in metres.
import { randomUUID } from "node:crypto";

const BASE = process.argv[2] ?? "http://127.0.0.1:18103";
const PORT = Number(process.argv[3] ?? 15610);
const LABEL = { policyIdentifier: { name: "NATO" }, classification: "UNCLASSIFIED" };
const SOURCE = { plugin: "marketing-scene" };
const FRIEND_UAV = "10030100001103000000";
const HARBOUR = [17.325, 62.392];
// An orbit of about 4 km round the harbour, flown clockwise from the north.
const ORBIT = [[17.325, 62.428], [17.402, 62.392], [17.325, 62.356], [17.248, 62.392], [17.325, 62.428]];
const ALTITUDE = 2500;
const SPEED = 50;

async function call(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text}`);
  return text === "" ? null : JSON.parse(text);
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// fmv: the output link that sends the camera's video, and the input link that receives it.
const settings = (await call("GET", "/api/settings/plugins/fmv")).values;
settings.links = [
  { name: "UAV out", enabled: true, direction: "out", mode: "udp", address: "127.0.0.1", port: PORT },
  { name: "UAV 1 video", enabled: true, direction: "in", mode: "udp", port: PORT, cameraIdentity: "friend" },
];
await call("PUT", "/api/settings/plugins/fmv", settings);
const outLink = (await call("GET", "/api/settings/plugins/fmv")).values.links.find((l) => l.name === "UAV out");
const output = `fmv/out-${outLink.id}`;

// The track and its route, as change requests over the live picture WebSocket.
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
const track = await create({
  type: "core.symbol",
  dataType: "core.general",
  dataSource: "manual",
  layerId: sim.id,
  geometry: { type: "Point", coordinates: [...ORBIT[0], ALTITUDE] },
  symbol: { standard: "APP-6D", sidc: FRIEND_UAV },
  properties: { name: "UAV 1" },
  label: LABEL,
});
const route = await create({
  type: "core.shape",
  dataType: "simulator.route",
  dataSource: "manual",
  layerId: sim.id,
  geometry: { type: "LineString", coordinates: ORBIT },
  style: { strokeColor: "#1f78b4", strokeWidth: 2, strokeDash: "dash", pointMarkers: "circle" },
  properties: { name: "ORBIT" },
  label: LABEL,
  extensions: { simulator: { points: ORBIT.map(() => ({ speedKind: "instant", speed: SPEED, altitudeKind: "instant", altitude: ALTITUDE })), groups: [], end: "restart" } },
});
await call("POST", "/api/plugins/simulator/put-on-route", { route, kind: "single", objects: [track] });

// uav-simulation: the camera on the track, tracking the harbour, sending on the output link.
for (let i = 0; ; i++) {
  const { outputs } = await call("GET", "/api/plugins/uav-simulation/cameras");
  if (outputs.some((o) => o.id === output)) break;
  if (i === 30) throw new Error(`the output ${output} is not on offer: ${JSON.stringify(outputs)}`);
  await pause(1000);
}
const created = await call("POST", "/api/plugins/uav-simulation/cameras", {
  platform: track, mode: "trackPoint", point: HARBOUR, pointHeight: 0, horizontalFov: 30,
  frameSize: "1280x720", frameRate: 25, mission: "EMCC DEMO", output,
});
const camera = created.id ?? created.camera?.id;
await call("POST", "/api/plugins/simulator/routes/start", {});
await call("POST", `/api/plugins/uav-simulation/cameras/${camera}/start`, {});
await new Promise((resolve) => {
  socket.addEventListener("close", resolve);
  socket.close(1000);
});
console.log(`UAV 1 orbits the harbour; its camera ${camera} sends on "UAV out" to 127.0.0.1:${PORT}, received by "UAV 1 video"`);
process.exit(0);
