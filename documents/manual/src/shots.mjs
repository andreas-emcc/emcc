// Takes the manual's screenshots (parts 2 to 6) from a running emcc.
//
//   node shots.mjs [base-url]
//
// It needs an emcc that has just been unpacked from a release zip and started without login (the
// run places objects, makes a bookmark and a setup, and changes the map), for example
//   start.bat -standalone 18098
// The base URL defaults to http://127.0.0.1:18098. Screenshots go to images/<chapter>-<step>.png.
//
// The script walks through the steps the chapters describe and checks what each step shows, so a
// step that no longer works as the manual says stops being silent: it is listed at the end and the
// exit code is 1. It uses Playwright's Chromium (the browser that the integration tests install).
// One look for the whole manual: the installation's default look, light, at 1336 x 849.

import { chromium } from "playwright-core";
import fs from "node:fs";
import dgram from "node:dgram";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.dirname(fileURLToPath(import.meta.url));
const IMG = path.join(SRC, "images");
const BASE = process.argv[2] ?? process.env.EMC2_URL ?? "http://127.0.0.1:18098";
const W = 1336;
const H = 849;
fs.mkdirSync(IMG, { recursive: true });

const failures = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: "light", deviceScaleFactor: 1 });
const p = await ctx.newPage();

// ---------- helpers ----------
const wait = (ms = 600) => p.waitForTimeout(ms);
const clamp = (c) => {
  const x = Math.max(0, Math.floor(c.x));
  const y = Math.max(0, Math.floor(c.y));
  const vs = p.viewportSize() ?? { width: W, height: H };
  return { x, y, width: Math.min(vs.width - x, Math.ceil(c.width)), height: Math.min(vs.height - y, Math.ceil(c.height)) };
};
async function shot(name, clip) {
  if (process.env.NO_SHOTS) return; // for a try-out that must not overwrite the pictures
  const file = path.join(IMG, `${name}.png`);
  await p.screenshot({ path: file, ...(clip ? { clip: clamp(clip) } : {}) });
  console.log("  shot", name);
}
const boxOf = async (loc) => {
  const b = await loc.boundingBox();
  if (!b) throw new Error("not visible: " + loc);
  return b;
};
const pad = (b, n) => ({ x: b.x - n, y: b.y - n, width: b.width + 2 * n, height: b.height + 2 * n });
async function must(cond, msg) {
  if (!(await cond)) throw new Error(msg);
}
// node shots.mjs <url> --only=<text>: runs the steps whose name has the text, after the two set-up steps (for changes to one chapter)
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7);
async function step(name, fn) {
  if (ONLY && !ONLY.split(",").some((o) => name.includes(o)) && !/^(Map: the notice|Map controls: choose Natural Earth)/.test(name)) return;
  console.log(name);
  try {
    await fn();
  } catch (e) {
    failures.push(`${name}: ${String(e.message).split("\n")[0]}`);
    console.log("  FAILED:", String(e.message).split("\n").slice(0, 4).join(" / "));
    await p.keyboard.press("Escape").catch(() => {});
  }
}
const btn = (name, opts = {}) => p.getByRole("button", { name, ...opts });
const dlg = () => p.locator("dialog[open], [role=dialog], [role=alertdialog]").first();
const left = () => p.locator(".pane-left");
const right = () => p.locator(".pane-right");
const bottom = () => p.locator(".pane-bottom");
const panelOf = (title) => p.locator(".panel", { has: p.locator(".panel-title-text", { hasText: new RegExp("^" + title + "$", "i") }) }).first();
// Settings since M8 (T-203): the categories are tabs in a list, a list of links is a table with a side form (one Save link
// for the form), a plain page has one Save and one Discard at its foot, and a group of fields is a fold.
async function openSettings(category) {
  await p.getByRole("tab", { name: "Settings" }).click();
  await wait(700);
  await p.locator(".settings-list [role=tab]").filter({ has: p.getByText(category, { exact: true }) }).first().click();
  await wait(900);
}
const settingsEntry = () => p.locator("section.settings-entry").first();
const linkList = () => p.locator("section.settings-item-list").first();
const linkForm = () => p.locator("aside.settings-item-form").first();
const lf = (label) => linkForm().getByLabel(new RegExp("^" + label + "\\s*\\*?$"));
async function addLink() {
  await p.getByRole("button", { name: "Add link", exact: true }).click();
  await wait(600);
}
async function saveLink() {
  await linkForm().getByRole("button", { name: "Save link", exact: true }).click();
  await wait(2200);
}
// Opens a folded group ("Advanced 2 settings") in the open entry
async function openFold(title) {
  const s = p.locator("summary", { hasText: new RegExp(title, "i") }).last();
  if (await s.count()) await s.evaluate((e) => { e.parentElement.open = true; });
}
const discardSettings = () => p.getByRole("button", { name: "Discard", exact: true }).first().click({ timeout: 3000 }).catch(() => {});
// Since M6 every panel starts collapsed. The steps below need the panels open, as they were in M5: open every
// collapsed panel of the left and right panes.
async function expandAll() {
  for (let i = 0; i < 12; i++) {
    const h = p.locator(".pane-left .panel-head button[aria-expanded=false], .pane-right .panel-head button[aria-expanded=false]").first();
    if (!(await h.count())) break;
    await h.click().catch(() => {});
    await wait(200);
  }
}
// Open one panel if it is collapsed (every panel starts collapsed): for a step that runs alone with --only, where expandAll has not run.
async function openPanel(title) {
  const h = panelOf(title).locator(".panel-head button[aria-expanded]").first();
  if ((await h.getAttribute("aria-expanded")) === "false") { await h.click(); await wait(500); }
}
// Since M7 the Symbols panel starts with the Palette list: the category list is the one that has "Land unit".
const catSelect = (panel) => panel.locator("select").filter({ has: p.locator("option", { hasText: "Land unit" }) }).first();
const sep = (which) => p.getByRole("separator", { name: `Resize the ${which} pane` });
async function mapBox() {
  const l = await boxOf(sep("left"));
  const r = await boxOf(sep("right"));
  const b = await boxOf(sep("bottom"));
  return { x: l.x + l.width, y: l.y, width: r.x - (l.x + l.width), height: b.y - l.y };
}
async function openMapControls() {
  if (!(await p.getByText("Projection", { exact: true }).isVisible())) await btn("Map controls").click();
  await wait(300);
}
const bgSelect = () => p.locator("select").filter({ has: p.locator("option", { hasText: "Natural Earth" }) });
const projSelect = () => p.locator("select").filter({ has: p.locator("option", { hasText: "EPSG:3413" }) });
async function closeTop() {
  await p.keyboard.press("Escape");
  await wait(200);
}
async function mapPoint(fx, fy) {
  const m = await mapBox();
  return { x: m.x + m.width * fx, y: m.y + m.height * fy };
}
async function pickLayerInObjects(label) {
  await p.getByRole("tab", { name: "Objects" }).click();
  await bottom().getByRole("combobox", { name: "Layer", exact: true }).first().selectOption({ label });
  await wait(1200);
}

// ---------- start ----------
await p.goto(BASE);
await p.locator(".pane-left").waitFor();
await wait(4000);

await step("Map: the notice about drawing without a GPU", async () => {
  const notice = p.getByText("This computer draws the map without a GPU").locator("..");
  await must(notice.isVisible(), "no GPU notice (this computer has a GPU?)");
  await shot("map-gpu-notice", pad(await boxOf(notice), 6));
  await btn("Dismiss").click();
  await wait(300);
});

await step("Map controls: choose Natural Earth", async () => {
  await openMapControls();
  const opts = await bgSelect().locator("option").allTextContents();
  await must(["Natural Earth", "OpenStreetMap", "None (grid)"].every((o) => opts.includes(o)), "backgrounds are " + opts);
  const proj = await projSelect().locator("option").allTextContents();
  await must(proj.join() === "EPSG:3857,EPSG:3413,EPSG:3031", "projections are " + proj);
  await bgSelect().selectOption({ label: "Natural Earth" });
  await wait(3000);
  const m = await mapBox();
  await shot("mapcontrols-box", { x: m.x + m.width - 250, y: m.y, width: 250, height: 240 });
});

await step("Map controls: close with the close button", async () => {
  await btn("Close").first().click();
  await wait(300);
  await must(p.getByText("Projection", { exact: true }).isHidden(), "the box did not close");
});

await step("The workspace", async () => {
  await shot("view-overview");
  await expandAll();
});

await step("Bookmarks: add, menu, organise", async () => {
  await btn("Bookmarks").first().click();
  await btn("Add bookmark").click();
  await wait(300);
  const b = await boxOf(btn("Bookmarks").first());
  await shot("bookmarks-add", { x: b.x - 10, y: 0, width: 300, height: 140 });
  await p.keyboard.press("Control+A");
  await p.keyboard.type("Scandinavia");
  await p.keyboard.press("Enter");
  await wait(1000);
  if (!(await btn("New folder").isVisible())) await btn("Bookmarks").first().click();
  await btn("New folder").waitFor();
  await p.getByText("Scandinavia").waitFor({ timeout: 8000 }).catch(() => {});
  await must(p.getByText("Scandinavia").isVisible(), "the bookmark is not in the menu");
  await shot("bookmarks-menu", { x: b.x - 10, y: 0, width: 300, height: 140 });
  const pencil = btn("New folder").locator("xpath=following-sibling::button[1]");
  await pencil.click();
  await wait(300);
  await must(btn("Rename").isVisible(), "no Rename button in the organising view");
  await must(btn("Move to…").isVisible(), "no Move to… button");
  await must(btn("Delete").first().isVisible(), "no Delete button");
  await shot("bookmarks-organise", { x: b.x - 10, y: 0, width: 300, height: 140 });
  await pencil.click();
  await wait(300);
  await must(btn("Add bookmark").isVisible(), "the pencil did not go back");
  await closeTop();
});

await step("Setups: save the start layout", async () => {
  await btn("Setups").click();
  await p.getByText("Save current setup as").waitFor();
  await p.getByText("No named setups yet").waitFor({ timeout: 8000 }).catch(() => {});
  await must(p.getByText("No named setups yet").isVisible(), "there are setups already");
  await p.getByPlaceholder("Name").fill("Start layout");
  await p.keyboard.press("Enter");
  await wait(800);
  const b = await boxOf(btn("Setups"));
  await shot("setups-menu", { x: b.x - 160, y: 0, width: 330, height: 150 });
  await closeTop();
});

await step("Look: the three lists", async () => {
  await btn("Look").click();
  await wait(400);
  const b = await boxOf(btn("Look"));
  const texts = await p.locator("select").evaluateAll((els) => els.map((e) => [...e.options].map((o) => o.text)));
  const flat = texts.flat();
  for (const t of ["Night Watch", "Chart Room", "Signal", "As the computer is", "Light", "Dark", "Compact", "Comfortable"]) {
    await must(flat.includes(t), "Look has no " + t);
  }
  await shot("look-menu", { x: b.x - 60, y: 0, width: 300, height: 190 });
  await closeTop();
});

await step("Panes and panels", async () => {
  const head = left().locator(".panel-head").first();
  await shot("general-panel-head", pad(await boxOf(head), 4));
  const bh = bottom().locator("[role=tablist]").first();
  await shot("general-bottom-tabs", pad(await boxOf(bh), 4));
  // Resize with the keys.
  const handle = sep("left");
  const before = Number(await handle.getAttribute("aria-valuenow"));
  await handle.focus();
  await p.keyboard.press("ArrowRight");
  await p.keyboard.press("ArrowRight");
  await p.keyboard.press("ArrowRight");
  await must(Number(await handle.getAttribute("aria-valuenow")) === before + 48, "three arrow keys do not move the edge by 48 px");
  await p.keyboard.press("Home");
  await must(Number(await handle.getAttribute("aria-valuenow")) === 160, "Home does not make the pane as small as it goes");
  await p.keyboard.press("End");
  await must(Number(await handle.getAttribute("aria-valuenow")) > 600, "End does not make the pane as large as it goes");
  // Collapse and expand the panes.
  await btn("Collapse the left pane").click();
  await btn("Collapse the bottom pane").click();
  await btn("Collapse the right pane").click();
  await wait(800);
  await must(btn("Expand the left pane").isVisible(), "no button to expand the left pane");
  await shot("general-collapsed-panes");
  await btn("Expand the left pane").click();
  await btn("Expand the bottom pane").click();
  await btn("Expand the right pane").click();
  await wait(500);
});

await step("Setups: restore the start layout", async () => {
  await btn("Setups").click();
  await p.getByText("Start layout", { exact: true }).waitFor({ timeout: 8000 });
  await p.getByText("Start layout", { exact: true }).click();
  await wait(1200);
  await must((async () => Number(await sep("left").getAttribute("aria-valuenow")) === 248)(), "restoring the setup did not bring the left pane back to 248 px");
});

await step("Panels: move a panel and bring it back", async () => {
  await btn("Move Symbol properties to the bottom pane").click();
  await wait(500);
  await must(bottom().getByRole("tab", { name: "Symbol properties" }).isVisible(), "the panel did not move to the bottom pane");
  await bottom().getByRole("tab", { name: "Symbol properties" }).click();
  await shot("general-moved-panel", pad(await boxOf(bottom()), 0));
  await btn("Move Symbol properties to the right pane").click();
  await wait(500);
  await must(right().getByText("Symbol properties").first().isVisible(), "the panel did not come back to the right pane");
  await p.getByRole("tab", { name: "Objects" }).click();
});

await step("Coordinates: the box, Go to, the cursor", async () => {
  await btn("Coordinates").click();
  await wait(400);
  const m = await mapBox();
  const formats = await p.locator("select").evaluateAll((els) => els.flatMap((e) => [...e.options].map((o) => o.text)));
  for (const f of ["Degrees, minutes, seconds (DMS)", "Decimal degrees (DD)", "UTM/UPS", "MGRS"]) await must(formats.includes(f), "no format " + f);
  await shot("coordinates-box", { x: m.x + m.width - 270, y: m.y, width: 270, height: 330 });
  const field = p.locator('input[placeholder*="°"]');
  await field.fill("59.33 18.07");
  await p.keyboard.press("Enter");
  await wait(1500);
  await must(p.getByText("Centred on").isVisible(), "Go to did not say Centred on");
  await shot("coordinates-goto", { x: m.x + m.width - 270, y: m.y, width: 270, height: 330 });
  await closeTop();
  const c = await mapPoint(0.4, 0.5);
  await p.mouse.move(c.x, c.y);
  await wait(500);
  await shot("coordinates-cursor", { x: m.x, y: m.y + m.height - 60, width: 360, height: 60 });
});

await step("Layers: the list, lock, new layer, rename, delete", async () => {
  await p.getByRole("tab", { name: "Layers" }).click();
  await wait(500);
  const bb = await boxOf(bottom());
  await shot("layers-panel", bb);
  const row = p.locator("li.layer-panel-row", { hasText: "Drawing" });
  await row.scrollIntoViewIfNeeded();
  await btn("Lock Drawing").click();
  await wait(800);
  await must(btn("Rename Drawing").isDisabled(), "a locked layer can be renamed");
  await must(btn("Delete Drawing").isDisabled(), "a locked layer can be deleted");
  await shot("layers-lock", pad(await boxOf(row), 4));
  await btn("Unlock Drawing").click();
  await wait(600);
  await btn("New layer").click();
  await wait(800);
  await must(dlg().getByText("Classification", { exact: true }).isVisible(), "the new-layer box has no Classification");
  await shot("layers-new-layer", pad(await boxOf(dlg()), 8));
  await dlg().getByRole("button", { name: "Create" }).click();
  await wait(1200);
  await must(p.locator("li.layer-panel-row", { hasText: "Layer 1" }).isVisible(), "New layer made no Layer 1");
  await btn("Rename Layer 1").click();
  await p.keyboard.press("Control+A");
  await p.keyboard.type("Reserve");
  await p.keyboard.press("Enter");
  await wait(800);
  await must(p.locator("li.layer-panel-row", { hasText: "Reserve" }).isVisible(), "the rename did not work");
  await btn("Delete Reserve").click();
  await wait(500);
  await must(p.getByText('Delete the empty layer "Reserve"?').isVisible(), "no question when deleting a layer");
  await shot("layers-delete-question", pad(await boxOf(dlg()), 8));
  await dlg().getByRole("button", { name: "Delete" }).click();
  await wait(1000);
  await must(p.locator("li.layer-panel-row", { hasText: "Reserve" }).count().then((n) => n === 0), "the layer was not deleted");
});

await step("Objects: open a layer from Layers, columns, paging", async () => {
  await p.getByRole("tab", { name: "Layers" }).click();
  await p.locator("li.layer-panel-row", { hasText: "Own forces" }).dblclick();
  await wait(1500);
  const choice = await p.getByRole("combobox", { name: "Layer", exact: true }).inputValue();
  await must(choice !== "", "the double-click did not open the layer in Objects");
  await must(p.getByText("5 objects").first().isVisible(), "Objects does not show the count");
  const heads = await p.locator(".object-list-head").innerText();
  for (const c of ["Name", "Kind", "Data type", "Source", "Classification", "Modified"]) await must(heads.includes(c), "no column " + c);
  await shot("objects-panel", await boxOf(bottom()));
});

await step("Symbols: choose, place, stop", async () => {
  await left().locator(".emc2-list-row, button", { hasText: "Command and control" }).first().click();
  await wait(300);
  const lb = await boxOf(left());
  await shot("symbols-panel", { x: lb.x, y: lb.y, width: lb.width, height: Math.min(lb.height, 640) });
  await btn("Place on map").click();
  await wait(300);
  await must(p.getByText("Click the map to place the symbol. Esc stops placing.").isVisible(), "no hint while placing");
  await must(btn("Stop placing").isVisible(), "no Stop placing button");
  await shot("symbols-place", lb);
  const pt = await mapPoint(0.25, 0.3);
  await p.mouse.click(pt.x, pt.y);
  await wait(1500);
  await must(btn("Stop placing").isVisible(), "placing did not stay on");
  await p.keyboard.press("Escape");
  await wait(300);
  await must(btn("Place on map").isVisible(), "Escape did not stop placing");
  await btn("Place on map").click();
  await p.mouse.click((await mapPoint(0.3, 0.8)).x, (await mapPoint(0.3, 0.8)).y, { button: "right" });
  await wait(500);
  await must(btn("Place on map").isVisible(), "a right-click did not stop placing");
  await pickLayerInObjects("Own forces");
  await must(p.getByText("6 objects").first().isVisible(), "the placed symbol is not in Own forces");
});

await step("Symbols: vessels", async () => {
  const sp = panelOf("Symbols");
  await catSelect(sp).selectOption({ label: "Vessels" });
  await wait(1500);
  await must(sp.getByText("Ship type").first().isVisible(), "Vessels shows no Ship type list");
  const lb = await boxOf(left());
  await shot("symbols-vessels", { x: lb.x, y: lb.y, width: lb.width, height: Math.min(lb.height, 520) });
  await catSelect(sp).selectOption({ label: "Land unit" });
  await wait(500);
  // Since M6 a data type brings its field sets: choose CoT, and the set CoT unit shows with its fields.
  await sp.locator("select").filter({ has: p.locator("option", { hasText: "AIS vessel" }) }).selectOption({ label: "CoT" });
  await wait(1200);
  await must(sp.getByText("Field set", { exact: true }).first().isVisible(), "the Symbols panel shows no Field set for the data type CoT");
  await p.setViewportSize({ width: W, height: 1500 });
  await wait(800);
  await sp.scrollIntoViewIfNeeded();
  await shot("symbols-fieldset", pad(await boxOf(sp), 2));
  await p.setViewportSize({ width: W, height: H });
  await wait(500);
  await sp.locator("select").filter({ has: p.locator("option", { hasText: "AIS vessel" }) }).selectOption({ label: "General" });
  await wait(500);
  // M7 (T-156): the Palette list at the top of the panel: General symbols, then each plugin's palettes (cot's "CoT").
  const palette = sp.locator("select").first();
  const palettes = await palette.locator("option").allTextContents();
  await must(Promise.resolve(palettes.join() === "General symbols,CoT"), "the palettes are " + palettes);
  await palette.selectOption({ label: "CoT" });
  await wait(1500);
  await must(sp.getByText(/Military/).first().isVisible(), "the palette CoT shows no symbols");
  const lbp = await boxOf(left());
  await shot("symbols-palette", { x: lbp.x, y: lbp.y, width: lbp.width, height: Math.min(lbp.height, 600) });
  await palette.selectOption({ label: "General symbols" });
  await wait(500);
});

await step("Symbol properties and the map's menu", async () => {
  // Select a demo symbol in the list, bring it to the middle of the map.
  const rows = p.locator(".object-list-row");
  await rows.nth(2).click();
  await wait(500);
  await rows.nth(2).click({ button: "right" });
  await p.getByRole("menuitem", { name: "Centre on object(s)" }).click();
  await wait(2000);
  await must(right().getByText("Unique designation").isVisible(), "Symbol properties does not show the symbol");
  const rb = await boxOf(right());
  await shot("symbol-properties", rb);
  const m = await mapBox();
  const cx = m.x + m.width / 2;
  const cy = m.y + m.height / 2;
  await shot("map-selection", { x: cx - 120, y: cy - 90, width: 240, height: 180 });
  await p.mouse.click(cx, cy, { button: "right" });
  await wait(600);
  for (const item of ["Centre on object(s)", "Zoom to object(s)", "Edit", "Delete"]) await must(p.getByRole("menuitem", { name: item }).isVisible(), "menu has no " + item);
  await shot("map-menu-object", { x: cx - 30, y: cy - 30, width: 250, height: 190 });
  await p.keyboard.press("Escape");
  await wait(300);
  const e = await mapPoint(0.15, 0.7);
  await p.mouse.click(e.x, e.y, { button: "right" });
  await wait(600);
  await must(p.getByRole("menuitem", { name: "Centre map" }).isVisible(), "no Centre map on empty map");
  await shot("map-menu-empty", { x: e.x - 20, y: e.y - 20, width: 200, height: 90 });
  await p.keyboard.press("Escape");
  await p.mouse.click(e.x + 10, e.y + 10);
  await wait(300);
});

await step("Symbol properties: heading, speed and a field set", async () => {
  const r = right();
  const mb = await mapBox();
  await p.mouse.click(mb.x + mb.width / 2, mb.y + mb.height / 2);
  await wait(900);
  await must(r.getByLabel("Heading (°)").isVisible(), "the symbol was not selected");
  await r.getByLabel("Heading (°)").fill("90");
  await r.getByLabel("Heading (°)").press("Enter");
  await wait(600);
  await r.getByLabel("Speed (km/h)").fill("36");
  await r.getByLabel("Speed (km/h)").press("Enter");
  await wait(900);
  // Since M6 the data type brings its field sets: choose the data type CoT, and the field set CoT unit appears.
  await r.getByRole("combobox").filter({ has: p.locator("option", { hasText: "AIS vessel" }) }).selectOption({ label: "CoT" });
  await wait(1500);
  await must(r.getByText("Callsign").isVisible(), "the field set CoT unit shows no Callsign");
  await r.getByLabel("Callsign").fill("ALPHA 2");
  await r.getByLabel("Callsign").press("Enter");
  await wait(900);
  await r.getByText("Heading (°)").scrollIntoViewIfNeeded();
  await shot("symbol-properties-fields", await boxOf(r));
  await r.getByText("Callsign").scrollIntoViewIfNeeded();
  await wait(300);
  await shot("symbol-properties-fieldset", await boxOf(r));
});

await step("Shapes: panel, draw a rectangle, Edit shape", async () => {
  await btn("Symbols", { exact: true }).click();
  await wait(400);
  const lb = await boxOf(left());
  await shot("shapes-panel", lb);
  await btn("Rectangle").click();
  await wait(300);
  await must(p.getByText("Drawing a rectangle: press and drag on the map. Escape cancels.").isVisible(), "no hint for the rectangle tool");
  await shot("shapes-draw", lb);
  const a = await mapPoint(0.1, 0.12);
  const z = await mapPoint(0.3, 0.3);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(a.x + ((z.x - a.x) * i) / 8, a.y + ((z.y - a.y) * i) / 8);
  await p.mouse.up();
  await wait(1500);
  await p.keyboard.press("Escape");
  await wait(400);
  await p.mouse.click(a.x + (z.x - a.x) / 2, a.y, { button: "right" });
  await wait(700);
  await p.getByRole("menuitem", { name: "Edit" }).click();
  await wait(1200);
  await must(p.getByText("Edit shape").first().isVisible(), "Edit did not open the Edit shape panel");
  await must(btn("Reshape").isVisible(), "no Reshape button");
  await shot("shapes-edit", await boxOf(right()));
  await btn("Symbols", { exact: true }).click();
});

await step("The map: the question before Delete", async () => {
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await p.keyboard.press("Delete");
  await wait(600);
  const d = dlg();
  await must(d.isVisible(), "the Delete key asked no question");
  await shot("map-delete-question", pad(await boxOf(d), 8));
  await d.getByRole("button", { name: "Cancel" }).click();
  await wait(400);
});

// ---------- M7: Append points to a line (T-176) ----------
await step("Shapes: Append points to a line", async () => {
  // A clear place and a close view (100 m across the scale bar), so that the line is easy to see.
  await p.keyboard.press("Escape");
  await wait(300);
  await zoomDemo();
  await btn("Arrow").click();
  await wait(300);
  const q = [[0.15, 0.62], [0.3, 0.52], [0.45, 0.64]];
  for (let i = 0; i < q.length; i++) {
    const pt = await mapPoint(q[i][0], q[i][1]);
    if (i < q.length - 1) await p.mouse.click(pt.x, pt.y);
    else await p.mouse.dblclick(pt.x, pt.y);
    await wait(500);
  }
  await wait(1200);
  await p.keyboard.press("Escape");
  await wait(300);
  const mid = await mapPoint(0.225, 0.57);
  await p.mouse.click(mid.x, mid.y, { button: "right" });
  await wait(700);
  await p.getByRole("menuitem", { name: "Edit" }).click();
  await wait(1200);
  await must(btn("Append").isVisible(), "the Edit shape panel of a line has no Append button");
  const ep = panelOf("Edit shape");
  await ep.scrollIntoViewIfNeeded();
  await shot("shapes-append-panel", pad(await boxOf(ep), 2));
  await btn("Append").click();
  await wait(500);
  await must(p.getByText("Click to add points after the last point.").isVisible(), "no hint while appending");
  const n1 = await mapPoint(0.58, 0.5);
  const n2 = await mapPoint(0.72, 0.62);
  await p.mouse.click(n1.x, n1.y);
  await wait(500);
  await p.mouse.move(n2.x, n2.y, { steps: 4 });
  await wait(500);
  await shot("shapes-append-map", await mapBox());
  await p.mouse.dblclick(n2.x, n2.y);
  await wait(1500);
  await must(ep.isVisible(), "the Edit shape panel closed after the double-click that ended the append");
  await p.keyboard.press("Escape");
  await wait(300);
});

await step("Status: the panel and the plugin list", async () => {
  await shot("status-panel", await boxOf(right()));
  await right().getByText(/^Plugins \(\d+\)$/).click();
  await wait(400);
  await shot("status-plugins", await boxOf(right()));
});

await step("Map controls: the Arctic, and back with a bookmark", async () => {
  await openMapControls();
  await projSelect().selectOption({ label: "EPSG:3413" });
  await wait(4000);
  const m = await mapBox();
  await shot("mapcontrols-arctic", m);
  await btn("Close").first().click();
  await btn("Bookmarks").first().click();
  await p.getByText("Scandinavia").click();
  await wait(3500);
  await openMapControls();
  await must(projSelect().inputValue().then((v) => v.includes("3857")), "the bookmark did not bring back EPSG:3857");
  await btn("Close").first().click();
});


// ---------- part 2: the top bar ----------
// ---------- M5: display settings ----------
async function setRange(loc, v) {
  await loc.evaluate((el, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, String(v));
}
await step("Display settings: the window and what it changes", async () => {
  if (await p.getByText("Projection", { exact: true }).isVisible()) await btn("Close").first().click();
  // The symbol 5 INF has a heading of 90 and a speed of 36 km/h (set in the step before): bring it to the middle, 10 km wide.
  await pickLayerInObjects("Own forces");
  const allRows = p.locator(".object-list-row");
  let row5 = null;
  for (let i = 0, n = await allRows.count(); i < n && !row5; i++) {
    await allRows.nth(i).click();
    await wait(500);
    if ((await right().getByLabel("Unique designation").inputValue().catch(() => "")) === "5 INF") row5 = allRows.nth(i);
  }
  await must(Promise.resolve(row5 !== null), "the symbol 5 INF is not in Own forces");
  await row5.click();
  // The symbol 5 INF is chosen here, in the list, and given its heading and speed here: a click on the map in an earlier step may hit another symbol
  await wait(600);
  if ((await right().getByLabel("Heading (°)").inputValue()) !== "90") {
    await right().getByLabel("Heading (°)").fill("90");
    await right().getByLabel("Heading (°)").press("Enter");
    await wait(600);
  }
  if ((await right().getByLabel("Speed (km/h)").inputValue()) !== "36") {
    await right().getByLabel("Speed (km/h)").fill("36");
    await right().getByLabel("Speed (km/h)").press("Enter");
    await wait(900);
  }
  await must(right().getByLabel("Heading (°)").inputValue().then((v) => v === "90"), "5 INF has no heading of 90");
  await must(right().getByLabel("Speed (km/h)").inputValue().then((v) => v === "36"), "5 INF has no speed of 36 km/h");
  await row5.click({ button: "right" });
  await p.getByRole("menuitem", { name: "Zoom to object(s)" }).click();
  await wait(2500);
  await shot("display-default", await mapBox());
  await btn("Display settings", { exact: true }).click();
  await wait(500);
  const win = p.locator(".display-window");
  await must(win.getByText("Symbol size").isVisible(), "the Display settings window has no Symbol size");
  await must(win.getByText("Dwell areas").isVisible(), "the Display settings window has no Areas (Dwell areas)");
  await must(win.getByLabel("Sensor coverage").isChecked(), "Sensor coverage is not on by default");
  await win.evaluate((e) => { for (const x of [e, ...e.querySelectorAll("*")]) { x.style.maxHeight = "none"; if (getComputedStyle(x).overflowY !== "visible") x.style.overflowY = "visible"; } });
  await wait(300);
  await p.setViewportSize({ width: W, height: 1100 }); // the window is taller than the map pane at the usual size
  await wait(800);
  await shot("display-window", pad(await win.evaluate((e) => e.getBoundingClientRect().toJSON()), 4));
  await p.setViewportSize({ width: W, height: H });
  await wait(600);
  await setRange(win.locator("input[type=range]").first(), 48);
  await setRange(win.locator("input[type=range]").nth(1), 7); // the speed vector slider has steps: 7 is 5 min
  await win.locator("select").nth(3).selectOption({ label: "Speed" }); // the fourth list: Top left, Top right, Bottom left, Bottom right, Below // since M8 each label has a place (SDK 1.8.0, T-163)
  await wait(1500);
  await btn("Close display settings").click();
  await wait(1200);
  await shot("display-changed", await mapBox());
  await btn("Display settings", { exact: true }).click();
  await wait(400);
  await win.getByRole("button", { name: "Use defaults" }).click();
  await wait(800);
  await must(win.getByText("30 px").isVisible(), "Use defaults did not bring back 30 px");
  await btn("Close display settings").click();
  await wait(800);
  await btn("Bookmarks").first().click();
  await p.getByText("Scandinavia").click({ timeout: 4000 }).catch(() => p.keyboard.press("Escape"));
  await wait(3000);
});

// ---------- M5: tactical graphics ----------
await step("Graphics: choose, place, edit", async () => {
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1200);
  await btn("Dismiss").click({ timeout: 1500 }).catch(() => {});
  if (await p.getByText("Projection", { exact: true }).isVisible()) await btn("Close").first().click();
  const gh = p.locator(".pane-left .panel-head button", { hasText: /^Graphics$/i }).first();
  if ((await gh.getAttribute("aria-expanded")) === "false") await gh.click();
  await wait(2500);
  const g = panelOf("Graphics");
  if (await panelOf("Symbols").getByText("Category", { exact: true }).first().isVisible()) await btn("Symbols", { exact: true }).click();
  if (await panelOf("Shapes").getByRole("button", { name: "Circle" }).isVisible()) await btn("Shapes", { exact: true }).click();
  await wait(500);
  await shot("graphics-panel", await boxOf(left()));
  await g.getByText("Phase Line", { exact: true }).first().click();
  await wait(500);
  await g.getByLabel(/Unique designation 1/).fill("ALFA");
  await g.getByRole("button", { name: "Place graphic" }).last().scrollIntoViewIfNeeded();
  await wait(300);
  await shot("graphics-chosen", await boxOf(left()));
  await g.getByRole("button", { name: "Place graphic" }).last().click();
  await wait(500);
  console.log("  buttons while placing:", (await g.getByRole("button").evaluateAll((b) => b.map((x) => (x.getAttribute("aria-label") || x.title || x.textContent).trim()).filter((s) => /place|stop/i.test(s)))).join(" ; "));
  const hint = await left().innerText();
  console.log("  hint while placing:", hint.split(/\r?\n/).filter((l) => /click|Esc|point/i.test(l)).join(" | "));
  const pts = [[0.3, 0.2], [0.42, 0.27], [0.55, 0.17], [0.68, 0.25]];
  for (let i = 0; i < pts.length; i++) {
    const pt = await mapPoint(pts[i][0], pts[i][1]);
    if (i < pts.length - 1) { await p.mouse.click(pt.x, pt.y); await p.mouse.move(pt.x + 20, pt.y + 10); }
    else await p.mouse.dblclick(pt.x, pt.y);
    await wait(700);
  }
  await wait(2500);
  await p.keyboard.press("Escape");
  await wait(500);
  await shot("graphics-placed", await mapBox());
  // Select it and open Edit.
  const mid = await mapPoint(0.36, 0.235);
  await p.mouse.click(mid.x, mid.y);
  await wait(700);
  await p.mouse.click(mid.x, mid.y, { button: "right" });
  await wait(600);
  const items = await p.getByRole("menuitem").allInnerTexts();
  console.log("  menu on a graphic:", items.join(" | "));
  await p.getByRole("menuitem", { name: "Edit" }).click();
  await wait(1200);
  await shot("graphics-edit", await boxOf(right()));
  await btn("Graphics", { exact: true }).click();
  await wait(400);
});

// ---------- M6: a graphic that has an icon inside it ----------
await step("Graphics: one with an icon", async () => {
  await btn("Graphics", { exact: true }).click();
  await wait(600);
  const g = panelOf("Graphics");
  await g.getByText("Mined Area", { exact: true }).click();
  await wait(500);
  await g.getByRole("button", { name: "Place graphic" }).last().click();
  await wait(500);
  const pts = [[0.3, 0.42], [0.44, 0.42], [0.44, 0.56], [0.3, 0.56]];
  for (let i = 0; i < pts.length; i++) {
    const pt = await mapPoint(pts[i][0], pts[i][1]);
    if (i < pts.length - 1) { await p.mouse.click(pt.x, pt.y); await p.mouse.move(pt.x + 20, pt.y + 10); }
    else await p.mouse.dblclick(pt.x, pt.y);
    await wait(700);
  }
  await wait(2500);
  await p.keyboard.press("Escape");
  await wait(500);
  const mb = await mapBox();
  const c = await mapPoint(0.37, 0.49);
  await shot("graphics-icon", { x: c.x - 150, y: c.y - 120, width: 300, height: 240 });
  await btn("Graphics", { exact: true }).click();
  await wait(400);
});

// ---------- M8 (T-204, SDK 1.8.0 part G): All graphics, with its folders closed, and the search ----------
await step("Graphics: all graphics and the search", async () => {
  const gh = p.locator(".pane-left .panel-head button", { hasText: /^Graphics$/i }).first();
  if ((await gh.getAttribute("aria-expanded")) === "false") await gh.click();
  await wait(1500);
  const g = panelOf("Graphics");
  await g.getByRole("button", { name: /^All graphics/ }).waitFor({ timeout: 15000 });
  console.log("  all graphics button:", await g.getByRole("button", { name: /^All graphics/ }).first().innerText());
  await g.getByRole("button", { name: /^All graphics/ }).click();
  await wait(1200);
  await g.getByText(/Control Measure › Command and control lines/i).first().scrollIntoViewIfNeeded();
  await wait(500);
  await shot("graphics-all", await boxOf(left()));
  await g.getByLabel("Find a graphic").fill("mined");
  await wait(1500);
  await g.getByLabel("Find a graphic").scrollIntoViewIfNeeded();
  await wait(400);
  await shot("graphics-search", await boxOf(left()));
  await g.getByLabel("Find a graphic").fill("");
  await wait(800);

  await gh.click();
  await wait(400);
});
// ---------- M5: terrain ----------
// The height folder: the demo zip's settings/terrain folder in the emcc folder (EMC2_HOME), or the folder in EMC2_DTED.
const DTED = process.env.EMC2_DTED ?? (process.env.EMC2_HOME ? process.env.EMC2_HOME.replace(/\\/g, "/") + "/settings/terrain" : "");
async function zoomDemo() {
  // The height data must cover 62.4 N, 17.3 E (the observer's place): centre on it, then zoom in.
  await btn("Bookmarks").first().click();
  await p.getByText("Scandinavia").click({ timeout: 4000 }).catch(() => p.keyboard.press("Escape"));
  await wait(2000);
  await btn("Coordinates").click();
  await wait(400);
  await p.locator('input[placeholder*="°"]').fill("62.4 17.3");
  await p.keyboard.press("Enter");
  await wait(1500);
  await closeTop();
  const c = await mapPoint(0.5, 0.5);
  await p.mouse.move(c.x, c.y);
  for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, -300); await wait(250); }
  await wait(2000);
}
await step("Terrain: range and bearing", async () => {
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1200);
  if (await p.getByText("Projection", { exact: true }).isVisible()) await btn("Close").first().click();
  await zoomDemo();
  await openPanel("Terrain");
  const t = panelOf("Terrain");
  await t.scrollIntoViewIfNeeded();
  await t.getByRole("button", { name: "Pick two points" }).click();
  await wait(400);
  const a = await mapPoint(0.3, 0.4);
  const b2 = await mapPoint(0.66, 0.62);
  await p.mouse.click(a.x, a.y);
  await wait(700);
  await p.mouse.click(b2.x, b2.y);
  await wait(1800);
  await must(t.getByText("Distance").first().isVisible(), "the Terrain panel shows no distance");
  await shot("terrain-range-map", await mapBox());
  await t.scrollIntoViewIfNeeded();
  await shot("terrain-range-panel", await boxOf(right()));
  console.log("  panel:", (await t.innerText()).split(/\s*\n\s*/).join(" | ").slice(0, 400));
  await t.getByRole("button", { name: "Clear" }).click();
  await wait(500);
});

await step("Terrain: the height folder, then a viewshed", async () => {
  await p.getByRole("tab", { name: "Settings" }).click();
  await wait(800);
  await p.locator(".settings-list-entry", { hasText: /^Terrain$/ }).click();
  await wait(900);
  await shot("settings-terrain");
  // Since M7 (T-157) the folder is %emcc%/settings/terrain by default: nothing is set by hand.
  const folder = await p.getByLabel("Height data folder", { exact: true }).inputValue();
  console.log("  height data folder:", JSON.stringify(folder));
  await must(Promise.resolve(folder === "%emcc%/settings/terrain"), "the height data folder is not %emcc%/settings/terrain by default");
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1500);
  await openPanel("Terrain");
  const t = panelOf("Terrain");
  await t.scrollIntoViewIfNeeded();
  await t.getByRole("button", { name: "Pick the observer" }).click();
  await wait(400);
  const o = await mapPoint(0.5, 0.5);
  await p.mouse.click(o.x, o.y);
  await t.getByText(/Computing/).waitFor({ state: "hidden", timeout: 60000 }).catch(() => {});
  await wait(3500);
  await shot("terrain-viewshed-map", await mapBox());
  await t.scrollIntoViewIfNeeded();
  await shot("terrain-viewshed-panel", await boxOf(right()));
  console.log("  panel:", (await t.innerText()).split(/\s*\n\s*/).join(" | ").slice(0, 600));
  await t.getByRole("button", { name: "Clear" }).click();
  await wait(500);
  // M7 (T-166): the height map in a circle. Press on the centre and drag to the radius.
  await t.getByRole("button", { name: "Draw a circle" }).click();
  await wait(400);
  await must(p.getByText("Press on the centre and drag to the radius. Escape cancels.").isVisible(), "no hint for the height map circle");
  const hc = await mapPoint(0.5, 0.5);
  await p.mouse.move(hc.x, hc.y);
  await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(hc.x + (150 * i) / 8, hc.y, { steps: 2 });
  await p.mouse.up();
  await t.getByText(/Computing/).waitFor({ state: "hidden", timeout: 60000 }).catch(() => {});
  await wait(3500);
  await must(t.getByText("Highest", { exact: true }).first().isVisible(), "the height map shows no Highest");
  await shot("terrain-heightmap-map", await mapBox());
  await t.scrollIntoViewIfNeeded();
  await shot("terrain-heightmap-panel", await boxOf(right()));
  console.log("  height map panel:", (await t.innerText()).split(/\s*\n\s*/).join(" | ").slice(0, 700));
  await t.getByRole("button", { name: "Clear" }).click();
  await wait(500);
  await btn("Terrain", { exact: true }).click();
  await wait(400);
});

await step("The top bar", async () => {
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(800);
  await shot("ui-top-bar", { x: 0, y: 0, width: W, height: 40 });
});

// M9 RC2: the Help menu at the right end of the top bar. Needs a release that has it (the CDA's help menu).
await step("The help menu", async () => {
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await btn("Help", { exact: true }).click();
  await wait(1200);
  const pop = p.locator(".help-popover");
  await must(pop.isVisible(), "the help menu did not open");
  console.log("  help menu:", (await pop.innerText()).replace(/\n+/g, " | "));
  const b = await boxOf(pop);
  console.log("  popover box:", JSON.stringify(b));
  const x = W - 420;
  await shot("ui-help-menu", { x, y: 0, width: 420, height: b.y + b.height + 70 });
  await p.keyboard.press("Escape");
  await wait(300);
});

// ---------- part 4: the Simulation workspace ----------
// ---------- M5: GMTI. The simulator's sensor sends over UDP on this computer to a link that receives it ----------
await step("GMTI: two links in Settings, one out and one in", async () => {
  await p.setViewportSize({ width: W, height: 1300 }); // the page of GMTI is long: the table and the form must be in view together
  await openSettings("GMTI");
  await addLink();
  await lf("Name").fill("sim-out");
  await lf("Mode").selectOption({ label: "udp" });
  await lf("Direction").selectOption({ label: "out" });
  await lf("Host").fill("127.0.0.1");
  await lf("Port").fill("47607");
  await wait(400);
  await linkList().scrollIntoViewIfNeeded();
  await wait(300);
  await shot("settings-gmti", await boxOf(linkList()));
  await saveLink();
  await must(lf("Name").inputValue().then((v) => v === "sim-out"), "the link sim-out is not saved");
  await addLink();
  await lf("Name").fill("sim-in");
  await lf("Mode").selectOption({ label: "udp" });
  await lf("Direction").selectOption({ label: "in" });
  await wait(400);
  await linkForm().getByRole("button", { name: "Set Listen on" }).click();
  await wait(400);
  console.log("  listen fields:", (await linkForm().locator("input").evaluateAll((els) => els.map((e) => e.labels?.[0]?.textContent?.trim() + "=" + e.id.slice(-30)))).join(" | "));
  await linkForm().getByLabel("Address", { exact: true }).fill("127.0.0.1");
  await linkForm().getByLabel(/^Port\s*\*?$/).last().fill("47607");
  await linkForm().getByRole("button", { name: "New layer for Layer" }).click();
  await wait(400);
  await p.getByLabel("Name of the new layer").fill("GMTI in");
  await p.getByRole("button", { name: "Create" }).click();
  await wait(1200);
  await saveLink();
  await must(p.locator(".settings-item-table").getByText("sim-in").first().isVisible(), "the table does not list sim-in");
  await p.setViewportSize({ width: W, height: H });
  await p.getByRole("tab", { name: "Monitor" }).click();
  await wait(3500);
  const mon = p.locator("section.other-view:visible").last();
  await must(mon.getByText("GMTI", { exact: true }).first().isVisible(), "the Monitor does not show GMTI");
  // Open the detail of GMTI in the plugin table (the whole page is too small to read in a manual)
  await mon.getByText("GMTI", { exact: true }).first().click();
  await wait(1500);
  const det = await p.evaluate(() => { const t = [...document.querySelectorAll("tr, li, div")].filter((e) => /sim-in/.test(e.textContent) && e.children.length < 12).map((e) => e.tagName + "." + e.className + ":" + e.textContent.slice(0, 120)); return t.slice(0, 5).join(" ; "); });
  console.log("  monitor detail:", det);
  {
    const row = mon.getByText("GMTI", { exact: true }).first().locator("xpath=ancestor::tr[1]");
    const detail = row.locator("xpath=following-sibling::tr[1]");
    await p.setViewportSize({ width: W, height: 1300 });
    await wait(600);
    const rb = await boxOf(row);
    const db = await boxOf(detail);
    await shot("gmti-monitor-links", pad({ x: rb.x, y: rb.y, width: Math.max(rb.width, db.width), height: db.y + db.height - rb.y }, 6));
    await p.setViewportSize({ width: W, height: H });
    await wait(400);
  }
  await must(p.getByText("sim-in").first().isVisible(), "the Monitor does not show the link sim-in");
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1000);
});

await step("Simulation: a route, a track on it, run it", async () => {
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(2500);
  await btn("Dismiss").click({ timeout: 2000 }).catch(() => {});
  await expandAll();
  await btn("Bookmarks").first().click();
  await p.getByText("Scandinavia").click({ timeout: 4000 }).catch(() => p.keyboard.press("Escape"));
  await wait(3000);
  await must(p.getByText("No routes in Simulation yet.").isVisible(), "Simulation does not start without routes");
  await must(p.getByText("Simulation", { exact: true }).first().isVisible(), "no Simulation layer");
  // Collapse Symbols and Shapes so that Routes is in view; open Symbols again when needed.
  const symbolsOpen = () => p.getByText("Command and control").first().isVisible();
  if (await symbolsOpen()) await btn("Symbols", { exact: true }).click();
  if (await p.getByRole("button", { name: "Circle", exact: true }).isVisible()) await btn("Shapes", { exact: true }).click();
  if (await p.getByRole("button", { name: "Place graphic" }).last().isVisible()) await btn("Graphics", { exact: true }).click();
  if (await p.getByRole("button", { name: "Pick the observer" }).isVisible()) await btn("Terrain", { exact: true }).click();
  await btn(/New route|Draw a new route/).first().click();
  await wait(500);
  const pts = [[0.3, 0.55], [0.45, 0.3], [0.62, 0.5], [0.75, 0.75]];
  for (let i = 0; i < pts.length; i++) {
    const pt = await mapPoint(pts[i][0], pts[i][1]);
    if (i < pts.length - 1) await p.mouse.click(pt.x, pt.y);
    else await p.mouse.dblclick(pt.x, pt.y);
    await wait(400);
  }
  await wait(1500);
  await must(p.getByText("Route editor").first().isVisible(), "the Route editor did not open after drawing a route");
  await must(p.getByText("Route 1").first().isVisible(), "no Route 1");
  // Place a symbol near the first point.
  await btn("Symbols", { exact: true }).click();
  await left().locator(".emc2-list-row, button", { hasText: "Command and control" }).first().click();
  await btn("Place on map").click();
  const first = await mapPoint(0.3, 0.55);
  await p.mouse.click(first.x - 14, first.y + 6);
  await wait(1200);
  await p.keyboard.press("Escape");
  await btn("Symbols", { exact: true }).click();
  await wait(500);
  // Put it on the route.
  await p.mouse.click(first.x - 14, first.y + 6, { button: "right" });
  await wait(700);
  for (const item of ["Centre on object(s)", "Zoom to object(s)", "Edit", "Put on route", "Delete"]) await must(p.getByRole("menuitem", { name: item }).isVisible(), "the Simulation menu has no " + item);
  await p.getByRole("menuitem", { name: "Put on route" }).click();
  await wait(700);
  const dlg1 = p.locator("dialog[open], [role=dialog]").first();
  await must(dlg1.getByText("1 object chosen").isVisible(), "the Put on route box does not say how many objects");
  const kinds = await dlg1.locator("select").nth(1).locator("option").allTextContents();
  await must(kinds.join() === "Each on its own,Convoy,Formation", "the kinds are " + kinds);
  await dlg1.locator("select").first().selectOption({ label: "Route 1" });
  await shot("sim-put-on-route", pad(await boxOf(dlg1), 10));
  await dlg1.getByRole("button", { name: "Put on route" }).click();
  await wait(1500);
  await must(p.getByText("1 object").first().isVisible(), "the route card does not show 1 object");
  await must(p.getByText("Route 1-1").first().isVisible(), "the track got no name");
  // The Route editor: the first point, then the second with the time helper.
  await shot("sim-route-editor", await boxOf(right()));
  await btn("Next point").click();
  await wait(600);
  await must(p.getByText("Time (h:mm:ss)").isVisible(), "no time helper on the second point");
  // An event.
  await btn(/^Add event at point/).click();
  await wait(800);
  await must(p.getByText("Event at point 2").first().isVisible(), "the Event panel did not open");
  await shot("sim-event", await boxOf(right()));
  await btn("Cancel").click();
  await wait(400);
  // Run.
  await btn("Start Route 1").click();
  await wait(5000);
  await must(p.getByText("The simulation runs.").isVisible(), "the simulation does not run");
  await must(btn("Pause Route 1").isVisible(), "no pause button");
  await shot("sim-overview");
  await shot("sim-running", await mapBox());
  await shot("sim-routes-panel", await boxOf(left()));
  await btn("Pause Route 1").click();
  await wait(1000);
  await must(p.getByText("Everything is paused.").isVisible(), "pausing did not pause everything");
  await btn("Reset Route 1").click();
  await wait(1000);
});

// ---------- M5: scenarios: export, and the box that import opens (nothing is imported) ----------
await step("Simulation: export and import a scenario", async () => {
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(1500);
  // Since M7 the two buttons are in the top bar: the Scenario button opens a menu (T-152).
  const scenarioMenu = async () => {
    await btn("Scenario", { exact: true }).click();
    await wait(500);
  };
  const imp = () => p.getByRole("menuitem", { name: /^Import scenario/ });
  await scenarioMenu();
  if (await imp().isDisabled()) {
    await p.keyboard.press("Escape");
    await btn(/^Pause all/).first().click().catch(() => {});
    await wait(1500);
    await scenarioMenu();
  }
  await must(imp().isEnabled(), "Import scenario is off although the simulation is reset");
  await shot("sim-scenario-menu", pad(await boxOf(p.getByRole("menu", { name: "Scenario" })), 40));
  await p.getByRole("menuitem", { name: /^Export scenario/ }).click();
  await wait(600);
  const d1 = dlg();
  await must(d1.getByText("Scenario name").isVisible(), "the Export scenario box has no name field");
  await shot("sim-scenario-export", pad(await boxOf(d1.locator(".emc2-dialog")), 10));
  const [dl] = await Promise.all([p.waitForEvent("download"), d1.getByRole("button", { name: "Export", exact: true }).click()]);
  await must(Promise.resolve(dl.suggestedFilename() === "Scenario.emcc-scenario.json"), "the file is named " + dl.suggestedFilename());
  const file = path.join(SRC, "x-scenario.tmp.json");
  await dl.saveAs(file);
  await scenarioMenu();
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), imp().click()]);
  await fc.setFiles(file);
  await wait(1200);
  const d2 = dlg();
  await must(d2.getByText(/layer and \d+ objects?/).isVisible(), "the Import scenario box does not say what the file holds");
  await shot("sim-scenario-import", pad(await boxOf(d2.locator(".emc2-dialog")), 10));
  await d2.getByRole("button", { name: "Cancel" }).click();
  fs.rmSync(file, { force: true });
  await wait(500);
});

// ---------- M5: a GMTI sensor on the track, two hostile tracks near it ----------
await step("Simulation: a GMTI sensor on the track", async () => {
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(2000);
  await btn("Dismiss").click({ timeout: 1500 }).catch(() => {});
  const plat = await mapPoint(0.3, 0.55);
  // Route 2 for two hostile tracks, near the platform (about 2 km a pixel at this zoom, the sensor reaches 150 km).
  await btn(/New route|Draw a new route/).first().click();
  await wait(500);
  const pts2 = [[35, -25], [50, -10], [55, 12]];
  for (let i = 0; i < pts2.length; i++) {
    const [dx, dy] = pts2[i];
    if (i < pts2.length - 1) await p.mouse.click(plat.x + dx, plat.y + dy);
    else await p.mouse.dblclick(plat.x + dx, plat.y + dy);
    await wait(400);
  }
  await wait(1200);
  const closeEd = btn("Close the route editor");
  if (await closeEd.isVisible()) await closeEd.click();
  await wait(500);
  // Two hostile symbols, placed away from everything, then put on Route 2 as a convoy.
  await btn("Symbols", { exact: true }).click();
  await wait(500);
  await panelOf("Symbols").locator("select").filter({ has: p.locator("option", { hasText: "Assumed friend" }) }).selectOption({ label: "Hostile" });
  await left().locator(".emc2-list-row, button", { hasText: "Armour" }).first().click();
  await btn("Place on map").click();
  for (const dx of [-60, -30]) {
    await p.mouse.click(plat.x + dx, plat.y + 120);
    await wait(900);
  }
  await p.keyboard.press("Escape");
  await btn("Symbols", { exact: true }).click();
  await wait(400);
  await pickLayerInObjects("Simulation");
  const rows = p.locator(".object-list-row").filter({ hasText: "Symbol" });
  const hostile = rows.filter({ hasNotText: "Route 1-1" });
  await must(hostile.count().then((n) => n >= 2), "the two hostile symbols are not in the list");
  await hostile.nth(0).click();
  await hostile.nth(1).click({ modifiers: ["Control"] });
  await hostile.nth(1).click({ button: "right", modifiers: ["Control"] });
  await p.getByRole("menuitem", { name: "Put on route" }).click();
  await wait(700);
  const d2 = p.locator("dialog[open], [role=dialog]").first();
  await d2.locator("select").first().selectOption({ label: "Route 2" });
  await d2.locator("select").nth(1).selectOption({ label: "Convoy" });
  await d2.getByRole("button", { name: "Put on route" }).click();
  await wait(1500);
  // The sensor on the first track.
  await p.locator(".object-list-row", { hasText: "Route 1-1" }).first().click();
  await wait(800);
  for (const t of ["Symbol properties", "Terrain", "Ground truth outputs"]) {
    const h = right().locator(".panel-head", { hasText: new RegExp(t, "i") }).first().getByRole("button", { name: new RegExp("^" + t + "$", "i") });
    if ((await h.count()) && (await h.first().getAttribute("aria-expanded")) !== "false") await h.first().click().catch(() => {});
  }
  await wait(500);
  await btn("New sensor").click();
  await wait(1200);
  const sp = panelOf("Sensors");
  await sp.getByLabel("Detect all in range").check();
  await sp.getByRole("checkbox").filter({ hasText: /sim-out/ }).first().check().catch(async () => { await sp.getByLabel(/sim-out/).check(); });
  await wait(300);
  await p.setViewportSize({ width: W, height: 1900 });
  await wait(900);
  await shot("sim-sensors", pad(await boxOf(panelOf("Sensors")), 2));
  await p.setViewportSize({ width: W, height: H });
  await wait(500);
  await sp.getByRole("button", { name: "Save" }).click();
  await wait(1200);
});

await step("GMTI: the sensor runs, and the picture in View", async () => {
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(1500);
  await btn("Start Route 1").click({ timeout: 4000 }).catch(() => {});
  await wait(28000);
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1500);
  await pickLayerInObjects("GMTI in");
  const rows = p.locator(".object-list-row");
  await must(rows.filter({ hasText: "GMTI platform" }).count().then((n) => n >= 2), "no GMTI platform and dwell area in the layer GMTI in");
  await must(rows.filter({ hasText: "GMTI detection" }).count().then((n) => n >= 2), "no GMTI detections in the layer GMTI in");
  // The bottom pane is only 170 px high: pull its separator up for the picture, so that the list shows its rows, then put it back
  const dragBottom = async (dy) => {
    const s = await boxOf(sep("bottom"));
    const x = s.x + s.width / 2;
    const y = s.y + s.height / 2;
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.mouse.move(x, y + dy / 2, { steps: 6 });
    await p.mouse.move(x, y + dy, { steps: 6 });
    await p.mouse.up();
    await wait(800);
  };
  await dragBottom(-250);
  await shot("gmti-objects", await boxOf(bottom()));
  await dragBottom(250);
  await rows.filter({ hasText: "dwell area" }).first().click();
  await rows.filter({ hasText: "dwell area" }).first().click({ button: "right" });
  await p.getByRole("menuitem", { name: "Zoom to object(s)" }).click();
  await wait(2500);
  await btn("Display settings", { exact: true }).click();
  await wait(400);
  await p.locator(".display-window").getByLabel("GMTI Pairing").check();
  await wait(1200);
  await btn("Close display settings").click();
  const away = await mapPoint(0.92, 0.9);
  await p.mouse.click(away.x, away.y);
  await wait(1500);
  await shot("gmti-picture", await mapBox());
  // A detection selected: its properties.
  await rows.filter({ hasText: "GMTI detection" }).first().click();
  await wait(900);
  const r = right();
  await r.getByText("Radial velocity").first().scrollIntoViewIfNeeded().catch(() => {});
  await shot("gmti-detection", await boxOf(r));
});

// ---------- M7 RC2: the fading of GMTI detections and dwell areas (T-192) ----------
// How many pixels of a clip are near a colour: the picture is drawn into a canvas in the page.
async function countColour(buf, rgb, tol = 60) {
  return p.evaluate(async ({ b64, rgb, tol }) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) + Math.abs(d[i + 1] - rgb[1]) + Math.abs(d[i + 2] - rgb[2]) < tol) n++;
    return n;
  }, { b64: buf.toString("base64"), rgb, tol });
}
const fadeField = (group, key) => p.locator(`[id$="_2f${group}_2f${key}"]`);
async function openGmtiSettings() {
  await p.getByRole("tab", { name: "Settings" }).click();
  await wait(800);
  await p.locator(".settings-list-entry", { hasText: /^GMTI$/ }).click();
  await wait(800);
}
await step("GMTI fade: the settings form", async () => {
  await p.setViewportSize({ width: W, height: 1300 });
  await openGmtiSettings();
  const det = p.locator("fieldset", { has: p.locator("legend", { hasText: /^Detection fade$/ }) }).first();
  const area = p.locator("fieldset", { has: p.locator("legend", { hasText: /^Dwell area fade$/ }) }).first();
  await det.evaluate((e) => e.scrollIntoView({ block: "start" }));
  await wait(400);
  await must(fadeField("detectionFade", "on").isChecked(), "Fade in steps is not on for the detections by default");
  await must(fadeField("detectionFade", "fromSeconds").inputValue().then((v) => v === "10"), "From (s) is not 10");
  await must(fadeField("detectionFade", "stepPercent").evaluate((e) => e.selectedOptions[0].textContent.trim()).then((v) => v === "5"), "Step (%) is not 5");
  await must(fadeField("detectionFade", "invisibleAtSeconds").inputValue().then((v) => v === "100"), "Invisible at (s) is not 100");
  await must(fadeField("dwellAreaFade", "on").isChecked(), "Fade in steps is not on for the dwell areas by default");
  const steps = await fadeField("detectionFade", "stepPercent").locator("option").allInnerTexts();
  console.log("  step choices:", steps.join(","));
  const labels = await det.locator("label").allInnerTexts();
  console.log("  labels:", labels.join(" | "));
  const a = await boxOf(det);
  const b = await boxOf(area);
  await shot("settings-gmti-fade", pad({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(a.width, b.width), height: b.y + b.height - a.y }, 4));
  // Off hides the three other fields
  await fadeField("detectionFade", "on").uncheck();
  await wait(500);
  await must(fadeField("detectionFade", "fromSeconds").isHidden(), "From (s) stays visible with Fade in steps off");
  await discardSettings();
  await wait(500);
  await p.setViewportSize({ width: W, height: H });
  await wait(400);
});

await step("GMTI fade: detections in steps", async () => {
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(1500);
  await btn("Start all routes").click({ timeout: 4000 }).catch(() => {});
  await wait(70000);
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1500);
  await pickLayerInObjects("GMTI in");
  const rows = p.locator(".object-list-row");
  const n0 = await rows.filter({ hasText: "GMTI detection" }).count();
  console.log("  detections listed:", n0);
  await must(Promise.resolve(n0 >= 3), "fewer than 3 detections in the layer GMTI in");
  // One detection, then one zoom step in (a scale of 500 m): the detections of the last minutes lie in a trail, the newest solid, the oldest faint
  const one = rows.filter({ hasText: "GMTI detection" }).nth(5);
  await one.click();
  await one.click({ button: "right" });
  await p.getByRole("menuitem", { name: "Zoom to object(s)" }).click();
  await wait(2500);
  const away = await mapPoint(0.92, 0.9);
  await p.mouse.click(away.x, away.y);
  await wait(800);
  await p.locator("button", { hasText: /^\+$/ }).first().click();
  await wait(2000);
  const before =await p.screenshot({ clip: clamp(await mapBox()) });
  await shot("gmti-fade-picture", await mapBox());
  // A very short fade, set by the administrator, reaches the map at once, without a reload
  await openGmtiSettings();
  await fadeField("detectionFade", "fromSeconds").fill("0");
  await fadeField("detectionFade", "stepPercent").selectOption({ label: "50" });
  await fadeField("detectionFade", "invisibleAtSeconds").fill("20");
  await p.getByRole("button", { name: "Save" }).first().click();
  await wait(2500);
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(2500);
  const after = await p.screenshot({ clip: clamp(await mapBox()) });
  await must(Promise.resolve(!before.equals(after)), "the map did not change after the fade was set to 0, 50 %, 20 s");
  const n1 = await p.locator(".object-list-row").filter({ hasText: "GMTI detection" }).count();
  console.log("  detections listed after the short fade:", n1);
  await must(Promise.resolve(n1 >= 3), "the detections are no longer listed after the short fade");
  // An end that is not above the start cannot be refused by the form: the Monitor names the setting
  await openGmtiSettings();
  await fadeField("detectionFade", "fromSeconds").fill("10");
  await fadeField("detectionFade", "stepPercent").selectOption({ label: "5" });
  await fadeField("detectionFade", "invisibleAtSeconds").fill("5");
  await p.getByRole("button", { name: "Save" }).first().click();
  await wait(3000);
  await p.getByRole("tab", { name: "Monitor" }).click();
  await wait(4500);
  const mon = await p.locator("body").innerText();
  const gi = mon.search(/GMTI[\s\S]{0,40}Degraded/i);
  console.log("  Monitor with the end below the start:", gi < 0 ? "no Degraded" : mon.slice(Math.max(0, gi - 40), gi + 300).replace(/\s+/g, " "));
  await must(Promise.resolve(gi >= 0), "the Monitor shows no Degraded for a fade whose end is not above its start");
  console.log("  Problems tab:", (await p.getByRole("tab", { name: /Problems/ }).innerText().catch(() => "no tab")).replace(/\s+/g, " "));
  await p.getByRole("tab", { name: /Problems/ }).click().catch(() => {});
  await wait(1200);
  console.log("  Problems list:", (await p.locator("section.other-view:visible").last().innerText()).replace(/\s+/g, " ").slice(0, 700));
  await shot("monitor-problems", pad(await boxOf(p.locator("section.other-view:visible").last().locator("section, .card").filter({ hasText: "Find a plugin" }).first()), 2));
  await p.getByRole("tab", { name: /^All/ }).click().catch(() => {});
  // The data type of the dwell areas
  await p.getByRole("tab", { name: "Settings" }).click();
  await wait(800);
  await p.locator(".settings-list-entry", { hasText: /^Data types$/ }).click();
  await wait(1000);
  const dt = await p.locator(".settings-layout, #settings-entry").first().innerText();
  const di = dt.indexOf("GMTI dwell area");
  console.log("  Data types:", di < 0 ? "no GMTI dwell area" : dt.slice(di, di + 160).replace(/\s+/g, " "));
  await must(Promise.resolve(di >= 0), "the data type GMTI dwell area is not in Settings, Data types");
  // Back to the defaults
  await openGmtiSettings();
  await fadeField("detectionFade", "fromSeconds").fill("10");
  await fadeField("detectionFade", "stepPercent").selectOption({ label: "5" });
  await fadeField("detectionFade", "invisibleAtSeconds").fill("100");
  await p.getByRole("button", { name: "Save" }).first().click();
  await wait(2000);
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1000);
});

// ---------- M7 RC2: which setting colours what (the table in 5.14). The two groups are set to different colours, then removed ----------
await step("GMTI colours: which setting colours what", async () => {
  const group = (legend) => p.locator("fieldset", { has: p.locator("legend", { hasText: new RegExp("^" + legend + "$") }) }).first();
  const setFixed = async (legend, colour) => {
    const g = group(legend);
    await g.scrollIntoViewIfNeeded();
    await g.locator("select").first().selectOption({ label: "fixed" });
    await wait(400);
    await g.getByRole("textbox").first().fill(colour);
    await wait(300);
  };
  const clearGroup = async (legend) => {
    await p.getByRole("button", { name: "Use the default for " + legend }).click().catch(() => {});
  };
  // Simulator: Dwell colour cyan. It reaches the Simulation map at once.
  await p.getByRole("tab", { name: "Settings" }).click();
  await wait(800);
  await p.locator(".settings-list-entry", { hasText: /^Simulator$/ }).click();
  await wait(800);
  await setFixed("Dwell colour", "#00FFFF");
  await p.getByRole("button", { name: "Save" }).first().click();
  await wait(2000);
  // GMTI: Dwell area colour magenta. It reaches the dwell areas from each sensor's next dwell.
  await openGmtiSettings();
  await setFixed("Dwell area colour", "#FF00FF");
  await p.getByRole("button", { name: "Save" }).first().click();
  await wait(2000);
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(6000);
  const sim = await p.screenshot({ clip: clamp(await mapBox()) });
  const cyanSim = await countColour(sim, [0, 255, 255]);
  console.log("  Simulation: cyan pixels", cyanSim, ", magenta pixels", await countColour(sim, [255, 0, 255]));
  await must(Promise.resolve(cyanSim >= 30), "the simulator's dwells are not cyan in Simulation");
  await wait(20000);
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(2500);
  await pickLayerInObjects("GMTI in");
  const areaRow = p.locator(".object-list-row").filter({ hasText: "dwell area" }).first();
  await areaRow.click();
  await areaRow.click({ button: "right" });
  await p.getByRole("menuitem", { name: "Zoom to object(s)" }).click();
  await wait(2500);
  const away2 = await mapPoint(0.92, 0.9);
  await p.mouse.click(away2.x, away2.y);
  await wait(1500);
  const view = await p.screenshot({ clip: clamp(await mapBox()) });
  const magView = await countColour(view, [255, 0, 255]);
  console.log("  View: magenta pixels", magView, ", cyan pixels", await countColour(view, [0, 255, 255]));
  await must(Promise.resolve(magView >= 30), "the dwell areas of the GMTI link are not magenta in View");
  // Back to identity
  await p.getByRole("tab", { name: "Settings" }).click();
  await wait(600);
  await p.locator(".settings-list-entry", { hasText: /^Simulator$/ }).click();
  await wait(800);
  await clearGroup("Dwell colour");
  await p.getByRole("button", { name: "Save" }).first().click();
  await wait(1500);
  await openGmtiSettings();
  await clearGroup("Dwell area colour");
  await p.getByRole("button", { name: "Save" }).first().click();
  await wait(1500);
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(800);
});

// ---------- M5 RC2: a sensor's coverage in Simulation, and the box that gmti in draws in View ----------
await step("Sensors: the coverage in Simulation and in View", async () => {
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(1500);
  await btn("Dismiss").click({ timeout: 1500 }).catch(() => {});
  const sp = panelOf("Sensors");
  await must(sp.getByLabel("Show coverage").isChecked(), "Show coverage is not on by default");
  // The coverage as the sensor is now: a circle (Detect all in range).
  await pickLayerInObjects("Simulation");
  const plat = p.locator(".object-list-row", { hasText: "Route 1-1" }).first();
  await plat.click();
  await plat.click({ button: "right" });
  await p.getByRole("menuitem", { name: "Centre on object(s)" }).click();
  await wait(1500);
  const c = await mapPoint(0.5, 0.5);
  await p.mouse.move(c.x, c.y);
  for (let i = 0; i < 2; i++) { await p.mouse.wheel(0, -300); await wait(300); }
  await wait(1500);
  await shot("sim-coverage-circle", await mapBox());
  // Then a sector: not all round, but 45 to 135 degrees from the heading.
  await sp.getByRole("button", { name: "Route 1-1" }).click();
  await wait(800);
  if (await sp.getByLabel("Detect all in range").isChecked()) {
    await sp.getByLabel("Detect all in range").uncheck();
    // M7: a new sensor looks all round (0 to 360 degrees): set the sector 45 to 135 degrees. The map follows the fields before Save.
    await sp.getByLabel("Start bearing (°)").fill("45");
    await sp.getByLabel("End bearing (°)").fill("135");
    await wait(1200);
    await sp.getByRole("button", { name: "Save" }).click();
  }
  await wait(1500);
  await shot("sim-coverage-sector", await mapBox());
  // A job area: four corners, drawn as a rectangle. Only tracks inside it are detected.
  const j0 = await mapPoint(0.5, 0.5);
  for (let attempt = 0; attempt < 3; attempt++) {
    // Put the platform in the middle again: a failed attempt only pans the map.
    await pickLayerInObjects("Simulation");
    await p.locator(".object-list-row", { hasText: "Route 1-1" }).first().click();
    await p.locator(".object-list-row", { hasText: "Route 1-1" }).first().click({ button: "right" });
    await p.getByRole("menuitem", { name: "Centre on object(s)" }).click();
    await wait(1500);
    // A selected object makes the drag a pan: click empty map to clear the selection first.
    const empty = await mapPoint(0.1, 0.1);
    await p.mouse.click(empty.x, empty.y);
    await wait(800);
    if (!(await sp.getByLabel("Preset").count())) await sp.getByRole("button", { name: "Route 1-1" }).click();
    await wait(600);
    await sp.getByRole("button", { name: "Draw job area", exact: true }).click();
    await wait(600);
    await p.mouse.move(j0.x + 100, j0.y - 150);
    await p.mouse.down();
    for (let i = 1; i <= 10; i++) await p.mouse.move(j0.x + 100 + (190 * i) / 10, j0.y - 150 + (250 * i) / 10, { steps: 3 });
    await p.mouse.up();
    await wait(2500);
    if (await sp.getByText(/Four corners/).first().isVisible().catch(() => false)) break;
  }
  await must(sp.getByText(/Four corners/).first().isVisible(), "the job area was not drawn");
  await shot("sim-job-area", await mapBox());
  // In View, gmti in draws the box that the sensor says it works in, with the sector inside it.
  // The dwell areas that the colour step drew in magenta are gone 100 s after their newest dwell
  await wait(110000);
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1500);
  await pickLayerInObjects("GMTI in");
  const rows = p.locator(".object-list-row");
  await must(rows.filter({ hasText: "coverage" }).count().then((n) => n >= 1), "the layer GMTI in has no coverage object");
  await rows.filter({ hasText: "coverage" }).first().click();
  await rows.filter({ hasText: "coverage" }).first().click({ button: "right" });
  await p.getByRole("menuitem", { name: "Zoom to object(s)" }).click();
  await wait(2500);
  const away = await mapPoint(0.92, 0.9);
  await p.mouse.click(away.x, away.y);
  await wait(1500);
  await shot("gmti-coverage", await mapBox());
});

// ---------- M8 (T-191, T-197): the Narrow wedge preset scans in rows (Systematic), and the Random mode fills its revisit ----------
await step("Sensors: the Narrow wedge scans in rows", async () => {
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(1500);
  await btn("Dismiss").click({ timeout: 1500 }).catch(() => {});
  const sp = panelOf("Sensors");
  if (!(await sp.getByLabel("Preset").count())) await sp.getByRole("button", { name: "Route 1-1" }).click();
  await wait(600);
  // The Random mode (the Medium wedge, as a new sensor has it): the revisit is full of dwells, one for each dwell interval
  await must(sp.getByLabel("Mode").evaluate((e) => e.selectedOptions[0].textContent.trim()).then((v) => v === "Random"), "the mode is not Random on the Medium wedge");
  await must(Promise.resolve((await sp.getByLabel("Empty dwells").count()) === 0), "the Sensors panel still has an Empty dwells field");
  const presets = await sp.getByLabel("Preset").locator("option").allTextContents();
  console.log("  presets:", presets.join(" | "));
  await must(Promise.resolve(presets.join("|") === "Default|Narrow wedge|Medium wedge|Wide wedge|Custom"), "the presets are " + presets.join("|"));
  // The job area is cleared, so that the scan covers the whole sector
  const clear = sp.getByRole("button", { name: "Clear job area" });
  if (await clear.isEnabled()) { await clear.click(); await wait(1000); }
  await sp.getByLabel("Preset").selectOption({ label: "Narrow wedge" });
  await wait(800);
  const read = async (l) => sp.getByLabel(l).first().inputValue();
  console.log("  narrow wedge:", await read("Search width (°)"), await read("Dwell depth (km)"), await read("Dwell interval (s)"), await sp.getByLabel("Mode").evaluate((e) => e.selectedOptions[0].textContent.trim()), await read("Target revisit (s)"));
  await must(Promise.resolve((await read("Search width (°)")) === "1.7" && (await read("Dwell depth (km)")) === "95" && (await read("Dwell interval (s)")) === "0.1"), "the Narrow wedge does not set 1.7°, 95 km and 0.1 s");
  await must(Promise.resolve((await read("Target revisit (s)")) === "2"), "the Target revisit is not 2");
  await must(sp.getByText(/Not used in Systematic/).first().isVisible(), "no note that the Revisit interval is not used in Systematic");
  await p.setViewportSize({ width: W, height: 1900 });
  await wait(900);
  await shot("sim-sensors-systematic", pad(await boxOf(panelOf("Sensors")), 2));
  await p.setViewportSize({ width: W, height: H });
  await wait(500);
  await sp.getByRole("button", { name: "Save" }).click();
  await wait(1500);
  await pickLayerInObjects("Simulation");
  const plat = p.locator(".object-list-row", { hasText: "Route 1-1" }).first();
  await plat.click();
  await plat.click({ button: "right" });
  await p.getByRole("menuitem", { name: "Centre on object(s)" }).click();
  await wait(1500);
  const away = await mapPoint(0.1, 0.1);
  await p.mouse.click(away.x, away.y);
  await wait(9000);
  await shot("sim-systematic-scan", await mapBox());
});

await step("Simulation: the Outputs panel", async () => {
  const close = btn("Close the route editor");
  if (await close.isVisible()) await close.click();
  await wait(500);
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(1000);
  if (!(await p.getByText("No plugin offers an output channel").isVisible())) {
    await right().locator(".panel-head", { hasText: /ground truth outputs/i }).first().getByRole("button", { name: /^Ground truth outputs$/i }).click();
    await wait(600);
  }
  await must(p.getByText("No plugin offers an output channel").isVisible(), "the Outputs panel text differs");
  const out = right().locator(".panel", { has: p.locator(".panel-title-text", { hasText: /ground truth outputs/i }) }).first();
  await shot("sim-outputs", pad(await boxOf(out), 2));
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(800);
});

// ---------- part 5: Settings, part 6: the Monitor ----------
await step("Settings: the categories", async () => {
  await p.getByRole("tab", { name: "Settings" }).click();
  await wait(1000);
  const names = (await p.locator(".settings-list-entry").allInnerTexts()).map((n) => n.split("\n")[0].trim());
  // Since M7 the list stands under six headings (T-174): Data Links, GeoMetoc, Map and Symbols, Drawing, Simulation, General.
  // Since M8 FMV is a category of Data Links, and the list has a filter over the names of the categories (T-203 part C).
  const expect = ["ADS-B aircraft", "AIS", "Cursor on Target", "FMV", "GMTI", "NVG", "Natural Earth background", "OpenStreetMap background", "Terrain", "WMS background maps", "2D map view", "Coordinates", "Symbology", "Draw shapes", "Draw symbols", "Draw tactical graphics", "Simulator", "General", "Display", "Data types", "Layers", "Labeling", "Bookmarks", "Objects"];
  const heads = await p.locator(".settings-list-heading").allInnerTexts();
  await must(heads.join("|").toLowerCase() === ["Data Links", "GeoMetoc", "Map and Symbols", "Drawing", "Simulation", "General"].join("|").toLowerCase(), "the headings are: " + heads.join(", "));
  await must(names.join("|") === expect.join("|"), "the settings categories are: " + names.join(", "));
  // The pictures of a category: a page as it is at the usual size; a list of links as its table and side form, tall enough for both
  const take = async (entry, name, withLink) => {
    await openSettings(entry);
    if (withLink) {
      await p.setViewportSize({ width: W, height: 1300 });
      await addLink();
      await linkList().scrollIntoViewIfNeeded();
      await wait(400);
      await shot(name, await boxOf(linkList()));
      await discardSettings();
      await p.setViewportSize({ width: W, height: H });
      await wait(400);
    } else {
      await p.evaluate(() => { for (const e of document.querySelectorAll("*")) if (e.scrollTop) e.scrollTop = 0; window.scrollTo(0, 0); });
      await wait(300);
      await shot(name);
    }
  };
  await take("General", "settings-overview");
  await take("Display", "settings-display");
  await take("Data types", "settings-data-types");
  await take("Layers", "settings-layers");
  // M7 (T-175): each layer can list its objects and be emptied.
  const lcard = p.locator("article.settings-card", { hasText: "Own forces" }).first();
  await lcard.getByRole("button", { name: "Show objects" }).click();
  await wait(1500);
  await p.setViewportSize({ width: W, height: 1300 });
  await wait(800);
  await shot("settings-layers-list", pad(await boxOf(lcard), 6));
  await p.setViewportSize({ width: W, height: H });
  await wait(500);
  await lcard.getByRole("button", { name: "Hide objects" }).click();
  await lcard.getByRole("button", { name: "Delete all objects" }).click();
  await wait(600);
  const dq = p.getByRole("alertdialog");
  await must(dq.getByText(/Delete all \d+ objects in Own forces\? This cannot be undone\./).isVisible(), "the question before Delete all objects differs");
  await shot("settings-layers-empty", pad(await boxOf(dq), 8));
  await dq.getByRole("button", { name: "Cancel" }).click();
  await wait(500);
});

// Since X1 (CR-0054) the pages and links forms have titles of their own; these pictures follow them. Runs alone with --only="Settings: the pages".
await step("Settings: the pages of the plugins", async () => {
  await p.getByRole("tab", { name: "Settings" }).click();
  await wait(800);
  const take = async (entry, name, withLink) => {
    await openSettings(entry);
    if (withLink) {
      await p.setViewportSize({ width: W, height: 1300 });
      await addLink();
      await linkList().scrollIntoViewIfNeeded();
      await wait(400);
      await shot(name, await boxOf(linkList()));
      await discardSettings();
      await p.setViewportSize({ width: W, height: H });
      await wait(400);
    } else {
      await p.evaluate(() => { for (const e of document.querySelectorAll("*")) if (e.scrollTop) e.scrollTop = 0; window.scrollTo(0, 0); });
      await wait(300);
      await shot(name);
    }
  };
  await take("2D map view", "settings-map-view");
  await take("ADS-B aircraft", "settings-adsb", true);
  await take("AIS", "settings-ais", true);
  await openSettings("AIS");
  await addLink();
  await linkForm().getByRole("button", { name: "New layer for Layer" }).click();
  await wait(500);
  const tl = await boxOf(lf("Layer"));
  const nb = await boxOf(p.getByLabel("Name of the new layer"));
  const top = Math.min(nb.y - 70, tl.y - 30);
  await shot("settings-new-layer", { x: tl.x - 10, y: top, width: 480, height: tl.y + tl.height + 30 - top });
  await p.keyboard.press("Escape");
  await discardSettings();
  await wait(400);
  await take("Cursor on Target", "settings-cot", true);
  await take("Draw tactical graphics", "settings-draw-tactical");
  // M7 (T-185), M8: the simulator's colour settings. Each colour has Use (fixed by default) and a colour box with its field. Nothing is saved.
  await take("Simulator", "settings-simulator");
  await take("WMS background maps", "settings-wms");
});

// ---------- M6: Settings > Labeling. Nothing is saved: the step ends with Discard changes ----------
await step("Settings: Labeling", async () => {
  await p.getByRole("tab", { name: "Settings" }).click();
  await wait(800);
  await p.locator(".settings-list-entry", { hasText: /^Labeling$/ }).click();
  await wait(900);
  await shot("settings-labeling");
  await p.getByRole("button", { name: "+ Add a value" }).first().click();
  await p.keyboard.type("SWE");
  await p.keyboard.press("Enter");
  await wait(400);
  await p.getByRole("button", { name: "+ Add a value" }).first().click();
  await p.keyboard.type("FIN");
  await p.keyboard.press("Enter");
  await wait(400);
  await p.getByRole("button", { name: "+ New label" }).first().click();
  await wait(600);
  await p.locator("#settings-entry, .settings-layout").first().locator("select").filter({ has: p.locator("option", { hasText: "UNCLASSIFIED" }) }).first().selectOption({ label: "SECRET" });
  await p.getByRole("button", { name: "SWE", exact: true }).last().click();
  await p.getByRole("button", { name: "FIN", exact: true }).last().click();
  await wait(500);
  await shot("settings-labeling-new");
  await p.getByRole("button", { name: "Add label" }).click();
  await wait(800);
  await shot("settings-labeling-added");
  await discardSettings();
  await wait(500);
  const q = p.locator("dialog[open], [role=dialog]").first();
  if (await q.isVisible().catch(() => false)) await q.getByRole("button", { name: /Discard|Leave/ }).first().click().catch(() => {});
  await wait(500);
});

// ---------- M5 RC2: Cursor on Target, the symbols from TAK and back. Events are sent over UDP on this computer ----------
// ATAK's format is <__milsym> with <unitmodifier>s, WinTAK's <mil2525c> with <amp>. A second link sends the layer out again, and
// a socket of the script listens for what it sends.
const COT_IN = 47610;
const COT_OUT = 47611;
const cotEvent = (uid, type, lat, lon, callsign, detail) => {
  const now = new Date();
  const stale = new Date(now.getTime() + 86400000);
  return `<event version="2.0" uid="${uid}" type="${type}" time="${now.toISOString()}" start="${now.toISOString()}" stale="${stale.toISOString()}" how="h-g-i-g-o">` +
    `<point lat="${lat}" lon="${lon}" hae="9999999.0" ce="9999999.0" le="9999999.0"/><detail><contact callsign="${callsign}"/>${detail}</detail></event>`;
};
const atak = (id, mods = "") => `<__milicon id="${id}">${mods}</__milicon><__milsym id="${id}">${mods}</__milsym>`;
const um = (code, v) => `<unitmodifier code="${code}">${v}</unitmodifier>`;
let cotSent = [];
await step("Cursor on Target: symbols from TAK and back", async () => {
  await openSettings("Cursor on Target");
  if ((await p.locator(".settings-item-table").getByText("tak-in").count()) === 0) {
    await addLink();
    await lf("Name").fill("tak-in");
    await lf("Direction").selectOption({ label: "in" });
    await lf("Transport").selectOption({ label: "udp" });
    await lf("Port").fill(String(COT_IN));
    await linkForm().getByRole("button", { name: "New layer for Receive into layer" }).click();
    await wait(400);
    await p.getByLabel("Name of the new layer").fill("TAK in");
    await p.getByRole("button", { name: "Create" }).click();
    await wait(1200);
    await saveLink();
    await addLink();
    await lf("Name").fill("tak-out");
    await lf("Direction").selectOption({ label: "out" });
    await lf("Transport").selectOption({ label: "udp" });
    await lf("Host").fill("127.0.0.1");
    await lf("Port").fill(String(COT_OUT));
    await linkForm().getByRole("checkbox", { name: "TAK in" }).check();
    await openFold("Sending");
    await lf("Refresh").fill("5");
    await saveLink();
    await must(p.locator(".settings-item-table").getByText("tak-out").first().isVisible(), "the CoT links were not saved");
  }
  // What the out link sends.
  const sock = dgram.createSocket("udp4");
  sock.on("message", (m) => cotSent.push(m.toString("utf8")));
  await new Promise((res) => sock.bind(COT_OUT, "127.0.0.1", res));
  // The events: ATAK's format, then WinTAK's.
  const out = dgram.createSocket("udp4");
  const send = (xml) => new Promise((res) => out.send(Buffer.from(xml), COT_IN, "127.0.0.1", res));
  await send(cotEvent("emcc-doc-1", "a-f-G-U-C-I", 58.2, 14.6, "ALPHA", atak("SFG*UCI---AF***", um("T", "1 INF") + um("M", "3 BDE") + um("C", "480") + um("F", "+"))));
  await send(cotEvent("emcc-doc-2", "a-h-G-U-C-A", 58.05, 15.1, "TANGO", atak("SHG*UCA----E***", um("T", "2 ARM") + um("G", "Moving north"))));
  await send(cotEvent("emcc-doc-3", "a-f-G-U-C-I-C", 57.85, 14.8, "BRAVO", `<mil2525c SIDC="SFGPUCI----F---"/><amp unique_designation="Alpha Co" higher_formation="1st Mech Div" quantity="120" status="Excellent"/><remarks>Qty: 120, Higher: 1st Mech Div, Status: Green</remarks>`));
  await send(cotEvent("emcc-doc-4", "a-f-G-U", 58.3, 15.2, "CHARLIE", atak("SFG*U-----*E***")));
  await wait(2500);
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1500);
  await pickLayerInObjects("TAK in");
  const rows = p.locator(".object-list-row");
  await must(rows.count().then((n) => n >= 4), "the layer TAK in has no four objects");
  const n = await rows.count();
  await rows.nth(0).click();
  for (let k = 1; k < n; k++) await rows.nth(k).click({ modifiers: ["Control"] });
  await rows.nth(n - 1).click({ button: "right", modifiers: ["Control"] });
  await p.getByRole("menuitem", { name: "Zoom to object(s)" }).click();
  await wait(2500);
  const away = await mapPoint(0.96, 0.96);
  await p.mouse.click(away.x, away.y);
  await wait(1500);
  await shot("cot-picture", await mapBox());
  // The symbol of ALPHA: its echelon, amplifiers and the field set CoT unit.
  await rows.filter({ hasText: "ALPHA" }).first().click();
  await wait(900);
  for (const t of ["Symbol properties"]) {
    const h = right().locator(".panel-head", { hasText: new RegExp(t, "i") }).first().getByRole("button", { name: new RegExp("^" + t + "$", "i") });
    if ((await h.count()) && (await h.first().getAttribute("aria-expanded")) === "false") await h.first().click().catch(() => {});
  }
  await wait(600);
  await p.setViewportSize({ width: W, height: 1900 });
  await wait(900);
  await shot("cot-symbol-properties", pad(await boxOf(panelOf("Symbol properties")), 2));
  await p.setViewportSize({ width: W, height: H });
  await wait(500);
  await wait(8000);
  console.log("  datagrams sent by the out link:", cotSent.length);
  for (const x of cotSent.slice(0, 5)) console.log("    " + x.slice(0, 900));
  sock.close();
  out.close();
});

// ---------- M6: Move to layer and Copy to layer in the object menu ----------
// ---------- M7: a refused file leaves no new layer behind (the manual's 3.18 says so) ----------
await step("NVG: a refused file leaves no layer", async () => {
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1200);
  await btn("Dismiss").click({ timeout: 1500 }).catch(() => {});
  const nv = panelOf("NVG");
  const bad = '<?xml version="1.0"?>\n<!DOCTYPE nvg [<!ENTITY x "y">]>\n<nvg version="2.0.2"/>';
  await nv.locator("input[type=file]").setInputFiles({ name: "refused-shots.nvg", mimeType: "text/xml", buffer: Buffer.from(bad) });
  await wait(600);
  const before = await nv.locator("select").first().locator("option").allTextContents();
  await must(Promise.resolve(before.includes("New layer: refused-shots")), "the panel does not offer a new layer named after the file: " + before.join());
  await nv.getByRole("button", { name: "Import", exact: true }).click();
  await must(nv.getByText(/DTD/).first().waitFor({ timeout: 15000 }).then(() => true), "the DTD file was not refused");
  await wait(2500);
  const after = await nv.locator("select").first().locator("option").allTextContents();
  await must(Promise.resolve(!after.some((o) => o.includes("refused-shots") && !o.startsWith("New layer"))), "a layer refused-shots was left behind: " + after.join());
  console.log("  options after the refusal:", after.join(" | "));
});

// ---------- M7: NVG, a file in and out (T-173). The file is the small example next to this script ----------
await step("NVG: import a file, export a layer", async () => {
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1200);
  await btn("Dismiss").click({ timeout: 1500 }).catch(() => {});
  await openPanel("NVG");
  const nv = panelOf("NVG");
  await p.setViewportSize({ width: W, height: 1100 });
  await wait(800);
  await nv.locator("input[type=file]").setInputFiles(path.join(SRC, "shots-example.nvg"));
  await nv.locator("select").nth(1).selectOption({ label: "UNCLASSIFIED" });
  await wait(600);
  const offered = await nv.locator("select").first().locator("option").allTextContents();
  await must(Promise.resolve(offered.includes("New layer: shots-example")), "the panel does not offer a new layer named after the file: " + offered.join());
  await nv.getByRole("button", { name: "Import", exact: true }).click();
  await must(nv.getByText(/shots-example\.nvg: 6 items: 6 created, 0 updated, 0 unchanged/).waitFor({ timeout: 15000 }).then(() => true), "the import did not report 6 created");
  await wait(800);
  await nv.scrollIntoViewIfNeeded();
  await shot("nvg-panel", pad(await boxOf(nv), 2));
  // What it made, on the map
  await p.setViewportSize({ width: W, height: H });
  await wait(600);
  await pickLayerInObjects("shots-example");
  const rows = p.locator(".object-list-row");
  await must(rows.count().then((n) => n === 6), "the layer shots-example does not hold 6 objects");
  await rows.first().click();
  for (let i = 1; i < 6; i++) await rows.nth(i).click({ modifiers: ["Control"] });
  await rows.last().click({ button: "right", modifiers: ["Control"] });
  await p.getByRole("menuitem", { name: "Zoom to object(s)" }).click();
  await wait(2500);
  await p.mouse.click((await mapPoint(0.6, 0.95)).x, (await mapPoint(0.6, 0.95)).y);
  await wait(800);
  await shot("nvg-map", await mapBox());
  // Export the layer again
  await p.setViewportSize({ width: W, height: 1100 });
  await wait(800);
  await nv.getByRole("checkbox", { name: "shots-example" }).check();
  await wait(400);
  await nv.scrollIntoViewIfNeeded();
  await shot("nvg-export", pad(await boxOf(nv), 2));
  const [dl] = await Promise.all([p.waitForEvent("download"), nv.getByRole("button", { name: "Export", exact: true }).click()]);
  await must(Promise.resolve(dl.suggestedFilename() === "shots-example.nvg"), "the file is named " + dl.suggestedFilename());
  const out = path.join(SRC, "x-export.tmp.nvg");
  await dl.saveAs(out);
  const xml = fs.readFileSync(out, "utf8");
  fs.rmSync(out, { force: true });
  await must(Promise.resolve(xml.includes('version="2.0.2"') && xml.includes("Alpha") && xml.includes("Assembly area")), "the exported file lacks version 2.0.2 or the items");
  console.log("  exported file:", xml.length, "characters");
  await nv.getByRole("checkbox", { name: "shots-example" }).uncheck();
  await p.setViewportSize({ width: W, height: H });
  await wait(500);
});

await step("Objects: Move to layer and Copy to layer", async () => {
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1200);
  await pickLayerInObjects("Own forces");
  const rows = p.locator(".object-list-row");
  await rows.nth(0).click();
  await rows.nth(0).click({ button: "right" });
  await wait(600);
  const items = await p.getByRole("menuitem").allInnerTexts();
  console.log("  menu on an object:", items.join(" | "));
  for (const t of ["Move to layer…", "Copy to layer…"]) await must(p.getByRole("menuitem", { name: t }).isVisible(), "the object menu has no " + t);
  await shot("objects-menu", pad(await boxOf(p.getByRole("menu").first()), 4));
  await p.getByRole("menuitem", { name: "Move to layer…" }).click();
  await wait(700);
  await dlg().locator("select").selectOption({ label: "Opposing forces" });
  await shot("objects-move", pad(await boxOf(dlg()), 8));
  await dlg().getByRole("button", { name: "Cancel" }).click();
  await wait(500);
  // Copy two objects to Drawing: the copies are hand-made snapshots.
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ["Control"] });
  await rows.nth(1).click({ button: "right", modifiers: ["Control"] });
  await p.getByRole("menuitem", { name: "Copy to layer…" }).click();
  await wait(600);
  await dlg().locator("select").selectOption({ label: "Drawing" });
  await dlg().getByRole("button", { name: /^Copy 2 objects$/ }).click();
  await wait(1000);
  const note = p.getByText("Copied 2 objects to Drawing.");
  await must(note.isVisible(), "no note after Copy to layer");
  await shot("objects-copied", pad(await boxOf(note.locator("xpath=ancestor::*[1]")), 12));
  await wait(500);
});

// ---------- M7: NVG links. The two forms are only shown; then a provider and a consumer that read each other make the panel's Links ----------
await step("NVG: links in Settings, and in the panel", async () => {
  await p.setViewportSize({ width: W, height: 1300 });
  await openSettings("NVG");
  await addLink();
  await openFold("Calls");
  // The link's name is a plain text field that starts empty.
  await lf("Name").fill("anet");
  await lf("Provider address").fill("http://localhost:8380/cxf/nvg/20");
  await lf("Access token").fill("anet");
  await wait(400);
  await linkList().scrollIntoViewIfNeeded();
  await shot("settings-nvg-consumer", await boxOf(linkList()));
  await lf("Kind").selectOption({ label: "soap-provider" });
  await wait(600);
  await shot("settings-nvg-provider", await boxOf(linkList()));
  await discardSettings();
  await wait(500);
  // A provider that serves the layer shots-example, and a consumer that reads it (this emcc, over its own address)
  await addLink();
  await lf("Name").fill("loop-out");
  await lf("Kind").selectOption({ label: "soap-provider" });
  await wait(400);
  await linkForm().getByRole("checkbox", { name: "shots-example" }).first().check();
  await saveLink();
  await addLink();
  await openFold("Calls");
  await lf("Name").fill("loop-in");
  await lf("Provider address").fill(BASE + "/api/services/nvg/nvg/loop-out");
  // The first call can come before the provider has read its layers: poll every 10 s, the least allowed.
  await lf("Call interval").fill("10");
  await wait(300);
  await saveLink();
  await p.setViewportSize({ width: W, height: H });
  await wait(3000);
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(3000);
  await p.setViewportSize({ width: W, height: 1100 });
  await wait(800);
  const nv = panelOf("NVG");
  let read = false;
  for (let i = 0; i < 8 && !read; i++) {
    await nv.getByRole("button", { name: "Refresh" }).click();
    await wait(6000);
    read = await nv.getByText(/6 items, 6 created/).first().isVisible().catch(() => false);
  }
  await must(Promise.resolve(read), "the consumer link has not read the 6 items");
  await nv.getByRole("button", { name: "Get capabilities" }).first().click();
  await wait(2500);
  await must(nv.getByText("layers", { exact: true }).first().isVisible(), "Get capabilities listed no filter item");
  await nv.scrollIntoViewIfNeeded();
  await shot("nvg-links", pad(await boxOf(nv), 2));
  await p.setViewportSize({ width: W, height: H });
  await wait(500);
});

// ---------- M8: FMV (T-209). Needs the ESA's replay: node external/fmv/start.mjs --only day-h264,day-mpeg2 (127.0.0.1:14611 and :14610) ----------
// The steps run only when --only names them: --only="Map controls: close,FMV:" on fresh data.
// No picture of the recording itself is kept (it has no licence, and the ESA's sheet keeps it out of the repository): the video is hidden before a picture of the window.
const FMV = ONLY.includes("FMV:");
if (FMV) {
  const fmvPanel = () => p.locator(".pane-right .panel", { has: p.locator(".panel-head", { hasText: /^FMV$/i }) }).first();
  const openRight = async (name) => {
    const h = p.locator(".pane-right .panel-head button", { hasText: new RegExp("^" + name + "$", "i") }).first();
    if ((await h.getAttribute("aria-expanded")) === "false") await h.click();
    await wait(600);
  };
  await step("FMV: two links in Settings", async () => {
    await openSettings("FMV");
    const heads = await settingsEntry().innerText();
    await must(Promise.resolve(/0 links/.test(heads)), "the FMV page does not start with 0 links");
    for (const [name, port] of [["Camera 1", "14611"]]) {
      await addLink();
      await lf("Name").fill(name);
      await lf("Port").fill(port);
      await saveLink();
    }
    const t = await settingsEntry().innerText();
    await must(Promise.resolve(/1 link/.test(t)), "the FMV page does not show 1 link");
    const labels = (await linkForm().locator("label").allInnerTexts()).map((s) => s.trim()).filter(Boolean);
    console.log("  link fields:", labels.join(" | "));
  });

  await step("FMV: the panel, the camera and its arc", async () => {
    await p.getByRole("tab", { name: "View", exact: true }).click();
    await wait(1500);
    await btn("Dismiss").click({ timeout: 1500 }).catch(() => {});
    await openRight("FMV");
    // Wait for a row that says Live (the sample has few sets, so a stream is often Stale)
    let live = false;
    for (let i = 0; i < 80 && !live; i++) {
      const t = await fmvPanel().innerText();
      live = /Camera 1[^]*? s ago[^]*?Live/.test(t) || /Camera 1[^]*?[0-9] s ago\s*Live/.test(t);
      if (!live) await wait(1000);
    }
    const text = (await fmvPanel().innerText()).replace(/\n+/g, " | ");
    console.log("  panel:", text);
    await must(Promise.resolve(/Camera 1 \| H\.264/.test(text)), "no H.264 row for Camera 1");
    await must(Promise.resolve(live), "Camera 1 never said Live with the age of its last set");
    // The camera and its field of view: both objects of the layer Camera 1, zoomed to
    await pickLayerInObjects("Camera 1");
    const rows = p.locator(".object-list-row");
    await must(rows.count().then((n) => n === 2), "the layer Camera 1 does not hold 2 objects");
    console.log("  objects:", (await rows.allInnerTexts()).map((s) => s.replace(/\s+/g, " ")).join(" // "));
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ["Control"] });
    await rows.nth(1).click({ button: "right", modifiers: ["Control"] });
    await p.getByRole("menuitem", { name: "Zoom to object(s)" }).click();
    await wait(3000);
    // One zoom step out, so that the camera is not under the map's labels
    const mc = await mapPoint(0.5, 0.5);
    await p.mouse.move(mc.x, mc.y);
    await p.mouse.wheel(0, 300);
    await wait(1500);
    const away = await mapPoint(0.92, 0.9);
    await p.mouse.click(away.x, away.y);
    await wait(1500);
    await shot("fmv-map", await mapBox());
    // The camera's properties: the field set FMV camera
    await rows.filter({ hasText: "FMV camera" }).first().click();
    await wait(1200);
    await openRight("Symbol properties");
    await wait(800);
    const sp = p.locator(".pane-right .panel", { has: p.locator(".panel-head", { hasText: /^Symbol properties$/i }) }).first();
    await p.setViewportSize({ width: W, height: 1900 });
    await wait(900);
    const spText = (await sp.innerText()).replace(/\n+/g, " | ");
    console.log("  symbol properties (end):", spText.slice(-900));
    await shot("fmv-properties", pad(await boxOf(sp), 2));
    await p.setViewportSize({ width: W, height: H });
    await wait(500);
    await openRight("Symbol properties");
  });

  await step("FMV: Watch, the window", async () => {
    await openRight("FMV");
    await p.getByRole("button", { name: "Watch" }).first().click();
    await wait(7000);
    const hasVideo = await p.evaluate(() => { const v = document.querySelector("video"); return v ? v.videoWidth > 0 : false; });
    await must(Promise.resolve(hasVideo), "the window does not play the stream");
    // The recording has no licence: the picture is made black before the picture of the window, so that no frame of it is kept
    await p.evaluate(() => { for (const v of document.querySelectorAll("video")) v.style.filter = "brightness(0)"; });
    await wait(500);
    const winBox = await p.getByText(/behind live/).first().evaluate((el) => { let e = el; while (e && !(e.getBoundingClientRect().width > 450 && e.getBoundingClientRect().height > 300)) e = e.parentElement; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, text: e.innerText }; });
    console.log("  window:", winBox.text.replace(/\n+/g, " | "));
    await must(Promise.resolve(/behind live/.test(winBox.text)), "the window's footer does not say how far behind live it is");
    await shot("fmv-window", pad({ x: winBox.x, y: winBox.y - 34, width: winBox.width, height: winBox.height + 34 }, 6));
    const win = p.getByText(/behind live/).first().locator("xpath=ancestor::*[@role='dialog'][1]");
    await p.evaluate(() => { for (const v of document.querySelectorAll("video")) v.style.filter = ""; });
    await p.getByRole("button", { name: /^Close/ }).filter({ hasText: "" }).last().click({ timeout: 3000 }).catch(() => p.keyboard.press("Escape"));
    await wait(800);
  });

  await step("FMV: an MPEG-2 stream", async () => {
    await p.getByRole("tab", { name: "Settings" }).click();
    await wait(800);
    await p.locator(".settings-list-entry", { hasText: /^FMV$/ }).click();
    await wait(800);
    await addLink();
    await lf("Name").fill("Camera 2");
    await lf("Port").fill("14610");
    await saveLink();
    await p.getByRole("tab", { name: "View", exact: true }).click();
    await wait(1500);
    await openRight("FMV");
    let both = false;
    for (let i = 0; i < 80 && !both; i++) {
      const t = await fmvPanel().innerText();
      both = /Camera 1[^]*?[0-9] s ago\s*Live/.test(t) && /Camera 2[^]*?MPEG-2 → H\.264/.test(t) && !/Not playable|No converter/.test(t) && !/Waiting/.test(t);
      if (!both) await wait(1000);
    }
    const text = (await fmvPanel().innerText()).replace(/\n+/g, " | ");
    console.log("  panel:", text);
    await must(Promise.resolve(/Camera 2 \| MPEG-2 → H\.264/.test(text)), "no converted MPEG-2 row for Camera 2");
    await must(Promise.resolve(both), "Camera 1 and Camera 2 are not both playable");
    console.log("  watch buttons:", await fmvPanel().getByRole("button", { name: /Watch/ }).evaluateAll((bs) => bs.map((b) => (b.getAttribute("aria-label") || b.textContent) + (b.disabled ? " [disabled]" : "") + " title=" + (b.title || ""))).then((a) => a.join(" | ")));
    await shot("fmv-panel", pad(await boxOf(fmvPanel()), 2));
    // Watch the converted stream: the window plays it
    await fmvPanel().getByRole("button", { name: /Watch/ }).nth(1).click();
    await wait(9000);
    const vids = await p.evaluate(() => [...document.querySelectorAll("video")].map((v) => v.videoWidth + "x" + v.videoHeight + " rs" + v.readyState));
    console.log("  videos:", vids.join(", "));
    await must(Promise.resolve(vids.some((v) => /^[1-9]/.test(v))), "the converted MPEG-2 stream does not play");
    console.log("  windows:", (await p.getByText(/behind live/).evaluateAll((els) => els.map((e) => e.textContent))).join(" | "));
    await p.getByRole("button", { name: /^Close/ }).filter({ hasText: "" }).last().click({ timeout: 3000 }).catch(() => p.keyboard.press("Escape"));
    await wait(800);
  });

  await step("FMV: a stopped link, and a renamed link with its window open", async () => {
    // A window of Camera 1 stays open while the link is renamed
    await fmvPanel().getByRole("button", { name: /Watch/ }).first().click();
    await wait(6000);
    console.log("  windows before:", (await p.getByText(/behind live/).evaluateAll((els) => els.map((e) => e.textContent))).join(" | "));
    await openSettings("FMV");
    await linkList().locator("tbody tr").filter({ hasText: "Camera 1" }).click();
    await wait(500);
    await lf("Name").fill("Camera A");
    await saveLink();
    await p.getByRole("tab", { name: "View", exact: true }).click();
    await wait(7000);
    console.log("  panel after the rename:", (await fmvPanel().innerText()).replace(/\n+/g, " | "));
    const vids2 = await p.evaluate(() => [...document.querySelectorAll("video")].map((v) => v.videoWidth + "x" + v.videoHeight + " rs" + v.readyState));
    console.log("  videos after the rename:", vids2.join(", "));
    console.log("  windows after the rename:", (await p.getByText(/behind live/).evaluateAll((els) => els.map((e) => e.parentElement.innerText.replace(/\n+/g, " / ")))).join(" | "));
    await p.getByRole("button", { name: /^Close/ }).filter({ hasText: "" }).last().click({ timeout: 3000 }).catch(() => p.keyboard.press("Escape"));
    await wait(500);
    // Stop Camera 2 with its Enabled box
    await openSettings("FMV");
    await linkList().locator("tbody tr").filter({ hasText: "Camera 2" }).click();
    await wait(500);
    await lf("Enabled").uncheck();
    await saveLink();
    await p.getByRole("tab", { name: "View", exact: true }).click();
    await wait(3500);
    const stopped = (await fmvPanel().innerText()).replace(/\n+/g, " | ");
    console.log("  panel with Camera 2 stopped:", stopped);
    console.log("  watch buttons:", await fmvPanel().getByRole("button", { name: /Watch/ }).evaluateAll((bs) => bs.map((b) => (b.getAttribute("aria-label") || b.textContent) + (b.disabled ? " [disabled]" : "") + " title=" + (b.title || ""))).then((a) => a.join(" | ")));
    await must(Promise.resolve(/Stopped/.test(stopped)), "the stopped link does not say Stopped");
    await shot("fmv-panel-stopped", pad(await boxOf(fmvPanel()), 2));
  });

  await step("FMV: the relation in the Display window", async () => {
    await btn("Display settings", { exact: true }).click();
    await wait(600);
    const dw = p.locator(".display-window");
    const t = (await dw.innerText()).replace(/\n+/g, " | ");
    console.log("  display window:", t.slice(0, 900));
    await must(Promise.resolve(/FMV camera and view/.test(t)), "the Display window has no FMV camera and view");
    await btn("Close display settings").click();
    await wait(400);
  });
}

// ---------- Task guide: setting up a GMTI simulation (chapter 7.1). Run on a fresh emcc: --only="GMTI: two links,Guide:" ----------
// The guide's steps are left out of a full run: they make their own routes, units and sensor, and need the links of "GMTI: two links".
const GUIDE = ONLY.includes("Guide:");
let guideCentre = null;
const gat = (dx, dy) => ({ x: guideCentre.x + dx, y: guideCentre.y + dy });
async function guidePlace(categoryLabel, symbolText, identity, points) {
  await btn("Symbols", { exact: true }).click();
  await wait(500);
  const sp = panelOf("Symbols");
  await catSelect(sp).selectOption({ label: categoryLabel });
  await wait(400);
  await sp.locator("select").filter({ has: p.locator("option", { hasText: "Assumed friend" }) }).first().selectOption({ label: identity });
  await wait(300);
  const rowsAll = left().locator(".emc2-list-row, button", { hasText: symbolText });
  console.log("  symbols for", symbolText, ":", await rowsAll.count());
  await rowsAll.first().click();
  await btn("Place on map").click();
  for (const pt of points) {
    await p.mouse.click(pt.x, pt.y);
    await wait(900);
  }
  await p.keyboard.press("Escape");
  await btn("Symbols", { exact: true }).click();
  await wait(500);
}
if (GUIDE) {
  await step("Guide: the map and the two routes", async () => {
    await p.getByRole("tab", { name: "Simulation" }).click();
    await wait(2500);
    await btn("Dismiss").click({ timeout: 2000 }).catch(() => {});
    await expandAll();
    // Only Routes open in the left pane
    for (const t of ["Symbols", "Shapes", "Graphics"]) {
      const h = left().locator(".panel-head", { hasText: new RegExp(t, "i") }).first().getByRole("button", { name: new RegExp("^" + t + "$", "i") });
      if ((await h.count()) && (await h.first().getAttribute("aria-expanded")) !== "false") await h.first().click().catch(() => {});
    }
    // The place and the scale: 61.6 N 15.4 E, a scale bar of 10 km
    await btn("Coordinates").click();
    await wait(400);
    await p.locator('input[placeholder*="°"]').fill("61.6 15.4");
    await p.keyboard.press("Enter");
    await wait(1500);
    await closeTop();
    guideCentre = await mapPoint(0.5, 0.5);
    await p.mouse.move(guideCentre.x, guideCentre.y);
    for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, -300); await wait(300); }
    await wait(2500);
    // The ground route, in the middle
    await btn(/New route|Draw a new route/).first().click();
    await wait(500);
    const g = [[-70, 8], [0, -6], [70, 8]];
    for (let i = 0; i < g.length; i++) {
      const pt = gat(g[i][0], g[i][1]);
      if (i < g.length - 1) await p.mouse.click(pt.x, pt.y);
      else await p.mouse.dblclick(pt.x, pt.y);
      await wait(400);
    }
    await wait(1500);
    await must(p.getByText("Route editor").first().isVisible(), "the Route editor did not open for the ground route");
    await right().getByLabel("Name", { exact: true }).first().fill("Ground route");
    await p.keyboard.press("Enter");
    await right().getByLabel("Speed change").first().selectOption({ label: "Step at this point" });
    await right().getByLabel("Speed (km/h)").first().fill("40");
    await right().getByRole("button", { name: "Set on all points" }).click();
    await wait(600);
    // The question: the smallest box above the confirm button that holds its heading (the dialog element itself is the whole window)
    const askBtn = p.getByRole("button", { name: /^Change all [0-9]+ points$/ });
    const askBox = await askBtn.evaluate((b) => { let e = b.parentElement; while (e && !/CHANGE ALL POINTS/i.test(e.innerText || "")) e = e.parentElement; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    await shot("guide-change-all-points", pad(askBox, 10));
    await p.getByRole("button", { name: /^Change all [0-9]+ points$/ }).click();
    await wait(800);
    const closeEd = btn("Close the route editor");
    if (await closeEd.isVisible()) await closeEd.click({ force: true, timeout: 5000 }).catch(() => {});
    await wait(500);
    // The air route: a clockwise circle round the ground route, starting in the west
    await btn(/New route|Draw a new route/).first().click();
    await wait(500);
    const R = 200;
    const a = [];
    for (let k = 0; k <= 8; k++) {
      const ang = Math.PI - (k * Math.PI) / 4; // west, north-west, north, ... back to west
      a.push([Math.round(R * Math.cos(ang)), Math.round(-R * Math.sin(ang) * 1)]);
    }
    for (let i = 0; i < a.length; i++) {
      const pt = gat(a[i][0], a[i][1]);
      if (i < a.length - 1) await p.mouse.click(pt.x, pt.y);
      else await p.mouse.dblclick(pt.x, pt.y);
      await wait(400);
    }
    await wait(1500);
    await must(p.getByText("Route editor").first().isVisible(), "the Route editor did not open for the air route");
    await right().getByLabel("Name", { exact: true }).first().fill("Air route");
    await p.keyboard.press("Enter");
    await right().getByLabel("At the end").first().selectOption({ label: "Restart" });
    await right().getByLabel("Speed change").first().selectOption({ label: "Step at this point" });
    await right().getByLabel("Speed (km/h)").first().fill("360");
    await right().getByLabel("Altitude change").first().selectOption({ label: "Step at this point" });
    await right().getByLabel("Altitude (m)").first().fill("5000");
    await right().getByRole("button", { name: "Set on all points" }).click();
    await wait(600);
    await p.getByRole("button", { name: /^Change all [0-9]+ points$/ }).click();
    await wait(800);
    await shot("guide-air-route-editor", await boxOf(right()));
    await wait(500);
    if (await closeEd.isVisible()) await closeEd.click({ force: true, timeout: 5000 }).catch(() => {});
    await wait(500);
    await shot("guide-routes-map", await mapBox());
    await shot("guide-routes-panel", await boxOf(left()));
  });

  await step("Guide: the units on their routes", async () => {
    // Four ground units, in a row below the ground route; they go to the route's first point when they are put on it
    await guidePlace("Land equipment", "Armour", "Hostile", [gat(-60, 110), gat(-20, 110), gat(20, 110), gat(60, 110)]);
    await pickLayerInObjects("Simulation");
    const rows = p.locator(".object-list-row").filter({ hasText: "Symbol" });
    await must(rows.count().then((n) => n === 4), "not 4 ground units in the Simulation layer");
    await shot("guide-units-map", await mapBox());
    await rows.nth(0).click();
    for (let i = 1; i < 4; i++) await rows.nth(i).click({ modifiers: ["Control"] });
    await rows.nth(3).click({ button: "right", modifiers: ["Control"] });
    await p.getByRole("menuitem", { name: "Put on route" }).click();
    await wait(700);
    const d = p.locator("dialog[open], [role=dialog]").first();
    await must(d.getByText("4 objects chosen").isVisible(), "the box does not say 4 objects chosen");
    await d.locator("select").first().selectOption({ label: "Ground route" });
    await d.locator("select").nth(1).selectOption({ label: "Convoy" });
    await wait(500);
    await d.locator("input").first().fill("150");
    console.log("  convoy fields:", (await d.locator("input").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") || e.id || e.type) + "=" + e.value))).join(" ; "));
    await shot("guide-put-convoy", pad(await boxOf(d), 10));
    await d.getByRole("button", { name: "Put on route" }).click();
    await wait(1500);
    // The aircraft, a friend, at the start of the air route (west)
    await guidePlace("Air", "ixed", "Friend", [gat(-200, 40)]);
    await pickLayerInObjects("Simulation");
    const plane = p.locator(".object-list-row").filter({ hasText: "Symbol" }).filter({ hasNotText: "Ground route-" }).first();
    await plane.click();
    await plane.click({ button: "right" });
    await p.getByRole("menuitem", { name: "Put on route" }).click();
    await wait(700);
    const d2 = p.locator("dialog[open], [role=dialog]").first();
    await d2.locator("select").first().selectOption({ label: "Air route" });
    await d2.locator("select").nth(1).selectOption({ label: "Each on its own" });
    await wait(300);
    await shot("guide-put-air", pad(await boxOf(d2), 10));
    await d2.getByRole("button", { name: "Put on route" }).click();
    await wait(1500);
    await pickLayerInObjects("Simulation");
    await must(p.locator(".object-list-row", { hasText: "Air route-1" }).first().isVisible(), "the aircraft got no name from the air route");
  });

  await step("Guide: the sensor on the aircraft", async () => {
    await pickLayerInObjects("Simulation");
    await p.locator(".object-list-row", { hasText: "Air route-1" }).first().click();
    await wait(800);
    for (const t of ["Symbol properties", "Terrain", "Ground truth outputs", "NVG"]) {
      const h = right().locator(".panel-head", { hasText: new RegExp(t, "i") }).first().getByRole("button", { name: new RegExp("^" + t + "$", "i") });
      if ((await h.count()) && (await h.first().getAttribute("aria-expanded")) !== "false") await h.first().click().catch(() => {});
    }
    await wait(500);
    await btn("New sensor").click();
    await wait(1200);
    const sp = panelOf("Sensors");
    const setNum = async (label, value) => {
      const f = sp.getByLabel(label).first();
      await f.fill(String(value));
    };
    await setNum(/^Start bearing/, process.env.GUIDE_START ?? 45);
    await setNum(/^End bearing/, process.env.GUIDE_END ?? 135);
    await setNum(/^Min range/, 5);
    await setNum(/^Max range/, 50);
    await setNum(/^Range error/, 50);
    await setNum(/^Cross-range error/, 100);
    await setNum(/^Minimum detectable speed/, process.env.GUIDE_MDV ?? 10);
    await sp.getByRole("checkbox").filter({ hasText: /sim-out/ }).first().check().catch(async () => { await sp.getByLabel(/sim-out/).check(); });
    await wait(500);
    await p.setViewportSize({ width: W, height: 1900 });
    await wait(900);
    await shot("guide-sensor-panel", pad(await boxOf(panelOf("Sensors")), 2));
    await p.setViewportSize({ width: W, height: H });
    await wait(500);
    await sp.getByRole("button", { name: "Save" }).click();
    await wait(1500);
    await shot("guide-sensor-map", await mapBox());
  });

  await step("Guide: run, and look at the result", async () => {
    await btn("Start all routes").click();
    await wait(Number(process.env.GUIDE_WAIT ?? 100000));
    await must(p.getByText("The simulation runs.").isVisible(), "the simulation does not run");
    await shot("guide-sim-running", await mapBox());
    await p.getByRole("tab", { name: "View", exact: true }).click();
    await wait(1500);
    await pickLayerInObjects("GMTI in");
    const rows = p.locator(".object-list-row");
    const n = await rows.filter({ hasText: "GMTI detection" }).count();
    console.log("  detections:", n);
    await must(Promise.resolve(n >= 3), "fewer than 3 detections: " + n);
    await rows.filter({ hasText: "GMTI detection" }).nth(2).click();
    await rows.filter({ hasText: "GMTI detection" }).nth(2).click({ button: "right" });
    await p.getByRole("menuitem", { name: "Zoom to object(s)" }).click();
    await wait(2500);
    await shot("guide-view-detections", await mapBox());
    await p.getByRole("tab", { name: "Simulation" }).click();
    await wait(1000);
    await btn("Reset all routes").click();
    await wait(800);
  });
}

// ---------- M9: the simulated camera (G2). Run alone: node shots.mjs <url> --only=Camera
// Needs a freshly unpacked release (no login) with an imagery set in settings/imagery (one subfolder with an imagery.json
// and its JPEG tiles over 62.39 N 17.30 E) and height data over the same place in settings/terrain, and a free UDP
// port 47621 on 127.0.0.1. It makes the links, a route with a track, a camera on it, and looks at the video in Edge. ----------
const CAM_PORT = "47621";
async function bgSelectTo(label) {
  await openMapControls();
  await bgSelect().selectOption({ label });
  await wait(800);
  await btn("Close").first().click();
  await wait(300);
}
async function goToAndScale(text, metres) {
  await btn("Coordinates").click();
  await wait(500);
  await p.locator('input[placeholder*="°"]').fill(text);
  await p.keyboard.press("Enter");
  await wait(1500);
  await p.keyboard.press("Escape");
  await wait(300);
  const scaleText = async () => (await p.locator("[class*=scale]").first().innerText().catch(() => "")).trim();
  for (let i = 0; i < 40; i++) {
    const m = /^(\d+(?:\.\d+)?)\s*(mm|m|km)$/.exec(await scaleText());
    if (!m) break;
    const now = Number(m[1]) * (m[2] === "km" ? 1000 : m[2] === "mm" ? 0.001 : 1);
    if (now === metres) break;
    await p.getByRole("button", { name: now > metres ? "+" : "–", exact: true }).first().click();
    await wait(900);
  }
  await wait(2500);
}
const camPanel = () => right().locator(".panel", { has: p.locator(".panel-title-text", { hasText: /^Cameras$/i }) }).first();
async function collapseRightExcept(keep) {
  for (const nm of ["Symbol properties", "NVG", "Terrain", "Ground truth outputs", "Sensors", "Status", "FMV", "Route editor"]) {
    if (nm === keep) continue;
    const b = right().locator(".panel-head", { hasText: new RegExp("^" + nm + "$", "i") }).locator("button[aria-expanded=true]").first();
    if (await b.count()) await b.click().catch(() => {});
  }
  await wait(400);
}

await step("Camera: an output link and an input link in Settings", async () => {
  await p.setViewportSize({ width: W, height: 1300 });
  await openSettings("FMV");
  await must(p.getByText("Compute threads").first().isVisible(), "no Compute threads group in FMV");
  await must(p.getByText("Imagery folder").first().isVisible(), "no Imagery folder");
  const entry = settingsEntry();
  const eb = await boxOf(entry);
  const lb = await boxOf(linkList());
  await shot("settings-fmv-folders", pad({ x: eb.x, y: eb.y, width: eb.width, height: lb.y - eb.y - 24 }, 4));
  await addLink();
  await lf("Name").fill("Camera out");
  await lf("Direction").selectOption({ label: "out" });
  await lf("Address").fill("127.0.0.1");
  await lf("Port").fill(CAM_PORT);
  await wait(500);
  await p.setViewportSize({ width: W, height: 1900 }); // the output form is long
  await wait(600);
  await shot("settings-fmv-out", pad(await boxOf(linkForm()), 4));
  await p.setViewportSize({ width: W, height: 1300 });
  await wait(400);
  await saveLink();
  await addLink();
  await lf("Name").fill("Camera in");
  await lf("Direction").selectOption({ label: "in" });
  await lf("Port").fill(CAM_PORT);
  await linkForm().getByRole("button", { name: "New layer for Layer" }).click();
  await wait(400);
  await p.getByLabel("Name of the new layer").fill("Camera feed");
  await p.getByRole("button", { name: "Create" }).click();
  await wait(1200);
  await saveLink();
  await must(p.locator(".settings-item-table").getByText("Camera in").first().isVisible(), "the table does not list Camera in");
  await p.setViewportSize({ width: W, height: H });
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(800);
});

await step("Camera: a route, a track, and New camera", async () => {
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(2500);
  await btn("Dismiss").click({ timeout: 2000 }).catch(() => {});
  await expandAll();
  await bgSelectTo("OpenStreetMap");
  await goToAndScale("62.392 17.30", 1000);
  const symbolsOpen = () => p.getByText("Command and control").first().isVisible();
  if (await symbolsOpen()) await btn("Symbols", { exact: true }).click();
  if (await p.getByRole("button", { name: "Circle", exact: true }).isVisible()) await btn("Shapes", { exact: true }).click();
  if (await p.getByRole("button", { name: "Place graphic" }).last().isVisible()) await btn("Graphics", { exact: true }).click();
  await btn(/New route|Draw a new route/).first().click();
  await wait(500);
  const pts = [[0.2, 0.55], [0.45, 0.4], [0.7, 0.5], [0.85, 0.62]];
  for (let i = 0; i < pts.length; i++) {
    const pt = await mapPoint(pts[i][0], pts[i][1]);
    if (i < pts.length - 1) await p.mouse.click(pt.x, pt.y);
    else await p.mouse.dblclick(pt.x, pt.y);
    await wait(400);
  }
  await wait(1500);
  await must(p.getByText("Route editor").first().isVisible(), "the Route editor did not open");
  await btn("Symbols", { exact: true }).click();
  await left().locator(".emc2-list-row, button", { hasText: "Command and control" }).first().click();
  await btn("Place on map").click();
  const first = await mapPoint(0.2, 0.55);
  await p.mouse.click(first.x - 14, first.y + 6);
  await wait(1200);
  await p.keyboard.press("Escape");
  await btn("Symbols", { exact: true }).click();
  await wait(500);
  await p.mouse.click(first.x - 14, first.y + 6, { button: "right" });
  await wait(700);
  await p.getByRole("menuitem", { name: "Put on route" }).click();
  await wait(700);
  const dlg1 = p.locator("dialog[open], [role=dialog]").first();
  await dlg1.locator("select").first().selectOption({ label: "Route 1" });
  await dlg1.getByRole("button", { name: "Put on route" }).click();
  await wait(1500);
  await btn("Close the route editor").click({ timeout: 2000 }).catch(() => {});
  await wait(500);
  // the track's menu has New camera
  await p.mouse.click(first.x - 14, first.y + 6, { button: "right" });
  await wait(700);
  await must(p.getByRole("menuitem", { name: "New camera" }).isVisible(), "no New camera in the track's menu");
  const menu = p.getByRole("menu").first();
  await shot("sim-camera-menu", pad(await boxOf(menu), 6));
  await p.getByRole("menuitem", { name: "New camera" }).click();
  await wait(1500);
  await collapseRightExcept("Cameras");
  const cp = camPanel();
  await must(cp.getByLabel("Pointing mode").isVisible(), "the camera's form did not open");
  const stopB = cp.getByRole("button", { name: /^Stop$/ }).first();
  if (await stopB.count()) { await stopB.click(); await wait(1200); }
  const outOpt = (await cp.getByLabel("Output").locator("option").allTextContents()).find((o) => o.startsWith("Camera out"));
  await cp.getByLabel("Output").selectOption({ label: outOpt });
  await cp.getByLabel("Mission").fill("RECCE NORTH");
  await cp.getByLabel(/Depression/).fill("35");
  await cp.getByRole("button", { name: "Save" }).click();
  await wait(1200);
  await cp.getByRole("button", { name: /^Start$/ }).first().click();
  await wait(1500);
  await btn(/Start Route 1/).click();
  await wait(9000);
  const t = await cp.innerText();
  console.log("  camera panel:", t.replace(/\n+/g, " | ").slice(0, 200));
  await must(/Running/.test(t) && /\d+ sent/.test(t), "the camera does not run: " + t.slice(0, 120));
  await shot("sim-camera-panel", pad(await boxOf(cp), 2));
});

await step("Camera: View, the camera on the map, and the video in Edge", async () => {
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1500);
  await btn("Dismiss").click({ timeout: 2000 }).catch(() => {});
  await expandAll();
  await bgSelectTo("OpenStreetMap");
  await goToAndScale("62.392 17.30", 1000);
  const fmvPanel = right().locator(".panel", { has: p.locator(".panel-head", { hasText: /^FMV$/i }) }).first();
  await must(fmvPanel.getByText("Route 1-1").first().isVisible(), "the FMV panel has no stream of the camera");
  console.log("  FMV panel:", (await fmvPanel.innerText()).replace(/\n+/g, " | "));
  await shot("fmv-sim-panel", pad(await boxOf(fmvPanel), 2));
  await shot("fmv-sim-map", await mapBox());
  // the video: Chromium of Playwright has no H.264, so the picture is taken in the installed Edge
  const edge = await chromium.launch({ channel: "msedge", args: ["--autoplay-policy=no-user-gesture-required"] });
  const ectx = await edge.newContext({ viewport: { width: W, height: H }, colorScheme: "light" });
  const ep = await ectx.newPage();
  await ep.goto(BASE);
  await ep.locator(".pane-left").waitFor();
  await ep.waitForTimeout(3500);
  await ep.getByRole("button", { name: "Dismiss" }).click({ timeout: 2000 }).catch(() => {});
  const efmv = ep.locator(".pane-right .panel", { has: ep.locator(".panel-head", { hasText: /^FMV$/i }) }).first();
  await efmv.getByRole("button", { name: /Watch/ }).first().click();
  await ep.waitForTimeout(7000);
  const win = ep.locator(".emc2-window").filter({ hasText: /behind live/ }).first();
  const wb = await win.boundingBox();
  console.log("  window box:", JSON.stringify(wb));
  const footer = (await win.innerText().catch(() => "")).replace(/\n+/g, " | ");
  console.log("  window text:", footer);
  if (!process.env.NO_SHOTS && wb) await ep.screenshot({ path: path.join(IMG, "fmv-sim-window.png"), clip: clamp({ x: wb.x - 6, y: wb.y - 6, width: wb.width + 12, height: wb.height + 12 }) });
  await edge.close();
});

await step("Camera: the Monitor", async () => {
  await p.getByRole("tab", { name: "Monitor" }).click();
  await wait(3500);
  const mon = p.locator("section.other-view:visible").last();
  await mon.getByText("FMV", { exact: true }).first().click();
  await wait(1500);
  await p.setViewportSize({ width: W, height: 2000 });
  await wait(600);
  const row = mon.getByText("FMV", { exact: true }).first().locator("xpath=ancestor::tr[1]");
  const detail = row.locator("xpath=following-sibling::tr[1]");
  const rb = await boxOf(row);
  const db = await boxOf(detail);
  console.log("  monitor detail:", (await detail.innerText()).replace(/\n+/g, " | ").slice(0, 1500));
  await shot("monitor-fmv-camera", pad({ x: rb.x, y: rb.y, width: Math.max(rb.width, db.width), height: db.y + db.height - rb.y }, 6));
  await p.setViewportSize({ width: W, height: H });
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(800);
});

await step("Monitor", async () => {
  await p.getByRole("tab", { name: "Monitor" }).click();
  await wait(3500);
  await must(p.getByText("Core workers").first().isVisible(), "the Monitor has no Core workers");
  await shot("monitor-overview");
});

// ---------- M9: the task guide "Set up the UAV simulation" (07-02). Run alone: node shots.mjs <url> --only="Guide UAV"
// Needs a freshly unpacked M9 release started with -standalone (no login), WITHOUT height data and WITHOUT imagery, and UDP
// port 47621 free on 127.0.0.1. The steps put the height data and the imagery in place themselves: set
//   GUIDE_REL=<the unpacked release folder>   GUIDE_HEIGHT_ZIP=<the demo height data zip>   GUIDE_IMAGERY=<one imagery set's folder>
// and GUIDE_WMS=<a WMS 1.3.0 address> (optional: without it the WMS step is left out). The picture of the video is taken in
// the installed Edge (Chromium of Playwright has no H.264). ----------
const GUIDE_PORT = "47621";
const GUIDE_REL = process.env.GUIDE_REL ?? "";
const camApi = async () => (await (await fetch(BASE + "/api/plugins/uav-simulation/cameras")).json()).cameras[0];
// gap: the time after Stop. The camera's pipeline ends 2 s after its last pose, so a Start within that time keeps the old pipeline.
async function camForm(gap = 1500) {
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(2000);
  await expandAll();
  await btn("Dismiss").click({ timeout: 1000 }).catch(() => {});
  const cp = camPanel();
  await collapseRightExcept("Cameras");
  const stopB = cp.getByRole("button", { name: /^Stop$/ }).first();
  if (await stopB.count()) {
    await stopB.click();
    await wait(gap);
  }
  if (!(await cp.getByLabel("Pointing mode").isVisible())) {
    await cp.getByRole("button", { name: /^Route 1-1$/ }).first().click();
    await wait(800);
  }
  return cp;
}
async function startCamera(cp, secs = 6000) {
  await cp.getByRole("button", { name: "Save" }).click();
  await wait(1200);
  await cp.getByRole("button", { name: /^Start$/ }).first().click();
  await wait(secs);
}
async function guideMonitorRow(name) {
  await p.setViewportSize({ width: W, height: 2000 });
  await p.getByRole("tab", { name: "Monitor" }).click();
  await wait(3500);
  const mon = p.locator("section.other-view:visible").last();
  const tg = mon.locator("button.monitor-toggle", { hasText: /^FMV$/ }).first();
  const row = tg.locator("xpath=ancestor::tr[1]");
  const text = (await row.innerText()).replace(/\s*\n+\s*/g, " | ");
  console.log("  Monitor, FMV:", text.slice(0, 900));
  // the row only: the opened detail names the computer's folders
  if (name) await shot(name, pad(await boxOf(row), 6));
  await p.setViewportSize({ width: W, height: H });
  return text;
}
async function watchInEdge(name, panelName) {
  const edge = await chromium.launch({ channel: "msedge", args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    const ectx = await edge.newContext({ viewport: { width: W, height: H }, colorScheme: "light" });
    const ep = await ectx.newPage();
    await ep.goto(BASE);
    await ep.locator(".pane-left").waitFor();
    await ep.waitForTimeout(3500);
    await ep.getByRole("button", { name: "Dismiss" }).click({ timeout: 2000 }).catch(() => {});
    const efmv = ep.locator(".pane-right .panel", { has: ep.locator(".panel-head", { hasText: /^FMV$/i }) }).first();
    const head = efmv.locator(".panel-head button[aria-expanded]").first();
    if ((await head.getAttribute("aria-expanded")) === "false") await head.click();
    await ep.waitForTimeout(800);
    console.log("  FMV panel:", (await efmv.innerText()).replace(/\s*\n+\s*/g, " | ").slice(0, 300));
    if (panelName && !process.env.NO_SHOTS) {
      const b = await efmv.boundingBox();
      await ep.screenshot({ path: path.join(IMG, panelName + ".png"), clip: clamp({ x: b.x - 2, y: b.y - 2, width: b.width + 4, height: b.height + 4 }) });
      console.log("  shot", panelName);
    }
    await efmv.getByRole("button", { name: /Watch/ }).first().click();
    await ep.waitForTimeout(7000);
    const win = ep.locator(".emc2-window").filter({ hasText: /behind live/ }).first();
    const wb = await win.boundingBox();
    console.log("  window text:", (await win.innerText().catch(() => "")).replace(/\s*\n+\s*/g, " | "));
    if (name && !process.env.NO_SHOTS && wb) {
      await ep.screenshot({ path: path.join(IMG, name + ".png"), clip: clamp({ x: wb.x - 6, y: wb.y - 6, width: wb.width + 12, height: wb.height + 12 }) });
      console.log("  shot", name);
    }
  } finally {
    await edge.close();
  }
}
async function camPanelShot(name) {
  await p.setViewportSize({ width: W, height: 1500 });
  await wait(600);
  const cp = camPanel();
  await cp.scrollIntoViewIfNeeded();
  await shot(name, pad(await boxOf(cp), 2));
  await p.setViewportSize({ width: W, height: H });
  await wait(400);
}
async function placeSymbol(fx, fy) {
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(1500);
  await expandAll();
  const symbolsOpen = () => p.getByText("Command and control").first().isVisible();
  if (!(await symbolsOpen())) await btn("Symbols", { exact: true }).click();
  await left().locator(".emc2-list-row, button", { hasText: "Command and control" }).first().click();
  await btn("Place on map").click();
  const tp = await mapPoint(fx, fy);
  await p.mouse.click(tp.x, tp.y);
  await wait(1200);
  await p.keyboard.press("Escape");
  await p.mouse.click(tp.x, tp.y);
  await wait(800);
}
const camText = async () => (await camPanel().innerText()).replace(/\s*\n+\s*/g, " | ");

await step("Guide UAV 1: Settings, FMV, and an output link with no destination", async () => {
  await p.setViewportSize({ width: W, height: 1900 });
  await openSettings("FMV");
  await wait(600);
  const entry = settingsEntry();
  const eb = await boxOf(entry);
  const lb = await boxOf(linkList());
  await shot("guide-uav-fmv-settings", pad({ x: eb.x, y: eb.y, width: eb.width, height: lb.y - eb.y - 24 }, 4));
  await addLink();
  await lf("Name").fill("Camera out");
  await lf("Direction").selectOption({ label: "out" });
  await wait(600);
  await shot("guide-uav-out-link-new", pad(await boxOf(linkForm()), 4));
  await saveLink();
  await must(p.locator(".settings-item-table").getByText("Camera out").first().isVisible(), "the table does not list Camera out");
  await p.setViewportSize({ width: W, height: H });
});

await step("Guide UAV 2: a route, a track, and the camera on it", async () => {
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(2500);
  await btn("Dismiss").click({ timeout: 2000 }).catch(() => {});
  await expandAll();
  await bgSelectTo("OpenStreetMap");
  await goToAndScale("62.392 17.30", 1000);
  const symbolsOpen = () => p.getByText("Command and control").first().isVisible();
  if (await symbolsOpen()) await btn("Symbols", { exact: true }).click();
  if (await p.getByRole("button", { name: "Circle", exact: true }).isVisible()) await btn("Shapes", { exact: true }).click();
  if (await p.getByRole("button", { name: "Place graphic" }).last().isVisible()) await btn("Graphics", { exact: true }).click();
  await btn(/New route|Draw a new route/).first().click();
  await wait(500);
  const pts = [[0.2, 0.55], [0.45, 0.4], [0.7, 0.5], [0.85, 0.62]];
  for (let i = 0; i < pts.length; i++) {
    const pt = await mapPoint(pts[i][0], pts[i][1]);
    if (i < pts.length - 1) await p.mouse.click(pt.x, pt.y);
    else await p.mouse.dblclick(pt.x, pt.y);
    await wait(400);
  }
  await wait(1500);
  await must(p.getByText("Route editor").first().isVisible(), "the Route editor did not open");
  await btn("Symbols", { exact: true }).click();
  await left().locator(".emc2-list-row, button", { hasText: "Command and control" }).first().click();
  await btn("Place on map").click();
  const first = await mapPoint(0.2, 0.55);
  await p.mouse.click(first.x - 14, first.y + 6);
  await wait(1200);
  await p.keyboard.press("Escape");
  await btn("Symbols", { exact: true }).click();
  await wait(500);
  await p.mouse.click(first.x - 14, first.y + 6, { button: "right" });
  await wait(700);
  await p.getByRole("menuitem", { name: "Put on route" }).click();
  await wait(700);
  const dlg1 = p.locator("dialog[open], [role=dialog]").first();
  await dlg1.locator("select").first().selectOption({ label: "Route 1" });
  await dlg1.getByRole("button", { name: "Put on route" }).click();
  await wait(1500);
  await btn("Close the route editor").click({ timeout: 2000 }).catch(() => {});
  await wait(500);
  await shot("guide-uav-platform-map", await mapBox());
  await p.mouse.click(first.x - 14, first.y + 6, { button: "right" });
  await wait(700);
  await must(p.getByRole("menuitem", { name: "New camera" }).isVisible(), "no New camera in the track's menu");
  const menu = p.getByRole("menu").first();
  await shot("guide-uav-new-camera", pad(await boxOf(menu), 6));
  await p.getByRole("menuitem", { name: "New camera" }).click();
  await wait(1500);
  await collapseRightExcept("Cameras");
  const cp = camPanel();
  await must(cp.getByLabel("Pointing mode").isVisible(), "the camera's form did not open");
  console.log("  new camera:", await camText());
  // Track a point: the point is in the middle of the route
  await cp.getByLabel("Pointing mode").selectOption({ label: "Track a point" });
  await wait(500);
  await cp.getByLabel(/^Longitude/).fill("17.30");
  await cp.getByLabel(/^Latitude/).fill("62.392");
  await cp.getByLabel("Mission").fill("RECCE NORTH");
  const outOpt = (await cp.getByLabel("Output").locator("option").allTextContents()).find((o) => o.startsWith("Camera out"));
  await cp.getByLabel("Output").selectOption({ label: outOpt });
  await wait(400);
  await camPanelShot("guide-uav-camera-form");
});

await step("Guide UAV 3: Start, with an output that has no destination", async () => {
  const cp = await camForm();
  await startCamera(cp, 1500);
  await btn(/Start Route 1/).click();
  await wait(6000);
  console.log("  camera:", await camText());
  await camPanelShot("guide-uav-camera-nodest");
  await guideMonitorRow("guide-uav-monitor-nodest");
});

await step("Guide UAV 4: the destination, and an input link on the same port", async () => {
  await p.setViewportSize({ width: W, height: 1900 });
  await openSettings("FMV");
  await wait(600);
  await p.locator(".settings-item-table").getByText("Camera out").first().click();
  await wait(800);
  await lf("Address").fill("127.0.0.1");
  await lf("Port").fill(GUIDE_PORT);
  await wait(500);
  await shot("guide-uav-out-link", pad(await boxOf(linkForm()), 4));
  await saveLink();
  await wait(3000);
  await addLink();
  await lf("Name").fill("Camera in");
  await lf("Direction").selectOption({ label: "in" });
  await lf("Port").fill(GUIDE_PORT);
  await linkForm().getByRole("button", { name: "New layer for Layer" }).click();
  await wait(400);
  await p.getByLabel("Name of the new layer").fill("Camera feed");
  await p.getByRole("button", { name: "Create" }).click();
  await wait(1200);
  await shot("guide-uav-in-link", pad(await boxOf(linkForm()), 4));
  await saveLink();
  await must(p.locator(".settings-item-table").getByText("Camera in").first().isVisible(), "the table does not list Camera in");
  await shot("guide-uav-links-table", pad(await boxOf(linkList()), 4));
  await p.setViewportSize({ width: W, height: H });
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(4000);
  console.log("  camera:", await camText());
  await camPanelShot("guide-uav-camera-ready");
  await guideMonitorRow("guide-uav-monitor-ready");
});

await step("Guide UAV 5: the video without height data and without imagery", async () => {
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1500);
  await expandAll();
  await watchInEdge("guide-uav-video-grey", "guide-uav-fmv-panel");
});

await step("Guide UAV 6: imagery, then height data (the track stands still, so that the two pictures can be compared)", async () => {
  if (!GUIDE_REL || !process.env.GUIDE_HEIGHT_ZIP || !process.env.GUIDE_IMAGERY) throw new Error("GUIDE_REL, GUIDE_HEIGHT_ZIP and GUIDE_IMAGERY are needed");
  const { execFileSync } = await import("node:child_process");
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(1500);
  await expandAll();
  await btn("Pause Route 1").click();
  await wait(1500);
  fs.cpSync(process.env.GUIDE_IMAGERY, path.join(GUIDE_REL, "settings", "imagery", path.basename(process.env.GUIDE_IMAGERY)), { recursive: true });
  console.log("  settings/imagery now:", fs.readdirSync(path.join(GUIDE_REL, "settings", "imagery")).join(", "));
  // a running camera does not see it: the video stays grey until the camera has been stopped for a few seconds and is started
  let cp = await camForm(4500);
  await cp.getByRole("button", { name: /^Start$/ }).first().click();
  await wait(6000);
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1500);
  await watchInEdge("guide-uav-video-flat");
  await guideMonitorRow("guide-uav-monitor-imagery");
  execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${process.env.GUIDE_HEIGHT_ZIP}' -DestinationPath '${GUIDE_REL}' -Force`]);
  console.log("  settings/terrain now:", fs.readdirSync(path.join(GUIDE_REL, "settings", "terrain")).join(", "));
  cp = await camForm(4500);
  await cp.getByRole("button", { name: /^Start$/ }).first().click();
  await wait(6000);
  await p.getByRole("tab", { name: "View", exact: true }).click();
  await wait(1500);
  await watchInEdge("guide-uav-video-relief");
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(1500);
  await btn("Start Route 1").click();
  await wait(1500);
});

await step("Guide UAV 7: Sweep, and Track an object", async () => {
  let cp = await camForm();
  await cp.getByLabel("Pointing mode").selectOption({ label: "Sweep" });
  await wait(500);
  await camPanelShot("guide-uav-camera-sweep");
  cp = camPanel();
  await startCamera(cp, 5000);
  console.log("  sweep:", await camText());
  // a target: a second symbol, picked with Use selection
  await placeSymbol(0.55, 0.3);
  cp = await camForm();
  await cp.getByLabel("Pointing mode").selectOption({ label: "Track an object" });
  await wait(500);
  await cp.getByRole("button", { name: /Use selection/ }).click();
  await wait(700);
  await camPanelShot("guide-uav-camera-object");
  cp = camPanel();
  await startCamera(cp, 5000);
  console.log("  object:", await camText());
  await btn("Symbols", { exact: true }).click().catch(() => {});
});

await step("Guide UAV 8: Target gone", async () => {
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(2000);
  await expandAll();
  const tp = await mapPoint(0.55, 0.3);
  await p.mouse.click(tp.x, tp.y);
  await wait(800);
  await p.keyboard.press("Delete");
  await wait(700);
  await dlg().getByRole("button", { name: /^Delete/ }).click();
  await wait(4500);
  await collapseRightExcept("Cameras");
  console.log("  after the target is deleted:", await camText());
  await camPanelShot("guide-uav-camera-targetgone");
  // the way back: a new target (Save refuses the old one, whatever the mode; its field shows only in Track an object)
  await placeSymbol(0.6, 0.25);
  const cp = await camForm();
  await cp.getByLabel("Pointing mode").selectOption({ label: "Track an object" });
  await cp.getByRole("button", { name: /Use selection/ }).click();
  await wait(700);
  await startCamera(cp, 5000);
  console.log("  new target:", await camText());
});

await step("Guide UAV 9: Fixed angles, and the output taken away", async () => {
  let cp = await camForm();
  await cp.getByLabel("Pointing mode").selectOption({ label: "Fixed angles" });
  await startCamera(cp, 5000);
  console.log("  fixed:", await camText());
  // the output link is switched off: the camera's output is missing
  await p.setViewportSize({ width: W, height: 1900 });
  await openSettings("FMV");
  await wait(600);
  await p.locator(".settings-item-table").getByText("Camera out").first().click();
  await wait(800);
  await linkForm().getByLabel("Enabled", { exact: true }).uncheck();
  await saveLink();
  await p.setViewportSize({ width: W, height: H });
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(5000);
  console.log("  output off:", await camText());
  await camPanelShot("guide-uav-camera-missing");
  await guideMonitorRow(undefined);
  await p.setViewportSize({ width: W, height: 1900 });
  await openSettings("FMV");
  await wait(600);
  await p.locator(".settings-item-table").getByText("Camera out").first().click();
  await wait(800);
  await linkForm().getByLabel("Enabled", { exact: true }).check();
  await saveLink();
  await p.setViewportSize({ width: W, height: H });
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(5000);
  console.log("  output on again:", await camText());
});

await step("Guide UAV 10: no encoder", async () => {
  const ff = path.join(GUIDE_REL, "tools", "ffmpeg", "ffmpeg.exe");
  fs.renameSync(ff, ff + ".off");
  try {
    const cp = await camForm();
    await wait(4000);
    await cp.getByRole("button", { name: /^Start$/ }).first().click();
    await wait(7000);
    console.log("  no encoder:", await camText());
    await camPanelShot("guide-uav-camera-noenc");
    await guideMonitorRow("guide-uav-monitor-noenc");
  } finally {
    fs.renameSync(ff + ".off", ff);
  }
  // it stays so until the link's own settings change
  await wait(12000);
  console.log("  ffmpeg back, 12 s later:", (await camApi()).outputDetail);
  await p.setViewportSize({ width: W, height: 1900 });
  await openSettings("FMV");
  await wait(600);
  await p.locator(".settings-item-table").getByText("Camera out").first().click();
  await wait(800);
  await lf("Bit rate").fill("3");
  await saveLink();
  await p.setViewportSize({ width: W, height: H });
  await wait(9000);
  const c = await camApi();
  console.log("  after the link was saved:", c.state, c.outputState, JSON.stringify(c.outputDetail));
});

await step("Guide UAV 11: an imagery set without a licence", async () => {
  const d = path.join(GUIDE_REL, "settings", "imagery", "a-no-licence");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(d + "/imagery.json", JSON.stringify({ name: "a-no-licence", source: "Example orthophotos", crs: "EPSG:3006", tiles: [] }, null, 2));
  const cp = await camForm();
  await wait(4000);
  await cp.getByRole("button", { name: /^Start$/ }).first().click();
  await wait(7000);
  await guideMonitorRow("guide-uav-monitor-refused");
});

await step("Guide UAV 12: the WMS fallback", async () => {
  if (!process.env.GUIDE_WMS) throw new Error("GUIDE_WMS is not set");
  await p.setViewportSize({ width: W, height: 2300 });
  await openSettings("FMV");
  await wait(800);
  const entry = settingsEntry();
  await entry.getByLabel("Fetch from a WMS", { exact: true }).check();
  await entry.getByLabel("Server", { exact: true }).fill(process.env.GUIDE_WMS);
  await entry.getByLabel("Layer", { exact: true }).fill("emc2:sweden");
  await entry.getByLabel("Source", { exact: true }).fill("Natural Earth, served by a test GeoServer");
  await entry.getByLabel("Licence", { exact: true }).fill("Public domain");
  await wait(600);
  const saveWms = entry.getByRole("button", { name: "Save", exact: true }).last();
  const hb = await boxOf(entry.getByText("WMS imagery", { exact: true }).first());
  const sbb = await boxOf(saveWms);
  const eb = await boxOf(entry);
  await shot("guide-uav-wms-settings", pad({ x: eb.x, y: hb.y - 6, width: eb.width, height: sbb.y + sbb.height - hb.y + 12 }, 2));
  await saveWms.click();
  await wait(2500);
  await p.setViewportSize({ width: W, height: H });
  // a camera that looks outside the set: the point east of its edge
  const cp = await camForm(4500);
  await cp.getByLabel("Pointing mode").selectOption({ label: "Track a point" });
  await wait(500);
  await cp.getByLabel(/^Longitude/).fill("17.364");
  await cp.getByLabel(/^Latitude/).fill("62.39");
  await startCamera(cp, 9000);
  await guideMonitorRow("guide-uav-monitor-wms");
});

await step("Guide UAV 13: Platform gone", async () => {
  await p.getByRole("tab", { name: "Simulation" }).click();
  await wait(2000);
  await expandAll();
  await btn("Dismiss").click({ timeout: 1000 }).catch(() => {});
  // the tracks go back to the start of their route, where the first one was put on it
  await btn("Reset Route 1").click();
  await wait(2500);
  const first = await mapPoint(0.2, 0.55);
  await p.mouse.click(first.x, first.y);
  await wait(800);
  await p.keyboard.press("Delete");
  await wait(700);
  console.log("  delete dialog:", (await dlg().innerText().catch(() => "none")).slice(0, 200));
  await dlg().getByRole("button", { name: /^Delete/ }).click();
  await wait(5000);
  await collapseRightExcept("Cameras");
  console.log("  after the platform is deleted:", await camText());
  await camPanelShot("guide-uav-camera-platformgone");
});

await browser.close();
if (failures.length) {
  console.log("\n" + failures.length + " step(s) failed:");
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("\nAll steps passed.");
