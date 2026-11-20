# ADR-0010: milsymbol for symbology, APP-6 B/D/E

- Status: Accepted
- Date: 2026-10-02
- Deciders: Owner

## Context
The application must draw military symbols according to APP-6. The owner prefers milsymbol from Spatial Illusions, which has proven fast and robust. APP-6 C is not needed for now.

## Decision
- Single-point symbols are drawn with **milsymbol** (Spatial Illusions, MIT license), wrapped by the `symbology` utility plugin.
- Supported standards: **APP-6 B, APP-6 D and APP-6 E**. APP-6 C is out of scope for now.
- Other plugins request symbols through the `symbology` plugin's SDK-facing interface, not by calling milsymbol directly. This allows caching and a later change of renderer.
- **Multipoint tactical graphics are not covered by this ADR.** milsymbol only draws single-point symbols, and Spatial Illusions' multipoint library (milgraphics) is unfinished and archived. A separate ADR follows spike S1.

## Alternatives considered
- **mil-sym-ts (US Army renderer):** covers single-point and multipoint symbols for MIL-STD-2525. Not chosen for single-point symbols, because of the owner's preference and milsymbol's proven speed. It remains a candidate for multipoint graphics (spike S1).

## Consequences
- Fast, robust single-point symbols.
- Multipoint graphics remain the largest technical risk until spike S1 is done.
- milsymbol renders according to APP-6 E style since its version 3. Symbols coded in B or D are drawn as close to that style as possible.
