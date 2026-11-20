# Usability findings

What the UXA found in the UI, and the fix for each. First pass: M7 RC3 (`c2d7dc9e`), no login, all three looks, 2026-11-13, with the owner's own remarks (marked *owner*). Screenshots of the state found are the manual's, in `documents/manual/src/images/`.

"Whose" names who would build the fix: the UXA (look), the CDA (shell markup and behaviour), a PCA (its panel), the PDA (tokens, components).

## Settings

| # | What is hard | Measured in M7 | Fix | Whose |
|---|---|---|---|---|
| S1 | Save is in a different place on every page, far from the fields (*owner*) | Save at 39 px (WMS), 1 441 px (2D map view), 1 456 px (GMTI); Data types has 8 Save rows, Layers 7 Apply buttons, Labeling a floating bar; General and Display have no Discard | One Save per editing surface, pinned to that surface's bottom edge, right-aligned, with the count of unsaved changes | CDA |
| S2 | Long pages that scroll (*owner*) | GMTI 2 673 px, Data types 2 943 px, 2D map view 1 462 px, Layers 1 432 px, at 1024 × 768 | Lists as tables, one item edited at a time; short fields side by side; Advanced folded | CDA (generated forms), PCAs (schema groups) |
| S3 | Help text drowns the fields | 1 to 3 lines under every field, regular expressions included (`Must match ^[a-z]…$`) | A short hint; the rest behind an info button | CDA, PCAs (short texts) |
| S4 | Fields that do not apply are shown greyed with a note | CoT: Address, Interface | Hide them | CDA |
| S5 | The list is 23 text rows; the unsaved dot is not explained | `settings-overview.png` | An icon per entry, a filter, a count of unsaved changes | CDA |
| S6 | List items are named "Links 1", "Projections 1" with Up, Down, Remove under each | `settings-map-view.png` | A table row with the item's own name and state | CDA |

## Panels (View and Simulation)

| # | What is hard | Fix | Whose |
|---|---|---|---|
| P1 | Every panel shows its name twice: the shell's head, then the plugin's own heading | Drop the inner heading; its buttons move to the top of the body | PCAs (PDA: say so in the design pattern) |
| P2 | Shapes, NVG, Terrain, Status and Ground truth outputs have no icon (*owner*) | An icon for every panel | PCAs |
| P3 | Symbols is a picture grid, Graphics a long text list whose tabs wrap to two lines (*owner*) | Graphics as picture tiles in folding groups, with a search field | PCA-draw-tactical |
| P4 | Long lists scroll the whole pane (*owner*) | Each open panel scrolls inside itself; search fields; folding groups | CDA, PCAs |
| P5 | Actions sit far from what they act on | A panel foot pinned at the bottom for Apply, Draw, Place | PDA (component), PCAs |
| P6 | The four move buttons squeeze the title ("SYMBOL PROPERTI…") | Owner, 2026-11-13: keep them. Mockups dim them until the head is hovered or focused | UXA |

## Look

| # | What is hard | Measured | Fix | Whose |
|---|---|---|---|---|
| L1 | Hard to see where one panel ends and the next begins, most in dark (*owner*) | Night Watch dark: border on pane 1.34:1, pane on ground 1.08:1 | An edge colour of at least 3:1 for pane edges, a tone step head/body, a visible resize grip | UXA; a new token is the PDA's |
| L2 | The three looks feel alike (*owner*) | They differ in accent, corner radius and heading case only | Each look gets its own surfaces, edges, control shape, tabs and labels | UXA; ADR-0034 (ACA) for what a look may set |
| L3 | State is plain text in every cell of the Monitor ("OK: ready") | | Chips with an icon and a word; problems first | CDA |
