"use strict";
// Builds the emcc user manual: documents/manual/src/*.md -> documents/manual/html/
//
//   npm install
//   npm run build
//
// One Markdown file per chapter, named NN-MM-name.md:
//   NN = the part (01..89 are numbered parts, 90 and up are appendices),
//   MM = the chapter inside the part (00 is the part's own introduction).
// Chapters are plain Markdown (no HTML inside). Images are images/<name>.png, links between
// chapters name the file, e.g. [Layers](03-11-layers.md#locking).
// The build fails on a broken link, a missing image, an image without alt text, HTML in a chapter
// or a file name that does not follow the pattern. Never edit html/ by hand.
//
// Part 7 holds the task guides. Besides being part of the manual, the build writes them as a document of
// their own, html/task-guides.html (npm run pdf makes pdf/emcc-task-guides.pdf from it).

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const MarkdownIt = require("markdown-it");

const SRC = __dirname;
const OUT = path.resolve(SRC, "..", "html");
const manual = JSON.parse(fs.readFileSync(path.join(SRC, "manual.json"), "utf8"));
const errors = [];
const warnings = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

// ---------- git stamp ----------
function git(...args) {
  try {
    return execFileSync("git", args, { cwd: SRC, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}
const commit = git("rev-parse", "--short", "HEAD") || "unknown";
const dirty = git("status", "--porcelain", "--", ".") !== "";
const stamp = `${commit}${dirty ? " (with uncommitted changes)" : ""}`;

// ---------- chapters ----------
const NAME = /^(\d\d)-(\d\d)-([a-z0-9-]+)\.md$/;
const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".md") && f !== "README.md").sort();
const chapters = [];
for (const f of files) {
  const m = NAME.exec(f);
  if (!m) {
    fail(f, "name must be NN-MM-name.md (lower case, digits and hyphens)");
    continue;
  }
  chapters.push({ file: f, part: Number(m[1]), sub: Number(m[2]), page: f.replace(/\.md$/, ".html"), text: fs.readFileSync(path.join(SRC, f), "utf8") });
}
// A draft mark, [CHECK: ...], is text that waits for the running release. The build counts them, so that none is left at a release.
for (const c of chapters) {
  const n = (c.text.match(/\[CHECK[:\]]/g) || []).length;
  if (n) warnings.push(`${c.file}: ${n} mark(s) [CHECK] still to check against the release`);
}
// Labels: "3", "3.2"; appendices "A", "A.1" ... by the order of their part numbers.
const APPENDIX_FROM = 90;
const partNumbers = [...new Set(chapters.map((c) => c.part))];
const seen = new Set();
for (const c of chapters) {
  const key = `${c.part}-${c.sub}`;
  if (seen.has(key)) fail(c.file, `another file has the number ${key}`);
  seen.add(key);
}
for (const p of partNumbers) {
  if (!chapters.some((c) => c.part === p && c.sub === 0)) fail(`part ${p}`, "has no NN-00 introduction file");
}
const appendixLetters = partNumbers.filter((p) => p >= APPENDIX_FROM);
for (const c of chapters) {
  if (c.part < APPENDIX_FROM) {
    c.label = c.sub === 0 ? `${c.part}` : `${c.part}.${c.sub}`;
    c.kind = c.sub === 0 ? "Part" : "Chapter";
  } else {
    const letter = String.fromCharCode(65 + appendixLetters.indexOf(c.part));
    c.label = c.sub === 0 ? letter : `${letter}.${c.sub}`;
    c.kind = c.sub === 0 ? "Appendix" : "Chapter";
  }
}
const byFile = new Map(chapters.map((c) => [c.file, c]));

// ---------- markdown ----------
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function makeParser(chapter, usedImages) {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

  // Heading ids, and the chapter's own title and outline.
  md.core.ruler.push("emc2_headings", (state) => {
    const used = new Set();
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== "heading_open") continue;
      const level = Number(toks[i].tag.slice(1));
      const text = toks[i + 1].children.map((t) => (t.type === "text" || t.type === "code_inline" ? t.content : "")).join("");
      let id = slug(text);
      for (let n = 2; used.has(id); n++) id = `${slug(text)}-${n}`;
      used.add(id);
      toks[i].attrSet("id", id);
      if (level === 1) {
        if (chapter.title) fail(chapter.file, "more than one H1");
        chapter.title = text;
        chapter.h1id = id;
      } else if (level === 2) {
        chapter.outline.push({ id, text });
      }
    }
    // Plain Markdown only: raw HTML would not survive a PDF or a Markdown output.
    for (const t of toks) {
      if (t.type === "inline") {
        for (const c of t.children) if (c.type === "text" && /<\/?[a-zA-Z]/.test(c.content)) fail(chapter.file, `HTML inside a chapter: "${c.content.trim().slice(0, 40)}"`);
      }
    }
  });

  // A paragraph with only an image becomes a figure; the image's title is its caption.
  md.core.ruler.push("emc2_figures", (state) => {
    const toks = state.tokens;
    for (let i = 0; i + 2 < toks.length; i++) {
      if (toks[i].type === "paragraph_open" && toks[i + 1].type === "inline" && toks[i + 1].children.length === 1 && toks[i + 1].children[0].type === "image") {
        toks[i].tag = "figure";
        toks[i + 2].tag = "figure";
        const img = toks[i + 1].children[0];
        const title = img.attrGet("title");
        if (title) {
          img.attrs = img.attrs.filter((a) => a[0] !== "title");
          const cap = new state.Token("html_inline", "", 0);
          cap.content = `<figcaption>${esc(title)}</figcaption>`;
          toks[i + 1].children.push(cap);
        }
      }
    }
  });

  const defaultImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    const src = t.attrGet("src");
    const alt = t.content;
    if (!alt.trim()) fail(chapter.file, `image ${src} has no alt text`);
    if (!/^images\/[a-z0-9._-]+\.(png|svg|jpg)$/.test(src)) fail(chapter.file, `image ${src}: must be images/<name>.png`);
    else if (!fs.existsSync(path.join(SRC, src))) fail(chapter.file, `image ${src} does not exist`);
    else usedImages.add(src);
    t.attrSet("loading", "lazy");
    return defaultImage(tokens, idx, options, env, self);
  };

  // Links to other chapters: NN-MM-name.md#id -> NN-MM-name.html#id; checked.
  const defaultLink = md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    const href = t.attrGet("href") || "";
    if (/^https?:/.test(href)) {
      t.attrSet("rel", "noopener");
    } else if (href.startsWith("#")) {
      chapter.anchorLinks.push(href.slice(1));
    } else {
      const [file, frag] = href.split("#");
      if (!byFile.has(file)) fail(chapter.file, `link to ${href}: no such chapter`);
      else {
        t.attrSet("href", byFile.get(file).page + (frag ? `#${frag}` : ""));
        chapter.crossLinks.push({ file, frag });
      }
    }
    return defaultLink(tokens, idx, options, env, self);
  };

  // Tables scroll sideways on a narrow screen instead of widening the page.
  md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n';
  md.renderer.rules.table_close = () => "</table></div>\n";
  return md;
}

const usedImages = new Set();
const ids = new Map(); // file -> Set of heading ids
for (const c of chapters) {
  c.outline = [];
  c.anchorLinks = [];
  c.crossLinks = [];
  c.title = "";
  const md = makeParser(c, usedImages);
  c.body = md.render(c.text);
  if (!c.title) fail(c.file, "has no H1 title");
  c.stub = /^Not written yet\.$/m.test(c.text);
  ids.set(c.file, new Set([c.h1id, ...c.outline.map((o) => o.id)]));
}
// Headings of level 3 and below can be link targets too: collect every id from the HTML.
for (const c of chapters) {
  for (const m of c.body.matchAll(/ id="([^"]+)"/g)) ids.get(c.file).add(m[1]);
}
for (const c of chapters) {
  for (const a of c.anchorLinks) if (!ids.get(c.file).has(a)) fail(c.file, `link to #${a}: no such heading in this chapter`);
  for (const l of c.crossLinks) if (l.frag && !ids.get(l.file).has(l.frag)) fail(c.file, `link to ${l.file}#${l.frag}: no such heading`);
}

// ---------- pages ----------
const title = (c) => `${c.label} ${c.title}`;
const parts = partNumbers.map((p) => ({ intro: chapters.find((c) => c.part === p && c.sub === 0), subs: chapters.filter((c) => c.part === p && c.sub > 0) }));

const GUIDE_PART = 7;
const guideChapters = chapters.filter((c) => c.part === GUIDE_PART);

function navHtml(current) {
  let h = '<nav class="toc" aria-label="Contents">\n<p class="toc-home"><a href="index.html"' + (current === null ? ' aria-current="page"' : "") + ">" + esc(manual.title) + "</a></p>\n<ol class=\"parts\">\n";
  for (const p of parts) {
    const open = current && current.part === p.intro.part;
    h += `<li class="part"><details${open ? " open" : ""}><summary><a href="${p.intro.page}"${current === p.intro ? ' aria-current="page"' : ""}>${esc(title(p.intro))}</a></summary>\n<ol>\n`;
    for (const s of p.subs) {
      h += `<li><a href="${s.page}"${current === s ? ' aria-current="page"' : ""}>${esc(title(s))}</a>`;
      if (current === s && s.outline.length) {
        h += '<ol class="outline">' + s.outline.map((o) => `<li><a href="#${o.id}">${esc(o.text)}</a></li>`).join("") + "</ol>";
      }
      h += "</li>\n";
    }
    h += "</ol></details></li>\n";
  }
  return h + "</ol>\n</nav>";
}

function page({ pageTitle, current, body, prev, next }) {
  const link = (c, cls, word) => (c ? `<a class="${cls}" href="${c.page}" rel="${cls}"><span>${word}</span> ${esc(title(c))}</a>` : "<span></span>");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)} – ${esc(manual.title)}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<a class="skip" href="#content">Skip to the content</a>
<header class="site"><a href="index.html">${esc(manual.title)}</a><span>${esc(manual.release)}</span></header>
<div class="layout">
${navHtml(current)}
<main id="content">
${body}
<div class="pager">${link(prev, "prev", "Previous")}${link(next, "next", "Next")}</div>
</main>
</div>
<footer class="site">${esc(manual.title)} for ${esc(manual.release)} · built from commit ${esc(stamp)} · Apache License 2.0</footer>
</body>
</html>
`;
}

// The picture of the View workspace on the first page and the cover, so that the reader sees at once what the manual is about.
const START_IMAGE = "images/view-overview.png";
if (!fs.existsSync(path.join(SRC, START_IMAGE))) fail("build.js", `${START_IMAGE} does not exist`);
usedImages.add(START_IMAGE);
const startFigure = `<figure><img src="${START_IMAGE}" alt="The View workspace: the map in the middle, with the left, right and bottom panes around it"><figcaption>The View workspace, where you work with the map.</figcaption></figure>\n`;

function indexBody() {
  let h = `<h1>${esc(manual.title)}</h1>\n<p class="release">Describes emcc ${esc(manual.release)}${manual.releaseZip ? " (" + esc(manual.releaseZip) + ")" : ""}.<br>Built from commit ${esc(stamp)}.</p>\n${startFigure}<h2>Contents</h2>\n<ol class="parts big">\n`;
  for (const p of parts) {
    h += `<li><a href="${p.intro.page}">${esc(title(p.intro))}</a>`;
    if (p.subs.length) h += "<ol>" + p.subs.map((s) => `<li><a href="${s.page}">${esc(title(s))}</a></li>`).join("") + "</ol>";
    h += "</li>\n";
  }
  h += "</ol>\n";
  if (guideChapters.length) h += `<p>The task guides, part ${GUIDE_PART}, are also one document of their own: <a href="task-guides.html">${esc(manual.guidesTitle)}</a>.</p>\n`;
  return h;
}

// Part introductions list their chapters, so the reader sees the way on.
function chapterBody(c) {
  let body = c.body;
  const p = parts.find((x) => x.intro.part === c.part);
  if (c.sub === 0 && p.subs.length && !body.includes(' id="in-this-part"')) {
    body += `<h2 id="in-this-part">In this part</h2>\n<ul>` + p.subs.map((s) => `<li><a href="${s.page}">${esc(title(s))}</a></li>`).join("") + "</ul>\n";
  }
  // Number the H1.
  return body.replace(/<h1 id="([^"]+)">/, (m, id) => `<h1 id="${id}"><span class="num">${esc(c.kind)} ${esc(c.label)}</span> `);}

if (errors.length) {
  console.error(`The manual does not build (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}

// ---------- write ----------
if (OUT !== path.resolve(SRC, "..", "html")) throw new Error("unexpected output folder");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "images"), { recursive: true });
fs.copyFileSync(path.join(SRC, "theme", "style.css"), path.join(OUT, "style.css"));
for (const img of usedImages) fs.copyFileSync(path.join(SRC, img), path.join(OUT, img));

fs.writeFileSync(path.join(OUT, "index.html"), page({ pageTitle: "Contents", current: null, body: indexBody(), prev: null, next: chapters[0] }));
chapters.forEach((c, i) => {
  fs.writeFileSync(path.join(OUT, c.page), page({ pageTitle: c.title, current: c, body: chapterBody(c), prev: chapters[i - 1] || null, next: chapters[i + 1] || null }));
});

// ---------- one page for printing (manual.html), the source of the PDF ----------
// Every chapter goes into one document. Heading ids get the chapter's name in front, and links between
// chapters become links inside the document.
function printable() {
  const prefix = (c) => c.file.replace(/\.md$/, "");
  const inDoc = (c, html) =>
    html
      .replace(/ id="([^"]+)"/g, (m, id) => ` id="${prefix(c)}--${id}"`)
      .replace(/ href="#([^"]+)"/g, (m, id) => ` href="#${prefix(c)}--${id}"`)
      .replace(/ href="(\d\d-\d\d-[a-z0-9-]+)\.html(?:#([^"]+))?"/g, (m, name, frag) => {
        const target = byFile.get(`${name}.md`);
        return ` href="#${name}--${frag || target.h1id}"`;
      });
  let toc = '<ol class="parts big">\n';
  for (const p of parts) {
    toc += `<li><a href="#${prefix(p.intro)}">${esc(title(p.intro))}</a>`;
    if (p.subs.length) toc += "<ol>" + p.subs.map((s) => `<li><a href="#${prefix(s)}">${esc(title(s))}</a></li>`).join("") + "</ol>";
    toc += "</li>\n";
  }
  toc += "</ol>\n";
  const sections = chapters.map((c) => `<section class="chapter${c.sub === 0 ? " part-intro" : ""}" id="${prefix(c)}">\n${inDoc(c, chapterBody(c))}</section>\n`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(manual.title)} – ${esc(manual.release)}</title>
<link rel="stylesheet" href="style.css">
</head>
<body class="print-doc">
<section class="cover">
<h1>${esc(manual.title)}</h1>
<p class="release">Describes emcc ${esc(manual.release)}<br>${manual.releaseZip ? esc(manual.releaseZip) + "<br>" : ""}Built from commit ${esc(stamp)}</p>
${startFigure}</section>
<section class="contents">
<h2>Contents</h2>
${toc}</section>
${sections}</body>
</html>
`;
}
fs.writeFileSync(path.join(OUT, "manual.html"), printable());

// ---------- the task guides (part 7) as a document of their own: task-guides.html ----------
// The same chapters, in one page with its own contents. A link to a chapter of another part stays a link to that
// chapter's page, which is next to this file in the manual's folder; the PDF turns it into the chapter's number.
function taskGuides() {
  const prefix = (c) => c.file.replace(/\.md$/, "");
  const inDoc = (c, html) =>
    html
      .replace(/ id="([^"]+)"/g, (m, id) => ` id="${prefix(c)}--${id}"`)
      .replace(/ href="#([^"]+)"/g, (m, id) => ` href="#${prefix(c)}--${id}"`)
      .replace(/ href="(\d\d-\d\d-[a-z0-9-]+)\.html(?:#([^"]+))?"/g, (m, name, frag) => {
        const target = byFile.get(`${name}.md`);
        if (target.part !== GUIDE_PART) return m;
        return ` href="#${name}--${frag || target.h1id}"`;
      });
  const intro = guideChapters.find((c) => c.sub === 0);
  const subs = guideChapters.filter((c) => c.sub > 0);
  let toc = '<ol class="parts big">\n';
  toc += subs.map((s) => `<li><a href="#${prefix(s)}">${esc(title(s))}</a></li>`).join("\n");
  toc += "\n</ol>\n";
  const sections = guideChapters.map((c) => `<section class="chapter${c.sub === 0 ? " part-intro" : ""}" id="${prefix(c)}">\n${inDoc(c, chapterBody(c))}</section>\n`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(manual.guidesTitle)} – ${esc(manual.release)}</title>
<link rel="stylesheet" href="style.css">
</head>
<body class="print-doc">
<section class="cover">
<h1>${esc(manual.guidesTitle)}</h1>
<p class="release">Describes emcc ${esc(manual.release)}<br>Part ${GUIDE_PART} of the ${esc(manual.title)}, as a document of its own<br>Built from commit ${esc(stamp)}</p>
</section>
<section class="contents">
<h2>Contents</h2>
${toc}</section>
${sections}</body>
</html>
`;
}
if (guideChapters.length) fs.writeFileSync(path.join(OUT, "task-guides.html"), taskGuides());

const stubs = chapters.filter((c) => c.stub);
console.log(`Built ${chapters.length} chapters and ${usedImages.size} images into documents/manual/html/ (release ${manual.release}, commit ${stamp})${guideChapters.length ? "; the task guides are also task-guides.html" : ""}.`);
console.log(`${chapters.length - stubs.length} written, ${stubs.length} not written yet.`);
if (process.argv.includes("--stubs")) for (const s of stubs) console.log("  not written: " + s.file);
for (const w of warnings) console.warn("warning: " + w);
