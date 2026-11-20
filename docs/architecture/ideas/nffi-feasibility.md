# Idea: NFFI feasibility, NATO Friendly Force Information from public sources

- **Status:** Parked (owner, 2026-11-19). Saved for later; no task, no milestone.
- **Author:** ACA. Research done on 2026-11-19, read-only, no spike.
- **Not a decision.** Nothing here is accepted. When the idea is resumed, it becomes ADRs, spikes and tasks through the normal process.
- **Before resuming:** the sources below are third-party copies and old drafts. Check them again first.

## The question

Can emcc implement NFFI (NATO Friendly Force Information, STANAG 5527) from public sources only? ADatP-36, the standard that STANAG 5527 implements, is not public.

## Answer

**Partly.** The message format and the SIP3 web service can be built from public sources. The framing of IP1 on TCP and the rules of IP2 on UDP cannot. Full ADatP-36 conformance cannot be claimed.

## What is public

- **STANAG 5527 Ed 2** (24 April 2025): the covering document only. It is in the owner's local folder of public NATO standards, not in the repository. Nations implement ADatP-36 Ed B; APP-11 and APP-6 are related documents.
- **NISP** (NATO's catalogue of interoperability standards and profiles) and the **FMN Spiral 5 Friendly Force Tracking profile**:
  - ADatP-36 Ed A is mandatory and Ed B conditional;
  - IP1 is the preferred protocol, and IP2 and WSMP 1.3.2 are allowed;
  - Ed A messages follow the FFI message text format in APP-11, Ed B messages the schema in Ed B's SRD 1;
  - IP1 of Ed A Ver 2 and IP1 of Ed B Ver 1 are not interoperable.
- **The NFFI 1.4 XSD**, namespace `urn:nato:fft:protocols:nffi14`, made by NC3A. A copy is on RTI's community site, with no licence or distribution statement.
  - `NFFIMessage` holds zero or more `track` elements.
  - `positionalData` is required: the track source (country, system, transponder id), UTC time as `YYYYMMDDhhmmss`, latitude and longitude in WGS 84 with optional accuracy, altitude, bearing, speed and reliability.
  - `identificationData` is optional: a 15-character APP-6(A) symbol id and a short name.
  - `operStatusData` is optional: footprint radius, strength, status, an alert flag and remarks.
  - Each section carries security attributes: policy, classification and category.
- **The SIP3 WSDL and XSDs, version 1.1.0, draft 1 (NC3A, March 2008)**, in `thomasRambaldi/master-nffi-client` on GitHub. That repository has no licence: we may read it, not copy it.
  - The files are the WSDLs, `nffi_13.xsd` (namespace `urn:nato:fft:protocols:nffi13`), `nffi_13_Query.xsd`, `SIP3.xsd`, `SIP3_delivery_batched.xsd`, `compressionAlgs.xsd` and `errorCodes.xsd`.
  - SIP3 is SOAP 1.1 over HTTP, document/literal style.
  - `PullDataOperation`: a `ReqResFilter` in, an `NFFIDataResponse` out, and a `SIP3Fault` on error. Optional SOAP headers name the compression supported and used.
  - `DecPullDataOperation`: a decoupled request and response.
  - `TracksPushDataOperation`: the server pushes `NFFIDataResponse`, direct or decoupled.
  - The filters select by area (circle, rectangle, closed polygon) and by system list, including or excluding.
- **Secondary descriptions:**
  - IP1 pushes XML over TCP, one-to-one and in both directions;
  - IP2 pushes over UDP, unicast, multicast or broadcast, with no security;
  - SIP3 adds pull to these push protocols (IST Lisbon paper; NC3A briefing, 7th NATO CIS Symposium 2008; ICCRTS papers 2008 and 2012).

## What is not public

- **ADatP-36**, Ed A and Ed B, and the FFI message text format schema (in APP-11 and in Ed B's SRD 1). So Ed B messages cannot be built.
- **AC/322-D(2006)0066**, "Interim NFFI Standard for Interoperability of Force Tracking Systems" (NC3A, 2006; NFFI v1.3, with the message and the interface protocols). NISP lists it, with no link.
  - The owner has a copy and says it is marked releasable for internet transmission. Using it is the owner's call; if used, it is read by path and never copied into the repository.
- **SIP3 Technical Specifications 1.1.5** (de Sortis, NC3A working paper EPW002625-WP05, March 2009). It is cited in an ICCRTS 2012 paper, and it is not online.
- **Framing:** how messages are delimited on IP1's TCP stream, which side connects, and the ports. For IP2: one message per datagram or not, and the size limit.

## Open implementations (checked 2026-11-19)

GitHub has no repositories tagged `nffi`, `stanag-5527`, `friendly-force-tracking` or `blue-force-tracking`. A search of names, descriptions and readmes found the following. Code search was not possible without a login.

| Repository | Licence | Finding |
|---|---|---|
| `thomasRambaldi/master-nffi-client` | none | A SIP3 client (Java, JAX-WS) holding NC3A's SIP3 1.1.0 draft WSDL and XSDs. The one useful source. |
| `syncpoint/ODINv2` | AGPL-3.0 | No NFFI code. Live tracks come in as GeoJSON over Server-Sent Events. |
| `ciprian-prunoiu/NffiTrackingSystem` | MIT | A demo: JSON in an invented length-prefixed frame. Not IP1. |
| `Waiel5/orp`, its NFFI adapter | Apache-2.0 | Element names that do not match the schema. |
| `rchiofalo/rustgate`, `rustgate-nffi` | AGPL-3.0 | Element names that do not match the schema, and no transport. |
| `arvinddhasmana/rtsa_webgpu`, `BenoitGoethals/JDSSArrow` | Apache-2.0, none | NFFI named in their readmes only; the code was not checked. |

AGPL code cannot enter emcc (`CLAUDE.md` section 4). Code without a licence may be read but not copied.

## In emcc

- **An `nffi` plugin, like `cot`:**
  - a codec for NFFI 1.3 and 1.4;
  - connection tasks for IP1 and IP2 (ADR-0036);
  - a SIP3 client or provider, as `nvg` does for SOAP.

  ECore and the contracts would not change.
- **The mapping fits:**
  - latitude first becomes longitude, latitude (ADR-0007, with a test point where the two differ);
  - the APP-6(A) symbol id goes to `symbology`;
  - the security attributes become the object's security label.
- **Built as `nvg` was:**
  - our own codec, WSDL and code, written from the public schemas; RTI's XSD and the repository's files are not shipped;
  - every point that only ADatP-36 or AC/322-D(2006)0066 can settle is an open point for the owner's local-LLM spec check.
- **What we may claim:** "compatible with the NFFI 1.3 and 1.4 schemas", never ADatP-36 compliance.

## Before resuming

- The owner decides whether AC/322-D(2006)0066 may be used.
- If it may not: the framing of IP1 and IP2 from a capture of a real system, or from the local-LLM check.
- Which edition the counterpart runs (Ed A Ver 2 or Ed B Ver 1), since their IP1s are not interoperable.

## Sources

- STANAG 5527 Ed 2, from the NATO Standardization Office (the owner's local folder).
- NISP: [ADatP-36 Ed A](https://nisp.nw3.dk/standard/nato-adatp-36-ed.a-v1.html), [ADatP-36 Ed B](https://nisp.nw3.dk/standard/nato-adatp-36-ed.b-v1.html), [FMN Spiral 5 Friendly Force Tracking profile](https://nisp.nw3.dk/serviceprofile/fmn5-20231123-prf-45.html), [NISP 7.0, Battlespace Management Interoperability (AC/322-D(2006)0066)](https://archive.nisp.nw3.dk/nisp-7.0/volume4/apds11.html).
- [NFFI 1.4 XSD, RTI's copy](http://community.rti.com/sites/default/files/STANAG5527_NFFI14_original.xsd).
- [SIP3 WSDL and XSDs in master-nffi-client](https://github.com/thomasRambaldi/master-nffi-client/tree/master/src/META-INF/wsdl/localhost_8080/SIP3Master).
- [ICCRTS 2008, Johnsen and Hafsøe](http://www.dodccrp.org/events/13th_iccrts_2008/CD/html/papers/052.pdf); [ICCRTS 2012, paper 041](http://www.dodccrp.org/events/17th_iccrts_2012/post_conference/papers/041.pdf).
- [NC3A briefing "Friendly Force Information Sharing", 2008 (third-party copy)](https://silo.tips/download/friendly-force-information-sharing).
- [IST Lisbon paper on Portuguese Army vehicle tracking](https://fenix.tecnico.ulisboa.pt/downloadFile/1970719973966969/Extended%20Abstract.pdf).
