// Prints the built manual to PDF files in ../pdf/:
//   ../html/manual.html       -> emcc-user-manual.pdf
//   ../html/task-guides.html  -> emcc-task-guides.pdf   (part 7 of the manual, as a document of its own)
//
//   npm run build
//   npm run pdf
//
// A4, white page and black text whatever the computer's light/dark setting is, bookmarks (outline) from the
// headings, clickable links, page numbers in the footer. Uses Playwright's Chromium, as shots.mjs does.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlDir = path.resolve(here, "..", "html");
const outDir = path.resolve(here, "..", "pdf");
const manual = JSON.parse(fs.readFileSync(path.join(here, "manual.json"), "utf8"));

const jobs = [
  { html: "manual.html", pdf: "emcc-user-manual.pdf", title: manual.title, required: true },
  { html: "task-guides.html", pdf: "emcc-task-guides.pdf", title: manual.guidesTitle, required: false, guides: true },
];
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const job of jobs) {
    const html = path.join(htmlDir, job.html);
    if (!fs.existsSync(html)) {
      if (job.required) {
        console.error(`html/${job.html} is missing: run \`npm run build\` first.`);
        process.exit(1);
      }
      continue;
    }
    const out = path.join(outDir, job.pdf);
    const page = await browser.newPage();
    await page.emulateMedia({ media: "print", colorScheme: "light" });
    await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
    // The pages load images lazily; a PDF needs all of them.
    const broken = await page.evaluate(async () => {
      const imgs = [...document.images];
      imgs.forEach((i) => (i.loading = "eager"));
      await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
      return imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src"));
    });
    if (broken.length) throw new Error("images did not load: " + broken.join(", "));
    if (job.guides) {
      // A link to a chapter of the manual cannot work from a PDF of its own: it becomes the chapter's number.
      await page.evaluate(() => {
        for (const a of [...document.querySelectorAll("a[href]")]) {
          const m = /^(\d\d)-(\d\d)-[a-z0-9-]+\.html/.exec(a.getAttribute("href"));
          if (!m) continue;
          const span = document.createElement("span");
          const n = Number(m[1]);
          const label = n >= 90 ? `appendix ${String.fromCharCode(65 + (n - 90))}` : `chapter ${n}.${Number(m[2])}`;
          span.textContent = `${a.textContent} (user manual, ${label})`;
          a.replaceWith(span);
        }
      });
    }
    const footer = `<div style="font: 8px system-ui, Arial, sans-serif; color: #555; width: 100%; padding: 0 18mm; display: flex; justify-content: space-between;">
<span>${job.title} – ${manual.release}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
    await page.pdf({
      path: out,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: footer,
      margin: { top: "18mm", bottom: "20mm", left: "18mm", right: "18mm" },
      outline: true,
      tagged: true,
    });
    console.log(`Wrote ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB).`);
    await page.close();
  }
} finally {
  await browser.close();
}
