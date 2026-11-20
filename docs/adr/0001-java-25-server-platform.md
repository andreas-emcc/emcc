# ADR-0001: Java 25 LTS and Maven for the server

- Status: Accepted
- Date: 2026-10-02
- Deciders: Owner (advised by ACA)

## Context
The server must run on Windows and Linux (Linux being the main target), must be heavily multithreaded without deadlocks, must be maintainable for many years, and must work disconnected. Agents write the code; the owner reviews it and reads Java natively. The geospatial and military ecosystem (GeoTools, JTS, NGA's MGRS libraries, TAK Server) is strongly Java-based.

## Decision
- The server is written in **Java 25 (LTS)**.
- Builds use **Maven** (multi-module). Exact versions of Java and all dependencies are pinned in the build files by the CDA.
- Concurrency uses virtual threads and the mechanisms in [ADR-0004](0004-concurrency-workers-and-messages.md). Preview features are not used.
- Deliverables are self-contained runtime images (built with `jlink`/`jpackage`) for Windows and Linux, so target machines need no separate Java installation.

## Alternatives considered
- **C# / .NET 10:** technically equally capable, with slightly less code in places. Not chosen: shorter support window (.NET 10 support ends November 2028, versus 2030+ for Java 25), weaker server-side geospatial ecosystem, and `async`/`await` makes the threading model harder to keep deadlock-free. The owner also reads Java natively.
- **TypeScript / Node.js:** one language for client and server, but true parallel threads are awkward and requirements depend heavily on them.
- **Go:** excellent concurrency, but in-process plugins are not supported on Windows.
- **Rust:** hard to review, slow to iterate.

## Consequences
- Long support window and a mature production environment on Linux.
- Access to GeoTools, JTS, Proj4J and `mgrs-java`.
- The client is TypeScript ([ADR-0008](0008-web-client-typescript-react.md)), so the system uses two languages. The common data model is therefore specified in a language-neutral form ([ADR-0007](0007-common-data-model.md)).
- Java has no compiler-checked null safety. The CDA and PDA decide on null annotations (e.g. JSpecify) as a coding rule.
