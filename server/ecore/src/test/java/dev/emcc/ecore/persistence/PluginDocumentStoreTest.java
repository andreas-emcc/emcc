package dev.emcc.ecore.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.persistence.PluginDocumentStore.Result;
import dev.emcc.sdk.document.Documents;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class PluginDocumentStoreTest {

  private static final ModelJson JSON = new ModelJson();
  private static final JsonObject LAYERS = JsonObject.of(Map.of("tak-north", JsonString.of("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01")));

  @TempDir Path dir;

  @Test
  void aDocumentSurvivesARestartAndBelongsToItsPluginOnly() {
    assertThat(new PluginDocumentStore(dir, JSON).put("cot", "layers", LAYERS)).isEqualTo(new Result.Written());

    PluginDocumentStore restarted = new PluginDocumentStore(dir, JSON);
    assertThat(restarted.get("cot", "layers")).isEqualTo(new Result.Found(LAYERS));
    assertThat(restarted.get("layer-panel", "layers")).as("another plugin's namespace").isEqualTo(new Result.Missing());
  }

  @Test
  void deleteRemovesItAndDeletingNothingIsFine() {
    PluginDocumentStore store = new PluginDocumentStore(dir, JSON);
    store.put("cot", "layers", LAYERS);

    assertThat(store.delete("cot", "layers")).isEqualTo(new Result.Written());
    assertThat(store.delete("cot", "layers")).isEqualTo(new Result.Written());
    assertThat(new PluginDocumentStore(dir, JSON).get("cot", "layers")).isEqualTo(new Result.Missing());
  }

  @Test
  void numbersKeepTheirExactValue() {
    JsonObject exact = JsonObject.of(Map.of("n", JsonNumber.of(new BigDecimal("0.10000000000000000555111512312578270211815834045410156250001"))));
    new PluginDocumentStore(dir, JSON).put("cot", "exact", exact);

    assertThat(new PluginDocumentStore(dir, JSON).get("cot", "exact")).isEqualTo(new Result.Found(exact));
  }

  @ParameterizedTest
  @ValueSource(strings = {"con", "nul", "aux", "com1", "lpt1.json"})
  void keysWindowsReservesAsFileNamesWork(String key) {
    assertThat(new PluginDocumentStore(dir, JSON).put("con", key, LAYERS)).isEqualTo(new Result.Written());

    assertThat(new PluginDocumentStore(dir, JSON).get("con", key)).isEqualTo(new Result.Found(LAYERS));
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "-x", ".x", "..", "Layers", "a/b", "a\\b", "a b", "ä"})
  void invalidKeysAreRefusedLikeTheSdkRefusesThem(String key) {
    PluginDocumentStore store = new PluginDocumentStore(dir, JSON);

    assertThat(store.put("cot", key, LAYERS)).isInstanceOf(Result.Failed.class);
    assertThat(store.get("cot", key)).isInstanceOf(Result.Failed.class);
    assertThat(Documents.KEY_PATTERN.matcher(key).matches()).as("the SDK refuses it too").isFalse();
  }

  @Test
  void aKeyOfTheLongestLengthWorksAndOneLongerDoesNot() {
    PluginDocumentStore store = new PluginDocumentStore(dir, JSON);

    assertThat(Documents.checkKey("k".repeat(PluginDocumentStore.MAX_KEY))).as("as long as the SDK allows").hasSize(128);
    assertThat(store.put("cot", "k".repeat(PluginDocumentStore.MAX_KEY), LAYERS)).isEqualTo(new Result.Written());
    assertThat(store.put("cot", "k".repeat(PluginDocumentStore.MAX_KEY + 1), LAYERS)).isInstanceOf(Result.Failed.class);
  }

  @Test
  void aDocumentOverOneMebibyteIsRefused() {
    PluginDocumentStore store = new PluginDocumentStore(dir, JSON);
    String fits = "x".repeat(PluginDocumentStore.MAX_BYTES - "{\"v\":\"\"}".length());

    assertThat(store.put("cot", "fits", JsonObject.of(Map.of("v", JsonString.of(fits))))).isEqualTo(new Result.Written());
    assertThat(store.put("cot", "too-big", JsonObject.of(Map.of("v", JsonString.of(fits + "x"))))).isInstanceOf(Result.Failed.class);
    assertThat(PluginDocumentStore.MAX_BYTES).isEqualTo(Documents.MAX_DOCUMENT_BYTES);
  }

  @Test
  void aPluginHasAtMostAThousandDocumentsButMayStillReplaceOne() throws IOException {
    PluginDocumentStore store = new PluginDocumentStore(null, JSON);
    for (int i = 0; i < PluginDocumentStore.MAX_DOCUMENTS; i++) {
      assertThat(store.put("cot", "d" + i, LAYERS)).isEqualTo(new Result.Written());
    }

    assertThat(store.put("cot", "one-more", LAYERS)).isInstanceOf(Result.Failed.class);
    assertThat(store.put("cot", "d7", JsonObject.of(Map.of()))).isEqualTo(new Result.Written());
    assertThat(store.put("layer-panel", "d0", LAYERS)).as("per plugin").isEqualTo(new Result.Written());
    assertThat(PluginDocumentStore.MAX_DOCUMENTS).isEqualTo(Documents.MAX_DOCUMENTS);
  }

  @Test
  void theCountIncludesDocumentsStoredBeforeARestart() {
    new PluginDocumentStore(dir, JSON).put("cot", "first", LAYERS);

    assertThat(new PluginDocumentStore(dir, JSON).keysOf("cot")).isEqualTo(List.of("first"));
  }

  @Test
  void withoutADataDirectoryNothingIsWritten() throws IOException {
    PluginDocumentStore store = new PluginDocumentStore(null, JSON);

    store.put("cot", "layers", LAYERS);

    assertThat(store.get("cot", "layers")).isEqualTo(new Result.Found(LAYERS));
    try (var files = Files.list(dir)) {
      assertThat(files).isEmpty();
    }
  }
}
