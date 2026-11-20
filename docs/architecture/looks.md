# The three looks

Reference values for the looks the owner chose on 2026-10-15 (T-055, ADR-0034). The PDA turns them into the web SDK's design tokens (T-049), the CDA into the shell's token sets (T-052). Names and values may be adjusted while building, as long as the contrast below still holds.

The owner saw all six palettes in the ACA's mockups (each look in light and dark). After checking contrast, the ACA adjusted a few values and added the field border; they are listed under "Adjusted by the ACA" below.

## What a look sets

| | A · Night Watch | B · Chart Room | C · Signal |
|---|---|---|---|
| Made for | Dim operations rooms, long shifts | Daylight, briefings, projectors | A distinct console look |
| Default density | Compact | Comfortable | Compact |
| Corners | 2 px | 6 px | 0 px |
| Shadows | None | Map controls and cards: `0 1px 2px rgba(20,30,40,0.10), 0 2px 8px rgba(20,30,40,0.08)`; menus: `0 8px 24px rgba(20,30,40,0.18)` | None; menus get a 1 px border only |
| Panel headings | Capitals at the text size, letter spacing 0.06 em, weight 600 | Sentence case at the text size, weight 600 | Capitals at the text size, letter spacing 0.1 em, weight 700, in the heading font |
| Active view tab | Accent underline, 2 px | Accent pill on Accent soft | Filled Accent block |
| Edges | 1 px | 1 px | 2 px |
| Control corners (buttons, chips, tabs) | 2 px | 999 px (pills) | 0 px |
| Field labels | The text font, sentence case | The text font, sentence case | The data font in capitals, letter spacing 0.04 em |

**In every look:**
- **Focus:** a 2 px outline in the accent colour, 2 px outside the element.
- **Hover:** list rows and menu items take a faint tint of the text colour (6 %); selected rows take Accent soft, so the two stay apart. Buttons move 8 % towards the text colour.
- **Disabled:** muted text, no hover, 60 % opacity on icons.
- **Dialog backdrop:** `rgba(0,0,0,0.45)`.

**Fonts** are the computer's own; nothing is bundled (ADR-0029):
- text: `'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif`;
- data (coordinates, date-time groups, counts): `'Cascadia Mono', Consolas, ui-monospace, 'SF Mono', monospace`;
- C's headings: `Bahnschrift, 'DIN Alternate', 'Arial Narrow', sans-serif`.

Segoe UI Variable and Bahnschrift come with Windows 10 and later. Other systems use the fallbacks; on Linux, C's headings end in the generic sans-serif. Visual checks must allow for that.

## Colours

| Token | A dark | A light | B light | B dark | C dark | C light |
|---|---|---|---|---|---|---|
| Ground | `#070e0e` | `#e4ebe9` | `#eeece3` | `#091016` | `#000000` | `#f1f1ee` |
| Pane | `#0f1a1a` | `#f2f6f5` | `#f9f8f2` | `#14202a` | `#101010` | `#ffffff` |
| Panel head, menu | `#172525` | `#ffffff` | `#ffffff` | `#1e2c38` | `#1d1d1d` | `#f4f4f0` |
| Border | `#2a3d3b` | `#bfcdca` | `#d6d2c3` | `#30424f` | `#474747` | `#8a8a85` |
| Field border | `#5f7673` | `#6a7f7b` | `#7b8078` | `#667781` | `#6c6c69` | `#262626` |
| Text | `#e0ebe8` | `#121c1a` | `#1c2830` | `#e4ebee` | `#f4f4f2` | `#111111` |
| Muted text | `#8ba39e` | `#4f625e` | `#57666c` | `#90a1aa` | `#a6a6a0` | `#545450` |
| Accent | `#45d0b5` | `#0a6b5f` | `#1f4e79` | `#86b8e8` | `#ff7a1a` | `#c2410c` |
| On accent | `#03201b` | `#ffffff` | `#ffffff` | `#0b1a28` | `#1a0b00` | `#ffffff` |
| Accent soft (selected rows) | `#123631` | `#d3eee8` | `#dce7f1` | `#1c3248` | `#3a2410` | `#fdefe5` |
| OK | `#4cc38a` | `#1c764a` | `#2c784c` | `#5dc48a` | `#62d196` | `#1e7a47` |
| Warning | `#e5a84b` | `#8e5c0a` | `#8f5f0b` | `#e2ad55` | `#f2c14e` | `#8a6100` |
| Error | `#f2776b` | `#b3261e` | `#a83229` | `#ee8379` | `#ff6b5e` | `#b42318` |
| Edge | `#5f7673` | `#667b77` | `#74786f` | `#6a7b86` | `#8c8c88` | `#111111` |
| Edge in cards | `#5f7673` | `#667b77` | `#74786f` | `#6a7b86` | `#6c6c69` | `#111111` |
| Raised | `#1c2c2b` | `#ffffff` | `#ffffff` | `#263746` | `#2a2a2a` | `#ffffff` |

**Adjusted by the ACA:**
- every field border (new, for 3:1);
- A light's OK and Warning, and B light's OK (they were below 4.5:1 on the ground);
- C light's Accent soft (accent text on it was below 4.5:1).

**Changed by the UXA** (T-205; the owner's choices of 2026-11-13, `docs/ux/looks-proposal.md`):
- **A is green-teal** in dark and light, with a teal accent, so that it stands apart from B dark's navy: all of A's colours but OK, warning and error, and A light's white panel head and on accent;
- **B light is warmer paper,** to stay apart from A light: ground, pane, border and field border;
- **B dark, C dark and C light:** surfaces a step further apart, so that panes and panels are easier to tell apart: ground, pane, panel head and border (C light: panel head and border).

**Added with SDK 1.8.0** (CR-0043, ADR-0056; the values the UXA's):
- **Edge:** the line that tells a pane or panel from what is behind it;
- **Edge in cards:** the same in the card look (Settings and the Monitor); quieter in C dark (owner, 2026-11-13);
- **Raised:** a surface above the panel, such as a tile, a card or a menu.

**Contrast (WCAG 2), computed by the UXA from this table:**
- text, muted text, accent, OK, warning and error on ground, pane and panel head: at least 4.5:1. The lowest pair is B light's OK on the ground, 4.55;
- text, muted text and accent on Accent soft (selected rows): at least 4.5:1. The lowest is C light's accent, 4.60;
- on accent on accent: at least 5.18 (C light);
- field border on ground, pane and panel head: at least 3.07:1 (B dark on the panel head).
- Edge on ground, pane and panel head: at least 3.25:1 (B dark on the panel head); Edge in cards at least 3.20:1 (C dark on the panel head);
- text, muted text, accent, OK, warning and error on Raised: at least 4.5:1. The lowest is B dark's muted text, 4.58.

Status colours are best kept off Accent soft: in a selected row, the lowest is B light's OK at 4.30:1. A state never shows by colour alone.

**Fixed in every look and theme:**
- the APP-6 affiliation fills, drawn by the symbology plugin: friend `#80e0ff`, hostile `#ff8080`, neutral `#aaffaa`, unknown `#ffff80`;
- the selection highlight `#ffd400`.

**How the accents stand apart from them.** The accent colours are for the controls, never for the map, so a mix-up costs little. Still:
- **A's** teal sits between the friend fill's cyan and the neutral fill's green, darker than both in light and about as light as the friend fill in dark; only its hue tells them apart.
- **B dark's** light blue is close in hue to the friend fill.
- **C's** orange sits between hostile red and unknown yellow:
  - in C light it is darker than both;
  - in C dark it is about as light as hostile red, and only its hue tells them apart.

## Density

Two levels. Each look has a default, and the user may switch. The **Plugin token** column says which sizes plugins use; the others are the shell's own. Pane sizes are only the defaults: sizes the user has set are saved with the setup and do not change with the density.

| Size | Compact | Comfortable | Plugin token |
|---|---|---|---|
| Text | 12.5 px | 14 px | yes |
| Small text | 11 px | 12 px | yes |
| Row (list, table, menu item) | 26 px | 34 px | yes |
| Input field height | 26 px | 34 px | yes |
| Padding | 8 px | 12 px | yes |
| Gap | 6 px | 10 px | yes |
| Icon | 16 px | 18 px | yes |
| Panel head | 28 px | 36 px | shell |
| Top bar | 38 px | 48 px | shell |
| Default pane widths: left, right | 248 px, 288 px | 268 px, 312 px | shell |
| Default bottom pane height | 170 px | 188 px | shell |

Density changes the controls, not the map: symbol and label sizes on the map stay the map view's own.

## Icons

One set for every look: [Lucide](https://lucide.dev). Its licence is ISC, with parts under MIT from Feather; both are allowed for shipped code (`CLAUDE.md` section 4). Plugins get the icons through the web SDK's icon component, whose version the SDK lists with its shared libraries. They are line icons in the current text colour, at the density's icon size, with an absolute stroke width of 1.75 px, so they do not turn thin at small sizes.
