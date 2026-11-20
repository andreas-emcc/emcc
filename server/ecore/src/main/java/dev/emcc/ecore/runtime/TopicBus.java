package dev.emcc.ecore.runtime;

import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Publish/subscribe on typed topics (overview 4.3). Publishing never blocks: each subscriber gets
 * the payload through its own mailbox and overflow policy. The subscriber's mapper runs in the
 * subscriber's worker; the coalescing key is taken from the payload.
 *
 * <p>The publisher's type decides (G19, M9 C9): a publish reaches the subscriptions made with the
 * same payload class, and skips any other, with one WARN per such subscription. Nothing about a
 * topic's type is kept between publishes, so a subscriber can never make the owner's publish fail,
 * and a plugin that restarts with its classes loaded again publishes as before.
 */
final class TopicBus {

  private static final Logger LOG = LoggerFactory.getLogger(TopicBus.class);

  /** Identity semantics on purpose: two equal-looking subscriptions are still two. */
  private static final class Subscription<T, M> {
    final Class<T> type;
    final WorkerCell<M> cell;
    final Function<? super T, ? extends M> mapper;
    final AtomicBoolean warned = new AtomicBoolean();

    Subscription(Class<T> type, WorkerCell<M> cell, Function<? super T, ? extends M> mapper) {
      this.type = type;
      this.cell = cell;
      this.mapper = mapper;
    }

    SendOutcome deliver(Object payload) {
      T typed = type.cast(payload);
      return cell.deliver(Envelope.deferred(() -> mapper.apply(typed), cell.keyOf(typed)));
    }
  }

  private final ConcurrentHashMap<String, CopyOnWriteArrayList<Subscription<?, ?>>> topics =
      new ConcurrentHashMap<>();
  /** Where a skipped subscription is reported; a test may replace it. */
  volatile Consumer<String> warn = LOG::warn;

  <T, M> Cancellable subscribe(Topic<T> topic, WorkerCell<M> cell, Function<? super T, ? extends M> mapper) {
    CopyOnWriteArrayList<Subscription<?, ?>> subscribers =
        topics.computeIfAbsent(topic.name(), name -> new CopyOnWriteArrayList<>());
    Subscription<T, M> subscription = new Subscription<>(topic.type(), cell, mapper);
    subscribers.add(subscription);
    return () -> subscribers.remove(subscription);
  }

  /** Delivers {@code payload} to every subscriber of the topic's type. Returns how many accepted it. */
  <T> int publish(Topic<T> topic, T payload) {
    Objects.requireNonNull(payload, "payload");
    if (!topic.type().isInstance(payload)) {
      throw new IllegalArgumentException(
          "payload of type " + payload.getClass().getName() + " does not match topic " + topic);
    }
    CopyOnWriteArrayList<Subscription<?, ?>> subscribers = topics.get(topic.name());
    if (subscribers == null) {
      return 0;
    }
    int accepted = 0;
    for (Subscription<?, ?> s : subscribers) {
      if (s.type != topic.type()) {
        if (!s.warned.getAndSet(true)) {
          warn.accept("Topic " + topic.name() + " is published with " + describe(topic.type()) + "; a subscription made with "
              + describe(s.type) + " gets nothing");
        }
        continue;
      }
      SendOutcome outcome = s.deliver(payload);
      if (outcome == SendOutcome.ACCEPTED) {
        accepted++;
      } else if (outcome == SendOutcome.CLOSED) {
        subscribers.remove(s); // the subscriber is stopped
      }
    }
    return accepted;
  }

  /** The class's name and its loader's, since a plugin's classes are loaded again at each start. */
  private static String describe(Class<?> type) {
    ClassLoader loader = type.getClassLoader();
    return type.getName() + " (" + (loader == null || loader.getName() == null ? "core" : loader.getName()) + ")";
  }
}
