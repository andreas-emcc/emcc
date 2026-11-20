# ADR-0062: TLS credentials for connection tasks, named apart from links

- Status: Accepted (owner, YK A, 2026-11-16, through the MCA; proposed by the ACA the same day; M9, "productification")
- Date: 2026-11-16
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0036 point 5 (TLS by name, through the SDK), ADR-0060 (settings and credentials files)

## Context
**Client certificates for outbound connection tasks exist already** (ADR-0036 point 5, since M3):
- a connection task asks the SDK for `tls(name)` or `sslContext(name)`, and ECore builds it from the key and trust stores that local server configuration names (`emc2.listeners.credentials.<name>.*`);
- the plugin never gets the key material;
- the trust store is required, and the key store only where the peer asks for a client certificate;
- ECore checks that the peer is the host the task connects to;
- `cot` uses it for a TAK Server: its link's **name** is the credentials' name.

**What a product needs beyond that:**
- **Renaming a link loses its certificate,** since the name is the key. M8 gave list items stable ids for this kind of reason (CR-0047).
- An admin cannot see in Settings which credentials exist, nor pick one.
- The stores' paths are not resolved with `%emcc%/`, and the passwords sit in `application-local.properties` with everything else.
- Only JKS and PKCS#12 are read. Nothing shows when a certificate expires, until the TAK Server refuses it.

## Decision
1. **The model stays:** TLS material is ECore's, and plugins get an `SSLContext` or a socket factory by a name, through the SDK. **The SDK calls do not change.**
2. **A TLS credential is named on its own** and kept in its own file, `settings/credentials/tls-<name>.properties` (ADR-0060):
   - the trust store, and optionally the key store, with their types and passwords;
   - paths may start with `%emcc%/`;
   - **types:** PKCS#12 and JKS, as today, and **PEM** (a CA file for the trust, a certificate chain and a private key for the identity), since TAK Server's tools and many CAs issue PEM;
   - **the keys** are today's, under a new prefix: `emc2.tls.<name>.trust-store`, `.trust-store-password`, `.key-store` and `.key-store-password`, with a `.type` for each store (`PKCS12`, `JKS` or `PEM`) and, for PEM, the certificate and key files. The CDA fixes the exact names;
   - the old keys `emc2.listeners.credentials.<name>.*` keep their meaning and are still read, with a deprecation warning. Where both name the same credential, the new file wins.
3. **A link picks its credential in Settings:**
   - a settings field of a new kind lists the names ECore has, never paths or passwords. It is in the next SDK version, the PDA's CR;
   - `cot`'s TLS links get the field;
   - **when it is empty, the link's name is used,** as today, so existing installations keep working.
4. **Expiry:**
   - the Monitor lists every TLS credential: the identity's subject and issuer, the trust store's certificates and each one's expiry date;
   - it marks the ones within 30 days of expiry;
   - a link whose certificate has expired fails with a status that says so, not a bare handshake error.
5. **The rest stays as ADR-0036 has it:**
   - TLS 1.2 and 1.3;
   - the host check on the peer;
   - read at start: a changed credential needs a restart in M9;
   - **TLS for connections that listen comes later** (ADR-0036, A5).

## Alternatives considered
- **Paths and passwords in the link's settings:** they would reach the browser, the settings file `data/ecore-config.json` and its backups. ADR-0036 rules that out.
- **One file for all TLS credentials:** one file cannot get narrower permissions per credential. The owner asked for credentials that can each get narrow permissions.
- **The Windows certificate store** (`Windows-MY`): it is Windows only, and the TAK tools give files. It can be added later as another store type.
- **Keep keying by the link's name:** a rename then silently breaks the link.

## Consequences
- **PDA:** the settings field kind for a TLS credential in the next SDK's CR; `cot`'s brief.
- **CDA:**
  - reading `tls-<name>.properties` and PEM;
  - `%emcc%/` in paths;
  - the Monitor's credentials list and the expiry status;
  - the deprecation of the old keys;
  - the field's list of names.
- **PCA-cot:** the field on TLS links, with the link's name as the fallback.
- **ESA:** the TAK Server's client certificate also as PEM; a certificate that expires soon, for the tests.
- **ITA:** a TAK link over TLS with a picked credential, a renamed link, an expired certificate.
- **UDA:** the admin guide's chapter on TLS credentials, with TAK Server's certificates.
- **SRA:** the credentials' handling and permissions.
