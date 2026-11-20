# Manual – sources

The sources of the emcc user manual. The built HTML goes to `documents/manual/html/` (not committed: owner, 2026-11-03).

**Never edit the output by hand.** Change a chapter and build again.

## Building

Needs Node.js and git.

```bash
npm install
npm run build
```

The build writes `../html/`: one page per chapter, `index.html`, `style.css` and the images that the chapters use. It works opened from the folder (`file://`) and served by a web server. It fails, and says why, on a broken link, a missing image, an image without alt text, HTML inside a chapter or a file name that does not follow the pattern. `node build.js --stubs` also lists the chapters that are not written yet.

It also writes `../html/manual.html`: the whole manual in one document, with links between chapters kept working.

Part 7 holds the **task guides**. The build writes them a second time as a document of their own, `../html/task-guides.html` (a link to a chapter of another part stays a link to that chapter's page, next to the file). The title comes from `guidesTitle` in `manual.json`. A new guide is a new chapter `07-NN-name.md`; nothing else changes.

## The PDF

```bash
npm run build
npm run pdf
```

`pdf.mjs` prints `html/manual.html` with Playwright's Chromium to `../pdf/emcc-user-manual.pdf`, and `html/task-guides.html` to `../pdf/emcc-task-guides.pdf` (neither committed, like `html/`; in the PDF of the guides a link to a chapter of the manual becomes the chapter's number). A4, white page and black text whatever the computer's colour setting is, a cover, a contents page, each chapter on a new page, bookmarks from the headings, clickable links and page numbers.

Every page names the release it describes (`manual.json`) and the commit it was built from.

## Chapters

One Markdown file per chapter, named `NN-MM-name.md`:

- `NN` is the part (01 to 89 are numbered parts, 90 and up are appendices);
- `MM` is the chapter in the part. `NN-00` is the part's own introduction and is required.

The files sort in reading order. The build numbers parts and chapters (3, 3.2; appendices A, A.1), so headings in the text carry no numbers.

Rules for a chapter:

- plain Markdown: headings, lists, tables, images, links; **no HTML**, so that a PDF and a Markdown output can be added later;
- one `#` heading, the chapter's title;
- an image is `![alt text](images/chapter-step.png "Caption")`; the alt text is required, the caption is optional; screenshots are PNG, named after the chapter and step;
- a link to another chapter names its file: `[Layers](03-14-layers.md#locking)`;
- a chapter that only says `Not written yet.` is a placeholder.

Files:

| File | Purpose |
|---|---|
| `build.js` | the build (markdown-it 15.0.3, pinned, with its own lock file) |
| `manual.json` | the manual's title and the release it describes |
| `theme/style.css` | the stylesheet (system fonts, light and dark) |
| `images/` | the screenshots |
| `pdf.mjs` | prints the whole manual and the task guides to PDF files (see above) |
| `shots.mjs` | takes the screenshots (see below) |
| `scrape.mjs` | reads the text of Settings and the Monitor from a running emcc, as a help for writing those chapters. It changes nothing |

The licence of the build's packages (PSF-2.0 for `argparse`) is CR-0036.

## Taking the screenshots

`shots.mjs` drives a running emcc with Playwright's Chromium (`playwright-core` 1.63.0, the version the integration tests use; install the browser with the integration tests' setup if it is missing). It walks through the steps the chapters describe, checks what each step shows and writes `images/<chapter>-<step>.png` at 1336 x 849 in the default look, light, with Natural Earth as the background. It exits with 1 and lists the steps that failed.

`--only=<text>` runs only the steps whose name has the text (after two set-up steps), to redo one chapter's pictures; several texts are separated by commas. Some steps need what an earlier step made. The **"Guide:" steps** (the task guides' pictures) run only when `--only` names them, on fresh data, with the steps that make the GMTI links and close the map controls: `--only="Map controls: close,GMTI: two links,Guide:"`. `NO_SHOTS=1` runs without writing any picture, for a try-out (`GUIDE_MDV`, `GUIDE_START`, `GUIDE_END` and `GUIDE_WAIT` change the guide's radar for such a try-out).

The emcc must be freshly started from a release, without login (for example `start.bat -standalone 18098`), because the run places objects and makes a bookmark and a setup. To run again, stop it, restore its `data` folder from a copy made before the first run, and start it again.

```bash
EMC2_HOME=<the emcc folder> node shots.mjs http://127.0.0.1:18098
```

**Height data for the viewshed pictures.** Put DTED cells (`.dt0`, `.dt1`, `.dt2`) into the emcc folder's `settings/terrain`, and give the emcc folder's path in `EMC2_HOME`. The run sets Settings > Terrain > height data folder to `<EMC2_HOME>/settings/terrain`, and puts the observer at 62.4 N, 17.3 E, which the cells must cover. `EMC2_DTED` names another height folder instead.

**What the run sends.** The GMTI step makes two links over UDP on 127.0.0.1, port 47607, and the Cursor on Target step makes two on ports 47610 and 47611. The script sends four CoT events (ATAK's format and WinTAK's) to the second pair and listens for what the link sends out again. Nothing leaves this computer. Note that a step that makes a link or a layer is not safe to run twice on the same data, so restore the data between runs.
