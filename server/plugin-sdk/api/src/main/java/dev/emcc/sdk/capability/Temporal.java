package dev.emcc.sdk.capability;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.WorkerRef;
import java.util.Objects;
import java.util.function.Function;

/**
 * SDK 1.4.0: the capability {@code temporal} (ADR-0045; {@link Capability#TEMPORAL}). A plugin
 * whose manifest declares {@code "capabilities": ["temporal"]} implements it on its {@code Plugin}
 * class, and ECore tells it each browser session's {@link dev.emcc.sdk.UserTime}.
 *
 * <p><b>What ECore does:</b> after {@code init} and before {@code start}, it asks once for {@link
 * #timeDelivery()}. From then on it sends the plugin's worker a {@link SessionTimeChange} for every
 * session at its start and at each change, mapped by the delivery's function. The value is always
 * the whole {@code UserTime}, its set time and its interval (CR-0032): <b>one delivery per change of
 * either part</b> (the ACA's R4 on CR-0032). <b>When a session ends</b> it delivers {@code
 * UserTime.NOW}, both parts at their defaults, for it once (owner, Q10, 2026-11-06), for every
 * session, also one that was at now (the ACA's R2 on part 4), so a plugin that keeps only sessions
 * with another time forgets it. Each endpoint request carries its session's time too
 * ({@code EndpointRequest.userTime()}).
 *
 * <pre>{@code
 * public final class HistoryPlugin implements Plugin, Temporal {
 *   private WorkerRef<HistoryMsg> worker;
 *   public void init(PluginContext context) {
 *     worker = context.workers().spawn(WorkerSpec.of("history", HistoryMsg.class, HistoryWorker::new));
 *   }
 *   public Delivery<?> timeDelivery() {
 *     return Temporal.deliver(worker, HistoryMsg.TimeChanged::new);
 *   }
 *   ...
 * }
 * }</pre>
 */
public interface Temporal {

  /** Where and how ECore delivers the sessions' times. Called once, after {@code init}. */
  Delivery<?> timeDelivery();

  /** A delivery to {@code target}, each change wrapped by {@code mapper}. */
  static <M extends Message> Delivery<M> deliver(WorkerRef<M> target, Function<SessionTimeChange, ? extends M> mapper) {
    return new Delivery<>(target, mapper);
  }

  /**
   * A worker and the function that turns a change into its message.
   *
   * @param target the worker that gets the changes
   * @param mapper wraps a change into the worker's message
   */
  record Delivery<M extends Message>(WorkerRef<M> target, Function<SessionTimeChange, ? extends M> mapper) {
    public Delivery {
      Objects.requireNonNull(target, "target");
      Objects.requireNonNull(mapper, "mapper");
    }

    /** Sends {@code change} to the worker, as ECore and the test kit do. */
    public void deliver(SessionTimeChange change) {
      target.send(mapper.apply(change));
    }
  }
}
