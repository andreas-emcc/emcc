package dev.emcc.ecore.json;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelSchemas.Document;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.testkit.ModelCodec;
import dev.emcc.sdk.testkit.ModelCodecContractTest;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The SDK's codec contract (round trip of every valid example, rejection of every invalid one,
 * exact extension numbers), run against ECore's codec.
 */
class ModelJsonContractTest extends ModelCodecContractTest {

  private static final ModelJson JSON = new ModelJson();

  @Override
  protected ModelCodec codec() {
    return new ModelCodec() {
      @Override
      public Object read(Kind kind, String json) {
        return JSON.read(document(kind), json);
      }

      @Override
      public String write(Object value) {
        return JSON.write(value);
      }
    };
  }

  @Override
  protected Path modelDirectory() {
    return Path.of("../../model"); // the working directory of the ecore tests is server/ecore
  }

  /** Mapped now, these must still be refused: by the schema, and by {@code LayerContent} and {@code ChangeRequest}. */
  @ParameterizedTest
  @ValueSource(strings = {"change-request-update-layer-with-fields.json", "change-request-fields-object-value.json",
      "layer-bad-workspace.json"})
  void theInvalidFieldsAndWorkspaceExamplesAreStillRejected(String name) throws IOException {
    String json = Files.readString(modelDirectory().resolve("examples/invalid").resolve(name));

    assertThatThrownBy(() -> JSON.read(name.startsWith("layer") ? Document.LAYER : Document.CHANGE_REQUEST, json))
        .isInstanceOf(InvalidDocumentException.class);
  }

  /**
   * T-098: the SDK's contract skips {@code layer-locked.json} until the codec maps {@code locked}
   * ({@code CODEC_PENDING}); ECore's does, so it round trips here. A {@code false} is read as given,
   * so an update can clear the lock; absent is {@code null}, which keeps the stored lock.
   */
  @Test
  void theLockedLayerExampleRoundTripsAndFalseAndAbsentStayApart() throws IOException {
    String json = Files.readString(modelDirectory().resolve("examples/valid/layer-locked.json"));
    Layer layer = (Layer) JSON.read(Document.LAYER, json);
    assertThat(layer.content().locked()).isTrue();
    assertThat(JSON.read(Document.LAYER, JSON.write(layer))).isEqualTo(layer);
    assertThat(JSON.write(layer)).contains("\"locked\":true");

    Layer unlocked = (Layer) JSON.read(Document.LAYER, json.replace("\"locked\": true", "\"locked\": false"));
    assertThat(unlocked.content().locked()).isFalse();
    Layer absent = (Layer) JSON.read(Document.LAYER, json.replaceAll(",\\s*\"locked\": true", ""));
    assertThat(absent.content().locked()).isNull();
    assertThat(JSON.write(absent)).doesNotContain("locked");

    String notBoolean = Files.readString(modelDirectory().resolve("examples/invalid/layer-locked-not-boolean.json"));
    assertThatThrownBy(() -> JSON.read(Document.LAYER, notBoolean)).isInstanceOf(InvalidDocumentException.class);
  }

  /**
   * SDK 1.4.0 part 2: the SDK's contract skips the range fan ({@code CODEC_PENDING}) until ECore's
   * codec maps a symbol's {@code distances} and {@code azimuths}; ECore's does, so it round trips
   * here, and the invalid examples of them are refused.
   */
  @Test
  void theRangeFanExampleRoundTripsWithItsDistancesAndAzimuths() throws IOException {
    String json = Files.readString(modelDirectory().resolve("examples/valid/object-multipoint-range-fan-sector.json"));
    dev.emcc.sdk.model.MapObject fan = (dev.emcc.sdk.model.MapObject) JSON.read(Document.MAP_OBJECT, json);
    dev.emcc.sdk.model.Modifiers m = java.util.Objects.requireNonNull(fan.content().symbol()).modifiers();

    assertThat(java.util.Objects.requireNonNull(m).distances()).containsExactly(500.0, 3000.0, 8000.0);
    assertThat(m.azimuths()).containsExactly(315.0, 45.0, 320.0, 40.0, 330.0, 30.0);
    assertThat(m.texts()).hasSize(1);
    assertThat(JSON.read(Document.MAP_OBJECT, JSON.write(fan))).isEqualTo(fan);
    assertThat(JSON.write(fan)).contains("\"distances\":[500.0,3000.0,8000.0]");

    for (String name : java.util.List.of("object-modifiers-azimuth-over-360.json", "object-modifiers-distances-not-numbers.json")) {
      String invalid = Files.readString(modelDirectory().resolve("examples/invalid").resolve(name));
      assertThatThrownBy(() -> JSON.read(Document.MAP_OBJECT, invalid)).as(name).isInstanceOf(InvalidDocumentException.class);
    }
  }

  /**
   * SDK 1.4.0 part 3: the SDK's contract skips the objects with field sets and relations ({@code
   * CODEC_PENDING}) until ECore's codec maps them; ECore's does, so they round trip here, empty lists
   * are written as absent (rule 13), and the invalid examples of them are refused.
   */
  @Test
  void theFieldSetAndRelationExamplesRoundTripAndEmptyListsAreLeftOut() throws IOException {
    var sets = (dev.emcc.sdk.model.MapObject) JSON.read(Document.MAP_OBJECT,
        Files.readString(modelDirectory().resolve("examples/valid/object-with-field-sets.json")));
    var related = (dev.emcc.sdk.model.MapObject) JSON.read(Document.MAP_OBJECT,
        Files.readString(modelDirectory().resolve("examples/valid/object-with-relations.json")));

    assertThat(sets.content().fieldSets()).isNotEmpty();
    assertThat(related.content().relations()).extracting(dev.emcc.sdk.model.Relation::kind).containsExactly("gmti.pairing", "gmti.pairing");
    assertThat(related.content().relations().get(1).objectId()).hasToString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e22");
    for (var o : java.util.List.of(sets, related)) {
      assertThat(JSON.read(Document.MAP_OBJECT, JSON.write(o))).isEqualTo(o);
    }
    var none = sets.content().withFieldSets(java.util.List.of()).withRelations(java.util.List.of());
    assertThat(JSON.write(new dev.emcc.sdk.model.MapObject(sets.id(), 1, none, sets.meta())))
        .doesNotContain("fieldSets").doesNotContain("relations");
    String emptyLists = Files.readString(modelDirectory().resolve("examples/valid/object-with-relations.json"))
        .replaceFirst("\"relations\": \\[[^]]*]", "\"relations\": [], \"fieldSets\": []");
    assertThat(((dev.emcc.sdk.model.MapObject) JSON.read(Document.MAP_OBJECT, emptyLists)).content().relations()).isEmpty();

    for (String name : java.util.List.of("object-relations-over-limit.json", "object-relation-bad-object-id.json", "object-vessel-bad-code.json")) {
      String invalid = Files.readString(modelDirectory().resolve("examples/invalid").resolve(name));
      assertThatThrownBy(() -> JSON.read(Document.MAP_OBJECT, invalid)).as(name).isInstanceOf(InvalidDocumentException.class);
    }
  }

  private static Document document(ModelCodec.Kind kind) {
    return switch (kind) {
      case MAP_OBJECT -> Document.MAP_OBJECT;
      case LAYER -> Document.LAYER;
      case CHANGE_REQUEST -> Document.CHANGE_REQUEST;
      case CHANGE_EVENT -> Document.CHANGE_EVENT;
      case CHANGE_REJECTION -> Document.CHANGE_REJECTION;
    };
  }
}
