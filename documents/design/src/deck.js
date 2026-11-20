"use strict";
// Builds documents/design/emcc-presentation.pptx.
// Simple, structured deck: one theme, two layouts (title and content), sections and speaker notes.
// Colours follow the APP-6 affiliation colours used in all project documents:
// accent1 = emcc core (friend blue), accent2 = plugins (neutral green),
// accent3 = external systems (unknown yellow), accent4 = risks (hostile red), accent5 = infrastructure.

const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

const THEME = {
  name: "emcc",
  headFontFace: "Calibri",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "1F2933", lt1: "FFFFFF", dk2: "3E4C59", lt2: "F2F4F6",
    accent1: "1F6F8B", accent2: "2E7D32", accent3: "8A7400", accent4: "A33A3A",
    accent5: "5B6670", accent6: "52606D", hlink: "1F6F8B", folHlink: "52606D",
  },
};

async function buildDeck({ commit, date, output }) {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  pres.title = "emcc – project presentation";
  pres.subject = "Architecture, technology and status";
  pres.author = "emcc project";
  const C = pres.SchemeColor;
  const S = pres.shapes;

  // ---------- Layouts ----------
  pres.defineSlideMaster({
    title: "EMCC_TITLE",
    background: { color: "FFFFFF" },
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: 0.8, y: 1.9, w: 7.6, h: 1.5, fontSize: 66, bold: true, color: C.text1, align: "left", valign: "bottom", margin: 0 }, text: "" } },
      { placeholder: { options: { name: "subtitle", type: "body", x: 0.8, y: 3.5, w: 7.6, h: 1.1, fontSize: 24, color: C.text2, align: "left", valign: "top", margin: 0 }, text: "" } },
      { placeholder: { options: { name: "meta", type: "body", x: 0.8, y: 6.0, w: 7.6, h: 0.5, fontSize: 13, color: C.accent6, align: "left", valign: "top", margin: 0 }, text: "" } },
    ],
  });
  pres.defineSlideMaster({
    title: "EMCC_CONTENT",
    background: { color: "FFFFFF" },
    margin: [0.4, 0.6, 0.6, 0.6],
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.4, w: 12.1, h: 0.8, fontSize: 32, bold: true, color: C.text1, align: "left", valign: "middle", margin: 0 }, text: "" } },
      { text: { text: `emcc · Draft · commit ${commit}`, options: { x: 0.6, y: 6.95, w: 8, h: 0.3, fontSize: 10, color: C.accent6, margin: 0 } } },
    ],
    slideNumber: { x: 12.1, y: 6.95, w: 0.6, h: 0.3, fontSize: 10, color: THEME.colors.accent6, align: "right" },
  });

  // ---------- Helpers ----------
  const tint = (color, transparency) => ({ color, transparency });
  function box(slide, runs, o) {
    slide.addText(runs, {
      shape: o.shape || S.ROUNDED_RECTANGLE, rectRadius: o.radius ?? 0.08,
      x: o.x, y: o.y, w: o.w, h: o.h,
      fill: o.fill || { color: C.background1 },
      line: o.line || { color: C.accent1, width: 1 },
      fontSize: o.fontSize || 12, color: o.color || C.text1,
      align: o.align || "center", valign: o.valign || "middle",
      margin: o.margin ?? 0.06, isTextBox: true, objectName: o.name,
    });
  }
  const title2 = (head, sub, headSize = 14, subSize = 11) => [
    { text: head, options: { bold: true, fontSize: headSize, breakLine: true } },
    { text: sub, options: { fontSize: subSize, color: C.text2 } },
  ];
  function line(slide, x, y, w, h, o = {}) {
    slide.addShape(S.LINE, {
      x, y, w, h, flipV: !!o.flipV, flipH: !!o.flipH,
      line: { color: o.color || C.text2, width: o.width || 1.25, dashType: o.dash || "solid",
        endArrowType: o.end || undefined, beginArrowType: o.begin || undefined },
      objectName: o.name,
    });
  }
  // APP-6 style frames: friend = rectangle, hostile = diamond, neutral = square.
  function friendInfantry(slide, x, y, w, h, name) {
    slide.addShape(S.RECTANGLE, { x, y, w, h, fill: tint(C.accent1, 55), line: { color: C.text1, width: 1.5 }, objectName: name });
    line(slide, x, y, w, h, { color: C.text1, width: 1.25 });
    line(slide, x, y, w, h, { color: C.text1, width: 1.25, flipV: true });
  }
  function hostile(slide, x, y, s, name) {
    slide.addShape(S.DIAMOND, { x, y, w: s, h: s, fill: tint(C.accent4, 55), line: { color: C.text1, width: 1.5 }, objectName: name });
  }
  function neutral(slide, x, y, s, name) {
    slide.addShape(S.RECTANGLE, { x, y, w: s, h: s, fill: tint(C.accent2, 55), line: { color: C.text1, width: 1.5 }, objectName: name });
  }

  // A grid of cards, each with a title and a text; an optional number in a circle.
  function cards(slide, items, o) {
    const { cols, x0 = 0.6, y0 = 1.5, w, h, gapX = 0.3, gapY = 0.25, numbered = false, titleSize = 17, textSize = 13, prefix } = o;
    items.forEach(([head, text], i) => {
      const x = x0 + (i % cols) * (w + gapX);
      const y = y0 + Math.floor(i / cols) * (h + gapY);
      slide.addShape(S.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.background2, width: 0.5 }, objectName: `${prefix} card ${i + 1}` });
      let tx = x + 0.3;
      if (numbered) {
        box(slide, String(i + 1), { shape: S.OVAL, x: x + 0.3, y: y + 0.3, w: 0.5, h: 0.5, fill: { color: C.accent1 }, line: { color: C.accent1, width: 0.5 }, fontSize: 15, color: C.background1, margin: 0, name: `${prefix} number ${i + 1}` });
        tx = x + 0.95;
      }
      slide.addText(head, { x: tx, y: y + 0.27, w: x + w - 0.25 - tx, h: 0.56, fontSize: titleSize, bold: true, color: C.text1, valign: "middle", margin: 0, isTextBox: true, objectName: `${prefix} title ${i + 1}` });
      slide.addText(text, { x: x + 0.3, y: y + 0.95, w: w - 0.6, h: h - 1.1, fontSize: textSize, color: C.text2, valign: "top", margin: 0, isTextBox: true, objectName: `${prefix} text ${i + 1}` });
    });
  }
  const plugin = (o) => ({ fill: tint(C.accent2, 85), line: { color: C.accent2, width: 1 }, ...o });
  const external = (o) => ({ fill: tint(C.accent3, 85), line: { color: C.accent3, width: 1 }, ...o });
  const core = (o) => ({ fill: tint(C.accent1, 88), line: { color: C.accent1, width: 1 }, ...o });

  // ---------- 1. Title ----------
  pres.addSection({ title: "Introduction" });
  let slide = pres.addSlide({ masterName: "EMCC_TITLE", sectionTitle: "Introduction" });
  slide.addText("emcc", { placeholder: "title" });
  slide.addText("A command and control application built by AI agents", { placeholder: "subtitle" });
  slide.addText(`Architecture, technology and status · Draft · commit ${commit} · ${date}`, { placeholder: "meta" });
  friendInfantry(slide, 8.9, 1.9, 2.1, 1.4, "Symbol friend");
  hostile(slide, 11.15, 2.55, 1.5, "Symbol hostile");
  neutral(slide, 9.6, 4.15, 1.2, "Symbol neutral");
  slide.addNotes(
    "emcc is a web-based mock-up of a military command and control system. Its purpose is to showcase what AI agents can do: " +
    "almost all code is written by agents, while the owner controls the work and makes the decisions. " +
    `This presentation covers what emcc does, how it is built and by whom, and where the project stands in milestone M8, as of repository commit ${commit}.`);

  // ---------- 2. What is emcc ----------
  slide = pres.addSlide({ masterName: "EMCC_CONTENT", sectionTitle: "Introduction" });
  slide.addText("What is emcc?", { placeholder: "title" });
  // UI sketch: the workspace (ADR-0031, ADR-0039)
  slide.addShape(S.ROUNDED_RECTANGLE, { x: 0.6, y: 1.45, w: 7.0, h: 4.95, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.accent5, width: 0.75 }, objectName: "UI sketch frame" });
  const paneLine = { color: C.accent5, width: 0.75 };
  slide.addShape(S.RECTANGLE, { x: 0.8, y: 1.62, w: 6.6, h: 0.4, fill: { color: C.background1 }, line: paneLine, objectName: "Top bar" });
  slide.addText("View · Simulation · Settings · Monitor", { x: 0.9, y: 1.64, w: 3.6, h: 0.36, fontSize: 10, bold: true, color: C.accent6, valign: "middle", margin: 0, isTextBox: true, objectName: "Workspace tabs" });
  slide.addText("Bookmarks · Setups · Look · 12:00Z", { x: 4.4, y: 1.64, w: 2.9, h: 0.36, fontSize: 10, color: C.text2, align: "right", valign: "middle", margin: 0, isTextBox: true, objectName: "Top bar items" });
  slide.addShape(S.RECTANGLE, { x: 0.8, y: 2.12, w: 1.2, h: 3.05, fill: { color: C.background1 }, line: paneLine, objectName: "Left pane" });
  slide.addText("Layers", { x: 0.85, y: 2.17, w: 1.1, h: 0.28, fontSize: 10, bold: true, color: C.accent6, align: "center", margin: 0, isTextBox: true });
  ["Drawing", "TAK", "Ships"].forEach((label, i) =>
    box(slide, label, { x: 0.9, y: 2.55 + i * 0.45, w: 1.0, h: 0.34, fill: { color: C.background2 }, line: paneLine, fontSize: 9, color: C.text2, name: `Layer ${label}` }));
  slide.addShape(S.RECTANGLE, { x: 2.1, y: 2.12, w: 4.0, h: 3.05, fill: tint(C.accent1, 90), line: { color: C.accent1, width: 0.75 }, objectName: "Map Pane" });
  slide.addText("Map Pane", { x: 2.2, y: 2.17, w: 2.0, h: 0.28, fontSize: 11, bold: true, color: C.accent1, margin: 0, isTextBox: true });
  friendInfantry(slide, 2.66, 2.75, 0.6, 0.4, "Map symbol 1");
  friendInfantry(slide, 4.02, 4.0, 0.6, 0.4, "Map symbol 2");
  hostile(slide, 5.02, 2.59, 0.56, "Map symbol 3");
  neutral(slide, 3.5, 3.46, 0.4, "Map symbol 4");
  line(slide, 3.3, 2.81, 0.88, 0.14, { color: C.accent1, width: 2, flipV: true, name: "Route part 1" });
  line(slide, 4.18, 2.81, 0.76, 0.07, { color: C.accent1, width: 2, end: "triangle", name: "Route part 2" });
  slide.addShape(S.RECTANGLE, { x: 6.2, y: 2.12, w: 1.2, h: 3.05, fill: { color: C.background1 }, line: paneLine, objectName: "Right pane" });
  slide.addText("Drawing", { x: 6.25, y: 2.17, w: 1.1, h: 0.28, fontSize: 10, bold: true, color: C.accent6, align: "center", margin: 0, isTextBox: true });
  ["Symbol", "Shape", "Fields"].forEach((label, i) =>
    box(slide, label, { x: 6.3, y: 2.55 + i * 0.45, w: 1.0, h: 0.34, fill: { color: C.background2 }, line: paneLine, fontSize: 9, color: C.text2, name: `Button ${label}` }));
  slide.addShape(S.RECTANGLE, { x: 0.8, y: 5.27, w: 6.6, h: 0.98, fill: { color: C.background1 }, line: paneLine, objectName: "Bottom pane" });
  slide.addText("Objects", { x: 0.9, y: 5.31, w: 2.0, h: 0.26, fontSize: 10, bold: true, color: C.accent6, margin: 0, isTextBox: true });
  ["Infantry platoon · Symbol · tak-in", "Route north · Shape · manual"].forEach((label, i) =>
    slide.addText(label, { x: 0.9, y: 5.6 + i * 0.28, w: 6.4, h: 0.26, fontSize: 9, color: C.text2, margin: 0, isTextBox: true, objectName: `Object row ${i + 1}` }));
  slide.addText("The workspace: one shared map, with panels the user moves around it", { x: 0.6, y: 6.45, w: 7.0, h: 0.35, fontSize: 11, italic: true, color: C.accent6, margin: 0, isTextBox: true });
  const facts = [
    ["Shared live picture", "All users see the same objects, updated live."],
    ["Everything is a plugin", "19 plugins on a small core: maps, symbols, graphics, drawing, a simulator, data exchange."],
    ["Talks to other systems", "TAK (CoT), NVG and GMTI in and out; AIS, ADS-B and UAV video in; WMS maps."],
    ["Built for the field", "100 000+ objects, works without internet, Keycloak login, security labels."],
    ["Built by AI agents", "Agents design, write, test and review the code. The owner decides."],
  ];
  facts.forEach(([head, text], i) => {
    const y = 1.5 + i * 0.97;
    slide.addShape(S.OVAL, { x: 8.1, y: y + 0.07, w: 0.24, h: 0.24, fill: { color: C.accent1 }, line: { color: C.accent1, width: 0.5 }, objectName: `Fact marker ${i + 1}` });
    slide.addText([
      { text: head, options: { bold: true, fontSize: 17, color: C.text1, breakLine: true } },
      { text, options: { fontSize: 13, color: C.text2 } },
    ], { x: 8.5, y, w: 4.25, h: 0.9, valign: "top", margin: 0, isTextBox: true, objectName: `Fact ${i + 1}` });
  });
  slide.addNotes(
    "The main view is a large shared map, the Map Pane, with docked panes to its left, right and below, where plugins put their panels. Users move the panels between the panes, and the arrangement is saved as a setup. " +
    "The top bar holds the tabs: View, the workspaces plugins add, such as the simulator's Simulation, Settings and Monitor; and on the right bookmarks, setups, the look and the clock. " +
    "All users share one live picture held by the server. Everything beyond a small core is a plugin, including the map itself: 19 plugins after milestone M7, and a 20th, for full motion video, in M8. " +
    "The system exchanges objects with TAK systems over Cursor on Target, with NVG services and with GMTI radars over STANAG 4607, in both directions; it reads ships from AIS and aircraft from ADS-B, and from M8 live UAV video over STANAG 4609; and it uses WMS servers for background maps. KML comes later. " +
    "It must handle at least 100 000 objects, work in a disconnected environment, use a real IAM such as Keycloak, and carry a security label on every object.");

  // ---------- 3. Built by AI agents ----------
  slide = pres.addSlide({ masterName: "EMCC_CONTENT", sectionTitle: "Introduction" });
  slide.addText("Built by AI agents", { placeholder: "title" });
  const roles = [
    ["Owner", "decides, approves every merge", { color: C.text1 }, C.text1, C.background1],
    ["ACA", "architecture, ADRs, rules", core(), C.text1],
    ["CDA", "core: ECore, edge, shell", core(), C.text1],
    ["PDA", "contracts: data model, SDKs, briefs", core(), C.text1],
    ["PCA × 20", "one agent per plugin", plugin(), C.text1],
    ["ITA", "integration tests, real browsers", core(), C.text1],
    ["MCA", "status, change control, merges", core(), C.text1],
    ["UXA", "the UI's looks and usability", core(), C.text1],
    ["UDA", "the user manual", core(), C.text1],
    ["ESA", "external test services", external(), C.text1],
    ["DMA", "website and marketing", { fill: { color: C.background2 }, line: { color: C.accent5, width: 1 } }, C.text1],
    ["CRA · SRA", "code and security review, on demand", { fill: { color: C.background2 }, line: { color: C.accent5, width: 1 } }, C.text1],
  ];
  roles.forEach(([head, sub, style], i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const s = i === 0 ? { fill: { color: C.text1 }, line: { color: C.text1, width: 1 } } : style;
    const runs = [
      { text: head, options: { bold: true, fontSize: 15, color: i === 0 ? C.background1 : C.text1, breakLine: true } },
      { text: sub, options: { fontSize: 11, color: i === 0 ? C.background1 : C.text2 } },
    ];
    box(slide, runs, { x: 0.6 + col * 1.85, y: 1.5 + row * 1.2, w: 1.75, h: 1.05, ...s, name: `Role ${head}` });
  });
  slide.addText("Agents never talk to each other: they work through files and git – the status board, change requests and handover notes – and the owner relays every message.", { x: 0.6, y: 5.35, w: 7.2, h: 0.9, fontSize: 13, italic: true, color: C.accent6, valign: "top", margin: 0, isTextBox: true, objectName: "Agents note" });
  const flow = [
    "The owner states the requirements and decides",
    "Decisions are written down: ADRs, change requests",
    "Contracts first: data model and SDKs, reviewed and frozen",
    "Each agent builds on its own branch, with tests",
    "Integration tests in real browsers, then the merge",
    "A release candidate per milestone, tested by the owner",
  ];
  flow.forEach((text, i) => {
    const y = 1.5 + i * 0.68;
    box(slide, String(i + 1), { shape: S.OVAL, x: 8.2, y: y + 0.05, w: 0.42, h: 0.42, fill: { color: C.accent1 }, line: { color: C.accent1, width: 0.5 }, fontSize: 13, color: C.background1, margin: 0, name: `Flow number ${i + 1}` });
    slide.addText(text, { x: 8.8, y, w: 3.95, h: 0.52, fontSize: 13.5, color: C.text1, valign: "middle", margin: 0, isTextBox: true, objectName: `Flow step ${i + 1}` });
  });
  slide.addText("Since 2 October 2026: 5 400+ commits on main · 58 ADRs · 47 change requests · 19 plugins", { x: 8.2, y: 5.75, w: 4.55, h: 0.5, fontSize: 12, bold: true, color: C.accent1, valign: "top", margin: 0, isTextBox: true, objectName: "Agents numbers" });
  slide.addNotes(
    "Almost all of emcc is written by AI agents, each with one role and its own folders. The owner, a human, states the requirements, makes every decision and approves every merge into main. " +
    "The architectural consultant writes the architecture, the decision records and the rules. The core developer builds ECore, the web edge and the shell. The plugin designer owns the contracts: the data model, both SDKs and each plugin's brief. " +
    "One plugin coding agent per plugin builds it from its brief; there are 19 on main and a 20th for full motion video. The integration test agent tests the combined system in real browsers. The management agent keeps the status board, runs change control and merges with the owner's approval. " +
    "Since M8 the user experience agent owns the looks and the components' look, while the layout stays the core developer's. The user documentation agent writes the user manual against each release, and the design and marketing agent the website and marketing material. " +
    "The external services agent installs and runs what emcc is tested against: a TAK Server, a GeoServer, Keycloak, an NVG service, and playbacks of recorded AIS, ADS-B, GMTI and video data. Code and security reviews run on demand. " +
    "Agents never talk to each other directly: everything goes through files in git, and the owner relays the messages. Since the start on 2 October 2026 there are over 5 400 commits on main, 58 architecture decision records and 47 change requests.");

  // ---------- 4. Architecture ----------
  pres.addSection({ title: "Architecture" });
  slide = pres.addSlide({ masterName: "EMCC_CONTENT", sectionTitle: "Architecture" });
  slide.addText("Architecture", { placeholder: "title" });
  const groupLine = () => ({ color: C.accent5, width: 1, dashType: "dash" });
  slide.addShape(S.ROUNDED_RECTANGLE, { x: 0.6, y: 1.45, w: 3.5, h: 5.0, rectRadius: 0.1, fill: { color: C.background1 }, line: groupLine(), objectName: "Browser group" });
  slide.addText("Browser", { x: 0.75, y: 1.52, w: 3.2, h: 0.35, fontSize: 14, bold: true, color: C.accent6, margin: 0, isTextBox: true });
  box(slide, title2("Shell", "Top bar · workspaces · panes\nSettings list · Monitor · setups\nLooks · actions · plugin loader", 15, 12), { x: 0.8, y: 1.95, w: 3.1, h: 1.75, fill: tint(C.accent1, 88), name: "Shell" });
  box(slide, title2("Plugin web parts", "map view · drawing · simulator · video …"), { x: 0.8, y: 3.85, w: 3.1, h: 1.05, ...plugin(), name: "Plugin web parts" });
  box(slide, title2("Web plugin SDK", "TypeScript – the only API for plugins"), { x: 0.8, y: 5.05, w: 3.1, h: 1.2, line: { color: C.accent1, width: 1, dashType: "dash" }, name: "Web plugin SDK" });
  line(slide, 4.12, 3.95, 0.66, 0, { begin: "triangle", end: "triangle", name: "Browser-server link" });
  slide.addText("WebSocket\n+ HTTPS", { x: 4.05, y: 3.3, w: 0.8, h: 0.55, fontSize: 10, color: C.text2, align: "center", margin: 0, isTextBox: true });
  slide.addShape(S.ROUNDED_RECTANGLE, { x: 4.8, y: 1.45, w: 5.0, h: 5.0, rectRadius: 0.1, fill: { color: C.background1 }, line: groupLine(), objectName: "Server group" });
  slide.addText("Server – Java 25", { x: 4.95, y: 1.52, w: 4.7, h: 0.35, fontSize: 14, bold: true, color: C.accent6, margin: 0, isTextBox: true });
  box(slide, "Spring Boot edge – HTTP · WebSocket · login", { x: 5.0, y: 1.95, w: 4.6, h: 0.6, fill: tint(C.accent1, 88), fontSize: 12, name: "Spring Boot edge" });
  slide.addShape(S.ROUNDED_RECTANGLE, { x: 5.0, y: 2.7, w: 4.6, h: 2.58, rectRadius: 0.08, fill: tint(C.accent1, 88), line: { color: C.accent1, width: 1 }, objectName: "ECore" });
  slide.addText("ECore – plain Java", { x: 5.1, y: 2.76, w: 4.4, h: 0.35, fontSize: 14, bold: true, color: C.text1, align: "center", margin: 0, isTextBox: true });
  [["Plugin host", "Live picture gateway"], ["Workers · connection tasks", "Object store (single writer)"], ["Message bus", "Persistence manager"], ["Stream hub (M8)", "Conversion · ffmpeg (M8)"]]
    .forEach((pair, r) => pair.forEach((label, c) =>
      box(slide, label, { x: 5.12 + c * 2.26, y: 3.17 + r * 0.51, w: 2.15, h: 0.42, fontSize: 11, line: { color: C.accent1, width: 0.75 }, name: label })));
  box(slide, "Java Plugin SDK – the only dependency of plugins", { x: 5.0, y: 5.4, w: 4.6, h: 0.45, line: { color: C.accent1, width: 1, dashType: "dash" }, fontSize: 12, name: "Java Plugin SDK" });
  box(slide, "Plugin server parts – CoT, NVG, GMTI and video links, simulator, WMS proxy, terrain …", { x: 5.0, y: 5.95, w: 4.6, h: 0.45, ...plugin(), fontSize: 11, name: "Plugin server parts" });
  const ext = [
    ["Keycloak", "login (OIDC)", C.accent3],
    ["WMS servers", "background maps", C.accent3],
    ["TAK · NVG", "CoT and NVG, in and out", C.accent3],
    ["AIS · ADS-B · GMTI", "ships, aircraft, radars", C.accent3],
    ["UAVs (M8)", "STANAG 4609 video", C.accent3],
    ["Storage", "file store · PostGIS (M9)", C.accent5],
  ];
  ext.forEach(([head, sub, col], i) => {
    const y = 1.45 + i * 0.84;
    box(slide, title2(head, sub, 13, 11), { x: 10.4, y, w: 2.33, h: 0.72, fill: tint(col, 85), line: { color: col, width: 1 }, name: head });
    line(slide, 9.82, y + 0.36, 0.56, 0, { begin: "triangle", end: "triangle", name: `Link ${head}` });
  });
  const legend = [
    ["Core", { fill: tint(C.accent1, 88), line: { color: C.accent1, width: 0.75 } }],
    ["Contract (SDK)", { fill: { color: C.background1 }, line: { color: C.accent1, width: 0.75, dashType: "dash" } }],
    ["Plugin", { fill: tint(C.accent2, 85), line: { color: C.accent2, width: 0.75 } }],
    ["External system", { fill: tint(C.accent3, 85), line: { color: C.accent3, width: 0.75 } }],
    ["Infrastructure", { fill: tint(C.accent5, 85), line: { color: C.accent5, width: 0.75 } }],
  ];
  let lx = 0.6;
  legend.forEach(([label, style]) => {
    slide.addShape(S.RECTANGLE, { x: lx, y: 6.58, w: 0.2, h: 0.2, ...style, objectName: `Legend ${label}` });
    slide.addText(label, { x: lx + 0.28, y: 6.53, w: 1.6, h: 0.3, fontSize: 10, color: C.text2, margin: 0, isTextBox: true });
    lx += 1.95;
  });
  slide.addNotes(
    "The browser runs a shell written in TypeScript and React. Plugin web parts are loaded into it at start-up and use only the web plugin SDK. " +
    "The browser talks only to the emcc server, over a WebSocket and HTTPS. On the server, a thin Spring Boot edge handles HTTP, WebSocket and the login; " +
    "everything behind it, ECore, is plain Java. ECore hosts the plugins, runs all workers and the plugins' connection tasks, delivers messages, holds the master copy of all objects " +
    "and offers persistence, security, settings and monitoring. In M8 it adds a stream hub, which serves a plugin's live video to its web part, and a conversion service, which turns MPEG-2 video into H.264 in a separate ffmpeg process that only ECore starts. " +
    "Plugin server parts depend only on the Java Plugin SDK; they reach the external systems: Keycloak for login, WMS servers for background maps, TAK systems and NVG services, AIS, ADS-B and GMTI feeds, and from M8 UAV video. These are set up by other projects. Storage is a file store today, and PostgreSQL with PostGIS in M9.");

  // ---------- 5. Design principles ----------
  slide = pres.addSlide({ masterName: "EMCC_CONTENT", sectionTitle: "Architecture" });
  slide.addText("Design principles", { placeholder: "title" });
  cards(slide, [
    ["Everything is a plugin", "Maps, symbols, the simulator, video and data exchange are plugins with an optional server part and web part, loaded at start-up."],
    ["No deadlocks by design", "Plugins never create threads or locks, or start programs. Workers handle one message at a time; sockets live in connection tasks."],
    ["Every change is an event", "One writer orders all changes and answers every request once. Events feed storage, browsers and plugins."],
    ["One shared live picture", "The server pushes every change live. Each browser gets its area of interest and its workspace, clustered when zoomed out."],
    ["One coordinate system", "WGS84 longitude/latitude inside, geodesic edges. Projections and MGRS, UTM and DMS only at display and input."],
    ["Secure and disconnected", "Keycloak login, permissions checked on the server, a security label on every object. Everything works offline."],
  ], { cols: 3, w: 3.85, h: 2.4, gapX: 0.3, gapY: 0.2, numbered: true, prefix: "Principle" });
  slide.addNotes(
    "Six principles shape the design. One: everything beyond the core is a plugin, built the same way. " +
    "Two: plugins never create their own threads or use locks; the core runs workers that handle one message at a time and share no state, so deadlocks are prevented by design, and a watchdog reports anything that hangs. Since M3, a plugin's own sockets run in connection tasks that the core starts, restarts and stops. " +
    "Three: every change to an object or layer goes through one writer, which answers each request exactly once, with a change event or a rejection; this gives a strict order now and history and timeline playback later. " +
    "Four: the server holds the master copy and pushes every change to all browsers. Each browser gets only what is in its view and in the workspace it shows, aggregated into clusters when zoomed out. " +
    "Five: coordinates are always WGS84 inside the system, with geodesic edges, so shapes look the same in every projection. " +
    "Six: real login, permissions enforced by the server, a security label on every object, and everything works offline: no function needs the internet, and the browser loads nothing from it.");

  // ---------- 6. Technology choices ----------
  pres.addSection({ title: "Technology" });
  slide = pres.addSlide({ masterName: "EMCC_CONTENT", sectionTitle: "Technology" });
  slide.addText("Technology choices", { placeholder: "title" });
  const tech = [
    ["SERVER", "Java 25 (LTS) · Maven", "Long support, strong geospatial libraries, virtual threads"],
    ["WEB CLIENT", "TypeScript · React 19 · Vite 8", "Largest ecosystem; plugin web parts as ES modules"],
    ["WEB EDGE", "Spring Boot 4.1", "Only at the edge – core and plugins stay plain Java"],
    ["MAP", "OpenLayers 10 + proj4js", "Any projection, including polar; WMS built in"],
    ["SYMBOLOGY", "milsymbol 3.0.4 · mil-sym-ts", "APP-6 B, D and E symbols, and every D and E tactical graphic"],
    ["VIDEO (M8)", "mpegts.js · ffmpeg (LGPL)", "Live STANAG 4609 video in the browser; MPEG-2 converted in a separate process"],
    ["STORAGE", "File store · PostGIS (M9)", "Behind a persistence manager, so storage can change"],
    ["IDENTITY", "Keycloak (OpenID Connect)", "Login on the server side – no tokens in the browser"],
    ["MONITORING", "Monitor · log file · OpenTelemetry (M9)", "In-app health view and a rolling log; open standard dashboards next"],
  ];
  tech.forEach(([cat, choice, why], i) => {
    const x = 0.6 + (i % 3) * 4.15;
    const y = 1.45 + Math.floor(i / 3) * 1.7;
    slide.addShape(S.ROUNDED_RECTANGLE, { x, y, w: 3.85, h: 1.5, rectRadius: 0.08, fill: { color: C.background2 }, line: { color: C.background2, width: 0.5 }, objectName: `Technology tile ${i + 1}` });
    slide.addText([
      { text: cat, options: { fontSize: 10.5, bold: true, color: C.accent1, charSpacing: 1, breakLine: true } },
      { text: choice, options: { fontSize: 15, bold: true, color: C.text1, breakLine: true } },
      { text: why, options: { fontSize: 12, color: C.text2 } },
    ], { x: x + 0.25, y: y + 0.1, w: 3.4, h: 1.3, valign: "middle", margin: 0, isTextBox: true, objectName: `Technology text ${i + 1}` });
  });
  slide.addNotes(
    "The server is Java 25, chosen for its maturity on Linux, long support window, geospatial libraries and virtual threads, which fit the worker model. " +
    "Spring Boot is used only at the edge for HTTP, WebSocket and login. The web client is TypeScript and React, built with Vite. " +
    "OpenLayers handles any map projection, including polar ones, and WMS maps. milsymbol draws the APP-6 symbols; since M5 the US Army's mil-sym-ts draws the multipoint tactical graphics, chosen after a spike. " +
    "In M8 the browser plays live video with mpegts.js, and ECore converts MPEG-2 to H.264 with a minimal LGPL build of ffmpeg, run as a separate process. " +
    "Storage is a file store today, behind a persistence manager, and PostgreSQL with PostGIS in M9. " +
    "Login uses OpenID Connect with Keycloak, run on the server side. Admins watch the system in an in-app monitor view, and since M7 a release writes a rolling log file; OpenTelemetry export follows in M9. Drawing all 100 000 objects needs a client with a GPU. " +
    "The project is licensed under Apache 2.0, and every shipped dependency must have a permissive licence; the bundled Java runtime and the ffmpeg program are the two approved exceptions. " +
    "Every choice is recorded with its reasons in an architecture decision record in the repository.");

  // ---------- 7. The workspace and its look ----------
  pres.addSection({ title: "Capabilities" });
  slide = pres.addSlide({ masterName: "EMCC_CONTENT", sectionTitle: "Capabilities" });
  slide.addText("The workspace and its look", { placeholder: "title" });
  cards(slide, [
    ["Movable panels", "Docked left, right and bottom panes around the map. Users move panels between them; plugins give each a default place."],
    ["Saved setups", "The arrangement, layers and map view, remembered automatically or by name, per user and per workspace."],
    ["Three looks, redesigned", "Each in light and dark, in two densities. In M8 the UX agent gave each its own controls, tabs and edges."],
    ["Select and act", "Click or box-select; right-click menus offer each plugin's actions, and a shared Delete, Move and Copy to layer."],
    ["Settings and display", "Settings in categories, as cards with one Save each. Each user's display window: labels, speed vector, filters."],
    ["Draw, mark and list", "Symbols from palettes, tactical graphics, shapes and texts, bookmarks, and a layer's objects page by page."],
  ], { cols: 3, w: 3.85, h: 2.4, gapX: 0.3, gapY: 0.2, prefix: "Workspace" });
  slide.addNotes(
    "Milestone M2, Beautify, gave emcc the workspace of a product, and later milestones built on it. " +
    "The map sits between docked panes. Each plugin gives its panels a default place, and users move them around; the arrangement is saved as a setup, kept on the server per user and per workspace, so it follows the user to another computer. " +
    "Users choose one of three looks for different rooms, each in light and dark, in two densities. The web SDK provides shared components built from the looks' design tokens, so every plugin looks the same. In M8 a user experience agent redesigned them: each look now has its own control shapes, tabs and edges, while the layout stays the same in all of them. " +
    "Objects are selected with clicks and a box, and a right-click menu offers the actions, among them the shared Delete and, since M6, Move and Copy to layer. Settings is one list, in categories since M7, with a generated form for each plugin or its own panel; in M8 its entries become cards with one Save each. Since M5 each user sets symbol size, labels, the speed vector and display filters in one window. " +
    "Plugins draw APP-6 symbols from palettes, tactical graphics with mil-sym-ts, shapes and texts, keep bookmarks of map views, and list a layer's objects page by page.");

  // ---------- 8. Workspaces and the simulator ----------
  slide = pres.addSlide({ masterName: "EMCC_CONTENT", sectionTitle: "Capabilities" });
  slide.addText("Workspaces and the simulator", { placeholder: "title" });
  slide.addShape(S.ROUNDED_RECTANGLE, { x: 0.6, y: 1.45, w: 6.4, h: 4.95, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.accent5, width: 0.75 }, objectName: "Simulation sketch frame" });
  slide.addShape(S.RECTANGLE, { x: 0.8, y: 1.62, w: 6.0, h: 0.4, fill: { color: C.background1 }, line: paneLine, objectName: "Simulation top bar" });
  slide.addText([
    { text: "View · ", options: { color: C.accent6 } },
    { text: "Simulation", options: { color: C.accent1, bold: true, underline: { style: "sng" } } },
    { text: " · Settings · Monitor", options: { color: C.accent6 } },
  ], { x: 0.9, y: 1.64, w: 5.8, h: 0.36, fontSize: 11, valign: "middle", margin: 0, isTextBox: true, objectName: "Simulation tabs" });
  slide.addShape(S.RECTANGLE, { x: 0.8, y: 2.12, w: 6.0, h: 4.1, fill: tint(C.accent1, 90), line: { color: C.accent1, width: 0.75 }, objectName: "Simulation map" });
  // A route with three legs and its points
  const pts = [[1.3, 5.6], [2.9, 4.3], [4.6, 4.7], [6.2, 2.8]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    line(slide, Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1), { color: C.accent1, width: 2.5, flipV: y2 < y1, end: i === pts.length - 2 ? "triangle" : undefined, name: `Route leg ${i + 1}` });
  }
  pts.forEach(([x, y], i) => slide.addShape(S.OVAL, { x: x - 0.09, y: y - 0.09, w: 0.18, h: 0.18, fill: { color: C.background1 }, line: { color: C.accent1, width: 1.5 }, objectName: `Route point ${i + 1}` }));
  friendInfantry(slide, 1.75, 4.95, 0.5, 0.34, "Convoy 1");
  friendInfantry(slide, 2.35, 4.45, 0.5, 0.34, "Convoy 2");
  friendInfantry(slide, 3.55, 4.15, 0.5, 0.34, "Convoy 3");
  slide.addText("convoy · 40 km/h", { x: 2.0, y: 5.45, w: 2.0, h: 0.3, fontSize: 10, italic: true, color: C.accent1, margin: 0, isTextBox: true });
  slide.addText("event: hide", { x: 4.75, y: 4.8, w: 1.4, h: 0.3, fontSize: 10, italic: true, color: C.accent1, margin: 0, isTextBox: true });
  slide.addText("ramp to 300 m", { x: 5.0, y: 2.55, w: 1.5, h: 0.3, fontSize: 10, italic: true, color: C.accent1, margin: 0, isTextBox: true });
  slide.addText("Simulation: its own map, panes and layers", { x: 0.6, y: 6.45, w: 6.4, h: 0.35, fontSize: 11, italic: true, color: C.accent6, margin: 0, isTextBox: true });
  [
    ["Workspaces", "Tabs with their own map, panes, setups and layers. Only users with the workspace's permission see it; the server enforces it."],
    ["Routes, groups, events", "Tracks follow geodesic routes alone, as a convoy or in formation. Events at points change a field or hide a track."],
    ["1 000 tracks at 1 Hz", "One worker ticks once a second, with no browser open. Moves are not written to disk while a simulation runs."],
    ["Ground truth and sensors", "Tracks go out as they are, e.g. as CoT, or as a simulated ground radar sees them, as GMTI (M5)."],
  ].forEach(([head, text], i) => {
    const y = 1.5 + i * 1.22;
    slide.addShape(S.OVAL, { x: 7.4, y: y + 0.07, w: 0.24, h: 0.24, fill: { color: C.accent1 }, line: { color: C.accent1, width: 0.5 }, objectName: `Simulator marker ${i + 1}` });
    slide.addText([
      { text: head, options: { bold: true, fontSize: 17, color: C.text1, breakLine: true } },
      { text, options: { fontSize: 13, color: C.text2 } },
    ], { x: 7.8, y, w: 4.95, h: 1.15, valign: "top", margin: 0, isTextBox: true, objectName: `Simulator fact ${i + 1}` });
  });
  slide.addNotes(
    "Milestone M3, the Simulator, added workspaces: tabs in the top bar with their own map, panes, setups and layers. A plugin declares a workspace with its own permissions, and the server sends its layers only to users who may see it. " +
    "The simulator declares the Simulation workspace and reuses the normal plugins there, with no copied code. One simulation is shared by everyone who may see it, and is kept over a restart. " +
    "Users draw routes whose points carry speeds and altitudes, instant or ramped, and put tracks on them alone, as a convoy or in a formation. Events at route points change a field of a passing track or hide it. " +
    "The engine moves at least 1 000 tracks once a second. A spike showed that writing every move to disk was the cost, so the owner decided that a running simulation's moves are not saved; the simulator saves its tracks when it starts, pauses or stops. " +
    "The tracks are the ground truth: the simulator sends them to the output channels a user picks. In the M3 demo they went as CoT to a TAK Server and came back into View through a cot input link. " +
    "Since M5 a track can also carry a simulated ground radar, whose detections go out through a Sensor output, for example as STANAG 4607 GMTI. In M9 a track can carry a simulated camera instead.");

  // ---------- 9. Data in and out ----------
  slide = pres.addSlide({ masterName: "EMCC_CONTENT", sectionTitle: "Capabilities" });
  slide.addText("Data in and out", { placeholder: "title" });
  const flowRow = (y, items, label) => {
    slide.addText(label, { x: 0.6, y: y - 0.42, w: 6, h: 0.32, fontSize: 12, bold: true, color: C.accent6, margin: 0, isTextBox: true });
    items.forEach(([head, sub, style], i) => {
      box(slide, title2(head, sub, 14, 11), { x: 0.6 + i * 3.1, y, w: 2.55, h: 0.95, ...style, name: `${label} ${head}` });
      if (i < items.length - 1) line(slide, 0.6 + i * 3.1 + 2.57, y + 0.47, 0.51, 0, { end: "triangle", name: `${label} arrow ${i + 1}` });
    });
  };
  flowRow(1.95, [
    ["Simulator", "tracks, 1 Hz", plugin()],
    ["cot output link", "an output channel", plugin()],
    ["TAK Server", "TAK clients, e.g. WinTAK", external()],
    ["cot input link", "into a layer in View", plugin()],
  ], "The M3 demo loop");
  flowRow(3.55, [
    ["AIS · ADS-B · GMTI · NVG", "receivers, radars, services", external()],
    ["Input links", "ais · adsb · gmti · nvg", plugin()],
    ["Layers in View", "ships · aircraft · detections", core()],
  ], "More links, M4 to M7");
  box(slide, title2("Playbook", "five work packages\nsix transport modes"), { x: 9.9, y: 3.55, w: 2.85, h: 0.95, line: { color: C.accent1, width: 1, dashType: "dash" }, name: "Playbook" });
  cards(slide, [
    ["Links", "One configured connection: a name, a transport and a direction. Input links fill one layer; output links send their layers."],
    ["Output channels", "Every output link is a channel other plugins can send to, as the simulator does, with a release limit per link."],
    ["Connection tasks", "Each plugin's sockets – TCP, UDP, multicast – run in tasks the core starts, restarts and caps."],
  ], { cols: 3, y0: 4.85, w: 3.85, h: 1.75, gapX: 0.3, titleSize: 15, textSize: 12, prefix: "Data" });
  slide.addNotes(
    "Data comes in and goes out through plugins. Since M3, a plugin's own sockets run in connection tasks, which the core starts, restarts with a back-off, caps and stops, so the concurrency rules still hold. " +
    "An admin sets up links in the plugin's settings: a name, which becomes the data source of what arrives, a transport and a direction. An input link writes into one layer; an output link sends the objects of its source layers, never back to where they came from. " +
    "Every output link is also an output channel that other plugins can send to without a layer: the simulator does. Each output has a highest classification it may release. " +
    "The M3 demo closed the loop: simulated tracks went out as CoT to a TAK Server and came back into View. In M4 the plugin designer wrote a playbook for in and out plugins, in five work packages, and the template gained six transport modes; " +
    "the new ais and adsb plugins were built by it as its first test. They read ships and aircraft, tested against recorded real-world data that the external services agent plays back. " +
    "M5 added gmti, for STANAG 4607 ground moving target indication in and out, and M7 nvg, for NATO Vector Graphics files and the NVG web service, in and out.");

  // ---------- 10. Full motion video (M8, ADR-0057) ----------
  slide = pres.addSlide({ masterName: "EMCC_CONTENT", sectionTitle: "Capabilities" });
  slide.addText("Full motion video (M8)", { placeholder: "title" });
  const infra = (o) => ({ fill: tint(C.accent5, 85), line: { color: C.accent5, width: 1 }, ...o });
  const fmvRow = [
    ["UAV · replay", "STANAG 4609 over UDP", external()],
    ["fmv input link", "metadata read, video passed on", plugin()],
    ["Stream hub (ECore)", "each viewer starts at a keyframe", core()],
    ["Video window", "mpegts.js · floating over the map", plugin()],
  ];
  fmvRow.forEach(([head, sub, style], i) => {
    box(slide, title2(head, sub, 14, 11), { x: 0.6 + i * 3.1, y: 1.55, w: 2.55, h: 0.95, ...style, name: `Video ${head}` });
    if (i < fmvRow.length - 1) line(slide, 0.6 + i * 3.1 + 2.57, 2.02, 0.51, 0, { end: "triangle", name: `Video arrow ${i + 1}` });
  });
  box(slide, title2("Map", "camera symbol · open field-of-view arc"), { x: 3.7, y: 2.95, w: 2.55, h: 0.95, ...core(), name: "Video map objects" });
  line(slide, 4.975, 2.52, 0, 0.41, { end: "triangle", name: "Video metadata arrow" });
  box(slide, title2("Conversion · ffmpeg", "MPEG-2 to H.264, a separate process"), { x: 6.8, y: 2.95, w: 2.55, h: 0.95, ...infra(), name: "Video conversion" });
  line(slide, 8.075, 2.52, 0, 0.41, { begin: "triangle", end: "triangle", name: "Video conversion arrow" });
  slide.addText("ST 0601 metadata → two map objects", { x: 0.6, y: 3.05, w: 2.9, h: 0.6, fontSize: 11, italic: true, color: C.accent6, valign: "middle", margin: 0, isTextBox: true, objectName: "Video metadata note" });
  slide.addText("streaming GET, checked per viewer", { x: 9.9, y: 3.05, w: 2.85, h: 0.6, fontSize: 11, italic: true, color: C.accent6, valign: "middle", margin: 0, isTextBox: true, objectName: "Video GET note" });
  cards(slide, [
    ["Formats", "H.264 and H.265 pass unchanged; H.265 plays where the browser can decode it. MPEG-2 is converted by a minimal LGPL ffmpeg that only ECore starts."],
    ["A stream channel", "Any plugin can stream bytes to its web part. The server checks each viewer, and a slow viewer loses data, never the others."],
    ["Next: a simulated camera (M9)", "ECore renders a UAV's view from orthophotos over the terrain and sends it as STANAG 4609, to emcc and to other systems."],
  ], { cols: 3, y0: 4.3, w: 3.85, h: 2.1, gapX: 0.3, titleSize: 15, textSize: 12, prefix: "Video" });
  slide.addNotes(
    "Milestone M8 adds full motion video from UAVs, as STANAG 4609 over UDP. The new fmv plugin's input link reads only what it needs from the transport stream. " +
    "It decodes the ST 0601 metadata in its own Java code and turns each stream into two map objects: the camera, as an APP-6 symbol, and its field of view, an open arc aimed at the frame centre. ST 0102 sets their security label. " +
    "The video itself goes on unchanged to a new part of ECore, the stream hub. Each viewer gets an endless HTTP download over its login session, checked for the plugin's view permission, and starts at the last keyframe, so the picture shows at once. A slow viewer loses data rather than slowing anyone else. " +
    "H.264 and H.265 pass unchanged. MPEG-2 is converted to H.264 by ECore's conversion service, which runs a minimal LGPL build of ffmpeg as a separate process; plugins never start programs. In the browser, mpegts.js plays the video in a floating window. " +
    "In M9 a simulated camera follows: ECore renders a UAV's view from orthophotos draped over the terrain, and the fmv plugin sends it out as STANAG 4609, to other systems and back into emcc's own video panel.");

  // ---------- 11. Maps in any projection ----------
  slide = pres.addSlide({ masterName: "EMCC_CONTENT", sectionTitle: "Capabilities" });
  slide.addText("Maps in any projection", { placeholder: "title" });
  const projections = [
    ["Web Mercator", "EPSG:3857", S.RECTANGLE],
    ["Arctic", "EPSG:3413", S.OVAL],
    ["Antarctic", "EPSG:3031", S.OVAL],
  ];
  projections.forEach(([name, code, shape], i) => {
    const x = 0.6 + i * 2.15;
    slide.addShape(S.ROUNDED_RECTANGLE, { x, y: 1.5, w: 1.95, h: 2.4, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.background2, width: 0.5 }, objectName: `Projection card ${i + 1}` });
    slide.addShape(shape, { x: x + 0.3, y: 1.75, w: 1.35, h: 1.35, fill: tint(C.accent1, 80), line: { color: C.accent1, width: 1 }, objectName: `Projection ${name}` });
    if (shape === S.OVAL) {
      line(slide, x + 0.975, 1.75, 0, 1.35, { color: C.accent1, width: 0.75, dash: "dash" });
      line(slide, x + 0.3, 2.425, 1.35, 0, { color: C.accent1, width: 0.75, dash: "dash" });
    } else {
      [0.45, 0.9].forEach((d) => line(slide, x + 0.3, 1.75 + d, 1.35, 0, { color: C.accent1, width: 0.75, dash: "dash" }));
      [0.45, 0.9].forEach((d) => line(slide, x + 0.3 + d, 1.75, 0, 1.35, { color: C.accent1, width: 0.75, dash: "dash" }));
    }
    slide.addText([
      { text: name, options: { bold: true, fontSize: 14, color: C.text1, breakLine: true } },
      { text: code, options: { fontSize: 11, color: C.text2 } },
    ], { x, y: 3.2, w: 1.95, h: 0.6, align: "center", margin: 0, isTextBox: true, objectName: `Projection label ${i + 1}` });
  });
  slide.addText("Any projection with a proj4 definition. Coordinates in MGRS, UTM, UPS or DMS on screen; WGS84 longitude, latitude inside; edges are geodesic, so a shape looks the same everywhere.", { x: 0.6, y: 4.15, w: 6.25, h: 1.2, fontSize: 13, color: C.text2, valign: "top", margin: 0, isTextBox: true, objectName: "Projection note" });
  [
    ["Natural Earth", "Offline, in every projection, polar ones included: vector data drawn by the map view. Always there.", { color: C.background1 }, C.accent1],
    ["WMS servers (M4)", "Detailed maps from the servers of a disconnected network, passed through the plugin's server part. Offered only in the projections the server serves, never reprojected. The admin picks the layers in the plugin's own panel.", tint(C.accent1, 88), C.accent1],
    ["OpenStreetMap", "For development and demos only; needs the internet, and can be left out of a disconnected installation.", { color: C.background2 }, C.accent5],
  ].forEach(([head, text, fill, col], i, all) => {
    const hs = [1.15, 1.75, 1.15];
    const y = 1.5 + hs.slice(0, i).reduce((a, b) => a + b + 0.22, 0);
    box(slide, title2(head, text, 16, 12.5), { x: 7.2, y, w: 5.53, h: hs[i], fill, line: { color: col, width: 1 }, align: "left", valign: "top", margin: 10, name: `Background ${head}` });
  });
  slide.addNotes(
    "The map view uses OpenLayers with proj4 definitions, so it works in any projection, including polar stereographic ones such as EPSG:3413 for the Arctic and 3031 for the Antarctic. " +
    "Inside the system every coordinate is WGS84 longitude and latitude, with geodesic edges; the coordinates plugin shows and reads MGRS, UTM, UPS and DMS. " +
    "Natural Earth, drawn from vector data, is the background that always works, offline and in every projection. " +
    "Since M4, WMS servers add detailed maps. The browser never talks to them: the basemap-wms plugin's server part checks each request and passes the map on, and a background is offered only in the projections its server serves, never reprojected. " +
    "An admin picks each background's layers from the server's list in the plugin's own settings panel. OpenStreetMap remains for development and demos.");

  // ---------- 12. Security and trust ----------
  slide = pres.addSlide({ masterName: "EMCC_CONTENT", sectionTitle: "Capabilities" });
  slide.addText("Security and trust", { placeholder: "title" });
  cards(slide, [
    ["Login on the server", "Keycloak with OpenID Connect; tokens never reach the browser. A no-login mode for demos, on loopback only."],
    ["Checked by the server", "Every change is checked against the user's permissions; a workspace has its own. The browser only hides."],
    ["Security labels", "A STANAG 4774 label on every object and layer; each output has a highest classification it may send."],
    ["The layer lock (M4)", "A locked layer refuses users' changes; incoming data and the simulator keep flowing into it."],
    ["One address, offline", "The browser talks only to the emcc server, even for video, and loads nothing from the internet."],
    ["Trusted, checked plugins", "Hosts come from settings, never from data; plugins start no programs. Build rules and reviews check them."],
  ], { cols: 3, w: 3.85, h: 2.4, gapX: 0.3, gapY: 0.2, prefix: "Security" });
  slide.addNotes(
    "Login uses OpenID Connect against Keycloak, run on the server side: the browser holds only a session cookie, never a token. A no-login mode stays for demos and tests, and then the server listens on loopback only. " +
    "The server checks every change request against the user's permissions before anything else; a workspace a plugin declares has its own permissions, which the server enforces too. The browser only hides what a user may not do. " +
    "Every object and layer carries a security label in the structure of STANAG 4774, and each output link has a highest classification it may send. Access control by label comes later. " +
    "In M4 a layer can be locked: users' changes to its content are refused by the server, while incoming data and the simulator keep updating it. " +
    "The browser talks only to the emcc server and loads nothing from the internet, and every function works offline; from M8 even live video reaches the browser through the server, which checks each viewer. " +
    "Plugins are trusted code, but their hosts come only from settings, they never start programs, and architecture rules in every build and reviews check them. A security review agent reviews the whole system, its dependencies included, and reports to the owner.");

  // ---------- 13. Milestones and next steps ----------
  pres.addSection({ title: "Status" });
  slide = pres.addSlide({ masterName: "EMCC_CONTENT", sectionTitle: "Status" });
  slide.addText("Milestones and next steps", { placeholder: "title" });
  const ms = [
    ["M0", "2026-10-10", "Internal demo", "Shared live map, symbols", "done"],
    ["M1", "2026-10-14", "First demo", "Keycloak, polar map, CoT in", "done"],
    ["M2", "2026-10-22", "Beautify", "Workspace, looks, shapes", "done"],
    ["M3", "2026-10-30", "Simulator", "Workspaces, CoT out", "done"],
    ["M4", "2026-11-03", "Maps and inputs", "WMS, lock, AIS, ADS-B", "done"],
    ["M5", "2026-11-10", "Graphics and sensors", "Tactical graphics, GMTI, terrain", "done"],
    ["M6", "2026-11-11", "Layers and reports", "Move and copy, graphic images", "done"],
    ["M7", "2026-11-13", "First outside release", "NVG, palettes, fading, log file", "done"],
    ["M8", "now", "Design and video", "UX redesign, FMV, sensors", "now"],
    ["M9", "next", "Camera and Linux", "Simulated camera, Linux, PostGIS", "next"],
  ];
  line(slide, 0.6, 1.95, 12.13, 0, { color: C.accent5, width: 2, name: "Timeline" });
  ms.forEach(([id, when, name, text, state], i) => {
    const x = 0.6 + i * 1.218;
    const done = state === "done", now = state === "now";
    box(slide, id, { shape: S.OVAL, x: x + 0.29, y: 1.65, w: 0.6, h: 0.6, fill: done ? { color: C.accent1 } : now ? tint(C.accent1, 88) : { color: C.background1 }, line: { color: done || now ? C.accent1 : C.accent5, width: now ? 3 : 1.5 }, fontSize: 13, color: done ? C.background1 : C.accent1, margin: 0, name: `Milestone ${id}` });
    slide.addText([
      { text: when, options: { fontSize: 10, color: C.accent6, breakLine: true } },
      { text: name, options: { fontSize: 12.5, bold: true, color: C.text1, breakLine: true } },
      { text, options: { fontSize: 10.5, color: C.text2 } },
    ], { x, y: 2.4, w: 1.18, h: 2.1, align: "center", valign: "top", margin: 0, isTextBox: true, objectName: `Milestone text ${id}` });
  });
  box(slide, title2("Now: M8, design and video", "M7 RC3 was the first release for outside users, with SDK and data model 1.7.0. M8 brings the UX agent's redesign, full motion video, the sensor package and SDK 1.8.0.", 16, 12.5), { x: 0.6, y: 4.65, w: 5.9, h: 1.6, fill: tint(C.accent1, 85), line: { color: C.accent1, width: 1 }, align: "left", valign: "top", margin: 10, name: "Now" });
  box(slide, title2("Next: M9, and later", "M9: the simulated UAV camera, Linux releases and tests, PostgreSQL + PostGIS, OpenTelemetry. Later: history, access by label, STANAG 4778, KML, a 3D map view.", 16, 12.5), { x: 6.83, y: 4.65, w: 5.9, h: 1.6, fill: { color: C.background2 }, line: { color: C.accent5, width: 1 }, align: "left", valign: "top", margin: 10, name: "Later" });
  slide.addText("Decisions so far: 58 architecture decision records and 47 change requests (45 approved or decided, 2 rejected), all in the repository.", { x: 0.6, y: 6.4, w: 12.1, h: 0.35, fontSize: 11, italic: true, color: C.accent6, margin: 0, isTextBox: true, objectName: "Decisions note" });
  slide.addNotes(
    "M0, on 10 October, was an internal demo: a shared live map with symbol drawing. M1 added login with Keycloak, a polar map from Natural Earth, CoT from TAK systems and clusters, with a self-contained release. " +
    "M2, Beautify, gave the workspace its final form. M3, the Simulator, added workspaces, the simulator, CoT out and connection tasks, and was demonstrated with simulated tracks going through a real TAK Server. " +
    "M4 brought WMS background maps, the layer lock, the AIS and ADS-B plugins built by the new playbook, and Keycloak run as an external service. From M5 the product is called emcc; the code, packages and settings keys keep the internal name emc2. " +
    "M5 added military tactical graphics with mil-sym-ts, GMTI with the simulator's ground radar, terrain analysis, vessel symbols and each user's display settings. M6 added moving and copying objects between layers, images in tactical graphics and sensor report symbols. " +
    "M7 was the first release for outside users: NVG in and out, symbol palettes, Settings categories, fading detections and a log file. " +
    "As in every milestone, the contracts came first: each SDK and data model version was reviewed in steps and frozen before the merge. " +
    "M8, now, brings the user experience agent's redesign, full motion video with a stream channel and ECore's conversion service, and the sensor package. M9 brings the simulated UAV camera, Linux releases and tests, PostgreSQL with PostGIS, and OpenTelemetry. Later come history, access by label, STANAG 4778, KML and a 3D view. " +
    "Every decision is recorded in the repository: 58 architecture decision records and 47 change requests so far.");

  await pres.writeFile({ fileName: output });
  await applyTheme(output, THEME);
}

// pptxgenjs writes Office's default colour scheme. Replace it with ours so that scheme colours
// resolve to the emcc palette, and refuse to finish if a non-hex colour slipped into the deck.
async function applyTheme(file, theme) {
  const JSZip = require(require.resolve("jszip", { paths: [path.dirname(require.resolve("pptxgenjs"))] }));
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const part = "ppt/theme/theme1.xml";
  const slots = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  const scheme = `<a:clrScheme name="${theme.name}">` +
    slots.map((k) => `<a:${k}><a:srgbClr val="${theme.colors[k]}"/></a:${k}>`).join("") + "</a:clrScheme>";
  const xml = (await zip.file(part).async("string"))
    .replace(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/, () => scheme)
    .replace(/(<a:(?:theme|fontScheme)\b[^>]*?\bname=")[^"]*"/g, (_, head) => `${head}${theme.name}"`);
  if (!xml.includes(scheme)) throw new Error(`${part} has no colour scheme to replace`);
  zip.file(part, xml);
  for (const name of Object.keys(zip.files).filter((n) => n.endsWith(".xml"))) {
    const bad = (await zip.file(name).async("string")).match(/<a:srgbClr val="((?![0-9A-Fa-f]{6}")[^"]*)"/);
    if (bad) throw new Error(`${name}: colour "${bad[1]}" is not six hex digits (a scheme colour in a hex-only option)`);
  }
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

module.exports = { buildDeck };
