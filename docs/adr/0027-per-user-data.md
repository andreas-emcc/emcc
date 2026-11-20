# ADR-0027: A core store for each user's own data

- Status: Accepted (owner, 2026-10-10)
- Date: 2026-10-10
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0024 (persistence manager)

## Context
From M2, users keep personal things in the web application (owner, 2026-10-10):
- their **map bookmarks** in a folder tree;
- their **workspace layout** (ADR-0026);
- the **dim level** of the map;
- their choice of **clock**.

These should follow the user to any browser and computer, not stay in one browser. The persistence manager (ADR-0024) stores objects, layers, plugin documents and settings, but nothing per user. Web parts of plugins have no storage access at all.

## Decision
1. **ECore keeps documents per user**: JSON documents keyed by the user, a namespace and a name.
   - The namespace is the plugin id, or `core` for the shell. `core` is ECore's own id, which no plugin may use.
   - They are stored through the persistence manager like everything else (ADR-0024).
2. **A plugin reaches only its own namespace, and only for the current user**, from its web part and from its server part, through the SDK. It never reaches another plugin's namespace or another user's documents.
3. **The user is the logged-in user** (ADR-0022), keyed by the IAM's stable user id (the OIDC `sub` claim), never by the display name. In the no-login mode it is the single local user.
4. **Limits per document and per user**, set by ECore, keep one user or plugin from filling the storage.
5. **The documents belong to their user and are not shared.** They are not map objects, carry no security label, and must not hold copies of objects. Sharing, for example shared bookmark folders, is a later decision.
6. **The last write wins**, when the same user writes the same document from two browsers. A browser reads the documents at start, so a reload shows the newest state.

## Alternatives considered
- **Browser storage (`localStorage`):** no server work, but it stays in one browser, is lost when the browser's data is cleared, and does not follow the user.
- **User attributes in the IAM:** tied to Keycloak, small, and not available in the no-login mode.
- **Map objects in a private layer:** objects are shared, labelled and live for everyone, which is wrong for personal settings.

## Consequences
- **The persistence manager (CDA)** stores user documents: in the file store first, in PostgreSQL later.
- **The SDK (PDA)** gets the user document calls for web and server parts, as a compatible addition.
- **First users:** the shell (layout, clock), `bookmarks` (folders and bookmarks), and `map-view-2d` (dim level).
- **The SRA checks** that no request can read or write another user's or another plugin's documents.
- Deleting a user's data (for example when an account is removed) is decided later.
