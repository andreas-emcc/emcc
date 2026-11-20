package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.sdk.json.JsonObject;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/** CR-0047 F2: the stable ids of a settings list's items. */
class SettingsItemIdsTest {

  private static final ModelJson JSON = new ModelJson();

  /** {@code links[]} with ids, each holding {@code targets[]} with ids too (through a reference), and {@code tags[]} without. */
  private static final JsonNode SCHEMA = JSON.parse("""
      {"type": "object", "properties": {
        "links": {"type": "array", "x-emc2": {"item": {"name": "name", "id": "id"}}, "items": {"type": "object",
          "properties": {"id": {"type": "string", "readOnly": true}, "name": {"type": "string"},
            "targets": {"$ref": "#/$defs/targets"}}}},
        "tags": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "string"}}}}},
       "$defs": {"targets": {"type": "array", "x-emc2": {"item": {"id": "key"}},
         "items": {"type": "object", "properties": {"key": {"type": "string"}}}}}}
      """);

  private static JsonObject values(String json) {
    return (JsonObject) ModelJson.toJsonValue(JSON.parse(json));
  }

  private static Supplier<String> ids() {
    AtomicInteger n = new AtomicInteger();
    return () -> "new-" + n.incrementAndGet();
  }

  @Test
  void fillsInMissingEmptyAndNonStringIdsAtAnyDepthAndLeavesUndeclaredListsAlone() {
    SettingsItemIds.Filled filled = SettingsItemIds.fill(SCHEMA, values("""
        {"links": [{"id": "a", "name": "A"}, {"name": "B", "targets": [{"key": ""}, {"key": "k"}]}, {"id": 5, "name": "C"}],
         "tags": [{}]}
        """), false, ids());

    assertThat(filled.values()).isEqualTo(values("""
        {"links": [{"id": "a", "name": "A"}, {"name": "B", "targets": [{"key": "new-1"}, {"key": "k"}], "id": "new-2"},
                   {"id": "new-3", "name": "C"}],
         "tags": [{}]}
        """));
    assertThat(filled.filled()).containsExactly("/links/1/targets/0/key", "/links/1/id", "/links/2/id");
    assertThat(filled.duplicates()).isEmpty();
  }

  @Test
  void keepsTheValuesAsTheyAreWhenEveryItemHasItsId() {
    JsonObject given = values("{\"links\": [{\"id\": \"a\", \"name\": \"A\"}], \"other\": 1}");

    SettingsItemIds.Filled filled = SettingsItemIds.fill(SCHEMA, given, true, ids());

    assertThat(filled.values()).isSameAs(given);
    assertThat(filled.changed()).isFalse();
  }

  @Test
  void findsARepeatedIdAndRenewsItOnlyWhenAsked() {
    JsonObject given = values("{\"links\": [{\"id\": \"a\"}, {\"id\": \"b\"}, {\"id\": \"a\"}]}");

    SettingsItemIds.Filled atChange = SettingsItemIds.fill(SCHEMA, given, false, ids());
    assertThat(atChange.duplicates()).containsExactly("/links/2/id");
    assertThat(atChange.values()).as("kept, for the caller to refuse").isSameAs(given);

    SettingsItemIds.Filled atLoad = SettingsItemIds.fill(SCHEMA, given, true, ids());
    assertThat(atLoad.duplicates()).containsExactly("/links/2/id");
    assertThat(atLoad.values()).isEqualTo(values("{\"links\": [{\"id\": \"a\"}, {\"id\": \"b\"}, {\"id\": \"new-1\"}]}"));
  }

  @Test
  void theSameIdInTwoListsIsNoRepeat() {
    SettingsItemIds.Filled filled = SettingsItemIds.fill(SCHEMA, values("""
        {"links": [{"id": "a", "targets": [{"key": "a"}]}, {"id": "b", "targets": [{"key": "a"}]}]}
        """), false, ids());

    assertThat(filled.duplicates()).isEmpty();
  }

  @Test
  void aNewIdIsAUuidV7InLowerCase() {
    String id = SettingsItemIds.uuidv7();

    assertThat(id).matches("[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}");
    long millis = Long.parseLong(id.substring(0, 8) + id.substring(9, 13), 16);
    assertThat(millis).isCloseTo(System.currentTimeMillis(), org.assertj.core.data.Offset.offset(5_000L));
    assertThat(SettingsItemIds.uuidv7()).isNotEqualTo(id);
  }
}
