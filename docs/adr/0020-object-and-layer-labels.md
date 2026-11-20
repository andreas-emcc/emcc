# ADR-0020: Access to an object requires clearance for its label and its layer's label

- Status: Accepted (owner, 2026-10-05)
- Date: 2026-10-05
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0007 (common data model)

## Context
Every object and every layer carries a STANAG 4774 confidentiality label (ADR-0007). In data model v0 the two are independent: an object's label covers the object, a layer's label covers the layer's own data (name, order), and no rule relates them. Label-based access control comes later (M1, with Keycloak). Before then it must be clear how the two labels combine, so that nothing built now has to be redesigned or migrated.

## Decision
1. **A user sees an object only if cleared for both the object's label and the label of the layer it belongs to.** Seeing covers the live picture (snapshot and change events), queries and exports on the user's behalf.
2. **A user sees a layer** (its name, order and existence) only if cleared for the layer's label.
3. **No constraint on stored labels.** An object's label may be lower than, higher than or different from its layer's label. There is no validation rule, so existing data never needs a migration.
4. **Changing an object** requires seeing it (point 1) and the permission to edit (overview 4.9). Creating an object in a layer requires seeing that layer.
5. Clearance is decided per security policy, from the user's attributes in the IAM and a security policy definition (classification order and categories, in the style of a SPIF), held as configuration (overview 4.9).

## Alternatives considered
- **The object's label alone:** simpler, but a layer marked SECRET could reveal nothing by its name while still showing all its objects to anyone cleared for each object, which surprises users who think of a layer as a container.
- **The layer's label must dominate the object's (enforced on write):** an object could never be more sensitive than its layer, which makes a single "mixed" layer impossible, and it adds a validation rule that stored data would have to satisfy (a migration when introduced).
- **The higher of the two labels, combined into one:** needs an order between arbitrary labels and categories, which policies do not always define; "cleared for both" gives the same result where an order exists.

## Consequences
- **Live picture gateway (M1):** filters snapshots and deltas per user on both labels. A change of a **layer's** label, or an object moving to another layer, changes the visibility of many objects at once. The gateway must then send removals and additions to the affected sessions; one change event on the layer is enough as input, because the gateway knows each layer's objects.
- **Change rejections** must not reveal entities the requester cannot see (ADR-0018): answer as if they did not exist.
- **Outgoing plugins** (`cot-out`, NVG export, M1 and later) send data outside the system and must apply the same rule for the receiving side's clearance; how that clearance is configured is decided with those plugins.
- **History (later):** whether playback evaluates the labels as they were at the time of an event or as they are now is decided when history is designed.
- The data model needs no change: `model/README.md` replaces its sentence "Label-based access control (later) will decide whether one must dominate the other" with a reference to this ADR (PDA).
