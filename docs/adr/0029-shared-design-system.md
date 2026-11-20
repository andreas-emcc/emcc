# ADR-0029: A shared visual design system in the web SDK

- Status: Accepted (owner, 2026-10-10)
- Date: 2026-10-10
- Deciders: Owner (advised by the ACA)

## Context
M2 ("Beautify", owner 2026-10-10) makes the web application look and work better. With movable panels, panels from different plugins sit side by side and move between panes (ADR-0026). Plugins also add items to the top bar and fill settings tabs.

Today the shell gives plugins four colour tokens (`--shell-fg`, `--muted`, `--pane-border`, `--control-pane-bg`), which the design pattern asks them to use. The tokens are not part of the SDK contract, and every plugin builds its own buttons, lists and forms. The result would look uneven.

## Decision
1. **The web SDK defines design tokens as part of its contract:**
   - colours for light and dark mode;
   - a type scale, spacing, corner radii and elevation;
   - a focus style, and an icon set.

   The shell provides them as CSS custom properties. Their names are versioned with the SDK: renaming or removing one is a breaking change.
2. **The web SDK offers a small set of shared React components** for the common parts: a panel frame and header, button and icon button, list and list row, form fields, tabs, a menu (used for the object actions, ADR-0028) and a confirmation dialog.
   - They use only the tokens.
   - Their CSS ships with the shell. This is a separate mechanism from plugin CSS: each plugin still bundles its own CSS and shares none of it (spike S4, recommendation 13).
3. **Plugins build their UI from these components and tokens.** Their own CSS only arranges content inside their panels. Fixed colour values in plugin CSS are not allowed.
4. **Everything is bundled** (ADR-0014): no remote fonts, icons or styles.
   - The icon set needs a licence from the list in `CLAUDE.md` section 4.
   - Fonts are system fonts unless a change request allows a font licence. The common SIL Open Font License (OFL-1.1) is not on the list.
5. **The visual style itself is chosen with the owner** during M2: the palette, the density and how panels and the top bar look. The SDK's components may build on an accessible "headless" component library, if one meets the licence rules. Such a library joins the SDK's list of shared libraries.

## Alternatives considered
- **Keep the four tokens:** no work, but an uneven look, and every plugin rebuilds the same controls.
- **A complete third-party component library with its own look** (for example Material UI): fast, but large, with its own styling system and a look that is hard to change. It also becomes a contract every plugin depends on.
- **A style guide only, without shared components:** cheaper for the SDK, but each PCA still builds its own controls, and they drift apart.

## Consequences
- **Web SDK (PDA):** the token list, the components and the icon set, and an update of the design pattern. These are compatible additions to SDK v1, except a token rename later.
- **Shell (CDA):** provides the tokens and the components' CSS, and uses them in the top bar and panes.
- **Existing plugins (PCAs):** move their panels to the components and tokens.
- **The conformance reviewer** gets a check for fixed colours in plugin CSS once the tokens exist (ACA).
- The look stays consistent as third-party plugins arrive.
