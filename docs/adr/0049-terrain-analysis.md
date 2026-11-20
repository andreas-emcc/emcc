# ADR-0049: Terrain analysis from local height data, in the `terrain` plugin

- Status: Accepted (owner, GR, 2026-11-05; its decision points approved with the M5 plan, GQ)
- Date: 2026-11-05
- Deciders: Owner (advised by the ACA; T-142, GH and GI; the M5 plan's Q1 and Q5, `docs/architecture/m5-plan.md`, A7)

## Context
The owner wants a plugin for two tasks (T-142, 2026-11-05):
- **range and bearing** between two points;
- **a viewshed** from a point: what can be seen from it, with an observer height above ground, a target height and a maximum range.

The height data is DTED (levels 0 to 2) or GeoTIFF, from a folder the admin sets (GH, GI). Nothing is shipped.

The plugin id is **`terrain`** (Q1). The board's first name, `geotools`, is also the name of the GeoTools library, which is LGPL and ruled out by ADR-0016.

A viewshed is usually many separate patches with holes, with thousands of corner points. The data model has polygons with holes but no MultiPolygon, so in M5 a viewshed is shown, not saved (Q5).

## Decision
1. **The `terrain` plugin** (Q1). It does not use the GeoTools library.
2. **Range and bearing** between two points the user picks:
   - the geodesic distance on WGS84, and the initial and final bearings from true north, computed with the SDK's geodesy (ADR-0019);
   - shown as the user's own overlay with a readout, not saved.
3. **The viewshed** is computed from a point, with:
   - an observer height above ground;
   - a target height above ground;
   - a maximum range;
   - the earth's curvature and atmospheric refraction, through a coefficient that the admin can change.
4. **Height data:**
   - DTED levels 0, 1 and 2, and GeoTIFF;
   - from **one folder that the admin sets** in `terrain`'s settings.

   Rules for the folder:
   - **The path comes only from the settings,** never from a request, a message or an object, as for outside hosts (ADR-0030).
   - **The plugin only reads the folder.** It opens nothing outside it, and resolves every path before checking that.
   - **The manifest declares that it reads a local folder,** and the Monitor shows the folder (SDK 1.4.0, part 6).
   - **Nothing is shipped.** Shipping height data later needs a CR, as CR-0009 was for Natural Earth.
5. **Heights:**
   - DTED gives heights above mean sea level; a GeoTIFF's metadata says what it gives;
   - the viewshed works with heights above the ground, from one data set at a time, so the vertical reference cancels out;
   - how overlapping data sets are combined is in the brief;
   - coordinates are longitude, latitude (ADR-0007), tested with a point where latitude ≠ longitude.
6. **Readers in Java only,** with no native libraries, so that the server runs the same on Windows and Linux:
   - **DTED** with the plugin's own code;
   - **GeoTIFF** with a library whose licence and exact version the owner approves first (ADR-0016), or the plugin's own reader for the common layouts (A7).
7. **Computing happens in the server part,** on ECore's compute workers, never on threads of its own (ADR-0004):
   - **Limits:** each request has a timeout and a cap on the number of height cells, both admin settings with defaults. A request over the cap is refused with its reason.
   - **At most one viewshed runs per user at a time.**
   - **Permission:** the requests come through the plugin's endpoints and need the plugin's own permission (overview 4.4).
8. **The result is the user's own overlay** (Q5):
   - the visible areas, simplified to the data's cell size;
   - not shared and not saved, and gone on a reload or when the user clears it;
   - saving a viewshed needs a MultiPolygon in the data model, through a later CR.

## Alternatives considered
- **The GeoTools library:** complete, but LGPL, which ADR-0016 does not allow.
- **GDAL:** the widest format support, but native code, which complicates running on both Windows and Linux, and outside the Java SDK.
- **Computing in the browser:** no server load, but large height grids would travel to every browser, and the folder is on the server.
- **Saving the viewshed as shapes:** shared at once, but as many polygon objects, or a new geometry type (owner, Q5).

## Consequences
- **SDK 1.4.0, part 6 (PDA), if SDK 1.3.0 lacks them:**
  - the map view's local overlay, for one user;
  - the manifest's declaration of a local folder that a plugin reads.
- **The `terrain` brief (PDA).**
- **PCA-terrain** (new) builds `terrain`.
- **ESA:** a public-domain test area (for example SRTM, as DTED and GeoTIFF), with the source approved by the owner.
- **ITA:** range and bearing; a viewshed over the test area; a request over the cap; a path outside the folder refused.
- **SRA:** in its next review, how the plugin handles paths in the folder.
