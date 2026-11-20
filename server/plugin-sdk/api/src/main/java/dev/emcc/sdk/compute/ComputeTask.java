package dev.emcc.sdk.compute;

import dev.emcc.sdk.Message;

/**
 * SDK 1.9.0 (CR-0048 point 5; ADR-0064 point 2): plugin code that ECore runs on a compute thread,
 * with its own loop. It returns when {@link ComputeContext#take} gives {@code null}, or when it is
 * done; a throw ends it as failed, and ECore restarts it if its spec asks.
 *
 * <pre>{@code
 * final class Renderer implements ComputeTask<Pose> {
 *   private final WorkerRef<LinkMsg> link;
 *   Renderer(WorkerRef<LinkMsg> link) { this.link = link; }
 *
 *   public void run(ComputeContext<Pose> task) {
 *     for (Pose p; (p = task.take()) != null; ) {
 *       Bytes picture = Bytes.of(render(p));   // CPU only, on data the task owns
 *       task.send(link, new LinkMsg.Picture(p.time(), picture));
 *       task.count("rendered", 1);
 *     }
 *   }
 * }
 * }</pre>
 *
 * <p><b>Write it as a class</b>, not a lambda: {@code PluginRules} checks the classes that implement
 * it, and a lambda's code belongs to its enclosing class.
 *
 * <p>ECore makes a new instance from the factory for every start and restart, so a task's fields
 * are its own. {@code PluginRules} checks what a class implementing it may use.
 *
 * @param <I> the type of the task's inbox items
 */
@FunctionalInterface
public interface ComputeTask<I extends Message> {

  /** Runs the task's loop until it is to stop or is done. */
  void run(ComputeContext<I> task) throws Exception;
}
