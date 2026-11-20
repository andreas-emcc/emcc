// Draws the stylised chart behind the website's map design: the coast from the Stockholm archipelago
// south to Gotland, with smooth lines.
//
//   node archipelago.mjs            writes ../maps/archipelago.svg
//
// The mainland and Gotland come from Natural Earth's 1:50m land (public domain; the copy in
// plugins/basemap-naturalearth/data/, read only), simplified and redrawn as smooth curves. The
// archipelago's islands are not in 1:50m data: they are smooth shapes placed at roughly the positions
// and sizes of the real islands, plus a seeded scatter of skerries in the outer archipelago. It is a
// picture inspired by the real map, not a chart: never for navigation.
//
// The SVG carries its own colours (near-black sea, dark grey land, light grey lines) and is 1000 units wide;
// the page stretches it over its full length.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..", "..");
const LAND = path.join(REPO, "plugins", "basemap-naturalearth", "data", "ne_50m_land.geojson");
const OUT = path.join(HERE, "..", "maps", "archipelago.svg");

// The strip: Stockholm's archipelago at the top, Gotland at the bottom (WGS84, degrees).
const W = 17.85, E = 19.25, S = 57.0, N = 60.35;
const K = Math.cos(((S + N) / 2) * (Math.PI / 180));
const WIDTH = 1000;
const HEIGHT = Math.round((WIDTH * (N - S)) / ((E - W) * K));
const xy = ([lon, lat]) => [((lon - W) / (E - W)) * WIDTH, ((N - lat) / (N - S)) * HEIGHT];
const KM = WIDTH / ((E - W) * K * 111.32); // SVG units per kilometre

// ---------- geometry helpers ----------
function simplify(points, tolerance) {
  // Douglas–Peucker on an open line.
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  let worst = 0, index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i], a, b);
    if (d > worst) [worst, index] = [d, i];
  }
  if (worst <= tolerance) return [a, b];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}
function distanceToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// A closed Catmull–Rom spline through the points, as cubic Béziers: smooth lines through every point.
function smoothClosed(points, tension = 0.5) {
  const n = points.length;
  const p = (i) => points[(i + n) % n];
  let d = `M${f(p(0)[0])} ${f(p(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const c1 = [p1[0] + ((p2[0] - p0[0]) * tension) / 3, p1[1] + ((p2[1] - p0[1]) * tension) / 3];
    const c2 = [p2[0] - ((p3[0] - p1[0]) * tension) / 3, p2[1] - ((p3[1] - p1[1]) * tension) / 3];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + "Z";
}
const f = (v) => (Math.round(v * 10) / 10).toString();
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A smooth island: an ellipse (lengths in km, angle in degrees from north) with a wavy rim.
function island([lon, lat], lengthKm, widthKm, angle, random) {
  const [cx, cy] = xy([lon, lat]);
  const a = (lengthKm * KM) / 2, b = (widthKm * KM) / 2;
  const turn = (angle * Math.PI) / 180;
  const count = lengthKm > 6 ? 14 : 9;
  const phase = random() * Math.PI * 2, waves = 2 + Math.floor(random() * 3);
  const points = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const r = 1 + 0.16 * Math.sin(waves * t + phase) + 0.1 * (random() - 0.5);
    const [ex, ey] = [b * Math.cos(t) * r, -a * Math.sin(t) * r];
    points.push([cx + ex * Math.cos(turn) - ey * Math.sin(turn), cy + ex * Math.sin(turn) + ey * Math.cos(turn)]);
  }
  return smoothClosed(orient(points), 0.55);
}

// 1:50m land covers the inner archipelago, so between 58.85° and 59.85° N the mainland's coast is
// pulled back to roughly the real inner shore (Nynäshamn, Stockholm, Norrtälje); the islands go east of it.
const SHORE = [
  [58.85, 17.95], [58.92, 17.89], [59.0, 18.03], [59.07, 17.97], [59.14, 18.12], [59.2, 18.06], [59.27, 18.2], [59.33, 18.12],
  [59.39, 18.27], [59.46, 18.22], [59.52, 18.4], [59.58, 18.36], [59.65, 18.55], [59.71, 18.5], [59.77, 18.68], [59.85, 18.8],
];
function innerCoast([lon, lat]) {
  if (lat < SHORE[0][0] || lat > SHORE[SHORE.length - 1][0] || lon < 17.5 || lon > 19.6) return [lon, lat];
  let i = 0;
  while (SHORE[i + 1][0] < lat) i++;
  const t = (lat - SHORE[i][0]) / (SHORE[i + 1][0] - SHORE[i][0]);
  return [Math.min(lon, SHORE[i][1] + t * (SHORE[i + 1][1] - SHORE[i][1])), lat];
}
// Every outline runs the same way round, so overlapping shapes join instead of cutting holes.
function orient(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [a, b] = [points[i], points[(i + 1) % points.length]];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area < 0 ? points.slice().reverse() : points;
}

// ---------- mainland and Gotland from Natural Earth ----------
const land = JSON.parse(fs.readFileSync(LAND, "utf8"));
const coasts = [];
for (const feature of land.features) {
  const g = feature.geometry;
  const polygons = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  for (const polygon of polygons) {
    const ring = polygon[0];
    if (!ring.some(([lon, lat]) => lon > W - 1 && lon < E + 1 && lat > S - 1 && lat < N + 1)) continue;
    // Far-away parts (the big polygon is all of Eurasia) are clamped onto a frame just outside the
    // picture, so the coast inside stays whole and the rest collapses into straight lines.
    const clamp = ([x, y]) => [Math.max(-150, Math.min(WIDTH + 150, x)), Math.max(-150, Math.min(HEIGHT + 150, y))];
    const projected = orient(simplify(ring.map(innerCoast).map(xy).map(clamp), 8));
    if (projected.length >= 4) coasts.push(smoothClosed(projected, 0.5));
  }
}

// ---------- the archipelago, after the real islands (approximate centre, length and width in km, angle) ----------
const ISLANDS = [
  ["Lidingö", [18.16, 59.36], 9, 5, 60], ["Värmdö", [18.55, 59.31], 24, 11, 80], ["Ingarö", [18.47, 59.24], 11, 7, 70],
  ["Resarö", [18.33, 59.43], 4, 2.5, 30], ["Rindö", [18.4, 59.39], 4, 2, 80], ["Ljusterö", [18.62, 59.52], 14, 6, 40],
  ["Gällnö", [18.62, 59.4], 3.5, 2, 20], ["Svartsö", [18.68, 59.45], 5, 2.5, 30], ["Ingmarsö", [18.75, 59.47], 3.5, 2.5, 0],
  ["Möja", [18.9, 59.42], 7, 3, 20], ["Runmarö", [18.76, 59.27], 4.5, 3, 10], ["Sandön", [18.91, 59.29], 2.5, 1.8, 0],
  ["Nämdö", [18.7, 59.19], 6, 3, 30], ["Ornö", [18.42, 59.06], 11, 4, 10], ["Utö", [18.34, 58.95], 7, 3, 20],
  ["Muskö", [18.11, 59.0], 5, 3.5, 40], ["Yxlan", [18.82, 59.63], 9, 4, 50], ["Blidö", [18.9, 59.6], 8, 4, 30],
  ["Rådmansö", [18.95, 59.77], 10, 5, 40], ["Väddö", [18.85, 59.95], 20, 6, 20], ["Arholma", [19.12, 59.85], 3, 2, 10],
  ["Gotska Sandön", [19.2, 58.37], 9, 5, 60], ["Landsort", [17.87, 58.74], 2.5, 1, 0], ["Fårö", [19.2, 57.92], 14, 8, 40],
];
const random = seeded(2026);
const islands = ISLANDS.map(([, at, length, width, angle]) => island(at, length, width, angle, random));
// Skerries: the outer archipelago (also orient()ed), a seeded scatter between the islands and the open sea.
const skerries = [];
for (let i = 0; i < 230; i++) {
  const lat = 58.85 + random() * 1.15;
  const outer = 18.55 + (lat - 58.85) * 0.25 + random() * 0.55; // the archipelago widens to the north
  const lon = Math.min(E - 0.02, outer);
  const size = 0.4 + random() ** 2 * 2.2;
  skerries.push(island([lon, lat], size * (1 + random()), size, random() * 180, random));
}
for (let i = 0; i < 40; i++) {
  const lat = 59.05 + random() * 0.45, lon = 18.2 + random() * 0.5;
  skerries.push(island([lon, lat], 0.5 + random() * 1.6, 0.4 + random(), random() * 180, random));
}

const landPaths = [...coasts, ...islands].join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" preserveAspectRatio="xMidYMin slice">
<!-- Stylised, inspired by the Stockholm archipelago and Gotland; coast after Natural Earth 1:50m (public domain). Not for navigation. -->
<style>
path{stroke-linejoin:round;fill:none}
.shoal2{stroke:#121315;stroke-width:34}
.shoal{stroke:#17181b;stroke-width:16}
.coast{stroke:#8e949a;stroke-width:3.2}
.sk-coast{stroke:#7d838a;stroke-width:2}
.fill{fill:#212327;fill-rule:nonzero}
</style>
<path class="shoal2" d="${landPaths}"/>
<path class="shoal" d="${landPaths}"/>
<path class="coast" d="${landPaths}"/>
<path class="sk-coast" d="${skerries.join("")}"/>
<path class="fill" d="${landPaths}${skerries.join("")}"/>
</svg>
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, svg);
console.log(`${OUT}: ${WIDTH} x ${HEIGHT}, ${coasts.length} coasts, ${islands.length} islands, ${skerries.length} skerries, ${svg.length} bytes`);
