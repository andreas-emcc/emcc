// Takes the marketing screenshots from a running emcc release.
//
//   node scene.mjs [base-url]                 once, on a freshly unpacked release started without login
//   node shots.mjs [base-url] [out-folder]    default http://127.0.0.1:18103 and ../screenshots
//
// The pictures show the real UI with the release's demo scenario, the fictional exercise that
// scene.mjs adds, and Natural Earth as the background (never OpenStreetMap tiles; agents/dma.md
// rule 4). It uses Playwright's Chromium, the browser that the integration tests install.
// Each shot is a JPEG at 1600 x 900 (the website scales them down); `--only=<name>` takes one and
// `--skip=<name>[,<name>]` leaves steps out. gmti.jpg needs a release of its own: reset, `node gmti-scene.mjs`,
// wait about four minutes, then `node shots.mjs --only=gmti`; fmv.jpg needs our own stream running,
// uav.jpg an M9 release with uav-scene.mjs (marketing/README.md).
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const BASE = args[0] ?? "http://127.0.0.1:18103";
const OUT = path.resolve(args[1] ?? path.join(HERE, "..", "screenshots"));
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7);
const SKIP = (process.argv.find((a) => a.startsWith("--skip=")) ?? "").slice(7).split(",").filter(Boolean);
const GMTI_CENTRE = "57.29 18.13";
const GMTI_WAIT = 12000;
// The FMV picture: round the harbour that the demo camera tracks (fmv/route.json), close enough for
// the camera's orbit.
// The map centre lies west of it, so that the camera and its arc sit to the right of the video window.
const FMV_CENTRE = "62.392 17.175";
const FMV_SCALE = "5 km";
const FMV_WAIT = 8000;
// The UAV picture: the orbit of uav-scene.mjs round the same harbour, west of centre for the same reason.
const UAV_CENTRE = "62.392 17.238";
const UAV_SCALE = "4 km"; // one zoom level in from FMV_SCALE once Go to has moved north (the bar then reads 2 km)
// The height map's circle: hilly ground west of Sundsvall, inside the demo data (62-63 N, 16-18 E).
const TERRAIN_CENTRE = "62.32 16.62"; // a valley to the north, the highest point (about 502 m) to the south
const TERRAIN_SCALE = "10 km";
const TERRAIN_RADIUS_M = 18000;
const TERRAIN_METRES_PER_PX = [50, 100]; // the zoom the circle is framed for (the 5 km bar at about 67 m)
const W = 1600;
const H = 900;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const failures = [];

async function open(scheme, projection = "EPSG:3857") {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: scheme, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const h = helpers(p);
  await p.goto(BASE);
  await p.locator(".pane-left").waitFor();
  await h.wait(4000);
  if (await h.btn("Dismiss").isVisible()) await h.btn("Dismiss").click();
  await h.mapControls();
  await h.select("EPSG:3413").selectOption({ label: projection });
  await h.wait(1500);
  await h.select("Natural Earth").selectOption({ label: "Natural Earth" });
  await h.wait(1500);
  await h.btn("Close").first().click();
  await h.wait(300);
  return { p, ctx, h };
}

function helpers(p) {
  const wait = (ms = 600) => p.waitForTimeout(ms);
  const btn = (name, o = {}) => p.getByRole("button", { name, ...o });
  const select = (option) => p.locator("select").filter({ has: p.locator("option", { hasText: option }) });
  return {
    wait,
    btn,
    select,
    async mapControls() {
      if (!(await p.getByText("Projection", { exact: true }).isVisible())) await btn("Map controls").click();
      await wait(300);
    },
    // The map view is kept per user, so every shot first zooms out as far as the map goes, then
    // zooms in until the map shows at most as many metres a pixel as a scale bar of `scale` (e.g.
    // "10 km") 115 px long, then centres. (Go to at the widest view is held back by the map's edge,
    // so it comes last.) The bar's text alone is not enough: it can stay the same over two zoom
    // levels ("50 km" at 73 px, then at 144 px), so its text and its length are read together.
    async view(latLon, scale) {
      const bar = p.locator(".map-view-2d-scale-line-inner").first();
      const scaleText = async () => ((await bar.textContent()) ?? "").replace(/\s+/g, " ").trim();
      const metres = (t) => {
        const m = /^([\d.]+) (mm|m|km)$/.exec(t);
        return m ? Number(m[1]) * { mm: 0.001, m: 1, km: 1000 }[m[2]] : NaN;
      };
      const resolution = async () => metres(await scaleText()) / (await bar.boundingBox()).width;
      const target = metres(scale) / 115;
      const minus = p.locator("button.map-view-2d-zoom-out");
      const plus = p.locator("button.map-view-2d-zoom-in");
      for (let i = 0, last = 0; i < 25; i++) {
        await minus.click();
        await wait(700);
        const now = await resolution();
        if (Math.abs(now - last) < now * 0.01) break;
        last = now;
      }
      for (let i = 0; i < 25 && !((await resolution()) <= target * 1.02); i++) {
        await plus.click();
        await wait(1000); // the zoom animates; the bar is read once it has settled
      }
      if (!((await resolution()) <= target * 1.02)) throw new Error(`the scale bar shows ${await scaleText()}, not ${scale} or less`);
      if (latLon) {
        await btn("Coordinates").click();
        await wait(400);
        await p.locator('input[placeholder*="°"]').fill(latLon);
        await p.keyboard.press("Enter");
        await wait(1200);
        await btn("Coordinates").click();
        await wait(300);
      }
      await wait(2500);
    },
    async pointAt(fx, fy) {
      const b = await p.locator(".pane-bottom").boundingBox();
      const l = await p.locator(".pane-left").boundingBox();
      const r = await p.locator(".pane-right").boundingBox();
      const x0 = l.x + l.width;
      await p.mouse.move(x0 + (r.x - x0) * fx, 40 + (b.y - 40) * fy);
      await wait(300);
    },
    async objectsOf(layer) {
      await p.getByRole("tab", { name: "Objects" }).click();
      await p.locator(".pane-bottom").getByRole("combobox", { name: "Layer" }).first().selectOption({ label: layer });
      await wait(1500);
    },
    async collapse(title) {
      const panel = p.locator(".panel", { has: p.locator(".panel-title-text", { hasText: new RegExp(`^${title}$`, "i") }) }).first();
      const head = panel.locator(".panel-head button[aria-expanded=true]").first();
      if (await head.count()) await head.click();
      await wait(400);
    },
    async expand(title) {
      const panel = p.locator(".panel", { has: p.locator(".panel-title-text", { hasText: new RegExp(`^${title}$`, "i") }) }).first();
      const head = panel.locator(".panel-head button[aria-expanded=false]").first();
      if (await head.count()) await head.click();
      await wait(500);
    },
  };
}

async function shot(p, name) {
  await p.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 86 });
  console.log("  shot", name);
}

async function step(name, fn) {
  if ((ONLY && !name.includes(ONLY)) || SKIP.some((x) => name.includes(x))) return;
  console.log(name);
  try {
    await fn();
  } catch (e) {
    failures.push(`${name}: ${String(e.message).split("\n")[0]}`);
    console.log("  FAILED:", String(e.message).split("\n").slice(0, 3).join(" / "));
  }
}

await step("arctic", async () => {
  const { p, ctx, h } = await open("light", "EPSG:3413");
  await h.view(null, "1000 km");
  await p.getByRole("tab", { name: "Layers" }).click();
  await h.wait(1500);
  await shot(p, "arctic");
  await ctx.close();
});

for (const scheme of ["light", "dark"]) {
  await step(`view-${scheme}`, async () => {
    const { p, ctx, h } = await open(scheme);
    await h.view("57.605 18.55", "10 km");
    await h.objectsOf("Exercise – control measures");
    await h.pointAt(0.47, 0.32);
    await h.expand("Graphics");
    await h.wait(1500);
    await shot(p, `view-${scheme}`);
    await ctx.close();
  });
}

await step("view-select", async () => {
  const { p, ctx, h } = await open("light");
  await h.view("57.605 18.55", "10 km");
  await h.expand("Symbols");
  await h.expand("Symbol properties");
  // 1 MECH's symbol at this view (the frame of view-light.jpg).
  await p.mouse.click(666, 230);
  await h.wait(1500);
  await p.getByRole("tab", { name: "Layers" }).click();
  await h.wait(1500);
  await shot(p, "view-select");
  await ctx.close();
});

await step("simulation", async () => {
  const { p, ctx, h } = await open("dark");
  await p.getByText("Simulation", { exact: true }).first().click();
  await h.wait(3000);
  if (await h.btn("Dismiss").isVisible()) await h.btn("Dismiss").click();
  await h.view("57.70 19.15", "50 km");
  await h.expand("Routes");
  await p.getByRole("tab", { name: "Layers" }).click();
  await h.wait(4000);
  await shot(p, "simulation");
  await ctx.close();
});

// After gmti-scene.mjs on its own: the radar aircraft's coverage (an arc band to its right), its
// dwells, and what comes back through the gmti link into the layer "GMTI in" (the platform, the dwell
// areas, the coverage box, the detections), shown in Simulation as a reference layer. The Simulation
// layer itself is hidden in this browser, so the detections are not under the tracks' symbols.
await step("gmti", async () => {
  const { p, ctx, h } = await open("dark");
  await p.getByText("Simulation", { exact: true }).first().click();
  await h.wait(3000);
  if (await h.btn("Dismiss").isVisible()) await h.btn("Dismiss").click();
  await h.view(GMTI_CENTRE, "10 km");
  await h.expand("Routes");
  await h.expand("Sensors");
  for (const name of ["Show coverage", "Show dwells"]) {
    const box = p.getByRole("checkbox", { name, exact: true });
    if (!(await box.isChecked())) await box.check();
  }
  await p.getByRole("tab", { name: "Layers" }).click();
  await h.wait(800);
  const eye = p.locator(".pane-bottom").getByRole("button", { name: /^Show GMTI in/ });
  if (await eye.count()) await eye.first().click();
  await p.locator(".pane-bottom").getByRole("button", { name: "Hide Simulation", exact: true }).click();
  // Display settings (this user's own): no pairing lines, so the detections stand out. (M7 also had a
  // "Name" label to untick; from M8 labels are set by place, and dwell areas have no name.)
  await h.btn("Display settings").click();
  await h.wait(500);
  for (const name of ["GMTI Pairing"]) {
    const box = p.getByRole("checkbox", { name, exact: true });
    // The switch saves first and then shows its new state, so click and wait rather than uncheck().
    if (await box.isChecked()) await box.click();
    await h.wait(1200);
  }
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await h.wait(GMTI_WAIT);
  await shot(p, "gmti");
  await ctx.close();
});

await step("settings", async () => {
  const { p, ctx, h } = await open("light");
  await p.getByText("Settings", { exact: true }).first().click();
  await h.wait(3000);
  await p.getByText("Cursor on Target", { exact: true }).locator("visible=true").first().click();
  await h.wait(2500);
  await shot(p, "settings");
  await ctx.close();
});

// The height map (Terrain, from M7) over the release's Sundsvall demo height data, unpacked into
// %emcc%/settings/terrain: a circle drawn with the panel's tool (press on the centre, drag to the
// radius), 16 bands from red (lowest) to green (highest) and the highest point's white cross.
await step("terrain", async () => {
  const { p, ctx, h } = await open("dark");
  await h.view(TERRAIN_CENTRE, TERRAIN_SCALE);
  for (const panel of ["Symbols", "Graphics", "Symbol properties"]) await h.collapse(panel);
  await h.expand("Terrain");
  await p.getByRole("tab", { name: "Layers" }).click();
  await h.wait(800);
  // The scale bar's text and length give the zoom; the zoom buttons' animation can land a step off.
  const bar = p.locator(".map-view-2d-scale-line-inner").first();
  const resolution = async () => {
    const km = Number(((await bar.textContent()) ?? "").replace(/\s+/g, " ").trim().replace(/ km$/, ""));
    return (km * 1000) / (await bar.boundingBox()).width;
  };
  let metresPerPx = await resolution();
  for (let i = 0; i < 4 && !(metresPerPx >= TERRAIN_METRES_PER_PX[0] && metresPerPx <= TERRAIN_METRES_PER_PX[1]); i++) {
    await p.locator(metresPerPx < TERRAIN_METRES_PER_PX[0] ? "button.map-view-2d-zoom-out" : "button.map-view-2d-zoom-in").click();
    await h.wait(1500);
    metresPerPx = await resolution();
  }
  const l = await p.locator(".pane-left").boundingBox();
  const r = await p.locator(".pane-right").boundingBox();
  const b = await p.locator(".pane-bottom").boundingBox();
  const cx = (l.x + l.width + r.x) / 2;
  const cy = (40 + b.y) / 2;
  await h.btn("Draw a circle").click();
  await h.wait(500);
  await p.mouse.move(cx, cy);
  await p.mouse.down();
  await p.mouse.move(cx + TERRAIN_RADIUS_M / metresPerPx, cy, { steps: 20 });
  await p.mouse.up();
  await p.getByText("Highest", { exact: true }).first().waitFor({ timeout: 60000 });
  await h.wait(2500);
  await p.mouse.move(cx, b.y - 20);
  await shot(p, "terrain");
  await ctx.close();
});

// Full motion video (fmv, from M8): after fmv-scene.mjs, with spike S10's LiveSender sending our own
// rendered stream to the link. View in the dark look round the tracked harbour: the camera symbol and
// its field of view on the map, the FMV panel's row, and the stream in its window (Watch).
// The UAV picture (uav-simulation, from M9) is the same view of the release's own simulated camera,
// after uav-scene.mjs.
const video = (name, centre, scale) => step(name, async () => {
  const { p, ctx, h } = await open("dark");
  await h.view(centre, scale);
  for (const panel of ["Symbols", "Graphics", "Symbol properties", "Terrain"]) await h.collapse(panel);
  await h.expand("FMV");
  await p.getByRole("tab", { name: "Layers" }).click();
  await h.wait(1500);
  await h.btn("Watch").first().click();
  await h.wait(1500);
  // Drag the window by its title to the map's upper left.
  const tb = await p.locator(".emc2-window-title").first().boundingBox();
  const left = await p.locator(".pane-left").boundingBox();
  const grip = { x: tb.x + tb.width - 80, y: tb.y + tb.height / 2 }; // beside the title's text, left of Close
  await p.mouse.move(grip.x, grip.y);
  await p.mouse.down();
  await p.mouse.move(grip.x - (tb.x - (left.x + left.width + 14)), grip.y - (tb.y - 52), { steps: 15 });
  await p.mouse.up();
  await h.wait(500);
  // Make it smaller by its corner (the window keeps the video's shape).
  const wb = await p.locator(".emc2-window").first().boundingBox();
  await p.mouse.move(wb.x + wb.width - 4, wb.y + wb.height - 4);
  await p.mouse.down();
  await p.mouse.move(wb.x + 500, wb.y + 360, { steps: 15 });
  await p.mouse.up();
  await h.wait(FMV_WAIT);
  // Last over the map's lower right, so that the corner readout shows a position in this view.
  const right = await p.locator(".pane-right").boundingBox();
  const bottom = await p.locator(".pane-bottom").boundingBox();
  await p.mouse.move(right.x - 140, bottom.y - 70, { steps: 5 });
  await h.wait(300);
  await shot(p, name);
  await ctx.close();
});
await video("fmv", FMV_CENTRE, FMV_SCALE);
await video("uav", UAV_CENTRE, UAV_SCALE);

// Settings > Labeling with scene.mjs's premade labels: the NATO policy open, the SWE policy folded
// (the page names no policy but NATO; owner, 2026-11-12), and the New label form with its preview.
await step("labeling", async () => {
  const { p, ctx, h } = await open("dark");
  await p.getByText("Settings", { exact: true }).first().click();
  await h.wait(2500);
  await p.getByText("Labeling", { exact: true }).locator("visible=true").first().click();
  await h.wait(2000);
  await p.locator("button.labeling-toggle", { has: p.locator("strong", { hasText: /^SWE$/ }) }).click();
  await h.wait(600);
  await p.getByRole("button", { name: "+ New label" }).first().click();
  await h.wait(800);
  await h.select("COSMIC TOP SECRET").locator("visible=true").first().selectOption({ label: "COSMIC TOP SECRET" });
  await h.wait(400);
  // The form's value chips are named by the value alone; the policy's list says "<value>: rename or remove".
  for (const value of ["FIN", "NOR", "SWE"]) await p.getByRole("button", { name: value, exact: true }).click();
  await h.wait(1200);
  await p.mouse.move(1500, 800);
  await shot(p, "labeling");
  await ctx.close();
});

await step("monitor", async () => {
  const { p, ctx, h } = await open("dark");
  await p.getByText("Monitor", { exact: true }).first().click();
  await h.wait(4000);
  await shot(p, "monitor");
  await ctx.close();
});

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} step(s) failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
