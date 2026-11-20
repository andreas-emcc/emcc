# ADR-0021: ECore may share only leaf locks between plugins

- Status: Accepted (owner, 2026-10-07)
- Date: 2026-10-07
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0004 (concurrency through core-managed workers and messages)

## Context
ADR-0004 prevents deadlocks between plugins by design, with "no shared locks". Rule C4 (overview 4.2), tightened by the owner on 2026-10-05, says that plugins use no locks at all, and that ECore's own code never shares a lock between plugins.

The worker runtime (T-011) guards each worker's bounded mailbox with a `ReentrantLock` and two conditions, as the JDK's blocking queues do. Every thread that sends a message to a worker takes that lock briefly while it queues the message, so threads of different plugins take the same lock. Read literally, that breaks C4. The CDA asked whether it is allowed (T-011 review, 2026-10-05).

The purpose of the rule is that no plugin can make another plugin hang. A deadlock needs at least two locks taken in opposite orders by two threads, or code that waits while holding a lock.

## Decision
1. **Plugins use no locks, monitors or blocking synchronizers.** Unchanged.
2. **ECore may use an internal lock that threads of several plugins take only if it is a leaf lock.** A leaf lock meets three conditions:
   1. no plugin code and no hook runs while it is held;
   2. no other lock is taken while it is held;
   3. plugins cannot see it or wait on it.
3. **Every other lock that threads of more than one plugin can take is forbidden** in ECore.
4. The conformance review checks every lock in ECore code against these conditions.

## Alternatives considered
- **Keep C4 literal and make the mailbox lock-free.** That would need a compare-and-swap queue for many senders that still supports in-place coalescing, capacity limits and eviction of the oldest message. It is much harder to get right, raises the risk of subtle bugs, delays the object store (T-012) and the plugin host (T-015), and gains nothing in practice. It would also rule out the JDK's blocking queues inside ECore.
- **No rule for ECore's own locks.** Loses the guarantee that ECore itself cannot deadlock plugins.

## Consequences
- **A leaf lock cannot take part in a deadlock.** No other lock is taken while it is held, and no plugin code runs that could wait. ADR-0004's "no shared locks" therefore means: no shared locks except leaf locks.
- **ECore complies as built.** Checked on 2026-10-07, on `main` at `91a0746`. No code change is needed.
  - **The mailbox lock** is the only lock that threads of several plugins take. The coalescing key is computed before the lock is taken, the drop hooks run after it is released, and `BLOCK_SENDER`, the only wait on the lock, has a timeout and is not offered to plugins (SDK v0).
  - **The other locks** (`synchronized` in `WorkerCell`, `Owner`, `WorkerRuntime` and `PluginEndpoints`) belong to one worker, one plugin or ECore itself. They guard only bookkeeping and run no plugin code.
- **Contention:** senders to one busy worker wait for each other only as long as a queue update takes. That is a performance matter, not a hang, and bounded mailboxes with their overflow policies limit it.
- `docs/architecture/overview.md` (rule C4 in section 4.2), `CLAUDE.md` section 4 and the conformance reviewer are updated.
