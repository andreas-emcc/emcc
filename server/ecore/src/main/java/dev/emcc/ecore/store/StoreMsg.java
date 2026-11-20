package dev.emcc.ecore.store;

import dev.emcc.ecore.geo.GeoArea;
import dev.emcc.ecore.runtime.ReplyHandle;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.MapObject;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Predicate;
import org.jspecify.annotations.Nullable;

/**
 * Messages of the object store worker. Send them with an ask, so that every one gets an answer.
 *
 * <p>The reads take {@code workspaces} (ADR-0039 point 7): the workspaces whose layers and objects
 * they may return, for a browser's user those it may see ({@link Workspaces#visibleTo}); {@code
 * null} for every workspace, for ECore and the plugins' server parts, which are not filtered.
 */
public sealed interface StoreMsg {

  /**
   * Applies a change request. The answer is the change event (also published on {@link
   * ObjectStore#CHANGES}) or the change rejection (model rule 12). {@code request.source()} must
   * already carry the server-side user (model rule 8). {@code requester} says whom it acts for: a
   * user's request without the permission is refused ({@code PERMISSION_DENIED}) before any other
   * check. Whoever takes a user's request checks this first too (overview 4.4); this is the second
   * line of defence.
   *
   * <p>{@code notSaved} (ADR-0041): an object update that is applied and sent like any other, but
   * not written to the journal. The store accepts it only on an update that changes nothing but a
   * move ({@link ObjectStore#onlyMoved}), and rejects it otherwise ({@code VALIDATION_FAILED}).
   */
  record Apply(ChangeRequest request, Requester requester, boolean notSaved, ReplyHandle<ChangeOutcome> replyTo)
      implements StoreMsg {

    /** A change that is saved, as every change of a user is. */
    public Apply(ChangeRequest request, Requester requester, ReplyHandle<ChangeOutcome> replyTo) {
      this(request, requester, false, replyTo);
    }
  }

  /** Answers with the whole picture as an immutable {@link PictureSnapshot}. */
  record GetSnapshot(ReplyHandle<PictureSnapshot> replyTo) implements StoreMsg {}

  /**
   * Answers with every layer and the objects that match {@code filter}, consistent with one
   * sequence number; with an {@code area}, only objects that reach into it, found through the
   * spatial index, in no particular order. With more than {@code limit} matches it fails, naming
   * the count. {@code filter} is ECore's own code and runs in the store's worker: cheap and
   * non-blocking.
   */
  record Find(@Nullable GeoArea area, Predicate<MapObject> filter, int limit, @Nullable Set<String> workspaces,
      ReplyHandle<PictureSnapshot> replyTo) implements StoreMsg {
    public Find {
      workspaces = workspaces == null ? null : Set.copyOf(workspaces);
    }

    /** In every workspace. */
    public Find(@Nullable GeoArea area, Predicate<MapObject> filter, int limit, ReplyHandle<PictureSnapshot> replyTo) {
      this(area, filter, limit, null, replyTo);
    }

    /** Without an area, in every workspace: every object is tested. */
    public Find(Predicate<MapObject> filter, int limit, ReplyHandle<PictureSnapshot> replyTo) {
      this(null, filter, limit, replyTo);
    }
  }

  /**
   * Answers with what a browser's subscription starts from (spike S3, recommendation 9): every
   * layer, the object count per layer, and the objects that reach into {@code area} (every object
   * without one; none when {@code objects} is false), consistent with one sequence number. The
   * area goes through the spatial index; the objects are in no particular order.
   */
  record GetArea(@Nullable GeoArea area, boolean objects, @Nullable Set<String> workspaces, ReplyHandle<AreaSnapshot> replyTo)
      implements StoreMsg {
    public GetArea {
      workspaces = workspaces == null ? null : Set.copyOf(workspaces);
    }

    /** In every workspace. */
    public GetArea(@Nullable GeoArea area, boolean objects, ReplyHandle<AreaSnapshot> replyTo) {
      this(area, objects, null, replyTo);
    }
  }

  /** The most ids one {@link GetObjects} may ask for (the SDK's {@code MAX_FETCH_IDS}). */
  int MAX_IDS = 1000;
  /** The largest page of a {@link GetLayerPage} (the SDK's {@code MAX_PAGE_SIZE}). */
  int MAX_PAGE_SIZE = 500;

  /**
   * Answers with the objects that have these ids and the ids no object has, each id once, in the
   * order asked for, consistent with one sequence number (CR-0015 item 8). At most {@link #MAX_IDS}.
   */
  record GetObjects(List<UUID> ids, @Nullable Set<String> workspaces, ReplyHandle<FoundObjects> replyTo) implements StoreMsg {
    public GetObjects {
      if (ids.size() > MAX_IDS) {
        throw new IllegalArgumentException("at most " + MAX_IDS + " ids: " + ids.size());
      }
      ids = List.copyOf(ids);
      workspaces = workspaces == null ? null : Set.copyOf(workspaces);
    }

    /** In every workspace. */
    public GetObjects(List<UUID> ids, ReplyHandle<FoundObjects> replyTo) {
      this(ids, null, replyTo);
    }
  }

  /**
   * Answers with page {@code page} (from 0) of a layer's objects, {@code pageSize} (1 to {@link
   * #MAX_PAGE_SIZE}) to a page, in id order, also for a layer no browser shows (CR-0015 item 9); or
   * {@link LayerPage.NoLayer}.
   */
  record GetLayerPage(UUID layerId, int page, int pageSize, @Nullable Set<String> workspaces, ReplyHandle<LayerPage> replyTo)
      implements StoreMsg {
    public GetLayerPage {
      if (page < 0 || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        throw new IllegalArgumentException("page from 0, pageSize 1 to " + MAX_PAGE_SIZE + ": " + page + ", " + pageSize);
      }
      workspaces = workspaces == null ? null : Set.copyOf(workspaces);
    }

    /** In every workspace. */
    public GetLayerPage(UUID layerId, int page, int pageSize, ReplyHandle<LayerPage> replyTo) {
      this(layerId, page, pageSize, null, replyTo);
    }
  }

  /**
   * Deletes up to {@code max} objects that are due for removal by the {@link Removal} of their
   * data type (types without one are never removed), each by an ordinary delete change request of
   * {@code core}, with its change event (data model rule 15). Checked and deleted in one go, so an
   * object renewed meanwhile is not removed. Answers how many were removed.
   */
  record RemoveExpired(Map<String, Removal> byDataType, int max, ReplyHandle<Integer> replyTo) implements StoreMsg {
    public RemoveExpired {
      byDataType = Map.copyOf(byDataType);
    }
  }
}
