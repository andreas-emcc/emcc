package dev.emcc.sdk.store;

import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.MapObject;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * Which objects a {@link Store#query} or {@link Store#subscribe} selects. All set criteria must
 * hold; with none set, every object matches. Immutable; the methods return a new query.
 *
 * <pre>{@code
 * ObjectQuery.byExternalRef(new ExternalRef("cot", uid))
 * ObjectQuery.byDataSource("tak-north").ofDataType("cot-in.cot")
 * ObjectQuery.all().within(area).limit(10_000)
 * }</pre>
 *
 * <p><b>Compatibility:</b> the 1.1.0 constructor without {@code workspaces} stays. Do not
 * deconstruct this record with a record pattern: it may gain components in later 1.x versions.
 *
 * @param layerId only objects in this layer, or {@code null}
 * @param dataType only objects of this data type, or {@code null}
 * @param dataSource only objects from this data source, or {@code null}
 * @param externalSystem only objects with an external identity in this system, or {@code null}
 * @param externalRef only the object with this external identity, or {@code null}
 * @param within only objects whose bound reaches into this area of interest (spike S3), or {@code null}
 * @param limit the most objects a {@link Store#query} may return, 1 to {@link #MAX_LIMIT}; a query that matches more fails. Subscriptions ignore it
 * @param workspaces SDK 1.2.0: only objects in layers of these workspaces ({@code core.view} for
 *     View); <b>empty means every workspace</b> (ADR-0039 point 7). Server parts are not filtered,
 *     so unlike every other default this one is not View: a server part that passes objects on to
 *     browsers or outputs filters by workspace itself (ACA note N9)
 */
public record ObjectQuery(
    @Nullable UUID layerId,
    @Nullable String dataType,
    @Nullable String dataSource,
    @Nullable String externalSystem,
    @Nullable ExternalRef externalRef,
    @Nullable Area within,
    int limit,
    Set<String> workspaces) {

  /** The 1.1.0 constructor: every workspace. */
  public ObjectQuery(
      @Nullable UUID layerId, @Nullable String dataType, @Nullable String dataSource, @Nullable String externalSystem,
      @Nullable ExternalRef externalRef, @Nullable Area within, int limit) {
    this(layerId, dataType, dataSource, externalSystem, externalRef, within, limit, Set.of());
  }

  public static final int MAX_LIMIT = 100_000;

  public ObjectQuery {
    workspaces = Set.copyOf(workspaces);
    if (limit < 1 || limit > MAX_LIMIT) {
      throw new IllegalArgumentException("limit must be 1.." + MAX_LIMIT + ": " + limit);
    }
    if (externalRef != null && externalSystem != null && !externalRef.system().equals(externalSystem)) {
      throw new IllegalArgumentException("externalRef " + externalRef + " is not in system " + externalSystem);
    }
  }

  /** Every object (up to the limit). */
  public static ObjectQuery all() {
    return new ObjectQuery(null, null, null, null, null, null, MAX_LIMIT, Set.of());
  }

  public static ObjectQuery byExternalRef(ExternalRef ref) {
    return all().withExternalRef(ref);
  }

  public static ObjectQuery byExternalSystem(String system) {
    return all().withExternalSystem(system);
  }

  public static ObjectQuery byDataSource(String dataSource) {
    return all().fromDataSource(dataSource);
  }

  public ObjectQuery inLayer(UUID value) {
    return new ObjectQuery(Objects.requireNonNull(value, "value"), dataType, dataSource, externalSystem, externalRef, within, limit, workspaces);
  }

  public ObjectQuery ofDataType(String value) {
    return new ObjectQuery(layerId, Objects.requireNonNull(value, "value"), dataSource, externalSystem, externalRef, within, limit, workspaces);
  }

  public ObjectQuery fromDataSource(String value) {
    return new ObjectQuery(layerId, dataType, Objects.requireNonNull(value, "value"), externalSystem, externalRef, within, limit, workspaces);
  }

  public ObjectQuery withExternalSystem(String value) {
    return new ObjectQuery(layerId, dataType, dataSource, Objects.requireNonNull(value, "value"), externalRef, within, limit, workspaces);
  }

  public ObjectQuery withExternalRef(ExternalRef value) {
    return new ObjectQuery(layerId, dataType, dataSource, externalSystem, Objects.requireNonNull(value, "value"), within, limit, workspaces);
  }

  public ObjectQuery within(Area value) {
    return new ObjectQuery(layerId, dataType, dataSource, externalSystem, externalRef, Objects.requireNonNull(value, "value"), limit, workspaces);
  }

  public ObjectQuery limit(int value) {
    return new ObjectQuery(layerId, dataType, dataSource, externalSystem, externalRef, within, value, workspaces);
  }

  /**
   * SDK 1.2.0: only objects in layers of these workspaces, e.g. {@code inWorkspaces("core.view")}
   * for View's only. A workspace named twice counts once.
   *
   * @throws IllegalArgumentException with no workspace: an empty filter would mean every workspace;
   *     leave the filter out for that
   */
  public ObjectQuery inWorkspaces(String... value) {
    if (value.length == 0) {
      throw new IllegalArgumentException("name at least one workspace; without a filter a query takes every workspace");
    }
    return new ObjectQuery(layerId, dataType, dataSource, externalSystem, externalRef, within, limit, Set.copyOf(java.util.Arrays.asList(value)));
  }

  /** SDK 1.2.0: whether a layer of {@code workspace} (its {@code workspace}, {@code null} for View) passes the workspace filter. */
  public boolean matchesWorkspace(@Nullable String workspace) {
    return workspaces.isEmpty() || workspaces.contains(workspace == null ? dev.emcc.sdk.Workspace.VIEW : workspace);
  }

  /**
   * Whether {@code object} matches every criterion except {@link #within}, which needs geodesic
   * geometry (ECore's job), and {@link #workspaces}, which needs the object's layer ({@link
   * #matchesWorkspace}). For ECore and the test kit.
   */
  public boolean matchesAttributes(MapObject object) {
    var content = object.content();
    var ref = object.meta().externalRef();
    return (layerId == null || layerId.equals(content.layerId()))
        && (dataType == null || dataType.equals(content.dataType()))
        && (dataSource == null || dataSource.equals(content.dataSource()))
        && (externalSystem == null || (ref != null && externalSystem.equals(ref.system())))
        && (externalRef == null || externalRef.equals(ref));
  }
}
