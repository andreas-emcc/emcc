# ADR-0004: Concurrency through core-managed workers and messages

- Status: Accepted
- Date: 2026-10-02
- Deciders: Owner (advised by ACA)

## Context
A lot of work happens in parallel: users editing, external systems sending data, plugins processing. The requirements demand no deadlocks or race conditions, that one hung thread must not hang the application, and advanced monitoring of what plugins do. Letting each plugin create and synchronize its own threads makes all three nearly impossible to guarantee.

## Decision
- Plugins **never create threads, executors or thread pools**. They request thread-like mechanisms from ECore through the SDK:
  - **Worker:** a mailbox plus a handler, running on a virtual thread, handling one message at a time.
  - **Listener:** a dedicated virtual thread with a loop for blocking I/O. It posts what it receives as messages.
  - **Timer:** sends a message to a worker once or periodically.
  - **Compute worker:** runs CPU-heavy work on a bounded pool of platform threads.
- Workers share no mutable state. They communicate **only through immutable messages**. Request/reply always has a **timeout**.
- Mailboxes are **bounded**, with a declared overflow policy (`BLOCK_SENDER`, `DROP_OLDEST`, `DROP_NEWEST`, `COALESCE_BY_KEY`).
- A **watchdog** gives each handler call a time budget. Workers that exceed it are marked HUNG and reported, and are restarted if declared restartable. Otherwise their plugin is marked DEGRADED.
- The rules are enforced by architecture tests (ArchUnit) in the build and by the ITA's stress tests.

The full rule set (C1–C8) is in [overview section 4.2](../architecture/overview.md#42-concurrency-model-normative).

## Alternatives considered
- **Plugins manage their own threads and locks:** maximum freedom, but deadlocks and races become likely and monitoring per plugin becomes impossible.
- **An actor framework (e.g. Akka/Pekko):** proven, but large. It would leak into the plugin API and has to be learned by every agent. Our needs are covered by a small in-house runtime built on standard Java.
- **Structured concurrency (Java):** still a preview feature in Java 25. It can be adopted inside ECore once it is final.

## Consequences
- Deadlocks between plugins are prevented by design: no shared locks, and every wait has a timeout.
- ECore knows exactly which plugin runs which worker, so thread counts, queue lengths and processing times per plugin are exact.
- A thread stuck in native code or an endless loop cannot be forcibly stopped in Java. It is detected, isolated and reported, but its thread may remain until restart.
- Plugin authors write message handlers instead of threads. The PDA's design pattern must make this easy.
