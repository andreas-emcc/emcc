# ADR-0064: Compute tasks, on compute threads a plugin declares and ECore owns

- Status: Accepted (owner, YK A, 2026-11-16, through the MCA; proposed by the ACA the same day, with the owner's YG A; YQ1 A in point 4). **Amended by CR-0051 part B** (owner, AAF A, 2026-11-17), after the owner's ZX A in the CDA's C7: points 2 and 5 say that a compute task's CPU time comes from the JVM's thread CPU clock, not JFR
- Date: 2026-11-16
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0004 (concurrency), ADR-0036 (connection tasks)

## Context
Plugins never create threads (ADR-0004, overview 4.2 rule C1). For CPU-heavy work they have the **compute worker** (rule C7): a handler that runs on ECore's shared, bounded pool of platform threads, one message at a time, under the watchdog's budget. It suits jobs that end: `terrain`'s viewshed, `nvg`'s computations.

**A simulated UAV camera is not a job that ends.** At 25 frames a second, a 720p frame takes 36 ms to render on one core (spike S10), so a camera holds about one core for as long as it runs. On the shared pool it would starve every other plugin's jobs, and nothing would show which plugin holds the pool. ADR-0058 therefore put the rendering in ECore, which owns threads. But the rendering then needed format knowledge in ECore: ST 0601, the transport stream's muxing, the imagery and the terrain.

**The owner chose the other way (YG A, 2026-11-16):** a plugin declares the compute threads it needs, and ECore creates, owns, limits and shows them. The format work stays in the plugin that owns the protocol (`fmv`), and ECore keeps only general mechanisms. ADR-0059 applies this to the camera.

## Decision
1. **A plugin declares its compute threads in its manifest:** how many it needs at most, and why, for example `"compute": { "threads": 1, "reason": "renders one simulated camera per thread" }`. The shape is the PDA's CR (SDK 1.9.0, part P).
   - A plugin without the declaration gets no compute thread.
   - The declaration is a ceiling: ECore never runs more of the plugin's compute tasks at once.
2. **A compute task is plugin code that ECore runs on one of those threads, with its own loop**, as a connection task is (ADR-0036 decision 2). The plugin never touches `Thread`, so rule C1 and `PluginRules` still hold. ECore:
   - creates the thread, and starts the task when a worker of the plugin asks through the SDK;
   - stops it when the plugin asks or stops, or when an admin switches the plugin's compute threads off;
   - restarts it with a back-off when it fails, if the plugin asks for that, as for connection tasks;
   - gives it a bounded **inbox** with an overflow policy (`DROP_OLDEST`, `DROP_NEWEST`, `COALESCE_BY_KEY`). The task's `take` waits for the inbox and returns nothing when the task is to stop. The inbox follows the rules of a connection task's inbox (overview 4.2, ADR-0021): senders never wait on it, its lock is a leaf lock, and `take` waits without holding that lock. **It is the second place, after a connection task, where plugin code may wait for data;**
   - fences a stopped task: whatever it posts afterwards is dropped.

   A compute thread is a platform thread, so ECore can measure its CPU time: the JVM's thread CPU clock measures platform threads only (owner, ZX A, 2026-11-17; CR-0051 part B).
3. **What a compute task may do:**
   - CPU work on data it owns: no other task, worker or thread touches that data;
   - receive in its inbox what its plugin's workers post to it, for example `fmv`'s map tiles from its stored cache, and the results of the SDK calls below that it starts, for example the encoded pictures from the conversion service. The PDA's CR fixes how a result reaches the inbox;
   - wait on its inbox; reading its plugin's declared folders is the only other blocking it does;
   - post immutable messages to its plugin's workers, and to its plugin's connection tasks' inboxes;
   - the SDK calls that are named for compute tasks: its counters, its plugin's declared folders (ADR-0049), and the input of ECore's conversion service (ADR-0057 point 8; for raw pictures, ADR-0059).

   **What it may not do:**
   - open sockets (only connection tasks do, ADR-0036), make outbound HTTP calls, or send changes to the object store; those are its plugin's workers' to do;
   - create threads, use parallel streams, take locks, use monitors or blocking synchronizers, or sleep (rules C1 and C4);
   - share mutable state with anything, or start a program (only ECore starts ffmpeg, CR-0045).

   **The hand-over is by immutable messages only** (rule C3), between a compute task and a worker, and between a compute task and a connection task. A picture crosses as an immutable value; the SDK may offer a buffer whose ownership moves with the message, if the sender can no longer touch it. The PDA's CR fixes that.
4. **The limits:**
   - **per plugin:** an admin setting lowers a plugin's compute threads below its declaration, or switches them off (0). Its tasks then do not start, and the plugin's status says why;
   - **in total:** an ECore setting caps the compute threads of all plugins, by default the computer's cores minus one, at least one. **It counts running compute tasks** (owner, YQ1 A): a start that would go above it is refused, with the reason, and counted, and declared threads that are not running block nobody;
   - **no watchdog budget:** a compute task runs a loop, not a handler. A task that does not end within a grace time after its stop is marked hung; its plugin is marked DEGRADED, and the thread may remain until restart (as ADR-0004's consequences say for any stuck thread).
5. **The Monitor shows each plugin's compute threads:** declared, allowed by the admin and running, against the total cap. Per task: its state (starting, running, restarting, stopped, failed with the reason), its **busy share** (the time it does not wait on its inbox), its **CPU time** from the JVM's thread CPU clock (`ThreadMXBean`), read when the Monitor asks, so it does not depend on JFR (ZX A), and the counters the plugin reports through the SDK, such as `fmv`'s late and dropped frames.
6. **The compute worker stays** for jobs that end (rule C7). A compute task is for a loop that holds a core for as long as it runs.

A sketch of the shape, not the API (the PDA designs it):
```java
ComputeRef<Pose> render = context.compute().start("camera-1", Pose.class, task -> {
  for (Pose p; (p = task.take()) != null; ) {
    Picture picture = renderer.render(p);          // CPU only, on data the task owns
    encoder.post(picture);                          // ECore's conversion service, raw pictures in
    task.count("rendered");
  }
}, Restart.backoff(Duration.ofSeconds(1), Duration.ofSeconds(60)));
// in a worker, never blocking:
render.post(pose);
```

## Alternatives considered
- **Compute workers on ECore's shared pool:** a camera would hold a pool thread for as long as it runs and starve other plugins' jobs. The pool is not per plugin, so its use would not show by plugin.
- **ECore renders, in a rendering service** (ADR-0058 point 3 as accepted): ECore would learn ST 0601, the muxing, the imagery and the terrain, which are `fmv`'s protocol. Every later CPU-heavy plugin would need its own ECore service in turn.
- **Plugins create their own threads:** against ADR-0004. Nothing would cap, show or stop them.
- **A separate process per plugin:** a second process protocol next to ffmpeg's, and out-of-process plugins are not planned before "Later" (overview section 6).

## Consequences
- **Easier:** CPU-heavy work that runs continuously stays in the plugin that knows the format. ECore knows each plugin's threads, their CPU time and their busy share.
- **Harder:** an admin sizes the compute threads and the total cap. A computer with few cores runs fewer cameras.
- **On acceptance:** overview 4.2 names the compute task: in rules C1 and C7, in the mechanisms table, in the leaf-lock paragraph (its inbox, as a connection task's), in "plugin code runs only inside the plugin's own workers" (a second exception), and in the inbox wait, now allowed in a compute task too. `CLAUDE.md` section 4's concurrency rule names it as well (the ACA; the owner approves `CLAUDE.md`).
- **PDA:** the compute task in SDK 1.9.0, part P: the manifest's `compute` declaration, the Java API with its inbox, counters and stop, the test kit's fake, and `PluginRules` for compute task code.
- **CDA:** compute tasks in ECore: the threads, the per-plugin setting, the total cap, the stop and the fence, and the Monitor's entries.
- **PCA-fmv:** the first user (ADR-0059).
- **ITA:** a stress test: compute tasks at the cap, a task that will not stop, and the other plugins' workers kept responsive.
- **SRA:** the caps, and a plugin that declares more threads than it needs.
- **UDA:** the admin guide: the per-plugin setting, the total cap and the Monitor's entries.
- **Planning:** M9, track P (owner, YG A).
