# ADR-0047: Vessel symbols, a second symbol set beside APP-6

- Status: Accepted (owner, GR, 2026-11-05; its decision points approved with the M5 plan, GQ)
- Date: 2026-11-05
- Deciders: Owner (advised by the ACA; T-139 and T-140, GK and GL; `docs/architecture/m5-plan.md`, A5)
- Extends: ADR-0007 (the common data model) and ADR-0010 (symbology)

## Context
`ais` draws every vessel as an APP-6 sea surface symbol. That shows the identity, but not what kind of ship it is.

The owner wants vessel symbols in the style of vessel-tracking web pages (T-139, 2026-11-05):
- a pointed hull, rotated by the ship's heading;
- coloured by the AIS ship type;
- drawn by emc2 itself, with no copied artwork (GK).

They are a symbol set beside APP-6:
- **for AIS links,** where they are the default for new links (T-140, GL);
- **for `draw-symbols`.**

They are sent out as CoT as a surface unit of their identity.

The data model's `symbol.standard` allows only APP-6B, APP-6D and APP-6E today, and its `sidc` follows the standard.

## Decision
1. **A new symbol standard, `vessel`,** in data model 1.4.0, beside the APP-6 standards.
2. **Its code is the AIS ship and cargo type, 0 to 99** (ITU-R M.1371), from the AIS data or chosen by the user. The PDA's CR decides where the code is stored.
3. **The identity is kept,** as for APP-6 (friend, hostile, neutral, unknown and so on). It is used for CoT and in lists, and is shown in the drawing as `symbology`'s brief says.
4. **The drawing is emc2's own** (GK):
   - a pointed hull along the object's `direction`;
   - a separate mark when no direction is known, or the ship is not moving;
   - the fill by ship-type group (cargo, tanker, passenger, fishing, pleasure craft, high-speed craft, tug and special craft, other, unknown).

   The group colours are fixed in every look, like APP-6's affiliation colours (ADR-0034).
5. **`symbology` draws vessel symbols behind its service** (ADR-0010). Other plugins ask it for them, as for APP-6 symbols.
6. **`draw-symbols` offers vessel symbols** beside the APP-6 categories (GK).
7. **In `ais`, the symbol type is a setting per link** (T-140):
   - vessel symbols, the default for new links (GL);
   - or APP-6, as today.

   Existing links keep APP-6 until the admin changes them.
8. **Out:** `cot` sends a vessel symbol as a surface unit of its identity, for example `a-f-S` or `a-h-S`. An output that cannot carry vessel symbols maps them the same way, or skips them and counts them (ADR-0037 point 7). Incoming CoT stays APP-6.
9. **The display settings apply as for APP-6** (ADR-0046): size, labels and the speed vector.

## Alternatives considered
- **APP-6 only:** nothing new to build, but the ship type does not show at a glance, which the owner wants.
- **The ship type as an APP-6 modifier:** it stays within one standard, but milsymbol cannot draw it as a hull, and it would not look like the owner's model.
- **Copying a tracking site's artwork:** quick, but under someone else's copyright (GK).

## Consequences
- **Data model 1.4.0, part 3 (PDA):** the `vessel` standard and its code, with the checks.
- **Plugins:**
  - `symbology` draws the symbols (PCA-symbology);
  - `draw-symbols` offers them;
  - `map-view-2d` rotates and selects them as other symbols;
  - `cot` maps them out;
  - `ais` gets the setting per link.
- **ITA:** an AIS link with vessel symbols; a vessel symbol sent as CoT; the colours in every look.
