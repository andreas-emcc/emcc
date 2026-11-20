package dev.emcc.plugins.cot;

import dev.emcc.plugins.cot.codec.CotEvent;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.document.DocumentResult;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.store.StoreUpdate;
import dev.emcc.sdk.worker.Coalescing;
import java.time.Instant;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * The messages of the {@code applier} worker, which owns all the plugin's state. Answers of the
 * object store, the documents and the connection tasks are always delivered; events from a link
 * are coalesced by uid, so a burst from one device costs one change request (brief function 5).
 */
sealed interface ApplierMsg extends Message {

  /** The complete current settings (at start, and after each accepted change). */
  record SettingsChanged(JsonObject settings) implements ApplierMsg {}

  /** What ECore reports about a link's connection task: it runs, restarts, or ended. */
  record LinkEvent(ConnectionEvent event) implements ApplierMsg {}

  /**
   * A run of a link's task has its connection or its socket: the link is up.
   *
   * @param generation identifies the task the worker started for the link: a message of a task that was stopped meanwhile (the link's
   *     settings changed) arrives after the new one started, and must not be taken for the new task's connection
   */
  record Connected(String link, UUID loop, UUID generation, Instant at) implements ApplierMsg {}

  /**
   * An event a task read, with the run's counters. Events of one link with the same uid replace each
   * other in the mailbox: the latest wins. Events of different links never do: a TAK Server sends every
   * event to every client, so two links on it read each event, and each must keep its own counters and
   * be handled on its own (owner, 2026-10-29, the real TAK Server check).
   *
   * @param loop identifies the run of the task, whose counters these are
   * @param lastDrop why the run dropped its latest event, or {@code null} if it dropped none: the worker logs it, at most once a minute per link
   */
  record Received(String link, UUID loop, Counters counters, @Nullable String lastDrop, CotEvent event) implements ApplierMsg, Coalescing {
    /** The key of an event: the link that read it, and its uid. */
    record Key(String link, String uid) {}

    @Override
    public @Nullable Object coalesceKey() {
      return new Key(link, event.uid());
    }
  }

  /** The counters of a run that has nothing to pass on (dropped and ignored events). Coalesced per link. */
  record Counted(String link, UUID loop, Counters counters, @Nullable String lastDrop) implements ApplierMsg, Coalescing {
    /** The key of a link's counters, apart from any uid. */
    record Key(String link) {}

    @Override
    public @Nullable Object coalesceKey() {
      return new Key(link);
    }
  }

  /**
   * How many events a run of a link's task has written so far, and how many it skipped as expired (a channel item whose expiry
   * passed while it waited), both cumulative. Coalesced per link.
   *
   * @param writing the task is about to write the event after the {@code count} ones written, and has not finished: the same
   *     {@code count} with {@code writing} seen again and again is one write that has not finished (a peer that stopped reading)
   */
  record Written(String link, UUID loop, long count, long expired, boolean writing) implements ApplierMsg, Coalescing {
    /** A count after a write, or after an event was skipped: no write is in progress. */
    Written(String link, UUID loop, long count, long expired) {
      this(link, loop, count, expired, false);
    }

    /** The key of a link's written count. */
    record Key(String link) {}

    @Override
    public @Nullable Object coalesceKey() {
      return new Key(link);
    }
  }

  /**
   * An item another plugin sent to the output channel of a link (brief function 15). Items for the same object replace each
   * other in the mailbox: the latest wins, and a removal replaces an update.
   */
  record FromChannel(String link, ChannelItem item) implements ApplierMsg, Coalescing {
    /** The key of an object's item on one link's channel, apart from the uids of events. */
    record Key(String link, UUID id) {}

    @Override
    public @Nullable Object coalesceKey() {
      return new Key(link, item.id());
    }
  }

  /** The plugin stops: the worker cancels what it subscribed to. */
  record Stop() implements ApplierMsg {}

  /** What the store told about the objects of one source layer (a subscription of the output). */
  record SourceUpdate(UUID layer, long generation, StoreUpdate update) implements ApplierMsg {}

  /** Once a second: status, and a new try for a layer that could not be made. */
  record Tick() implements ApplierMsg {}

  /** The answer to a change of an object. {@code ticket} tells it from an earlier try for the same uid. */
  record ObjectAnswer(String uid, long ticket, ChangeOutcome outcome) implements ApplierMsg {}

  /** The answer to the creation of a new layer; {@code name} is the name the links that wait for it share. */
  record LayerAnswer(String name, long ticket, ChangeOutcome outcome) implements ApplierMsg {}

  /** The subscription to the plugin's objects and the layers. */
  record Stored(StoreUpdate update) implements ApplierMsg {}

  /** The answer to a look-up of one uid. */
  record Looked(String uid, long ticket, QueryResult result) implements ApplierMsg {}

  /** The plugin document with the layers the plugin made. */
  record LayersLoaded(DocumentResult result) implements ApplierMsg {}

  record LayersSaved(DocumentResult result) implements ApplierMsg {}
}
