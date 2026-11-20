// Builds the emcc website into dist/ (git-ignored). On main, the Pages workflow .github/workflows/website.yml
// runs this build and deploys dist/ to GitHub Pages as www.emcc.dev.
//
//   node build.mjs            for publishing
//   node build.mjs --draft    the same, but a placeholder such as __M9_DATE__ is allowed (for a check only)
//
// It copies src/ (the page and its favicon), the screenshots the page uses, the logo and the chart
// into dist/img/, writes CNAME (www.emcc.dev) and .nojekyll (a Pages deploy by the workflow needs
// neither: the domain is set in the repository's Pages settings), and checks
// the rules of agents/dma.md rule 9: no scripts, nothing loaded from another server, every local file
// that a page refers to exists, and no file over 5 MB. Any failed check stops the build (exit 1).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "src");
const ASSETS = path.join(HERE, "..", "assets");
const DIST = path.join(HERE, "dist");
const DOMAIN = "www.emcc.dev";
// Only the screenshots that a page refers to (img/<name>.jpg); the others stay in marketing/assets.
const PAGES = fs.readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith(".html")).map((f) => fs.readFileSync(path.join(SRC, f), "utf8")).join(" ");
const SHOTS = fs.readdirSync(path.join(ASSETS, "screenshots")).filter((f) => f.endsWith(".jpg") && PAGES.includes(`img/${f}`));
const IMAGES = [...SHOTS.map((f) => `screenshots/${f}`), "logo/emcc-logo.svg", "maps/archipelago.svg"];
const MAX_BYTES = 5 * 1024 * 1024;
const DRAFT = process.argv.includes("--draft");

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, "img"), { recursive: true });
fs.cpSync(SRC, DIST, { recursive: true });
for (const image of IMAGES) fs.copyFileSync(path.join(ASSETS, image), path.join(DIST, "img", path.basename(image)));
fs.writeFileSync(path.join(DIST, "CNAME"), `${DOMAIN}\n`);
fs.writeFileSync(path.join(DIST, ".nojekyll"), "");

const problems = [];
const files = fs.readdirSync(DIST, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(DIST, f)).isFile());
for (const file of files) {
  const full = path.join(DIST, file);
  const size = fs.statSync(full).size;
  if (size > MAX_BYTES) problems.push(`${file} is ${size} bytes, over 5 MB`);
  if (!/\.(html|css|svg)$/.test(file)) continue;
  const text = fs.readFileSync(full, "utf8");
  if (/<script\b/i.test(text)) problems.push(`${file} has a <script>`);
  if (/@import\b/i.test(text)) problems.push(`${file} has an @import`);
  // Resources the browser loads: src, srcset, link href (not <a href>), CSS url().
  const loaded = [
    ...[...text.matchAll(/\s(?:src|srcset)="([^"]+)"/gi)].map((m) => m[1]),
    ...[...text.matchAll(/<link\b[^>]*\shref="([^"]+)"/gi)].map((m) => m[1]),
    ...[...text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)].map((m) => m[1]),
  ];
  for (const ref of loaded) {
    if (/^(https?:)?\/\//i.test(ref)) problems.push(`${file} loads ${ref} from another server`);
    else if (!ref.startsWith("#") && !ref.startsWith("data:")) {
      const target = path.join(path.dirname(full), ref.split(/[?#\s]/)[0]);
      if (!fs.existsSync(target)) problems.push(`${file} refers to ${ref}, which is missing`);
    }
  }
  // Local links (<a href>) must exist too; links to other sites are allowed.
  for (const m of text.matchAll(/<a\b[^>]*\shref="([^"]+)"/gi)) {
    const ref = m[1];
    if (/^(https?:|mailto:|#)/i.test(ref)) continue;
    if (!fs.existsSync(path.join(path.dirname(full), ref.split(/[?#]/)[0]))) problems.push(`${file} links to ${ref}, which is missing`);
  }
  if (file.endsWith(".html")) {
    for (const m of text.matchAll(/href="#([^"]+)"/g)) if (!text.includes(`id="${m[1]}"`)) problems.push(`${file} links to #${m[1]}, which has no target`);
    for (const m of text.matchAll(/<img\b[^>]*>/gi)) if (!/\salt="/.test(m[0])) problems.push(`${file} has an image without alt text`);
    // A placeholder such as __M9_DATE__ (a release written as released before its date is known) must be
    // filled in before publishing; `--draft` builds anyway, for a check in the browser only.
    if (!DRAFT) for (const m of new Set(text.match(/__[A-Z0-9_]+__/g) ?? [])) problems.push(`${file} still has the placeholder ${m}`);
  }
}

let total = 0;
for (const file of files.sort()) {
  const size = fs.statSync(path.join(DIST, file)).size;
  total += size;
  console.log(`${String(size).padStart(9)}  ${file.replaceAll("\\", "/")}`);
}
console.log(`${String(total).padStart(9)}  in ${files.length} files, dist/`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
