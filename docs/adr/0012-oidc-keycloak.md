# ADR-0012: Identity through OpenID Connect, Keycloak as reference IAM

- Status: Superseded by ADR-0022 (owner, 2026-10-10)
- Date: 2026-10-02
- Deciders: Owner (advised by ACA)

## Context
The application must be protected by an IAM such as Keycloak or similar, from the first demo. Users belong to several groups, and groups decide what users can see and do. The internal demo runs without login.

## Decision
- Authentication uses **OpenID Connect**: Authorization Code flow with PKCE in the browser. The server validates tokens as a Spring Security resource server (in `server/app` only, see [ADR-0002](0002-spring-boot-at-edge-only.md)).
- **Keycloak** is the reference IAM used in development and demos. Any OIDC-compliant IAM can replace it.
- Groups from the token are mapped to emc2 **permissions** by configuration. Plugins declare their permissions in their manifest and check them through the SDK.
- A **development profile without login** is used for the internal demo. It logs a clear warning at every start.

## Alternatives considered
- **Keycloak-specific adapters:** deprecated by Keycloak itself, and they would tie us to one product.
- **Built-in user management:** more work, and does not meet the IAM requirement.

## Consequences
- Login works with any standard IAM.
- Keycloak itself must be installed and available in disconnected environments.
- Label-based access control (later) will combine the token's clearance information with object labels.
