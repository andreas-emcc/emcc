# ACA review of CR-0026: POST endpoints for plugins (T-078)

- **Reviewed:** `docs/change-requests/CR-0026-post-endpoints.md` on `pda/cr-0026-post-endpoints` `b818d44` (the CR as of `f569aec`), folded into SDK 1.2.0 as the owner chose on 2026-10-26.
- **The first round:** on the first head, `72d9d07`, the ACA gave the PDA four points through the MCA: R1, the fold into 1.2.0, which is in; and R2 to R4, which follow. R5 is new.
- **Checked against:** ADR-0002, ADR-0022 and ADR-0030; overview 4.4 and 4.5; the frozen SDK 1.2.0 (`Endpoint`, `EndpointRequest`); and the edge as it is on `integration/sdk-v1.2` (`OriginCheckFilter`, `ModelJson`).

Owned by the ACA. Like the rest of this folder, it is not `docs/reviews/`, where the CRA's and SRA's reports stay with the reviewer (`CLAUDE.md` section 8).

## Security

**Sound.** The ACA checked each claim against the code.

**Three layers stop a cross-site command:**
- **The `Origin` check covers the new requests unchanged.** `OriginCheckFilter` skips only reading methods (`GET`, `HEAD`, `OPTIONS`, `TRACE`) and checks every other request on every path. It refuses a foreign `Origin`, `Origin: null`, and a foreign `Referer` without an `Origin`.
- **Only `application/json` is accepted** (item 3). A cross-origin page can send it only after a CORS preflight, and emc2 answers none: the server has no CORS configuration.
- **In login mode, the session cookie is `SameSite=Lax`** (ADR-0022 point 3), so a browser does not send it on a cross-site `POST`.
  - A page on the same site but another origin, such as another port on the same host, still gets the cookie. There, the `Origin` check and the preflight carry the protection.
  - **In the no-login mode** there is no cookie, and the local user holds every permission (item 9). The `Origin` check and the JSON content type carry it alone, as for ECore's own `POST` requests.

**Inside emc2:**
- **`requires` is mandatory for `POST`,** checked by `register` in ECore and in the test kit's fake. ECore answers `403` before delivery (ADR-0022).
- **The body is bounded and parsed by ECore** (`maxBody`, `413`, `415`, `400`), so a plugin never parses raw bytes from a browser.
- **Endpoints still take nothing from a request that names a host** (ADR-0030).

## Compatibility

**Compatible with 1.1.0 and with the frozen 1.2.0.**
- `Endpoint` (four components) and `EndpointRequest` (six) keep their constructors, each with a test, as CR-0025 kept the records' 1.1.0 constructors (N5).
- Plugins do not build an `EndpointRequest`, and `Endpoint.get` is unchanged.
- A plugin that uses `Endpoint.post` declares `^1.2.0`, so an ECore at 1.1.0 refuses to load it.
- **The fold** reopens the freeze of 2026-10-26 for this addition only, before 1.2.0 reaches `main`. That is safe, as for CR-0018, CR-0019 and CR-0021 in 1.1.0: no version step, and the shell's refused range stays `^1.3.0`.
- **No ADR changes,** rightly: no accepted ADR says that endpoints are `GET` only. ADR-0002 holds, since the mapping is in `server/app/`.

## Remarks (PDA, may go into the CR before the owner decides, or into its build)

- **R2. Name the strict JSON parse.**
  - Item 3 asks for "strict UTF-8 JSON (RFC 8259)". RFC 8259 leaves duplicate names open, and leaves the depth limit to the parser.
  - ECore's `ModelJson` already refuses duplicate keys (`STRICT_DUPLICATE_DETECTION`), and Jackson has a nesting limit.
  - The CR should say that a `POST` body is parsed the same way, and that each of these gets `400`, never `500`:
    - a duplicate key;
    - a body nested past the limit;
    - optionally, UTF-16 or UTF-32, or a byte order mark, which Jackson would otherwise detect and accept.
  - The CDA tests them.
- **R3. Who sent a command** (for the owner and the SRA). A command's changes to objects carry the plugin and no user, as every server part's do. So nothing records which user started, reset or put objects on a route.
  - **Recommended:** ECore logs each delivered `POST`, with the plugin, the path, the user and the status, without the body.
  - **Otherwise** the CR says why not.
- **R4. `HEAD` to a `POST`-only path.** Item 7 is silent on `HEAD`, which the controller maps to `GET` today. The CR should say that a `HEAD` to a `POST`-only path gets `405` with `Allow: POST`, like a `GET`.
- **R5. Item 8's "as ADR-0022 intends"** claims more than ADR-0022 says. Its point 3 checks state-changing requests "for an allowed `Origin`". Letting a request with neither `Origin` nor `Referer` through is `OriginCheckFilter`'s own documented rule for clients that are not browsers. Cite the filter.

## Overview 4.4 (ACA, once the owner approves)

The "Plugin endpoints" bullet now says "(SDK v1 endpoints are `GET` only)". Once the owner approves the CR, the ACA changes it to say:
- endpoints are `GET`, and from SDK 1.2.0 also `POST` with a JSON body, for commands;
- for changes to objects and layers, a change request from the browser is still preferred, and a `POST` endpoint that makes them requires the matching permission, as the bullet already says;
- every `POST` endpoint requires a permission, and ECore refuses cross-site requests and checks the body before the plugin sees it.

`docs/plugins/design-pattern.md`'s "`GET` only" is the PDA's, and the CR already lists it. Overview 4.5 and `agents/sra.md` need no change.

## Verdict

**The ACA recommends that the owner approves CR-0026, folded into SDK 1.2.0.** Nothing blocks: R2 to R5 can go into the CR or its build, and the ACA changes overview 4.4 after the approval.
