# ADR-0031: The workspace: a top bar, a settings list, docked panes and saved setups

- Status: Accepted (owner, 2026-10-14)
- Date: 2026-10-14
- Deciders: Owner (advised by the ACA)
- Supersedes: ADR-0026 (the shell's workspace: a top bar with views, and docked panes with movable panels)

## Context
ADR-0026 gave the shell a top bar with view tabs, one more tab per plugin with runtime settings, and docked panes with movable panels. M1 built the top bar and the plugin tabs. M2 ("Beautify") builds the rest.

Planning M2 in detail, the owner changed two parts (2026-10-14, after the M2 feasibility study):
- **Plugin settings move into a list inside the Settings tab.** One tab per plugin fills the top bar as plugins are added.
- **User settings are saved in two ways:** the current setup is remembered automatically, and users can save named setups and restore them. ADR-0026 had only the first.

The owner also wants an admin to change a layer's classification from the Settings tab, with a question whether to raise the objects of the layer too.

The rest of ADR-0026 stands. This ADR repeats its decisions and alternatives, so that it can be read on its own.

## Decision
1. **A top bar runs across the page.**
   - **Left: view tabs**, in this order:
     - **View:** the map and its panes;
     - **Settings:** the general settings and every plugin's runtime settings (point 2);
     - **Monitor:** the monitor view.
   - **Settings and Monitor need the admin permission** (`settings.admin`). Other users see only View. In the no-login mode the local user has every permission (ADR-0022).
   - **Right, from left to right:** items from plugins (first the bookmarks control), the setups control (point 5), the clock, and the logout button.
     - The clock shows UTC (Zulu, as a date-time group) by default. Local time is each user's choice.
     - Without login, the logout button is replaced by the "No login" mark (ADR-0022).
2. **The Settings tab is a list on the left, and the chosen entry on the right.**
   - The list starts with the general entries: **General** (the web application's general settings; reserved until there are any), **Data types** (ADR-0023) and **Layers** (point 3). Then comes **one entry per plugin** with settings that can change at runtime.
   - For a plugin, the right side shows the form the shell draws from the settings the plugin declares, or the plugin's own settings panel.
   - **A plugin's settings form is a self-contained panel**, so that it can later be shown elsewhere in the shell as well.
   - The server checks `settings.admin` for every change of settings (overview 4.11); hiding the tab is not the protection.
3. **Layers: an admin changes a layer's classification**, and is asked whether to raise the objects of the layer.
   - On "yes", every object of the layer whose classification is lower is raised to the layer's.
   - **Only the classification changes.** The rest of each label stays as it is.
   - **"Lower" follows the NATO order of classifications, from configuration.**
   - **Objects created by plugins are raised too.** The next update from their source may bring the source's label back.
   - **For now the change is cosmetic.** Labels do not limit access until access by label comes (ADR-0020).
4. **The View tab has the Map Pane in the middle, and a left, a right and a bottom pane.**
   - The panes are docked: the Map Pane shrinks and grows with them, nothing overlaps the map.
   - Each pane has a handle to resize it and a button to collapse it. A collapsed pane leaves a button to expand it again.
   - **The left and right panes** show their panels from top to bottom. Each panel collapses and expands on its own, so that the user can scroll on down the pane.
   - **The bottom pane** shows one panel at a time, with a tab for each of its panels.
   - **Every panel has buttons that move it** to the left, the right or the bottom pane.
   - **Plugins register panels with a default pane.** Panels must work in every pane, both narrow and tall, and wide and low.
5. **Setups: the user's arrangement is saved in two ways**, per user on the server (ADR-0027).
   - **Remembered automatically:** the current setup is saved as the user works, and restored at the next start.
   - **Named setups:** the user saves the current setup under a name, and restores any saved setup later, through the setups control in the top bar.
   - **A setup holds:**
     - the panel layout (which pane holds each panel, the order, the sizes, what is collapsed);
     - the visibility of each layer (the layer panel's eye, which stays local to the user);
     - the map type (projection and background), the centre, the zoom and the dim level;
     - the clock choice.
   - **Bookmarks are lighter than setups:** a bookmark holds only the map type, the centre and the zoom.
6. **Plugins may add items to the right of the top bar** through the web SDK. Only small controls go there, such as the bookmarks menu.
7. **Planning** (overview section 6; the milestones are planning, not part of this decision): M1 built the top bar, the view tabs and one tab per plugin. M2 replaces the plugin tabs with the settings list, and adds the Layers entry, the panes, moving panels, the plugin items, the setups and the clock.

## Alternatives considered
- **Keep one tab per plugin** (ADR-0026): the top bar fills up as plugins are added, and general and plugin settings sit in different places.
- **Plugin settings as panels in the View tab:** admin settings would mix with the work on the map, and need room the side panes do not have.
- **Setups remembered automatically only** (ADR-0026): no way to keep a setup for a recurring task, such as an Arctic overview.
- **Setups saved only by hand:** a reload or a closed browser would lose any arrangement not yet saved.
- **Changing the whole label of a layer's objects:** other parts of a label, such as releasability, need rules of their own. Only the classification changes for now (owner, 2026-10-14).
- From ADR-0026:
  - **Keep one Control Pane:** simple, but crowded as plugins are added, and the user cannot arrange the work.
  - **Floating windows over the map:** flexible, but they cover the map, are hard to arrange on small screens, and need window management.
  - **Settings in dialogs over the map:** the plugin settings (lists of endpoints and links) need room, and a dialog hides the picture anyway.
  - **Saving the layout in the browser:** it would not follow the user to another computer (ADR-0027).

## Consequences
- **Web SDK 1.x (PDA, through a change request):**
  - panel registration with a default pane (today's `ui.addControlPanel` maps to the right pane), and the top bar item slot;
  - a plugin's settings entry, from its declared settings or its own panel (it replaces ADR-0026's "settings tab");
  - a way for each part to save and restore its share of a setup: the shell its panes and the clock, the map view the map and the layers' visibility;
  - setting the map's projection, background and dim level, for setups and bookmarks.
- **Shell (CDA):**
  - rework M1's plugin tabs into the settings list;
  - the setups and their control, kept as the user's documents under ECore's own namespace (`core`, ADR-0027);
  - the panes and the clock;
  - **the Layers entry:**
    - the order of classifications as configuration;
    - the server query for a layer's objects, since the browser may not hold them all;
    - the changes as ordinary change requests with the shell's own `source.plugin` (ADR-0032), in batches within the session's limit on waiting requests (`server/live-picture-protocol.md`);
    - its controls follow the admin's `layers.edit` and `objects.edit`, so that it offers only what the server will accept.
- **The Layers entry is admin-only in the shell, like the whole Settings tab.** The server checks `layers.edit` and `objects.edit` on each change request (overview 4.4), as for any change. A user with those permissions could make the same changes one at a time.
- **A raise is an ordinary update:** the whole object as the shell last received it, with only the classification changed (last write wins, overview 4.4). A live object, such as a TAK track, may move in between; its newer position then comes back with its next update.
- **Existing plugins (PCAs):** their panels must work in every pane; `map-view-2d` saves and restores its share of a setup.
- **ITA:** flows for the settings list, the Layers entry, moving and resizing panels, and setups surviving a reload and another browser. Tests that open a plugin's tab (`#plugin/<id>`) change with the settings list.
- **The overview** (4.9 and 4.11) records the classification order as configuration; the security policy definitions for access by label remain later work.
- The look of the workspace follows the shared design system (ADR-0029).
