# ADR-0034: Three selectable looks

- Status: Accepted (owner, 2026-10-15)
- Date: 2026-10-15
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0029 (a shared visual design system in the web SDK), ADR-0031 (the workspace: setups)

## Context
ADR-0029 left the visual style to be chosen with the owner during M2 (T-055). The ACA showed the owner three directions on the same workspace:
- **Night Watch:** dark, compact, a violet accent, flat;
- **Chart Room:** light, comfortable, a navy accent, soft shadows;
- **Signal:** dark, high contrast, a signal-orange accent, square.

Each fits a different use, and the owner wants users to choose between them (2026-10-15).

ADR-0029 already makes this cheap. All colours, sizes and corner radii come from design tokens that the shell provides, and plugins may not use fixed colours. A look is then a set of token values, and switching looks swaps them.

## Decision
1. **emc2 ships three looks: Night Watch, Chart Room and Signal, each in light and dark.** Their values are in `docs/architecture/looks.md`.
2. **Each user chooses the look**, saved with their setups (ADR-0031). **An admin sets the installation's default look** in Settings › General (ADR-0031), for users who have not chosen one.
3. **Light or dark follows the computer's setting** unless the user picks one.
4. **Density is a setting of its own, with two levels:** compact and comfortable. Each look has a default, and the user can change it.
5. **The background maps do not change with the look**; dimming stays the user's (ADR-0031).
6. **One icon set for every look:** Lucide.

## Alternatives considered
- **One look for everyone:** simpler to test, but no look suits both a dim operations room and a projector in daylight.
- **Looks as an installation setting only:** users who share an installation work in different rooms and roles.
- **Three density levels, one per look:** 18 combinations of look, theme and density to test, against 12 with two levels.
- **Recolouring the background maps with the look:** OpenStreetMap tiles are images and cannot follow it.

## Consequences
- **The settings and where they live** (the ACA's design):
  - a setup holds three values:
    - the look: the installation default, or one of the three;
    - light or dark: the computer's setting, light, or dark;
    - the density: the look's default, compact, or comfortable.
  - A setup that keeps "the installation default" follows the admin's later changes.
  - Before the user's setup has loaded, the shell shows the installation default, light or dark as the computer says.
  - The default look is kept with ECore's settings. Every logged-in user's shell can read it, and only `settings.admin` changes it.
  - **A change applies at once, without a reload:** the shell swaps the token values.
- **Defaults per look:** Night Watch and Signal compact, Chart Room comfortable (`looks.md`).
- **Fixed in every look:** the APP-6 affiliation colours and the selection highlight, as the map view and the symbology plugin draw them today.
- **Plugins take colours, fonts, sizes, spacing, corner radii and shadows from the tokens only.** This follows from the looks and the densities, and extends ADR-0029 point 3 from colours. A plugin's own CSS only arranges its content.
  - The conformance reviewer's check (T-057) looks in plugin CSS for literal values in colour properties, `font-family`, `font-size`, `line-height`, `padding`, `margin`, `gap`, `height`, `border-radius` and `box-shadow`.
  - It does not count `0`, percentages, `auto` or 1 px hairlines.
- **Web SDK 1.x (PDA, T-049):**
  - the token list covers what the looks change: colours (including a field border), corner radius, shadows, the heading font, case, letter spacing and weight, and the plugin sizes of `looks.md`'s density table;
  - an icon component for Lucide, whose version the SDK lists with its shared libraries;
  - a way to read the current token values, and an event when the look, light or dark, or density changes. The map view needs both for what it draws in canvas, such as label text.

  Plugins read tokens; they never choose a look.
- **Shell (CDA, T-052):**
  - three token sets in light and dark, and two density sets;
  - the three values in the user's setups;
  - the default look in Settings › General.
- **Plugins (PCAs):** each checks its panels in both densities and in at least one light and one dark look. Density does not change the map's symbols or labels.
- **Third-party notices (MCA):** Lucide's licence (ISC, with Feather's MIT parts) through the notices tool and the licence check.
- **ITA:**
  - each look in light and dark loads cleanly (a visual check, allowing for the fonts' fallbacks on Linux);
  - switching the look, light or dark, and the density applies without a reload;
  - the admin's default reaches a user who has not chosen;
  - "light or dark" follows the computer (an emulated colour scheme);
  - the choice survives a reload and another browser.
