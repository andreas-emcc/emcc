// Builds the emcc website as one file that is easy to send: standalone/dist/emcc.html, the same page
// as the site with every picture, the logo, the chart and the favicon put inside it as data: URLs.
// It opens from a mail attachment or a folder (file://) with nothing beside it, and loads nothing
// from any server.
//
//   node standalone.mjs            for sending
//   node standalone.mjs --draft    the same, but a placeholder such as __M9_DATE__ is allowed (for a check only)
//
// Each picture is in the page twice (the picture and its full-size pop-over), so the file is about
// four times the pictures' size in bytes. The checks are those of build.mjs that apply to one file:
// no scripts, nothing loaded from another server or a local file, every #link has its target, every
// image has alt text, no placeholder (unless --draft), and the file is under 10 MB (mail limits).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "src");
const ASSETS = path.join(HERE, "..", "assets");
const OUT = path.join(HERE, "standalone", "dist", "emcc.html");
const MAX_BYTES = 10 * 1024 * 1024;
const DRAFT = process.argv.includes("--draft");
// Where build.mjs takes each file the page refers to from.
const SOURCES = { "favicon.svg": path.join(SRC, "favicon.svg"), "img/emcc-logo.svg": path.join(ASSETS, "logo", "emcc-logo.svg"), "img/archipelago.svg": path.join(ASSETS, "maps", "archipelago.svg") };
const TYPES = { ".jpg": "image/jpeg", ".svg": "image/svg+xml" };

const cache = new Map();
function dataUrl(ref) {
  if (!cache.has(ref)) {
    const file = SOURCES[ref] ?? (ref.startsWith("img/") && ref.endsWith(".jpg") ? path.join(ASSETS, "screenshots", path.basename(ref)) : null);
    if (!file || !fs.existsSync(file)) throw new Error(`the page refers to ${ref}, which is not found`);
    cache.set(ref, `data:${TYPES[path.extname(file)]};base64,${fs.readFileSync(file).toString("base64")}`);
  }
  return cache.get(ref);
}

let text = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
text = text.replace(/(\s(?:src|href))="((?:img\/|favicon)[^"]+)"/g, (_, attr, ref) => `${attr}="${dataUrl(ref)}"`);

const problems = [];
if (/<script\b/i.test(text)) problems.push("it has a <script>");
if (/@import\b/i.test(text)) problems.push("it has an @import");
const loaded = [
  ...[...text.matchAll(/\s(?:src|srcset)="([^"]+)"/gi)].map((m) => m[1]),
  ...[...text.matchAll(/<link\b[^>]*\shref="([^"]+)"/gi)].map((m) => m[1]),
  ...[...text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)].map((m) => m[1]),
];
for (const ref of loaded) if (!ref.startsWith("data:") && !ref.startsWith("#")) problems.push(`it loads ${ref.slice(0, 80)}, which is not inside it`);
for (const m of text.matchAll(/<a\b[^>]*\shref="([^"]+)"/gi)) if (!/^(https?:|mailto:|#)/i.test(m[1])) problems.push(`it links to ${m[1]}, a local file`);
for (const m of text.matchAll(/href="#([^"]+)"/g)) if (!text.includes(`id="${m[1]}"`)) problems.push(`it links to #${m[1]}, which has no target`);
for (const m of text.matchAll(/<img\b[^>]*>/gi)) if (!/\salt="/.test(m[0])) problems.push("it has an image without alt text");
if (!DRAFT) for (const m of new Set(text.match(/__[A-Z0-9_]+__/g) ?? [])) problems.push(`it still has the placeholder ${m}`);
const size = Buffer.byteLength(text);
if (size > MAX_BYTES) problems.push(`it is ${size} bytes, over 10 MB`);

if (problems.length) {
  console.log(`emcc.html not written, ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);
console.log(`${String(size).padStart(9)}  standalone/dist/emcc.html (${cache.size} files inside it)${DRAFT ? ", a draft" : ""}`);
