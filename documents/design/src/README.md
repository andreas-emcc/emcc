# Design documents – sources

This folder holds the sources of the documents in `documents/design/`:

| Output | Source | Content |
|---|---|---|
| `emcc-presentation.pptx` | `deck.js` | Presentation for talking about the project |
| `emcc-SDD.pdf` | `sdd/emc2-sdd.html` | Software Design Document (SDD) with figures |

The outputs carry the product name **emcc**; the sources keep the internal name emc2 (`CLAUDE.md` section 4).

**Never edit the outputs by hand.** Change the sources and rebuild, so that the documents can be regenerated as the project grows.

## Building

Requires Node.js and git. The SDD also needs a Chromium-based browser (Edge or Chrome), which prints the HTML to PDF.

```bash
npm install
npm run build          # both documents
npm run build:deck     # presentation only
npm run build:sdd      # SDD only
```

If the browser is not found, set `EMC2_BROWSER` to its executable.

Both documents show the short hash of the git commit they were built from (`HEAD`). Commit your changes before building a version you intend to share, so that the hash identifies what the document describes.

## Conventions

- The SDD follows the structure in its table of contents. New sections are added according to Appendix A. Figures are inline SVG in the HTML.
- Colours follow the APP-6 affiliation colours, in all documents: blue = emcc core, green = plugins, yellow = external systems, grey = infrastructure, red = risks. Dashed outlines are contracts (SDKs).
- The presentation uses one theme and two layouts (title and content), defined in `deck.js`. Each slide has speaker notes.
- The content must agree with `requirements.md`, `docs/architecture/overview.md` and `docs/adr/`. Those are the sources of truth.
