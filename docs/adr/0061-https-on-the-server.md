# ADR-0061: HTTPS on the server, with a certificate the admin configures

- Status: Accepted (owner, YK A, 2026-11-16, through the MCA; proposed by the ACA the same day; M9, "productification")
- Date: 2026-11-16
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0022 (login on the server side), ADR-0060 (settings and credentials files)

## Context
**The Spring Boot edge serves plain HTTP only.** There is no `server.ssl` setting. The readme and the manual say to use HTTPS, or a reverse proxy that ends TLS, anywhere but on the server's own computer. ADR-0022 needs HTTPS outside loopback:
- the session cookie is `Secure` only over HTTPS;
- the OIDC redirect must be HTTPS.

**What the server already does over HTTPS:** HSTS is sent only over HTTPS (`SecurityConfiguration`), and the host check and the proxy settings exist (`server.forward-headers-strategy=native`).

A product must be able to run with HTTPS **without a proxy in front of it**.

## Decision
1. **The edge serves HTTPS itself when an admin configures a certificate.** It does so through a Spring Boot SSL bundle named `emcc`, used by the server (`server.ssl.bundle=emcc`). Without one it serves HTTP as today.
2. **Certificate formats:**
   - **PKCS#12** (`.p12`, `.pfx`) is the recommended one: it is Java's default key store, and it is what Windows' certificate export and most CAs give;
   - **PEM** (the certificate chain and the private key as files) for certificates from a CA that issues PEM;
   - JKS is read too, for existing Java key stores.
3. **Where the certificate and its password live** (ADR-0060):
   - in `settings/credentials/https.properties`, as **Spring Boot's own SSL bundle keys** for the bundle `emcc`: `spring.ssl.bundle.jks.emcc.keystore.*` (location, password, type `PKCS12` or `JKS`) with `spring.ssl.bundle.jks.emcc.key.alias` where the store holds more than one key, or `spring.ssl.bundle.pem.emcc.keystore.*` (certificate, private key, its password) for PEM. Paths may start with `%emcc%/`;
   - the key store file itself beside it in `settings/credentials/`, with the same narrow permissions;
   - **the password is never in `emcc.properties`, on the command line or in the service's definition.** An environment variable may hold it instead;
   - a PEM key may be unencrypted, with the file's permissions as its protection, or encrypted with a password kept in the same file.
4. **One port.** With HTTPS on, plain HTTP is off. An optional second port that only redirects to HTTPS is a setting, off by default (owner, 2026-11-16, M9 plan Q3 A).
5. **TLS 1.2 and 1.3 only,** with the JDK's default cipher suites. WebSockets run on the same port as `wss`.
   - **HSTS** stays as today, sent only over HTTPS. Its lifetime becomes a setting, and the admin guide warns that HSTS with a test certificate the browser does not trust can lock that browser out of the host name until the lifetime ends.
6. **A renewed certificate applies without a restart** where Spring Boot can reload the bundle (`reload-on-update`); otherwise at the next start. The Monitor shows the certificate's subject, issuer and expiry date, and warns 30 days before it expires.
7. **Login:** the IAM's redirect URIs for emcc must be `https://` once HTTPS is on. The admin guide says so for Keycloak. The no-login mode may use HTTPS too; on loopback, HTTP stays the default.
8. **emcc does not make certificates.** The admin guide shows how to make a self-signed one with the JDK's `keytool` for a test. The test services' CA is the ESA's.
9. **A reverse proxy that ends TLS stays supported,** with the settings it has today.

## Alternatives considered
- **A proxy only** (nginx, IIS or similar in front): a second product to install and run; it remains possible (point 9).
- **A certificate made by emcc at its first start:** browsers warn about it anyway, and an installation's certificate is the organisation's to issue.
- **Only PKCS#12:** some CAs and tools issue PEM, and converting a key with `openssl` is a step that admins get wrong.
- **The password in `emcc.properties`:** that file is readable by more people than the credentials are (ADR-0060).

## Consequences
- **CDA:** the SSL bundle from `https.properties`, the optional redirect port, the certificate's entry in the Monitor, the start scripts' printed addresses (with the MCA).
- **MCA:** the release's `https.properties` template; `start.bat` and the service print `https://` when HTTPS is on.
- **ESA:** a test CA and a certificate for emcc's test server; Keycloak's demo client with an `https://` redirect for the HTTPS tests.
- **ITA:** HTTPS specs: login, the WebSocket, the cookie's `Secure` flag, HSTS, the redirect port, a renewed certificate.
- **UDA:** the admin guide's HTTPS chapter: formats, where the files go, `keytool` for a test certificate, the IAM's redirect URIs.
- **SRA:** the TLS settings and the key's protection.
