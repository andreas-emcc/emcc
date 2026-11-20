# Design overhaul: directions and choices (T-198)

The UXA's proposal for the web UI's overhaul, and the owner's choices as they are made. The design is final (owner, 2026-11-13), and the UXA may now change its own CSS (owner, the same day): T-205 first. The findings behind it are in `findings.md`.

## The mockups

`mockups/`: static HTML on the real `web/shell/src/tokens.css` and `web/plugin-sdk/src/components/components.css`. Open `mockups/index.html` from the folder, or serve the repository root (`python -m http.server 18104 --bind 127.0.0.1`) and open `/docs/ux/mockups/`. The dashed bar at the top is the mockup's own and switches direction, look, scheme and density. A page also takes them in its address: `view.html?dir=cards&look=signal&scheme=dark`.

| File | What |
|---|---|
| `directions.css` | the proposed values of the looks, and the three directions |
| `mock.css`, `mock.js` | a stand-in for the shell's layout, and the repeated parts |
| `view.html` | the workspace |
| `settings.html` | Settings: GMTI (a list, three variants), Data types (a table), Simulator (a plain page) |
| `monitor.html` | the Monitor |
| `colours.html`, `sample.html` | the colour review: the six palettes side by side, with their contrast |

The main layout is fixed (owner, 2026-11-13): the map in the middle, panes left, right and bottom.

## The three directions

They differ only in how panes and panels are told apart. Every usability change is the same in all three, so the parts can be mixed: "Settings from 1, View from 3".

| | 1 · Lines | 2 · Surfaces | 3 · Cards |
|---|---|---|---|
| Pane against the map | an edge line of at least 3:1 | a 6 px gutter in the ground colour | the pane is ground; its panels float on it |
| Panel against panel | a hairline, and an accent mark on the open head | a 3 px gap, heads one tone lighter | each panel its own framed card, 6 px apart |
| Closest to today | yes | | least |
| Costs | least room | 6 px per pane | about 12 px per pane |

## The looks, made more different

Today a look sets colours, corners, shadows, heading style and the active tab. Proposed (owner, 2026-11-13: mock freely; what needs others is marked):

| | Night Watch | Chart Room | Signal |
|---|---|---|---|
| Character | quiet, cool, thin | soft, rounded, roomy | hard, square, loud |
| Corners | 3 px | 8 px | 0 |
| Buttons | outlined, clear | pills, filled | square, text-colour border, capitals |
| Tabs | underline | pill on a track | filled block |
| Field labels | text font | text font | data font, capitals |
| Open panel head | the same in every look: the soft accent tint with an accent bar and icon (the mockup bar's "Open head" also shows a full accent head and a title-only one) | | |
| Edge width | 1 px | 1 px | 2 px |

**Proposed colour changes** (the rest stay as in `docs/architecture/looks.md`):

| Token | A dark | A light | B light | B dark | C dark | C light |
|---|---|---|---|---|---|---|
| Ground | `#070e0e` | `#e4ebe9` | `#eeece3` | `#091016` | `#000000` | `#f1f1ee` |
| Pane | `#0f1a1a` | `#f2f6f5` | `#f9f8f2` | `#14202a` | `#101010` | `#ffffff` |
| Panel head, menu | `#172525` | `#ffffff` | `#ffffff` | `#1e2c38` | `#1d1d1d` | `#f4f4f0` |
| Border | `#2a3d3b` | `#bfcdca` | `#d6d2c3` | `#30424f` | `#474747` | `#8a8a85` |
| Edge (new) | `#5f7673` | `#667b77` | `#74786f` | `#6a7b86` | `#8c8c88` | `#111111` |
| Raised (new) | `#1c2c2b` | `#ffffff` | `#ffffff` | `#263746` | `#2a2a2a` | `#ffffff` |

**A dark is green-teal** (owner, 2026-11-13), so that it stands apart from B dark's navy; its other colours change with it: field border `#5f7673`, text `#e0ebe8`, muted text `#8ba39e`, accent `#45d0b5`, on accent `#03201b`, accent soft `#123631`. To watch: the teal accent is nearer the friend fill's cyan and the OK green than the violet was; the accent is for controls, and OK always carries an icon and a word.

**A light follows** (owner, 2026-11-13): green-teal surfaces, field border `#6a7f7b`, text `#121c1a`, muted text `#4f625e`, accent `#0a6b5f`, accent soft `#d3eee8`. **B light moves to warmer paper** to stay apart from it, with field border `#7b8078`.

**Two values differ in the card look** (Settings and the Monitor), and are not in the table:
- C dark's Edge is `#6c6c69` there, not `#8c8c88` (owner, 2026-11-13: the brighter line was too much). It is the same grey as C dark's field border in `tokens.css`, and 3.2:1 or more on ground, pane and panel head. The workspace (Lines) keeps `#8c8c88`.
- A dark's card frame is `#3f5855`, a step above its hairline border. It is decoration, about 2:1.

If the shell is to draw them, the Edge token needs a second, quieter value for cards, or the card look takes the field border; that is for the PDA's CR.

Contrast, computed from this table (WCAG 2): the table's edge on ground, pane and panel head is at least 3.25:1 (B dark on the panel head); text at least 10.1:1, muted text at least 4.58:1 (B dark on Raised), the accent at least 4.58:1 (C light on the ground) and OK, warning and error at least 4.55:1 (B light's OK on the ground) on all four surfaces. `mockups/colours.html` computes every value from the page and marks any below its limit; a first try with darker light grounds failed there for OK and warning, so the light grounds stay about as light as today's. The hairline border is decoration (1.4 to 3.5:1) and never the only sign of an edge.

**Needs others, if chosen:**
- new tokens Edge and Raised, a control radius, the label font and case, the tab style: the PDA (contract) and ADR-0034 (ACA), since they widen what a look may set;
- everything in `findings.md` marked CDA or PCA.

## Saving: one rule

Owner, 2026-11-13: a sticky bar and a Save per item may both be useful. The mockups follow one rule that allows both without two Saves for the same fields:

> **One Save per editing surface, pinned to the bottom edge of that surface, on the right, with the count of unsaved changes.**

- A plain page (Simulator) and a table edited in place (Data types) are one surface: the bar at the page's foot.
- An item of a list (a GMTI link) is its own surface: the bar at the foot of its form, whether the form is beside the table, in a dialog or in a folded row. The list page then has no Save of its own.
- A panel that edits (Symbol properties) is a surface too: Apply and Revert in the panel's foot.

## Choices

| Date | Question | The owner's choice |
|---|---|---|
| 2026-11-13 | The main layout | Fixed. Work on the details |
| 2026-11-13 | Saving in Settings | Both a sticky bar and a Save per item may be useful; see "Saving: one rule" (to confirm on the mockups) |
| 2026-11-13 | Long lists in Settings | Mock all three variants (side form, dialog, folded rows), once each; the final design is put together from parts of the mockups |
| 2026-11-13 | The four move buttons in a panel head | Keep as today |
| 2026-11-13 | How far the looks may differ | Mock freely; decide on what needs the PDA or the ACA after seeing it |
| 2026-11-13 | The direction for View (the workspace) | **1 · Lines** |
| 2026-11-13 | The direction for Settings and the Monitor | **3 · Cards** |
| 2026-11-13 | Lists in Settings | **Table + side form** |
| 2026-11-13 | The looks' differences (control shape, tabs, labels, edge width) | As mocked, but all colours and accents of the three looks, dark and light, are reviewed before the design is final (`mockups/colours.html`) |
| 2026-11-13 | Night Watch dark against Chart Room dark | **Night Watch goes green-teal; Chart Room stays** |
| 2026-11-13 | Night Watch light | **Follows the dark scheme fully:** green-teal surfaces and a dark teal accent; Chart Room light goes to warmer paper to stay apart |
| 2026-11-13 | Chart Room dark's accent, close to the friend fill | **Keep the light blue** |
| 2026-11-13 | Signal's orange accent | **Keep.** The owner wants changes to the card look and to the colour of selected (open) panels |
| 2026-11-13 | The open (selected) panel's head | **The soft accent head** (confirmed on the mockup the same day) |
| 2026-11-13 | Signal dark's card lines | **A darker grey:** `#6c6c69` (3.2:1 or more) instead of `#8c8c88`, in the card look |
| 2026-11-13 | Is the design final? | **Final.** Small look changes later stay in the UXA's CSS, values only |
| 2026-11-13 | May the UXA change its CSS now? | **Yes, T-205 now:** the existing tokens' values and the top bar's 1 px; the new tokens wait for SDK 1.8.0 (T-202). The 1 px turned out to be gone already (the CDA's T-113; the ITA's `m2-looks` spec checks the exact height): the UXA's screenshots measure 38 and 48 px in every look, scheme, density and workspace |

The mockups open in this mix. The follow-up tasks are on the board: T-201 (ACA), T-202 (PDA), T-203 (CDA), T-204 (PCAs), T-205 (UXA).
