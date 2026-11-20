package dev.emcc.ecore.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.InvalidDocumentException;
import dev.emcc.ecore.json.ModelJson;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The one-time migration of stored M0 data (data model 0.1.0) to 1.0.0 (model README, "Migration";
 * the ACA's review points N1 and N6).
 */
class MigrationTest {

  private static final ModelJson JSON = new ModelJson();
  private static final Path EXAMPLES = Path.of("../../model/examples/migration/0.1.0-to-1.0.0");
  private static final String LAYER = "0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01";
  private static final String SYMBOL = "0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e11";
  private static final String POLAR = "0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e15";
  private static final String PRECISE = "0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e19";

  @TempDir Path dir;

  @Test
  void ecoreKnowsTheDataModelVersionOfTheSchemas() throws IOException {
    Matcher version = Pattern.compile("\"version\"\\s*:\\s*\"([^\"]+)\"").matcher(Files.readString(Path.of("../../model/package.json")));
    assertThat(version.find()).isTrue();
    assertThat(ModelJson.DATA_MODEL).isEqualTo(version.group(1));
  }

  @TestFactory
  Stream<DynamicTest> eachExampleBecomesItsAfterFile() throws IOException {
    try (Stream<Path> files = Files.list(EXAMPLES.resolve("before"))) {
      return files.sorted().toList().stream().map(before -> DynamicTest.dynamicTest(before.getFileName().toString(), () -> {
        JsonNode tree = JSON.parse(Files.readString(before));
        JsonNode after = JSON.parse(Files.readString(EXAMPLES.resolve("after").resolve(before.getFileName())));
        JsonNode migrated = tree.has("layerId") ? Migration.object(tree) : tree; // layers are unchanged
        assertThat(migrated).isEqualTo(after);
      }));
    }
  }

  @Test
  void anObjectThatHasAFieldNewIn100IsNot010Data() {
    ObjectNode object = (ObjectNode) example("before", "object-symbol.json");
    for (String field : List.of("dataType", "dataSource", "time")) {
      ObjectNode with = object.deepCopy();
      with.put(field, "x");
      assertThatThrownBy(() -> Migration.object(with)).isInstanceOf(InvalidDocumentException.class)
          .satisfies(e -> assertThat(((InvalidDocumentException) e).problems()).singleElement()
              .satisfies(p -> assertThat(p.path()).isEqualTo("/" + field)));
    }
  }

  /**
   * N1: M0 data with a journal. The journal is folded into the snapshot (an update, a delete and a
   * create, all 0.1.0), the result is migrated, the old files are kept, and the next start does not
   * migrate again.
   */
  @Test
  void m0DataWithAJournalIsMigratedOnceWithTheJournalFoldedIn() throws IOException {
    String snapshot = snapshot010(10, example("before", "layer.json"),
        example("before", "object-symbol.json"), example("before", "object-shape-polygon-polar.json"),
        example("before", "object-extension-high-precision.json"));
    UUID created = UUID.randomUUID();
    String journal = String.join("\n",
        event010(11, "update", SYMBOL, 4L, 3L, withVersion(example("before", "object-symbol.json"), 4)),
        event010(12, "delete", POLAR, 2L, 1L, null),
        event010(13, "create", created.toString(), 1L, null, newObject(created)), "");
    Files.writeString(dir.resolve(FileStore.SNAPSHOT), snapshot);
    Files.writeString(dir.resolve(FileStore.JOURNAL), journal);

    PictureStore.Stored stored = loadAndClose();

    assertThat(stored.journal()).isEmpty();
    assertThat(stored.snapshot().sequenceNo()).isEqualTo(13);
    assertThat(stored.snapshot().layers()).singleElement().satisfies(l -> assertThat(l.id()).hasToString(LAYER));
    Map<String, MapObject> objects = stored.snapshot().objects().stream().collect(Collectors.toMap(o -> o.id().toString(), Function.identity()));
    assertThat(objects).containsOnlyKeys(SYMBOL, PRECISE, created.toString());
    assertThat(objects.get(PRECISE)).as("untouched by the journal: exactly its after file")
        .isEqualTo(JSON.readMapObject(Files.readString(EXAMPLES.resolve("after/object-extension-high-precision.json"))));
    assertThat(objects.get(SYMBOL).version()).as("the version does not change").isEqualTo(4);
    assertThat(objects.values()).allSatisfy(o -> {
      assertThat(o.content().dataType()).isEqualTo(MapObjectContent.GENERAL);
      assertThat(o.content().dataSource()).isEqualTo(MapObjectContent.MANUAL);
    });

    assertThat(Files.readString(dir.resolve(FileStore.SNAPSHOT))).contains("\"dataModel\":\"" + dev.emcc.ecore.json.ModelJson.DATA_MODEL + "\"");
    assertThat(Files.readString(dir.resolve(FileStore.JOURNAL))).isEmpty();
    Path kept = dir.resolve(FileStore.KEPT_0_1_0);
    assertThat(Files.readString(kept.resolve(FileStore.SNAPSHOT))).isEqualTo(snapshot);
    assertThat(Files.readString(kept.resolve(FileStore.JOURNAL))).isEqualTo(journal);

    deleteKept();
    PictureStore.Stored again = loadAndClose();
    assertThat(again.snapshot()).isEqualTo(stored.snapshot());
    assertThat(kept).as("migrated only once").doesNotExist();
  }

  @Test
  void m0DataWithOnlyAJournalIsMigrated() throws IOException {
    UUID layer = UUID.fromString(LAYER);
    UUID created = UUID.randomUUID();
    Files.writeString(dir.resolve(FileStore.JOURNAL), String.join("\n",
        event010(1, "create", layer.toString(), 1L, null, withVersion(example("before", "layer.json"), 1)),
        event010(2, "create", created.toString(), 1L, null, newObject(created)), ""));

    PictureStore.Stored stored = loadAndClose();

    assertThat(stored.journal()).isEmpty();
    assertThat(stored.snapshot().objects()).singleElement()
        .satisfies(o -> assertThat(o.content().dataType()).isEqualTo(MapObjectContent.GENERAL));
    assertThat(dir.resolve(FileStore.KEPT_0_1_0).resolve(FileStore.JOURNAL)).exists();
  }

  @Test
  void anInvalid010DocumentStopsTheStartAndNothingIsWritten() throws IOException {
    ObjectNode broken = (ObjectNode) example("before", "object-symbol.json");
    broken.remove("geometry");
    String snapshot = snapshot010(1, example("before", "layer.json"), broken);
    Files.writeString(dir.resolve(FileStore.SNAPSHOT), snapshot);

    assertThatThrownBy(this::loadAndClose).isInstanceOf(IllegalStateException.class).hasMessageContaining("invalid document");
    assertThat(Files.readString(dir.resolve(FileStore.SNAPSHOT))).isEqualTo(snapshot);
    assertThat(dir.resolve(FileStore.KEPT_0_1_0)).doesNotExist();
  }

  @Test
  void anInvalid010JournalEventStopsTheStartAndNothingIsWritten() throws IOException {
    String snapshot = snapshot010(10, example("before", "layer.json"), example("before", "object-symbol.json"));
    ObjectNode state = withVersion(example("before", "object-symbol.json"), 4);
    state.put("dataType", "core.general"); // not 0.1.0 data
    Files.writeString(dir.resolve(FileStore.SNAPSHOT), snapshot);
    Files.writeString(dir.resolve(FileStore.JOURNAL), event010(11, "update", SYMBOL, 4L, 3L, state) + "\n");

    assertThatThrownBy(this::loadAndClose).isInstanceOf(IllegalStateException.class).hasMessageContaining("line 1");
    assertThat(Files.readString(dir.resolve(FileStore.SNAPSHOT))).isEqualTo(snapshot);
    assertThat(dir.resolve(FileStore.KEPT_0_1_0)).doesNotExist();
  }

  @Test
  void dataOfANewerMajorVersionIsRefusedAndNotRewritten() throws IOException {
    String snapshot = "{\"format\":\"emc2-picture/1\",\"dataModel\":\"2.0.0\",\"sequenceNo\":0,\"layers\":[],\"objects\":[]}";
    Files.writeString(dir.resolve(FileStore.SNAPSHOT), snapshot);

    assertThatThrownBy(this::loadAndClose).isInstanceOf(IllegalStateException.class).hasMessageContaining("2.0.0, newer");
    assertThat(Files.readString(dir.resolve(FileStore.SNAPSHOT))).isEqualTo(snapshot);
  }

  @Test
  void dataOfAnOlderMinorVersionIsReadAsItIsWithoutAMigration() throws IOException {
    // Data model 1.1.0 only adds optional fields (CR-0014): 1.0.0 data is valid 1.1.0 data.
    String snapshot = "{\"format\":\"emc2-picture/1\",\"dataModel\":\"1.0.0\",\"sequenceNo\":0,\"layers\":[],\"objects\":[]}";
    Files.writeString(dir.resolve(FileStore.SNAPSHOT), snapshot);

    PictureStore.Stored stored = loadAndClose();

    assertThat(stored.snapshot().sequenceNo()).isZero();
    assertThat(dir.resolve(FileStore.KEPT_0_1_0)).as("no migration").doesNotExist();
    assertThat(Files.readString(dir.resolve(FileStore.SNAPSHOT))).as("not rewritten at the start").isEqualTo(snapshot);
  }

  @Test
  void aCrashAfterTheMigratedSnapshotButBeforeTheJournalWasEmptiedLosesNothing() throws IOException {
    UUID created = UUID.randomUUID();
    Files.writeString(dir.resolve(FileStore.SNAPSHOT), snapshot010(10, example("before", "layer.json")));
    Files.writeString(dir.resolve(FileStore.JOURNAL), event010(11, "create", created.toString(), 1L, null, newObject(created)) + "\n");
    PictureStore.Stored migrated = loadAndClose();
    Files.writeString(dir.resolve(FileStore.JOURNAL), event010(11, "create", created.toString(), 1L, null, newObject(created)) + "\n");

    PictureStore.Stored stored = loadAndClose();

    assertThat(stored.snapshot()).isEqualTo(migrated.snapshot());
    assertThat(stored.journal()).as("the 0.1.0 event is in the migrated snapshot already").isEmpty();
  }

  @Test
  void aNewDataDirectoryRecordsTheDataModelAtOnce() throws IOException {
    loadAndClose();

    assertThat(Files.readString(dir.resolve(FileStore.SNAPSHOT))).contains("\"dataModel\":\"" + dev.emcc.ecore.json.ModelJson.DATA_MODEL + "\"");
  }

  // ---- 0.1.0 documents -------------------------------------------------------------------------

  private PictureStore.Stored loadAndClose() {
    try (FileStore store = new FileStore(dir, JSON)) {
      return store.load();
    }
  }

  private void deleteKept() throws IOException {
    Path kept = dir.resolve(FileStore.KEPT_0_1_0);
    try (Stream<Path> files = Files.list(kept)) {
      for (Path f : files.toList()) {
        Files.delete(f);
      }
    }
    Files.delete(kept);
  }

  private static ObjectNode example(String folder, String name) {
    try {
      return (ObjectNode) JSON.parse(Files.readString(EXAMPLES.resolve(folder).resolve(name)));
    } catch (IOException e) {
      throw new java.io.UncheckedIOException(e);
    }
  }

  private static ObjectNode withVersion(ObjectNode entity, long version) {
    ObjectNode copy = entity.deepCopy();
    copy.put("version", version);
    return copy;
  }

  /** A 0.1.0 object: no data type, no data source. */
  private static ObjectNode newObject(UUID id) {
    ObjectNode object = withVersion(example("before", "object-shape-polygon-polar.json"), 1);
    object.put("id", id.toString());
    return object;
  }

  /** An M0 snapshot: it names no data model. */
  private static String snapshot010(long sequenceNo, ObjectNode layer, ObjectNode... objects) {
    return "{\"format\":\"emc2-picture/1\",\"sequenceNo\":" + sequenceNo + ",\"layers\":[" + layer + "],\"objects\":["
        + Stream.of(objects).map(JsonNode::toString).collect(Collectors.joining(",")) + "]}";
  }

  /** An M0 journal line. */
  private static String event010(long sequenceNo, String operation, String id, long version, Long previousVersion, ObjectNode state) {
    boolean layer = id.equals(LAYER);
    return "{\"sequenceNo\":" + sequenceNo + ",\"requestId\":\"" + UUID.randomUUID() + "\",\"entityType\":\""
        + (layer ? "layer" : "object") + "\",\"operation\":\"" + operation + "\",\"entityId\":\"" + id + "\",\"version\":" + version
        + ",\"previousVersion\":" + previousVersion
        + ",\"state\":" + (state == null ? "null" : state.toString())
        + ",\"label\":{\"policyIdentifier\":{\"name\":\"NATO\"},\"classification\":\"UNCLASSIFIED\"}"
        + ",\"at\":\"2026-10-04T09:00:00.000Z\",\"by\":{\"plugin\":\"draw-symbols\"}}";
  }
}
