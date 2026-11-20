package dev.emcc.sdk.testkit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.fail;

import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.MapObject;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

/**
 * The contract every JSON codec for the model types must pass, over the examples in
 * {@code model/examples/} (docs/plugins/sdk-v0.md, "Data model types"; sdk-v1.md):
 *
 * <ol>
 *   <li><b>Round trip:</b> every valid example reads into its Java type and writes back to an equal
 *       JSON tree ({@link TestJson#normalize}): core numbers compared as IEEE 754 doubles, numbers
 *       in extension data exactly by value (CR-0004), empty optional members equal to absent ones
 *       (model rule 13), a layer's {@code workspace} {@code core.view} equal to an absent one
 *       (data model 1.2.0, R2), and a layer's {@code locked} {@code false} equal to an absent one
 *       (data model 1.3.0, ADR-0042), each except in an update.
 *   <li><b>Rejection:</b> every invalid example is rejected by {@link ModelCodec#read}.
 *   <li><b>Migrated data</b> (data model 1.0.0): every {@code after/} file of {@code
 *       examples/migration/0.1.0-to-1.0.0/} round-trips like a valid example.
 * </ol>
 *
 * The {@code invalid-by-rule} examples are not part of this contract; the object store tests them.
 * Manifest examples are skipped, and so are the examples in {@link #CODEC_PENDING}, when it holds
 * any.
 *
 * <pre>{@code
 * class EcoreCodecContractTest extends ModelCodecContractTest {
 *   protected ModelCodec codec() { return new JacksonModelCodec(); }
 *   protected Path modelDirectory() { return Path.of("../../model"); }
 * }
 * }</pre>
 */
public abstract class ModelCodecContractTest {

  /**
   * Valid examples that ECore's codec cannot round-trip yet. Empty again since ECore's codec maps an
   * object's {@code fieldSets} and {@code relations} (SDK 1.4.0 part 3; CDA, 2026-11-06), as it was
   * since ECore's codec maps a symbol's {@code distances} and {@code azimuths} (SDK 1.4.0 part 2, CR-0030; CDA,
   * 2026-11-06), as it was since ECore's codec maps a layer's {@code locked} (SDK 1.3.0, CR-0028 part 2; CDA, T-098; the ACA's final review,
   * F1, 2026-10-31), as it was empty once ECore's codec mapped a change request's {@code fields}
   * and a layer's {@code workspace} (CR-0025 parts 4 and 5; CDA, 2026-10-26; W2, owner 2026-10-25). The invalid {@code fields} and {@code workspace} examples
   * are still rejected: by {@code ChangeRequest} ({@code
   * change-request-update-layer-with-fields.json}), by {@code FieldValue} ({@code
   * change-request-fields-object-value.json}), and by the schema's pattern and {@code
   * LayerContent} ({@code layer-bad-workspace.json}).
   */
  public static final java.util.Set<String> CODEC_PENDING = java.util.Set.of();

  /** The codec under test. */
  protected abstract ModelCodec codec();

  /** The repository's {@code model/} folder. */
  protected abstract Path modelDirectory();

  @TestFactory
  Stream<DynamicTest> validExamplesRoundTrip() {
    return examples("valid").filter(file -> !CODEC_PENDING.contains(file.getFileName().toString())).map(file -> DynamicTest.dynamicTest("round trip: " + file.getFileName(), () -> {
      ModelCodec.Kind kind = kindOf(file);
      String original = read(file);
      Object value = codec().read(kind, original);
      assertInstanceOf(kind.type(), value, "read must return a " + kind.type().getSimpleName());
      JsonValue expected = TestJson.normalize(TestJson.parse(original));
      JsonValue actual = TestJson.normalize(TestJson.parse(codec().write(value)));
      assertEquals(expected, actual, () -> "written JSON differs:\n  expected " + TestJson.write(expected) + "\n  actual   " + TestJson.write(actual));
    }));
  }

  @TestFactory
  Stream<DynamicTest> migratedExamplesRoundTrip() {
    return examples("migration/0.1.0-to-1.0.0/after").map(file -> DynamicTest.dynamicTest("round trip after migration: " + file.getFileName(), () -> {
      ModelCodec.Kind kind = kindOf(file);
      String original = read(file);
      JsonValue expected = TestJson.normalize(TestJson.parse(original));
      JsonValue actual = TestJson.normalize(TestJson.parse(codec().write(codec().read(kind, original))));
      assertEquals(expected, actual, () -> "written JSON differs:\n  expected " + TestJson.write(expected) + "\n  actual   " + TestJson.write(actual));
    }));
  }

  @TestFactory
  Stream<DynamicTest> invalidExamplesAreRejected() {
    return examples("invalid").map(file -> DynamicTest.dynamicTest("rejected: " + file.getFileName(), () -> {
      ModelCodec.Kind kind = kindOf(file);
      assertThrows(Exception.class, () -> codec().read(kind, read(file)), "an invalid document must be rejected");
    }));
  }

  /** Blind forwarding loses no precision (ADR-0007): the extension's numbers keep their exact text value. */
  @Test
  void highPrecisionExtensionNumbersSurvive() throws Exception {
    Path file = modelDirectory().resolve("examples/valid/object-extension-high-precision.json");
    MapObject object = (MapObject) codec().read(ModelCodec.Kind.MAP_OBJECT, read(file));
    JsonObject data = object.content().extensions().get("nvg-in");
    if (data == null) {
      fail("the nvg-in extension is missing");
      return;
    }
    assertEquals(JsonNumber.of("0.10000000000000000555111512312578270211815834045410156250001"), data.getNumber("beyondDoublePrecision"));
    assertEquals(JsonNumber.of("123456789012345678901234567890"), data.getNumber("beyondSafeInteger"));
    JsonValue written = TestJson.parse(codec().write(object));
    JsonObject writtenData = ((JsonObject) written).getObject("extensions").getObject("nvg-in");
    assertEquals(data.getNumber("beyondDoublePrecision"), writtenData.getNumber("beyondDoublePrecision"));
  }

  /** The kind an example file is for, from its name prefix; {@code null} for manifests. */
  static ModelCodec.@Nullable Kind kindFromName(String name) {
    if (name.startsWith("change-request-")) {
      return ModelCodec.Kind.CHANGE_REQUEST;
    }
    if (name.startsWith("change-event-")) {
      return ModelCodec.Kind.CHANGE_EVENT;
    }
    if (name.startsWith("change-rejection-")) {
      return ModelCodec.Kind.CHANGE_REJECTION;
    }
    if (name.startsWith("object-")) {
      return ModelCodec.Kind.MAP_OBJECT;
    }
    if (name.startsWith("layer")) {
      return ModelCodec.Kind.LAYER;
    }
    if (name.startsWith("manifest-")) {
      return null;
    }
    throw new IllegalArgumentException("unknown example prefix: " + name);
  }

  private static ModelCodec.Kind kindOf(Path file) {
    ModelCodec.Kind kind = kindFromName(file.getFileName().toString());
    if (kind == null) {
      throw new IllegalArgumentException("not a model document: " + file);
    }
    return kind;
  }

  private Stream<Path> examples(String folder) {
    Path dir = modelDirectory().resolve("examples").resolve(folder);
    try (Stream<Path> files = Files.list(dir)) {
      List<Path> list = files.filter(p -> p.toString().endsWith(".json")).filter(p -> kindFromName(p.getFileName().toString()) != null).sorted().toList();
      assertFalse(list.isEmpty(), "no examples found in " + dir.toAbsolutePath());
      return list.stream();
    } catch (IOException e) {
      throw new UncheckedIOException("cannot list " + dir.toAbsolutePath(), e);
    }
  }

  private static String read(Path file) {
    try {
      return Files.readString(file, StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
