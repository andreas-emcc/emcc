# symbology

The single place where APP-6 symbols are understood and drawn (ADR-0010, T-021). Owner: PCA-symbology. Brief: `docs/plugins/briefs/symbology.md`. Web part only, on SDK v1 (`sdkVersion` `^1.1.0` since SDK 1.1.0; moved to v1 in T-042).

## What it does

Provides the `SymbolService` (`emc2.symbols`). Other plugins use it instead of milsymbol, so that images are cached and the renderer can change later.

- **`render({ standard, sidc, modifiers?, size, withText?, labels? })`** draws a symbol with milsymbol 3.0.4 on a canvas, or a `vessel` symbol as emc2's own drawing (see "Vessel symbols"). It returns the image, its width and height, and the anchor: the pixel that belongs at the object's position.
  - **Colours:** the four affiliation fills of `docs/architecture/looks.md`, the same in every look: friend `#80e0ff`, hostile `#ff8080`, neutral `#aaffaa`, unknown `#ffff80` (T-125, owner, 2026-10-31). Civilian symbols take their identity's fill, not milsymbol's civilian purple from MIL-STD-2525. Suspect is hostile red with version 13 too, not milsymbol's 2525E suspect colour; such a SIDC is drawn as version 14, the only difference milsymbol makes between the two.
  - `size` is milsymbol's `size` option: the frame of a land unit is about `size` pixels high. The image is larger when echelons, a direction arrow or text are drawn. `size` must be from 4 to 256 (`MIN_SIZE`, `MAX_SIZE`); any other value is a `RangeError`. Below 4 the image is a few pixels, and below 1 it is empty.
  - Images are cached by appearance. The key is the standard, the canonical SIDC (`canonicalSidc`), the size, and the modifiers that are drawn. A 20-digit and a 30-digit APP-6E SIDC of the same symbol share one image. The same key always returns the identical object.
  - Without `withText`, only `direction` is drawn, as an arrow, rounded to whole degrees. Many objects therefore share one image (spike S2). With `withText: true`, all text amplifiers and the speed are drawn as well, and they become part of the key.
  - **The user's labels** (`labels`, SDK 1.4.0 part 5, brief function 14), which the map view passes from `ctx.display`. Of the amplifiers on the closed list (`LABEL_IDS` without `name`: `uniqueDesignation`, `higherFormation`, `additionalInformation`, `staffComments`, `type`, `dtg`, `altitudeDepth`, `speed`, `direction`), only the listed ones are drawn; the others (e.g. `quantity`) as before. Text still needs `withText`; the direction's arrow follows `direction` in the list with or without it. `name` is the map view's and is ignored. Without `labels`, everything as before. The key holds what is drawn, so a list that changes nothing shares the image.
  - An invalid SIDC still draws, as milsymbol draws an invalid symbol, never as nothing.
  - **The image is shared and read-only.** On the returned canvas, `getContext` returns null, and `width` and `height` (whose assignment would clear it) cannot be changed: an assignment throws a `TypeError` in strict mode, which every ES module (and so every plugin) runs in, and is silently ignored in sloppy mode. Either way the image stays as it is. The `SymbolImage` and its anchor are frozen. To change an image, draw it onto your own canvas (`drawImage`).
- **`validate(standard, sidc)`** first checks the model's pattern, with a reason when it fails:
  - APP-6B: 15 characters.
  - APP-6D: 20 digits, version 10–12.
  - APP-6E: 20 or 30 digits, version 13–14.
  - `vessel`: 4 digits: context 0–2, standard identity 0–6, AIS ship type 00–99 (e.g. `0470`).

  For APP-6 it then asks milsymbol whether it knows the standard identity, symbol set and entity.
- **`compose(parts)` / `describe(standard, sidc)`** work for APP-6D and APP-6E only.
  - Compose writes version 10 or 13, context 0 and sector modifiers 00, and returns the canonical (20-digit) SIDC.
  - Describe returns the six parts and throws a `RangeError` for a SIDC that does not match the pattern.
- **`catalog()`** returns 159 common entities in 14 symbol sets (listed under "Catalog"), the standard identities 0–6, and the land echelons. Every entry with every standard identity is a symbol milsymbol knows and draws (tested). The echelons are those of land units (set 10); in other sets digits 9–10 mean other things, such as mobility.
- **`graphicCatalog(standard)`** (M5) resolves to the tactical graphics drawn with mil-sym-ts: 337 for APP-6D and 312 for APP-6E, none for APP-6B (see "Tactical graphics").
- **`renderGraphic(request)`** (M5) draws one `core.multipoint` graphic for a view, in a web worker, and resolves to its lines, fills, labels and (M6) images in longitude, latitude, or to `{ ok: false, reason }`. It never rejects.
- **`modifierNames`** is the data model's 36 modifier names. Each maps to the milsymbol option of the same name; `speed` (m/s) is shown as text in whole km/h. The tactical graphics' amplifiers (SDK 1.4.0: `dtg1`, `targetNumber`, `uniqueDesignation1`, `uniqueDesignation2`, `distances`, `azimuths`) are ignored by single-point symbols: same image, same cache key.

milsymbol options are passed per symbol (`standard: 'APP6'`). The plugin never changes milsymbol's global state.

## Catalog

The entries per symbol set, with their entity codes (brief function 6, criterion 8). Each set has 10 to 20 common entities, or all that milsymbol 3.0.4 has; land units keep the 33 of M0.

| Symbol set | Entries | Entities |
|---|---|---|
| `10` Land unit | 33 | Command and control `110000`, Liaison `110500`, Signal `111000`, Air assault `120100`, Anti-tank `120400`, Armour `120500`, Army aviation (rotary wing) `120600`, Combined arms `121000`, Infantry `121100`, Mechanized infantry `121102`, Motorized infantry `121104`, Reconnaissance `121300`, Sniper `121500`, Special forces `121700`, Special operations forces `121800`, Unmanned aircraft systems `121900`, Air defence `130100`, Field artillery `130300`, Missile `130700`, Mortar `130800`, CBRN defence `140100`, Engineer `140700`, Explosive ordnance disposal `140800`, Military police `141200`, Security `141700`, Electronic warfare `150500`, Military intelligence `151000`, Ammunition `160400`, Maintenance `161100`, Medical `161300`, Medical treatment facility `161400`, Supply `163400`, Transportation `163600` |
| `15` Land equipment | 20 | Rifle `110100`, Machine gun `110200`, Grenade launcher `110300`, Air defence gun `110500`, Anti-tank gun `110600`, Howitzer `110900`, Missile launcher `111000`, Air defence missile launcher `111100`, Anti-tank missile launcher `111200`, Mortar `111400`, Multiple rocket launcher `111600`, Armoured fighting vehicle `120101`, Armoured personnel carrier `120103`, Tank `120200`, Mine-clearing equipment `130900`, Dozer `131100`, Utility vehicle `140100`, Radar `220300`, Land mine `210100`, Improvised explosive device `210400` |
| `20` Land installation | 16 | Military base `120802`, Airport `120803`, Helicopter landing site `121305`, Air traffic control facility `121302`, Ammunition cache `110300`, Bridge `110701`, Tunnel `121313`, Railhead `121307`, Port `121309`, Electric power facility `120500`, Chemical plant `120301`, Industrial site `120306`, Telecommunications tower `121203`, Dam `121402`, Hospital `120702`, Religious institution `121004` |
| `01` Air | 17 | Fixed wing `110100`, Attack/strike `110102`, Bomber `110103`, Fighter `110104`, Fighter/bomber `110105`, Cargo `110107`, Tanker `110109`, Patrol `110110`, Reconnaissance `110111`, Airborne early warning `110116`, Anti-submarine warfare `110118`, Electronic countermeasures (jammer) `110108`, Medical evacuation `110101`, Rotary wing `110200`, Unmanned aerial vehicle `110300`, Civilian fixed wing `120100`, Civilian rotary wing `120200` |
| `02` Air missile | 1 | Missile `110000` |
| `05` Space | 12 | Space vehicle `110100`, Re-entry vehicle `110200`, Satellite `110600`, Anti-satellite weapon `110800`, Communications satellite `111100`, Earth observation satellite `111200`, Navigation satellite `111400`, Reconnaissance satellite `111500`, Space station `111600`, Weather satellite `111800`, Space launch vehicle `111900`, Civilian satellite `120300` |
| `30` Sea surface | 20 | Carrier `120100`, Battleship `120201`, Cruiser `120202`, Destroyer `120203`, Frigate `120204`, Corvette `120205`, Amphibious warfare ship `120300`, Landing craft `120308`, Mine warfare vessel `120400`, Minesweeper `120402`, Minehunter `120404`, Patrol `120500`, Unmanned surface vehicle `120700`, Auxiliary ship `130100`, Hospital ship `130107`, Replenishment oiler `130110`, Merchant ship `140100`, Oiler/tanker `140109`, Passenger ship `140110`, Fishing vessel `140200` |
| `35` Sea subsurface | 13 | Submarine `110100`, Submarine, surfaced `110101`, Submarine, snorkelling `110102`, Submarine, bottomed `110103`, Other submersible `110200`, Non-submarine `110300`, Military diver `110500`, Civilian submersible `120100`, Civilian diver `120300`, Torpedo `130100`, Improvised explosive device `130200`, Underwater decoy `130300`, Seabed installation `200000` |
| `36` Mine warfare | 12 | Sea mine `110000`, Sea mine, bottom `110100`, Sea mine, moored `110200`, Sea mine, floating `110300`, Sea mine, rising `110400`, Kingfisher `110600`, Exercise mine `110800`, Neutralized sea mine `110900`, Unexploded ordnance `120000`, Sea mine decoy `130000`, Mine-like contact (MILCO) `140200`, Mine-like echo (MILEC) `150100` |
| `50–54` Signals intelligence (space, air, land, sea surface, subsurface) | 3 | Communications `110100`, Jammer `110200`, Radar `110300` |

- **Air missile and signals intelligence** have only the entities milsymbol has (1, and 3 per set). The kinds of missile (cruise, ballistic) and of emitter (fire control radar, early warning) are sector modifiers 1 and 2, which `CatalogEntry` and `SidcParts` do not have and `compose` writes as `00` (owner, 2026-10-30: no change request for now).
- Left out on purpose: US agency symbols (FBI, DEA, TSA and the like), manual and fused tracks, and civilian variants beyond a few.

## Tactical graphics

From M5 (brief functions 7 to 10, ADR-0043) the service draws APP-6 tactical graphics with mil-sym-ts (`@armyc2.c5isr.renderer/mil-sym-ts-web` 2.10.9).
- **One module worker** (`web/src/graphics/worker.ts`, built to `dist/assets/worker-*.js`, 7 MB) holds mil-sym-ts. It starts at the first `graphicCatalog` or `renderGraphic` and stays for the page's life; the main thread never loads mil-sym-ts. The requests of one frame go to it in one message; it answers with flat `Float64Array`s, transferred.
- **Versions:** mil-sym-ts gets digits 1–2 as `10` for APP-6D (stored 10, 11 or 12) and `16` for APP-6E (13 or 14); the stored SIDC never changes.
- **The view:** the scale is `resolution` at 96 dots per inch; the extent is mil-sym-ts's bounding box, except across the antimeridian (west > east), where it gets none and clips nothing.
- **Colours, widths, dashes and fonts are mil-sym-ts's**, the same in every look (owner, Q2, 2026-11-06), with APP-6 E V2 section 8.1.4 applied where they differ (owner YE B, 2026-11-16; `web/src/graphics/colours.ts`). `GraphicLabel.halo` is mil-sym-ts's own outline of a label, passed through.
  - **Friendly** control measures are black, **hostile** ones red (8.1.4.1–2): mil-sym-ts's own. Red is on every display, so no "ENY" fallback is needed.
  - **Obstacles and obstructions** (table 8-17) are green, `#00FF00`, whatever their identity (8.1.4.3). mil-sym-ts draws most of them green already. emcc also makes the crossings green (bridge or gap, assault crossing, fords, safe lane or gap, ferry, raft site) and the overhead wire (identity colours, or purple in APP-6E). The obstacle bypasses keep the identity colours, as do the field fortifications of table 8-18 (owner, 2026-11-16).
  - **CBRN contaminated areas** (2717–2720) are hatched in yellow, `#FFFF00` (8.1.4.4). Their outline and icon keep the identity colour.
  - The same rules apply to APP-6D graphics. Neutral and unknown control measures stay green and yellow, mil-sym-ts's own.
- **Images inside graphics** (M6, SDK 1.5.0 part 2, brief function 15): for 21 graphics (14 in APP-6D: 270706, 270707, 270800, 270801, 270900, 270901, 271700, 271701, 271800, 271801, 271900, 272000, 272001, 290101; 7 in APP-6E: 271700 to 272001; the mined areas, dummy and dynamic minefields, the mine line, and the biological, chemical, nuclear and radiological contaminated areas) mil-sym-ts's result holds image points. The worker hands each over as a `GraphicImage`: the point as `position`, mil-sym-ts's `image` as `svg` unchanged (a base64 SVG data URI), its `rotation` as `angle`, and the SVG's own `width` and `height` (from its root element, else its `viewBox`), read as text in the worker. mil-sym-ts's `anchorPoint` and offsets are not used. An image that is not an SVG data URI, or whose size cannot be read, is left out, and the graphic still draws. A graphic without image points has no `images`. The images are strings, so they are copied, not transferred; they refer to nothing outside themselves (a test).
- **Refusals** (`ok: false`): mil-sym-ts's error, NaN in its result, a point count outside the catalogue's, a missing required amplifier, APP-6B, a code outside the catalogue, an empty view, and `timeout`.
- **The timeout** (`graphicTimeoutSeconds`) counts from when mil-sym-ts has loaded; loading itself may take up to 60 s. A request that times out ends the worker, so that the next request draws in a new one; the other requests that worker held resolve with `timeout` too.

**The catalogue** is built in the worker from mil-sym-ts's lookup, once per standard (the owner's option A, 2026-11-06: no generated file; the first palette waits for the renderer, about 0.3 s in the browser check). It lists every graphic whose lookup geometry is `Line` or `Area`. Each entry takes from the lookup its code, name, path, point counts, amplifiers (by their APP-6 letters: T `uniqueDesignation`, T1 `uniqueDesignation1`, T2 `uniqueDesignation2`, H `additionalInformation`, N `hostile`, V `type`, W `dtg`, W1 `dtg1`, X `altitudeDepth`, Y `location`, AS `country`, AP `targetNumber`, AM `distances`, AN `azimuths`) and echelon (B). The rest comes from its draw rule (`web/src/graphics/drawRules.ts`):
- `kind`: `arrow` for AXIS1 and AXIS2, `points` for graphics of one point, otherwise `area` or `line` from the lookup's geometry;
- `geometry`: `MultiPoint` for `points`; `Polygon` for areas whose points have no roles (a corner is a corner); `LineString` for everything else;
- `points` and `requiredModifiers` as in the table below. The required amplifiers were checked against mil-sym-ts: without them the graphic draws no line (a test).

**Draw rules, for the owner to check.** The `points` texts are written from MIL-STD-2525D's anchor-point descriptions, which mil-sym-ts documents per draw rule, and APP-6 E. When a graphic takes more points than are listed, the second-to-last text describes the points in between and the last one the last point; a single text describes them all.

| Draw rule | APP-6D | APP-6E | For example | Kind, geometry | Points | Required |
|---|---|---|---|---|---|---|
| AREA1 | 69 | 82 | Area of Operations, Named Area of Interest | area Polygon | 1. a corner of the area |  |
| AREA2 | 12 | 0 | Limited Access Area, Instrument Flight Rule (IFR) | area Polygon | 1. a corner of the area |  |
| AREA3 | 2 | 0 | Battle Position, Prepared (P) but not Occupied | area Polygon | 1. a corner of the area |  |
| AREA4 | 1 | 0 | Strong Point | area Polygon | 1. a corner of the area |  |
| AREA5 | 1 | 1 | Contain | area LineString | 1. one end of the half circle’s opening<br>2. the other end of the opening<br>3. the end of the arrow |  |
| AREA6 | 1 | 1 | Retain | area LineString | 1. the centre<br>2. a point on the circle, where it starts; it sets the radius |  |
| AREA7 | 1 | 1 | Attack by Fire Position | area LineString | 1. the tip of the arrowhead<br>2. one end of the line at the back<br>3. the other end of the line at the back |  |
| AREA8 | 1 | 1 | Support by Fire | area LineString | 1. one end of the line at the back<br>2. the other end of the line at the back<br>3. the tip of the first arrowhead<br>4. the tip of the second arrowhead |  |
| AREA9 | 1 | 0 | Series or Groups of Targets | area Polygon | 1. a corner of the area |  |
| AREA10 | 12 | 12 | Irregular, Terminally Guided Munition Footprint (TGMF) | area Polygon | 1. a corner of the area |  |
| AREA11 | 1 | 2 | Block | area LineString | 1. one end of the straight line across<br>2. the other end of that line<br>3. the end of the line at right angles to it |  |
| AREA12 | 1 | 2 | Disrupt | area LineString | 1. one end of the straight line across<br>2. the other end of that line<br>3. the tip of the longest arrow |  |
| AREA13 | 1 | 1 | Mine Cluster | area LineString | 1. one corner<br>2. the opposite corner |  |
| AREA14 | 1 | 1 | Minimum Safe Distance Zone | area LineString | 1. the centre<br>2. a point on a circle, which sets its radius, from the inner circle out<br>3. a point on the outer circle |  |
| AREA15 | 4 | 4 | Isolate, Cordon and Knock | area LineString | 1. the centre<br>2. a point on the circle, where it starts; it sets the radius |  |
| AREA16 | 1 | 1 | Occupy | area LineString | 1. the centre<br>2. a point on the circle, where it starts; it sets the radius |  |
| AREA17 | 1 | 1 | Penetrate | area LineString | 1. one end of the straight line across<br>2. the other end of that line<br>3. the rear of the symbol |  |
| AREA18 | 2 | 2 | Relief in Place (RIP), Demonstration | area LineString | 1. the tip of the first arrowhead<br>2. the end of the first arrow<br>3. the tip of the second arrowhead<br>4. the end of the second arrow |  |
| AREA19 | 3 | 4 | Secure, Control | area LineString | 1. the centre<br>2. a point on the circle, where it starts; it sets the radius |  |
| AREA20 | 1 | 0 | Airfield Zone | area Polygon | 1. a corner of the area |  |
| AREA21 | 1 | 1 | Search Area/Reconnaissance Area | area LineString | 1. the vertex<br>2. the tip of the first arrowhead<br>3. the tip of the second arrowhead |  |
| AREA23 | 2 | 0 | Dummy Minefield Dynamic, Dynamic Depiction | area Polygon | 1. a corner of the area |  |
| AREA24 | 1 | 0 | Block | area LineString | 1. one end of the straight line across<br>2. the other end of that line<br>3. the end of the line at right angles to it |  |
| AREA25 | 1 | 0 | Disrupt | area LineString | 1. one end of the straight line across<br>2. the other end of that line<br>3. the tip of the longest arrow |  |
| AREA26 | 1 | 1 | Multiple Strikes - STRIKWARN | area LineString | 1. the first half of the points outline the inner zone, the second half the outer zone, with as many points in each |  |
| AREA27 | 0 | 1 | Mobile Defense | area LineString | 1. the tip of the arrowhead<br>2. the end of the straight part<br>3. the size and direction of the half circle |  |
| POINT12 | 5 | 6 | Easy, Difficult | line LineString | 1. the tip of the first arrowhead<br>2. the tip of the second arrowhead<br>3. the rear of the symbol |  |
| POINT17 | 1 | 1 | Cued Acquisition Doctrine | points MultiPoint | 1. the centre | distances, azimuths |
| POINT18 | 1 | 1 | Radar Search Doctrine | points MultiPoint | 1. the centre of rotation | distances, azimuths |
| LINE1 | 54 | 64 | Decision Line, Forward Line of Troops | line LineString | 1. a point of the line |  |
| LINE2 | 19 | 0 | Light Line, Phase Line | line LineString | 1. a point of the line |  |
| LINE3 | 2 | 1 | Principle Direction of Fire, Instability Line | line LineString | 1. the vertex<br>2. the tip of the first arrowhead<br>3. the tip of the second arrowhead |  |
| LINE4 | 2 | 1 | Navigational, Shear Line | line LineString | 1. one corner<br>2. the opposite corner |  |
| LINE5 | 13 | 10 | Bearing Line, Electronic | line LineString | 1. the start of the line<br>2. the end of the line |  |
| LINE6 | 1 | 0 | Convergence Line | line LineString | 1. a point of the line |  |
| LINE7 | 4 | 0 | Boundary, Engineer Work Line | line LineString | 1. a point of the line |  |
| LINE8 | 1 | 1 | Munition Flight Path | line LineString | 1. the start of the path<br>2. a turn of the path<br>3. the end of the path |  |
| LINE9 | 2 | 4 | Fix, Moving Convoy | line LineString | 1. the tip of the arrowhead<br>2. the rear of the symbol |  |
| LINE10 | 1 | 2 | Turn | line LineString | 1. the tip of the arrowhead<br>2. the rear of the symbol<br>3. the end of the 90-degree arc |  |
| LINE11 | 1 | 1 | Bridge or Gap | line LineString | 1. one end of the near side<br>2. the other end of the near side<br>3. one end of the far side<br>4. the other end of the far side |  |
| LINE12 | 4 | 4 | Planned, Explosives, State of Readiness 1 (Safe) | line LineString | 1. one end of the symbol<br>2. the other end<br>3. one side of the symbol |  |
| LINE13 | 1 | 0 | Abatis | line LineString | 1. a point of the line |  |
| LINE14 | 2 | 4 | Lane, Raft Site | line LineString | 1. the tip of the first arrowhead<br>2. the tip of the second arrowhead |  |
| LINE16 | 1 | 1 | Assault Crossing | line LineString | 1. one end of the near side<br>2. the other end of the near side<br>3. one end of the far side<br>4. the other end of the far side |  |
| LINE17 | 2 | 2 | Ford Easy, Ford Difficult | line LineString | 1. one end of the first line<br>2. the other end of the first line<br>3. where the parallel line lies |  |
| LINE18 | 1 | 1 | Ferry | line LineString | 1. the tip of the first arrowhead<br>2. the tip of the second arrowhead |  |
| LINE19 | 1 | 1 | Fighting Position | line LineString | 1. one front corner<br>2. the other front corner |  |
| LINE20 | 1 | 0 | Halted Convoy | line LineString | 1. the tip of the arrowhead<br>2. the rear of the symbol |  |
| LINE21 | 8 | 0 | Main Supply Route, One Way Traffic | line LineString | 1. a point of the line |  |
| LINE22 | 1 | 0 | Breach | line LineString | 1. one end of the opening<br>2. the other end of the opening<br>3. the rear of the symbol |  |
| LINE23 | 1 | 1 | Clear | line LineString | 1. one end of the straight line across<br>2. the other end of that line<br>3. the rear of the symbol |  |
| LINE24 | 6 | 5 | Delay, Retire/Retirement | line LineString | 1. the tip of the arrowhead<br>2. the end of the straight part<br>3. the size and direction of the half circle |  |
| LINE25 | 2 | 2 | Follow and Assume, Follow and Support | line LineString | 1. the tip of the arrowhead<br>2. the rear of the symbol |  |
| LINE26 | 3 | 4 | Cover, Guard | line LineString | 1. with four points: the tip of the first arrowhead; with three: the vertex<br>2. with four: the end of the first arrow; with three: the tip of the first arrowhead<br>3. with four: the end of the second arrow; with three: the tip of the second arrowhead<br>4. the tip of the second arrowhead |  |
| LINE27 | 2 | 4 | Seize, Capture | line LineString | 1. the centre of the circle<br>2. with four points: a point on the circle, which sets its radius; with three: the tip of the arrowhead<br>3. with four: the bend of the arc; with three: the end of the 90-degree arc<br>4. the end of the arrow |  |
| LINE28 | 1 | 0 | Fix | line LineString | 1. the tip of the arrowhead<br>2. the rear of the symbol |  |
| LINE29 | 3 | 3 | Ambush, Decoy/Dummy/Deception | line LineString | 1. the tip of the arrowhead<br>2. one end of the curved line at the back<br>3. the other end of the curved line |  |
| LINE30 | 1 | 1 | Conduct Exploitation, Exploit/Exploitation | line LineString | 1. the tip of the arrowhead<br>2. the end of the symbol<br>3. the length of the angled lines (its distance from the second point) |  |
| LINE31 | 1 | 1 | Envelop, Envelopment | line LineString | 1. the start of the straight line<br>2. the end of the straight part<br>3. the diameter of the half circle<br>4. the direction of the half circle |  |
| LINE32 | 2 | 2 | Exfiltrate, Infiltrate | line LineString | 1. the end of the straight part<br>2. the centre of the two arcs<br>3. the tip of the arrowhead |  |
| LINE33 | 1 | 1 | Pursue, Pursuit | line LineString | 1. the start of the straight line<br>2. the end of the straight part<br>3. the size and direction of the half circle, and the tip of the arrowhead |  |
| LINE50 | 1 | 1 | Escort | line LineString | 1. the tip of the arrowhead<br>2. the rear of the symbol<br>3. the width of the symbol |  |
| CORRIDOR1 | 7 | 7 | Air Corridor, Low Level Transit Route | area Polygon | 1. a point of the corridor’s centre line | distances |
| AXIS1 | 3 | 10 | Friendly Airborne/Aviation, Attack Helicopter | arrow LineString | 1. the tip of the arrow<br>2. the axis, from the tip back to the tail<br>3. the width of the arrowhead |  |
| AXIS2 | 5 | 1 | Main Attack, Supporting Attack | arrow LineString | 1. the tip of the arrow<br>2. the axis, from the tip back to the tail<br>3. the width of the arrowhead |  |
| POLYLINE1 | 1 | 1 | Infiltration Lane | line LineString | 1. one end of the lane<br>2. the other end of the lane<br>3. the width on one side |  |
| ELLIPSE1 | 3 | 3 | Ellipse/Circle | points MultiPoint | 1. the centre | distances, azimuths |
| RECTANGULAR1 | 19 | 19 | Rectangle, Rectangular | area LineString | 1. the middle of one side<br>2. the middle of the opposite side | distances |
| RECTANGULAR2 | 1 | 1 | Rectangular Target | points MultiPoint | 1. the centre | distances, azimuths |
| RECTANGULAR3 | 1 | 1 | Rectangular Target - Single Target, Rectangular Target - Single Target (AEGIS ONLY) | area LineString | 1. the centre<br>2. the orientation of the rectangle | distances |
| CIRCULAR1 | 19 | 18 | No Attack (NOTACK) Zone, Circular | points MultiPoint | 1. the centre | distances |
| CIRCULAR2 | 1 | 1 | Weapon/Sensor Range fan, Circular | points MultiPoint | 1. the weapon or sensor | distances |
| ARC1 | 1 | 1 | Weapon/Sensor Range fan, Sector | points MultiPoint | 1. the weapon or sensor | distances, azimuths |

Doubtful texts: **LINE50** (Escort) has no description in mil-sym-ts; its three points are a guess from the drawing. **RECTANGULAR3** (Rectangular Target – Single Target) is described with one point, but the lookup asks for two; the second is a guess (the orientation). **LINE26** and **LINE27** describe their three- and four-point forms in one text each.

## Vessel symbols

From M5 (brief functions 12 and 13, ADR-0047) `render` draws `vessel` symbols itself, in the style of vessel-tracking pages, with no copied artwork:
- **Moving** (a `direction`, and a `speed` absent or above 0): a pointed hull `size` long and a third of it wide, its point along `direction` in whole degrees. The image is turned, north up; it is a square that fits every heading, and its anchor is the hull's centre.
- **Not moving** (no `direction`, or `speed` 0): a filled circle half the size across.
- **Fill:** the ship-type group's colour, the same in every look. **Outline:** 2 px in the identity's APP-6 frame colour of `looks.md` (pending and unknown `#ffff80`, friend and assumed friend `#80e0ff`, neutral `#aaffaa`, suspect and hostile `#ff8080`), with a 1 px gap in the look's ground colour (`colorGround`) between fill and outline (owner, LS, 2026-11-08), so that the pale identity colours read on the fills and on a light map.
- **Text:** with `withText`, the text amplifiers and the speed, filtered by `labels` as for APP-6, one per line, upright to the right of the square, 0.4 × `size` pixels (at least 8), black. The hull turns whatever the labels. The context digit is not drawn (M5).
- **Shared images:** the key is the code, the size, the heading in whole degrees or "mark", the drawn texts and the ground colour, read from `ctx.theme` at each render. After a change of look, a render gives the new look's image; a caller that keeps images itself must ask again on `ctx.theme.onChange`.
- An invalid code still draws: as an unknown ship (type 0) of unknown identity.

**The groups** (`vesselGroups()`, function 13), a proposal for the owner to check in the browser in each look; each AIS type has its name from ITU-R M.1371 (e.g. 31 Towing, 52 Tug, 70 Cargo, 84 Tanker, hazardous category D):

| Group (`id`) | Label | AIS types | Colour |
|---|---|---|---|
| `cargo` | Cargo | 70 to 79 | `#5A9E3A` |
| `tanker` | Tanker | 80 to 89 | `#C23B30` |
| `passenger` | Passenger | 60 to 69 | `#2F6FD0` |
| `fishing` | Fishing | 30 | `#E08A2E` |
| `pleasure` | Pleasure craft | 36, 37 | `#B248B8` |
| `highSpeed` | High-speed craft | 40 to 49 | `#D8B820` |
| `tugSpecial` | Tug and special craft | 31 to 35, 50 to 59 | `#2AA6A6` |
| `other` | Other | 1 to 29, 38, 39, 90 to 99 | `#808080` |
| `unknown` | Unknown | 0 | `#D0D0D0` |

## Sensor report symbol

From M6 (SDK 1.5.0 part 3, brief function 16) `sensorReportSymbol()` returns one image for every object whose data type declares `sensorReport` (today `gmti.detection`); the map view draws it instead of the APP-6 symbol.
- **From the three settings** below, one for all sensor reports. The shape fills a size by size image; its anchor is the centre. `dot` is a filled circle, `cross` an upright cross, `ring` an unfilled circle, `diamond` a filled square on its point, `square` a filled square. The cross's and the ring's lines are size / 5 wide, at least 2 px; a ring below 5 px has a 1 px line, so its centre stays open, and shows only its outline (owner, 2026-11-10).
- **Outlined:** 1 px black, white for a black symbol, so it shows on light and dark maps; no look, user setting or label changes it.
- **Drawn pixel by pixel**, without anti-aliasing (`web/src/sensorReport.ts`), so small sizes stay crisp. At 4 px the cross and the diamond show 4 coloured pixels inside their outline.
- **One image until the settings change:** every call returns the same frozen, read-only image; after a change of the settings the next call returns a new one. It is not in `render`'s cache, and `render` still draws a detection's APP-6 symbol unchanged.

## Settings

| Name | Default | Meaning |
|---|---|---|
| `imageCacheSize` | `2000` | How many images the render cache keeps; the least recently used one is dropped first. A value that is not a positive integer makes the plugin `DEGRADED`: at start it uses 2 000, after a change it keeps the current size |
| `graphicTimeoutSeconds` | `5` | How long a tactical graphic may take to draw, 1 to 30 seconds; a slower one resolves with `timeout`. Another value makes the plugin `DEGRADED` and keeps the current timeout |
| `sensorReportShape` | `dot` | The sensor report symbol's shape: `dot`, `cross`, `ring`, `diamond` or `square` (see "Sensor report symbol") |
| `sensorReportColor` | `orange` | Its colour: `yellow` `#ffff00`, `orange` `#ff8000`, `red` `#ff0000`, `magenta` `#ff00ff`, `cyan` `#00ffff`, `green` `#00c000`, `blue` `#0060ff`, `white` `#ffffff`, `black` `#000000` |
| `sensorReportSize` | `10` | Its size, 4 to 32 pixels. For each of the three, another value makes the plugin `DEGRADED` and keeps the current one |

**The form** (SDK 1.8.0 part D, T-204): the Settings entry, with the icon Hexagon, shows the group "Sensor reports" (shape, colour, size in px) and a folded "Advanced" group (cache size in images, timeout in s), each field with a short hint (`x-emc2` in `plugin.json`).

**Changes at runtime** (SDK v1, by a user with `settings.admin`) apply at once, without a reload. A smaller cache drops the least recently used images at once. The `emc2.symbols` service object stays the same, so its users need not get it again. The settings schema requires every setting and allows no other, so the server refuses a missing, unknown or out-of-range value before it reaches the plugin; the plugin still checks the value it gets.

The cache also holds at most 16 Mi pixels (64 MiB as RGBA, `MAX_CACHED_PIXELS`), whatever the setting. 2 000 symbols of size 30 take about 3 Mi pixels, so the limit only matters for large images.

## Messages and services

- Provides `emc2.symbols` (`SymbolService`). Gets no service, so the manifest has no `requires` and no `uses` (design pattern v1, section 3). `draw-symbols` requires `emc2.symbols`; `map-view-2d` lists it in `uses` from SDK v1 (CR-0011), so it also loads without this plugin and draws markers.
- No topics, panels, overlays or endpoints.

## Permissions and internet

None. milsymbol and mil-sym-ts draw locally and fetch no fonts or images; the worker's file comes from the emc2 server, like `index.js` (browser check: no other request). With no panels, the plugin checks no permissions, so it behaves the same for every user (read-only users included; a test checks it with a user without permissions).

## Licence

- milsymbol 3.0.4: MIT.
- mil-sym-ts 2.10.9: Apache-2.0, shipped unmodified in the worker's file. One deprecated function in it, `mdlGeodesic.IntersectLines`, carries a note that it is under the Creative Commons Attribution 3.0 Unported licence, with no author named; CR-0029 allows it. Both belong in the third-party notices (the MCA's notices file).

## Known limits

- **The direction arrow in the map view:** symbology draws its arrow only when `direction` is passed and listed. The map view never passes `direction` for APP-6 symbols and draws its own arrow (owner, LC, 2026-11-08), so there the Direction label changes nothing; it matters for other callers, such as a palette's preview.
- **`render`, `validate` and `describe` are for single-point symbols.** A multipoint SIDC, such as the boundary in `model/examples/valid/object-multipoint-boundary.json`, is unknown to milsymbol: `validate` says so and `render` draws milsymbol's invalid symbol. Multipoint graphics go through `graphicCatalog` and `renderGraphic` (M5).
- **One graphic is left out of the catalogue:** APP-6E's PSYOPS zone, Circular (`25 242703`), which mil-sym-ts 2.10.9 draws as nothing with any amplifiers (`DRAWS_NOTHING`; a test notices a newer version that draws it).
- **Label size:** mil-sym-ts writes its font size as `12pt` but places its labels for a 12 px font, so labels are 12 px. With 16 px the lines of an air corridor's text block overlapped.
- **Labels are placed for the request's scale:** mil-sym-ts moves each label by a few pixels from its anchor at that scale, so after a zoom the map view must ask again (as it does after every zoom).
- **No halo round lines and labels for dark maps** in M5 (owner, Q2, 2026-11-06); black control measures are hard to read on a dark background.
- **APP-6B has no graphics** (ADR-0043 point 8).
- **Frames:** requests are sent once per animation frame. A page whose frames are slowed (a background tab, or the browser pane without screenshots) waits that long; the worker itself drew 1 000 graphics in 76–87 ms.
- **What `describe` drops:** the version, the context, the sector modifiers (digits 17–20) and digits 21–30. `SidcParts` has no fields for them. Compose followed by describe is exact.
- **Units and size are fixed for now:**
  - speed is always in km/h (later a unit setting per domain);
  - the size is the caller's (later configurable);
  - the device pixel ratio is 1.
- **Catalog names** follow the APP-6D text where known, otherwise milsymbol's icon table. Names that are doubtful:
  - `Mechanized infantry` (121102): milsymbol draws infantry with armour; APP-6D calls it infantry "armoured/mechanized/tracked".
  - `Unmanned aircraft systems` (121900): milsymbol's icon is "unmanned systems".
  - `Medical treatment facility` (161400): a facility rather than a unit type.
  - `CBRN defence` (140100): milsymbol's icon is "CBRN".
  - `Army aviation (rotary wing)` (120600).
  - `Port` (land installation 121309): milsymbol draws transportation with a naval sign; 121310 (naval with "YRD") is the shipyard.
  - `Hospital` (land installation 120702): milsymbol draws the medical treatment facility; 120701 is medical infrastructure in general.
  - `Electronic countermeasures (jammer)` (air 110108) and `Jammer` (signals intelligence 110200): milsymbol's icon is "jammer / electronic countermeasures".
  - `Air defence missile launcher` (land equipment 111100): milsymbol draws it from parts, with no name of its own.
- **Headquarters is not an entity:** it is the HQ/task force/dummy part of the SIDC (owner, 2026-10-08), so the catalog has no headquarters entry.
- **What the unit tests do not verify.** jsdom has no canvas, so the tests use a recording 2D context (`web/test/canvas.ts`): "drawn" means a canvas of positive size with drawing calls on it. A real canvas in the tests was rejected (CR-0007, owner, 2026-10-08). So these criteria are **not verified by the unit tests**, and the ITA checks them in a real browser. PCA-symbology's own browser checks on SDK v1, including the M4 catalog, are recorded in `docs/handover/pca-symbology.md`.
  - criterion 1: real, non-empty pixels;
  - criterion 5: the render time including rasterization (the unit test measures milsymbol without it);
  - criterion 6: no network request (the unit test only checks that render and validate call no network API).
