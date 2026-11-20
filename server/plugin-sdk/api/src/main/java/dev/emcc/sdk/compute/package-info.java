/**
 * Compute tasks (SDK 1.9.0; ADR-0064, CR-0048 point 5): CPU-heavy plugin code that runs as a loop
 * for as long as it is needed, e.g. {@code fmv}'s renderer of a simulated camera, on a compute
 * thread that ECore creates, owns, caps and shows in the Monitor.
 *
 * <p><b>The declaration:</b> a plugin that starts compute tasks declares them in its manifest,
 * {@code "compute": { "threads": 1, "reason": "…" }}: how many may run at once, at most, and why.
 * A plugin without it gets none. An admin may lower the number for the plugin, or switch it off
 * (0), at run time in the plugin's Settings entry (owner PQ1 A); an ECore setting caps the running
 * compute tasks of all plugins together ({@code emc2.compute.max-threads}, by default the
 * computer's cores minus one, at least one). A start above either is refused ({@link
 * ComputeEvent.Refused}).
 *
 * <p><b>What a task may do</b> (ADR-0064 point 3): CPU work on data it owns; wait on its inbox
 * ({@link ComputeContext#take}, {@link ComputeContext#poll}); read its plugin's declared folders
 * ({@link ComputeContext#folders}); send immutable messages to its plugin's workers ({@link
 * ComputeContext#send}) and post to its plugin's connection tasks ({@code ConnectionRef.post});
 * count and describe itself for the Monitor. <b>What it may not do:</b> open sockets, make HTTP
 * calls, use the store, documents, channels, streams, topics, timers or workers (those are its
 * plugin's workers'), create threads, take locks, sleep, share mutable state, or start a program.
 * {@code PluginRules} checks the classes that implement {@link ComputeTask}.
 *
 * <p><b>Pictures and other large values</b> cross as {@link dev.emcc.sdk.Bytes}, one copy into an
 * immutable value (CR-0048 point 5.6, owner PQ4 A).
 *
 * <p>The compute worker (rule C7) stays for jobs that end.
 */
@NullMarked
package dev.emcc.sdk.compute;

import org.jspecify.annotations.NullMarked;
