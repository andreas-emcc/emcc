package dev.emcc.ecore.store;

import static dev.emcc.ecore.store.Fixtures.DRAW;
import static dev.emcc.ecore.store.Fixtures.LABEL;
import static dev.emcc.ecore.store.Fixtures.LAYERS;
import static dev.emcc.ecore.store.Fixtures.create;
import static dev.emcc.ecore.store.Fixtures.ext;
import static dev.emcc.ecore.store.Fixtures.layer;
import static dev.emcc.ecore.store.Fixtures.update;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.DisplayClass;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Style;
import dev.emcc.sdk.model.Text;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Data model 1.6.0 (CR-0041 part A): a {@code core.text} keeps its text through the store and its JSON. */
class TextObjectStoreTest {

  private static final Instant NOW = Instant.parse("2026-11-12T10:00:00Z");
  private static final Actor NVG = Actor.plugin("nvg");

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final PictureState state = new PictureState();
  private final ObjectStore store = new ObjectStore(state, runtime, Clock.fixed(NOW, ZoneOffset.UTC), DataTypes.of(Set.of()),
      DeclaredFields.of(List.of(), Set.of(), Set.of()), new StoreCounts());
  private final UUID layerId = UUID.randomUUID();
  private final UUID objectId = UUID.randomUUID();

  @BeforeEach
  void aLayer() {
    assertThat(store.apply(create(layerId, layer("Notes"), LAYERS), Requester.NO_USER)).isInstanceOf(ChangeOutcome.Applied.class);
  }

  @AfterEach
  void close() {
    runtime.close();
  }

  /** A text at a point where latitude and longitude differ (ADR-0007), with the given extensions. */
  private MapObjectContent note(Text text, Extensions extensions) {
    return new MapObjectContent(MapObjectContent.TEXT, MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, layerId,
        new Geometry.Point(Position.of(17.31, 62.39)), null, new Style("#1F6F8B", null, null, null, null, null), null, LABEL, extensions,
        List.of(), List.of(), text);
  }

  private MapObject applied(ChangeRequest request) {
    ChangeOutcome outcome = store.apply(request, Requester.NO_USER);
    assertThat(outcome).isInstanceOf(ChangeOutcome.Applied.class);
    return (MapObject) ((ChangeOutcome.Applied) outcome).event().state();
  }

  @Test
  void aTextIsStoredAndKeptWhenAnotherPluginsUpdateHasItsExtensionsMergedIn() {
    Text text = new Text("Bridge 12\nclosed", 30.0, 16);
    MapObject created = applied(create(objectId, note(text, ext("cot", "uid", "n-1")), DRAW));
    assertThat(created.content().text()).isEqualTo(text);

    // NVG's update leaves cot's namespace out: the store puts it back, and the text stays.
    MapObject updated = applied(update(objectId, 1, note(Text.of("Bridge 12 open"), Extensions.empty()), NVG));

    assertThat(updated.content().text()).isEqualTo(Text.of("Bridge 12 open"));
    assertThat(updated.content().extensions().namespaces()).containsKey("cot");
    assertThat(updated.content().geometry()).isEqualTo(new Geometry.Point(Position.of(17.31, 62.39)));
  }

  @Test
  void aDisplayClassIsKeptWhenAnotherPluginsUpdateHasItsExtensionsMergedIn() { // data model 1.6.0, CR-0041 part D
    MapObjectContent area = note(Text.of("Dwell 4"), ext("gmti", "dwell", "4")).withDisplayClass(DisplayClass.DWELL_AREA);
    assertThat(applied(create(objectId, area, DRAW)).content().displayClass()).isEqualTo("dwell-area");

    MapObject updated = applied(update(objectId, 1, note(Text.of("Dwell 4"), Extensions.empty()).withDisplayClass(DisplayClass.DWELL_AREA), NVG));

    assertThat(updated.content().displayClass()).isEqualTo("dwell-area");
    assertThat(updated.content().extensions().namespaces()).containsKey("gmti");
    assertThat(new ModelJson().write(updated)).contains("\"displayClass\":\"dwell-area\"");
  }

  @Test
  void aTextsJsonHasItsValueAndOnlyTheRotationAndSizeItWasGiven() {
    ModelJson json = new ModelJson();
    MapObject upright = applied(create(objectId, note(Text.of("Alpha"), Extensions.empty()), DRAW));

    String written = json.write(upright);
    assertThat(written).contains("\"text\":{\"value\":\"Alpha\"}").contains("\"type\":\"core.text\"");
    assertThat(json.readMapObject(written).content().text()).isEqualTo(Text.of("Alpha"));

    MapObject turned = applied(update(objectId, 1, note(new Text("Alpha", 359.5, 8), Extensions.empty()), DRAW));
    assertThat(json.readMapObject(json.write(turned)).content().text()).isEqualTo(new Text("Alpha", 359.5, 8));
  }
}
