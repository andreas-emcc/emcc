// Seeds the fictional exercise that the marketing screenshots show, into a running emcc.
//
//   node scene.mjs [base-url]          (default http://127.0.0.1:18103)
//
// Run it once on an emcc just unpacked from a release zip and started without login. It sends
// change requests over the live picture WebSocket (/api/live), as any client does, and so adds three
// layers to the release's own demo scenario: a fictitious brigade task force advancing south across
// Gotland, its control measures, and an opposing force. All units, names and positions are made up.
// Positions are WGS84, longitude first. Units carry no name property: the map would draw it as a
// label beside the designation that the symbol already shows.
import { randomUUID } from "node:crypto";

const BASE = process.argv[2] ?? "http://127.0.0.1:18103";
const LABEL = { policyIdentifier: { name: "NATO" }, classification: "UNCLASSIFIED" };
const SOURCE = { plugin: "marketing-scene" };

// APP-6D SIDC: version 10, context 0, identity, symbol set, status 0, HQ/task force, echelon, entity, 0000.
const FRIEND = "3";
const HOSTILE = "6";
const sidc = (identity, set, entity, { echelon = "00", hq = "0", planned = false } = {}) =>
  `10${"0"}${identity}${set}${planned ? "1" : "0"}${hq}${echelon}${entity}0000`;
const BN = "16";
const COY = "15";
const BDE = "18";

const socket = new WebSocket(`${BASE.replace(/^http/, "ws")}/api/live`);
const waiting = new Map();
await new Promise((resolve, reject) => {
  socket.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    if (m.type === "welcome") resolve();
    if (m.type === "change-outcome") {
      const w = waiting.get(m.requestId);
      if (w) {
        waiting.delete(m.requestId);
        w(m);
      }
    }
  });
  socket.addEventListener("close", () => reject(new Error("connection closed")));
});

let failed = 0;
function send(entityType, data) {
  const requestId = randomUUID();
  const entityId = randomUUID();
  return new Promise((resolve) => {
    waiting.set(requestId, (m) => {
      if (m.outcome !== "applied") {
        failed++;
        console.log("rejected:", JSON.stringify(m.rejection ?? m), JSON.stringify(data).slice(0, 200));
      }
      resolve(entityId);
    });
    socket.send(JSON.stringify({ type: "change-request", request: { requestId, entityType, operation: "create", entityId, data, source: SOURCE } }));
  });
}
const layer = (name, drawOrder) => send("layer", { name, drawOrder, visible: true, label: LABEL });
const base = (layerId, type, geometry, symbol, name) => ({
  type,
  dataType: "core.general",
  dataSource: "manual",
  layerId,
  geometry,
  symbol: { standard: "APP-6D", ...symbol },
  ...(name ? { properties: { name } } : {}),
  label: LABEL,
});
const unit = (layerId, code, [lon, lat], designation, direction) =>
  send(
    "object",
    base(layerId, "core.symbol", { type: "Point", coordinates: [lon, lat] }, { sidc: code, modifiers: { uniqueDesignation: designation, ...(direction !== undefined ? { direction } : {}) } }, null),
  );
const line = (layerId, code, points, designation, name) =>
  send("object", base(layerId, "core.multipoint", { type: "LineString", coordinates: points }, { sidc: code, ...(designation ? { modifiers: { uniqueDesignation: designation } } : {}) }, name));
const area = (layerId, code, ring, designation, name) =>
  send(
    "object",
    base(layerId, "core.multipoint", { type: "Polygon", coordinates: [[...ring, ring[0]]] }, { sidc: code, ...(designation ? { modifiers: { uniqueDesignation: designation } } : {}) }, name),
  );

const measures = await layer("Exercise – control measures", 50);
const own = await layer("Exercise – task force", 52);
const opfor = await layer("Exercise – opposing force", 51);

// Control measures of the task force (friend).
await line(measures, sidc(FRIEND, "25", "110100", { echelon: BN }), [[18.53, 57.83], [18.545, 57.70], [18.52, 57.56], [18.54, 57.38]], null, "Battalion boundary");
await line(measures, sidc(FRIEND, "25", "141000"), [[18.32, 57.735], [18.40, 57.73], [18.62, 57.74], [18.84, 57.745]], "GREEN", "Line of departure GREEN");
await line(measures, sidc(FRIEND, "25", "140300"), [[18.22, 57.615], [18.40, 57.61], [18.62, 57.62], [18.79, 57.625]], "AMBER", "Phase line AMBER");
await line(measures, sidc(FRIEND, "25", "140300", { planned: true }), [[18.20, 57.485], [18.40, 57.48], [18.62, 57.49], [18.84, 57.495]], "BLUE", "Phase line BLUE");
// Axes: the tip, back along the axis to the tail, then a point that sets the arrowhead's width.
await line(measures, sidc(FRIEND, "25", "151403"), [[18.42, 57.462], [18.43, 57.56], [18.445, 57.70], [18.47, 57.485]], null, "Main attack");
await line(measures, sidc(FRIEND, "25", "151404"), [[18.66, 57.475], [18.665, 57.58], [18.655, 57.70], [18.70, 57.497]], null, "Supporting attack");
await area(measures, sidc(FRIEND, "25", "151700"), [[18.34, 57.41], [18.43, 57.40], [18.51, 57.415], [18.50, 57.458], [18.36, 57.462]], "KESTREL", "Objective KESTREL");
await area(measures, sidc(FRIEND, "25", "150200"), [[18.40, 57.752], [18.515, 57.748], [18.52, 57.805], [18.42, 57.81]], "OAK", "Assembly area OAK");

// The task force (friend).
await unit(own, sidc(FRIEND, "10", "121100", { echelon: BDE, hq: "2" }), [18.63, 57.788], "TF NORTH");
await unit(own, sidc(FRIEND, "10", "121104", { echelon: BN }), [18.40, 57.712], "1 MECH", 180);
await unit(own, sidc(FRIEND, "10", "121104", { echelon: BN }), [18.68, 57.717], "2 MECH", 180);
await unit(own, sidc(FRIEND, "10", "120500", { echelon: BN }), [18.605, 57.688], "3 ARM");
await unit(own, sidc(FRIEND, "10", "121300", { echelon: COY }), [18.40, 57.655], "A RECCE", 180);
await unit(own, sidc(FRIEND, "10", "121300", { echelon: COY }), [18.73, 57.65], "B RECCE", 180);
await unit(own, sidc(FRIEND, "10", "130300", { echelon: BN }), [18.80, 57.782], "4 ARTY");
await unit(own, sidc(FRIEND, "10", "140700", { echelon: COY }), [18.685, 57.762], "C ENGR");

// The opposing force (hostile). The release's own demo units A ARM and B INF stand nearby and fit in.
await unit(opfor, sidc(HOSTILE, "10", "121104", { echelon: BN }), [18.45, 57.392], "21 MR");
await unit(opfor, sidc(HOSTILE, "10", "120500", { echelon: COY }), [18.64, 57.445], "T ARM");
await unit(opfor, sidc(HOSTILE, "10", "121300", { echelon: COY }), [18.58, 57.545], "R RECON", 0);
await unit(opfor, sidc(HOSTILE, "10", "130300", { echelon: BN }), [18.605, 57.398], "22 ART");
await area(opfor, sidc(HOSTILE, "25", "270800"), [[18.555, 57.462], [18.62, 57.458], [18.625, 57.475], [18.56, 57.479]], null, "Mined area");

// Premade security labels for labeling.jpg (Settings > Labeling, from M6): the NATO policy's values
// and a few labels, in the form of ECore's Labeling (one document, replaced at once).
const rel = (values) => (values.length ? [{ tagName: "Releasable To", type: "permissive", values }] : []);
const nato = (classification, values = []) => ({ policyIdentifier: { name: "NATO" }, classification, categories: rel(values) });
const labeling = await fetch(`${BASE}/api/settings/labeling`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    policies: {
      NATO: {
        releasableTo: ["DNK", "EST", "FIN", "NOR", "SWE"],
        labels: [
          nato("SECRET", ["FIN", "SWE"]),
          nato("CONFIDENTIAL", ["DNK", "EST", "FIN", "NOR", "SWE"]),
          nato("CONFIDENTIAL", ["NOR"]),
          nato("RESTRICTED"),
          nato("RESTRICTED", ["FIN", "SWE"]),
          nato("UNCLASSIFIED"),
        ],
      },
    },
  }),
});
if (!labeling.ok) {
  failed++;
  console.log("labeling refused:", labeling.status, await labeling.text());
}

await new Promise((resolve) => {
  socket.addEventListener("close", resolve);
  socket.close(1000);
});
console.log(failed ? `${failed} change requests rejected` : "scene placed");
process.exit(failed ? 1 : 0);
