# ADR-0022: Login on the server side with OpenID Connect, and a no-login mode

- Status: Accepted (owner, 2026-10-10)
- Date: 2026-10-10
- Deciders: Owner (advised by the ACA)
- Supersedes: ADR-0012 (identity through OpenID Connect, Keycloak as reference IAM)

## Context
ADR-0012 chose OpenID Connect with Keycloak as the reference IAM. The browser was to run the Authorization Code flow with PKCE itself and send tokens to the server, which validates them as a resource server. A development profile without login served the internal demo.

Planning M1 (2026-10-10) showed that the browser-side flow does not fit two other decisions:
- **The Content-Security-Policy** allows the browser to connect only to the emc2 server (`connect-src 'self'`, ADR-0014, overview 4.5). A browser-side flow must call the IAM's token endpoint, and silent renewal usually needs a frame from the IAM.
- **A WebSocket cannot carry an `Authorization` header** from a browser. The token would have to travel in the URL, where logs and history keep it, or in a message of our own protocol.

Tokens held in the browser can also be read by every web part.

The owner also wants the server to keep starting without login, as a supported mode: for portable use on one computer, for demonstrations and for tests (2026-10-10).

## Decision
1. **OpenID Connect, Keycloak as the reference IAM.** Any OIDC-compliant IAM can replace Keycloak. Keycloak runs as a separate local service. It is not shipped with emc2. (Unchanged from ADR-0012.)
2. **The login runs on the server side.** The edge (`server/app` only, ADR-0002) runs the Authorization Code flow with PKCE as a confidential client. Tokens stay on the server and never reach the browser.
3. **The browser holds only a session cookie:** `HttpOnly`, `Secure` when served over HTTPS, and `SameSite=Lax`. State-changing HTTP requests are also checked for an allowed `Origin`.
4. **The WebSocket handshake carries the session cookie.** The edge accepts it only for a logged-in session and an allowed `Origin`, as it already checks the `Origin`.
   - The live session belongs to that user. `source.user` comes from the login, never from the client.
   - When the login session ends (logout, expiry, refused renewal), the server closes that user's WebSockets.
5. **Permissions:** groups or roles from the IAM map to emc2 permissions through configuration. Plugins declare their permissions in the manifest and check them through the SDK. (Unchanged from ADR-0012.)
6. **No secrets in the repository:** the client secret is local configuration, ignored by git (`CLAUDE.md` section 4).
7. **No-login mode:** a supported mode, chosen by configuration, not only a development profile.
   - There is one built-in local user, who has all permissions.
   - The server logs a clear warning at every start, and the browser shows a visible "No login" mark, so that nobody takes it for a protected system.
   - The server listens on loopback only, unless a second, explicit setting allows other addresses. Then it logs a warning at start as well.
   - **No silent fallback:** a server configured for login that cannot reach its IAM does not switch to no-login mode. The release's start script may choose no-login mode, so that a portable installation works without Keycloak.
8. **Access by security label is not part of M1** (owner, 2026-10-10). It comes later, as `requirements.md` says, and follows ADR-0020 then. In M1 every user sees every object and layer. Permissions decide what users may do.

## Alternatives considered
- **The browser-side flow of ADR-0012.**
  - The CSP would have to allow the IAM's address for connections and frames.
  - Every web part could read the tokens.
  - The WebSocket would need the token in its URL or in a message of its own.
- **A token in the WebSocket URL:** simple, but the token ends up in server logs, proxies and the browser history.
- **No login only in a development profile, as in M0:** does not allow the portable use the owner wants.
- **Falling back to no-login mode when the IAM is unreachable:** convenient, but a configuration fault would then open the system without anyone noticing.

## Consequences
- **The Content-Security-Policy stays `'self'`.** The IAM's login page is a top-level navigation, not a connection or a frame.
- **The server holds login sessions in memory.** A restart logs users out. Several servers (later) need sticky sessions or a shared session store.
- **HTTPS is needed outside loopback** for the `Secure` cookie. Behind a reverse proxy the edge must trust forwarded headers (already noted by the CDA for the host check).
- **The CDA builds:**
  - the login with Spring Security's OAuth2 client (Apache-2.0) in `server/app`;
  - the session handling and the user on the live session;
  - the permission mapping and the no-login mode.

  It replaces the M0 rule "the server only starts with the `dev` profile".
- **SDK v1 (PDA)** gives plugins the user's permissions: on the server for checks, and in the browser so that a web part can show read-only panels.
- **The ITA** runs the M1 flows with login and in no-login mode. A Keycloak test realm is set up by a script, and its secrets are made locally, never committed. Keycloak must be installed on the test machine. The development machine has no Docker (2026-10-10), so the owner installs Keycloak there by hand.
- **The SRA** reviews:
  - the session cookie and the `Origin` checks;
  - logout and session end, and the redirect URIs;
  - the no-login mode's network setting.
- **The M0 risk that the server believes the plugin id sent by the browser** (`source.plugin`, `server/live-picture-protocol.md`) remains. With login it is limited to logged-in users. Revisit it before any untrusted web part.
- ADR-0012 is superseded. The label timing in ADR-0020's context ("M1") is replaced by point 8. ADR-0020's rule itself is unchanged. ADR-0018's "later security work (M1)", rejections that reveal nothing the user may not see, applies when access by label comes. The "token validation" in ADR-0002's context means the server-side login of this ADR.
