# ADR-0026: The shell's workspace: a top bar with views, and docked panes with movable panels

- Status: Superseded by ADR-0031 (owner, 2026-10-14)
- Date: 2026-10-10
- Deciders: Owner (advised by the ACA)

## Context
The M0 shell has a Map Pane and one Control Pane on the right, where plugins add panels. M1 adds a settings view and a monitor view, both named in `requirements.md`. The owner wants a workspace that looks and works better (milestone M2, "Beautify", owner 2026-10-10):
- a **top bar** across the page, with tabs that switch between whole views, and items on its right;
- a **left, right and bottom pane** around the map, which users resize, collapse and expand, with panels they can move between them;
- **one tab per plugin** whose server settings can be changed, such as WMS endpoints or CoT links. The tab shows that plugin's settings only.

## Decision
1. **A top bar runs across the page.**
   - **Left: view tabs**, in this order:
     - **View:** the map and its panes;
     - **Settings:** the general settings of the web application, including the settings per data type (ADR-0023);
     - **Monitor:** the monitor view;
     - **one tab per plugin** with settings that can change at runtime.
   - A plugin's tab shows only that plugin's settings. The shell draws them from the settings the plugin declares, as a generated form, or shows the plugin's own settings panel.
   - **Settings, Monitor and the plugin tabs need the admin permission** (`settings.admin`). Other users see only View. In the no-login mode the local user has every permission (ADR-0022).
   - **Right, from left to right:** items from plugins (first the bookmarks control), the clock, and the logout button.
     - The clock shows UTC (Zulu, as a date-time group) by default. Local time is each user's choice.
     - Without login, the logout button is replaced by the "No login" mark (ADR-0022).
2. **The View tab has the Map Pane in the middle, and a left, a right and a bottom pane.**
   - The panes are docked: the Map Pane shrinks and grows with them, nothing overlaps the map.
   - Each pane has a handle to resize it and a button to collapse it. A collapsed pane leaves a button to expand it again.
   - **The left and right panes** show their panels from top to bottom. Each panel collapses and expands on its own.
   - **The bottom pane** shows one panel at a time, with a tab for each of its panels.
   - **Every panel has buttons that move it** to the left, the right or the bottom pane.
3. **Plugins register panels with a default pane.** The user's layout (which pane holds each panel, the order, the sizes, what is collapsed) is saved per user (ADR-0027) and restored at the next start.
4. **Panels must work in every pane**, both narrow and tall, and wide and low.
5. **Plugins may add items to the right of the top bar** through the web SDK. Only small controls go there, such as the bookmarks menu.
6. **Planning** (overview section 6; the milestones are planning, not part of this decision):
   - M1 builds the top bar with its view tabs, together with the settings and monitor views, so they are not built twice. Logout and the "No login" mark also come in M1, because the login does (ADR-0022).
   - M2 adds the panes, moving panels, the plugin items and the clock on the right, and the saved layout.

## Alternatives considered
- **Keep one Control Pane:** simple, but crowded as plugins are added, and the user cannot arrange the work.
- **Floating windows over the map:** flexible, but they cover the map, are hard to arrange on small screens, and need window management.
- **Settings in dialogs over the map:** the plugin settings (lists of endpoints and links) need room, and a dialog hides the picture anyway.
- **Saving the layout in the browser:** it would not follow the user to another computer (ADR-0027).

## Consequences
- **Web SDK (PDA):**
  - panel registration with a default pane (today's `ui.addControlPanel` maps to the right pane);
  - the top bar item slot;
  - a plugin's settings tab, from its declared settings or its own panel.
  - These are compatible additions to SDK v1, except where the M1 design already includes them.
- **Shell (CDA):** the top bar, the views, the panes and the saved layout.
- **Existing plugins (PCAs):** their panels must work in the narrow side panes and in the low bottom pane. The design pattern says so (PDA).
- **ITA:** flows for the tabs, moving and resizing panels, and the layout surviving a reload and another browser.
- The look of the workspace follows the shared design system (ADR-0029).
