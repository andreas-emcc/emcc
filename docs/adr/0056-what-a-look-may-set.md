# ADR-0056: What a look may set

- Status: Accepted (owner, UI A, 2026-11-13; T-201)
- Date: 2026-11-13
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0034 (three selectable looks) and ADR-0029 (a shared visual design system)

## Context
**What a look sets today** (ADR-0034's Consequences): colours, corner radius, shadows, the heading font and case, and the plugin sizes of the density table. The shell adds one per-look rule, the active view tab: an accent underline, an accent pill or a filled accent block (`web/README.md`, "Tokens and looks").

**The owner finds the three looks too alike** (the UXA's finding L2, `docs/ux/findings.md`). The UXA's design (T-198, `docs/ux/looks-proposal.md`, "Choices", owner, 2026-11-13) lets them differ in more:
- control shape;
- tabs;
- field labels;
- the width of edges;
- two new surfaces, Edge and Raised;
- a quieter edge value in the card look, which Settings and the Monitor use.

The proposal marks these as widening what a look may set, which needs this ADR and the PDA's CR for the new tokens (T-202).

Two rules must still hold whatever a look sets:
- **Every screen has the same parts in every look**, so that the ITA's specs and the manual's steps work in each.
- **Plugins look right in every look without knowing it** (ADR-0029 point 3, ADR-0034).

## Decision
1. **A look may set its appearance in these ways:**
   - **colours,** including two new surface tokens: **Edge**, the line that tells a pane or panel from what is behind it, at least 3:1; and **Raised**, a surface above the panel, such as a card or a menu;
   - **the width of edges** (e.g. 1 px or 2 px);
   - **the corner radius** of panes, panels and cards, and **a control radius** of its own for buttons, fields, chips and tabs;
   - **the type of headings and of field labels:** font (the text font or the data font), case, letter spacing and weight;
   - **shadows;**
   - **the shape of controls and tabs**, as in the UXA's design (e.g. outlined, filled pills, or square with capitals; an underline, a pill on a track, or a filled block);
   - **a second value of a token for the card look** (Settings and the Monitor), where the workspace and the cards need different strengths, such as a quieter Edge.
2. **How a look sets it:**
   - **through its token values** in `looks.md` and in `tokens.css`'s per-look blocks;
   - and, in the UXA's files only (`components.css`, `shell-look.css`), **through per-look rules** (`[data-look=…]`) that change only look properties, the ones `web/shell/build/shell-css.test.ts` lists as look.

   **Plugins never write per-look rules.** They read tokens, through CSS or `theme.tokens()`, and so follow every look.
3. **A look never sets:**
   - layout, positions, which parts a screen has, or their order: the layout properties of `shell-css.test.ts`'s layout list, such as display, positions, widths and heights;
   - the sizes of panes and panels, which density sets (two levels, ADR-0034 point 4). Spacing inside a part (padding, margin, gap) and type sizes are look properties, as the test's look list has them;
   - icons (one Lucide set, ADR-0034 point 6);
   - wording;
   - behaviour, the focus order or the keys.
4. **Fixed in every look:**
   - as ADR-0034 says: the APP-6 colours, the selection highlight and the background maps;
   - **the open panel's head**, the soft accent head (owner, 2026-11-13).
5. **Contrast** holds in every look, scheme and density, to WCAG 2.2 AA (`agents/uxa.md` rule 4). An edge or a state is never shown by a hairline or a colour alone.
6. **ADR-0034 stands otherwise:** three looks, each in light and dark, chosen per user, with an admin's default.

## Alternatives considered
- **Looks as colours only** (today): cheap, but the owner finds the looks too alike (L2).
- **Free CSS per look:** looks could also move or resize parts, which would break the ITA's specs and the manual's steps per look and make plugins look wrong in some looks.
- **A token for every style choice, e.g. "tab style: underline":** the choices would sit in the SDK's contract, and every new style would need a CR. Per-look rules in the UXA's two files keep the contract to what plugins must read.

## Consequences
- **PDA (T-202, the CR):**
  - the new tokens: Edge, Raised, the control radius, the field label's font and case, and the card values;
  - the panel foot, chips and tiles of the UXA's design;
  - the design pattern's "name once, icon always".

  The token names are the PDA's; this ADR names them only by what they do.
- **UXA (T-205):**
  - the values in `looks.md` and `tokens.css`, in one commit;
  - the per-look rules in `components.css` and `shell-look.css`.

  New tables or rows in `looks.md` go through the CDA, whose `tokens.test.ts` reads them (`agents/uxa.md` rule 6).
- **CDA:** the tests' new rows for the new tokens; markup for the panel foot and the card look (T-203).
- **PCAs:** nothing for the look itself. Their panels follow the tokens. A PCA that draws on canvas reads the new tokens if it uses them.
- **The conformance reviewer:**
  - fails a per-look rule (`[data-look`) in CSS under `web/` and `plugins/` outside `tokens.css`, `components.css` and `shell-look.css`;
  - fails a per-look rule in the last two that sets a property outside the test's look list.

  The UXA's mockups in `docs/ux/` are exempt.
- **ITA:** each look in light and dark still loads cleanly, and no spec depends on a look.
- **UDA and DMA:** screenshots in the looks they show; a changed look means retaking them.
