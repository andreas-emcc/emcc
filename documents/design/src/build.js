"use strict";
// Builds the design documents in documents/design/:
//   emcc-presentation.pptx  from deck.js
//   emcc-SDD.pdf            from sdd/emc2-sdd.html, printed by a headless Chromium-based browser
// Usage: npm run build | npm run build:deck | npm run build:sdd
// The documents reference the git commit they are built from (short hash of HEAD).
// Set EMC2_BROWSER to the browser executable if it is not found automatically.

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { buildDeck } = require("./deck");

const OUT_DIR = path.resolve(__dirname, "..");
const DECK_OUTPUT = path.join(OUT_DIR, "emcc-presentation.pptx");
const SDD_SOURCE = path.join(__dirname, "sdd", "emc2-sdd.html");
const SDD_OUTPUT = path.join(OUT_DIR, "emcc-SDD.pdf");

function buildInfo() {
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: __dirname, encoding: "utf8" }).trim();
  const date = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, local time
  return { commit, date };
}

function findBrowser() {
  if (process.env.EMC2_BROWSER) return process.env.EMC2_BROWSER;
  const candidates = {
    win32: [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    ],
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
    linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"],
  }[process.platform] || [];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("No Chromium-based browser found. Set EMC2_BROWSER to the browser executable.");
  return found;
}

function buildSdd({ commit, date }) {
  const html = fs.readFileSync(SDD_SOURCE, "utf8").replaceAll("{{COMMIT}}", commit).replaceAll("{{DATE}}", date);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "emc2-sdd-"));
  const htmlFile = path.join(tmp, "emc2-sdd.html");
  fs.writeFileSync(htmlFile, html);
  // Remove the old PDF first: a browser that cannot run (e.g. in a sandbox) fails silently,
  // and the existence check below must then report it instead of keeping a stale document.
  fs.rmSync(SDD_OUTPUT, { force: true });
  try {
    execFileSync(findBrowser(), [
      "--headless", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer",
      `--user-data-dir=${path.join(tmp, "profile")}`,
      `--print-to-pdf=${SDD_OUTPUT}`,
      pathToFileURL(htmlFile).href,
    ], { stdio: "ignore", timeout: 120000 });
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* the browser may still hold files; harmless */ }
  }
  if (!fs.existsSync(SDD_OUTPUT)) throw new Error("The browser did not produce the PDF");
  console.log(`SDD written to ${SDD_OUTPUT}`);
}

async function main() {
  const what = process.argv[2] || "all";
  const info = buildInfo();
  console.log(`Building design documents for commit ${info.commit} (${info.date})`);
  if (what === "all" || what === "deck") {
    await buildDeck({ ...info, output: DECK_OUTPUT });
    console.log(`Presentation written to ${DECK_OUTPUT}`);
  }
  if (what === "all" || what === "sdd") buildSdd(info);
}

main().catch((e) => { console.error(`Build failed: ${e.message}`); process.exit(1); });
