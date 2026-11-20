package dev.emcc.ecore.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.persistence.UserDocumentStore.Reason;
import dev.emcc.ecore.persistence.UserDocumentStore.Result;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.JsonNode;

/** Each user's own documents (ADR-0027): per user and namespace, with ECore's limits. */
class UserDocumentStoreTest {

  private static final ModelJson JSON = new ModelJson();
  private static final String ALICE = "0b6f2a1c-5d3e-4f7a-9b8c-1d2e3f4a5b6c";
  private static final String BOB = "local";

  @TempDir Path dir;

  private static JsonNode json(String text) {
    return JSON.parse(text);
  }

  /** A JSON string of {@code bytes} bytes in all, quotes included. */
  private static JsonNode ofSize(int bytes) {
    return json("\"" + "x".repeat(bytes - 2) + "\"");
  }

  private static void assertRefused(Result result, Reason reason) {
    assertThat(result).isInstanceOf(Result.Refused.class);
    assertThat(((Result.Refused) result).reason()).as(result.toString()).isEqualTo(reason);
  }

  @Test
  void aDocumentSurvivesARestartAndBelongsToItsUserAndNamespaceOnly() {
    UserDocumentStore store = new UserDocumentStore(dir, JSON);
    assertThat(store.put(ALICE, "core", "setup.current", json("{\"panes\": {\"left\": 280}, \"clock\": \"utc\"}")))
        .isEqualTo(new Result.Written());

    UserDocumentStore restarted = new UserDocumentStore(dir, JSON);
    assertThat(restarted.get(ALICE, "core", "setup.current")).isEqualTo(new Result.Found("{\"panes\":{\"left\":280},\"clock\":\"utc\"}"));
    assertThat(restarted.get(BOB, "core", "setup.current")).as("another user's").isEqualTo(new Result.Missing());
    assertThat(restarted.get(ALICE, "bookmarks", "setup.current")).as("another namespace").isEqualTo(new Result.Missing());
    assertThat(restarted.list(ALICE, "core")).isEqualTo(new Result.Names(List.of("setup.current")));
    assertThat(restarted.list(BOB, "core")).isEqualTo(new Result.Names(List.of()));
  }

  @Test
  void anyJsonValueIsADocumentAndNumbersKeepTheirExactValue() {
    UserDocumentStore store = new UserDocumentStore(dir, JSON);
    for (String value : List.of("[1,2,3]", "\"text\"", "true", "null", "0.10000000000000000555111512312578270211815834045410156250001")) {
      assertThat(store.put(BOB, "bookmarks", "value", json(value))).isEqualTo(new Result.Written());
      assertThat(new UserDocumentStore(dir, JSON).get(BOB, "bookmarks", "value")).as(value).isEqualTo(new Result.Found(value));
    }
  }

  @Test
  void theUserIdIsNeverAFileNameAndTheFolderNamesItsUser() throws IOException {
    String sub = "../../etc/passwd:CON";
    new UserDocumentStore(dir, JSON).put(sub, "core", "clock", json("\"local\""));

    Path root = dir.resolve(UserDocumentStore.FOLDER);
    List<Path> users;
    try (Stream<Path> found = Files.list(root)) {
      users = found.toList();
    }
    assertThat(users).hasSize(1);
    assertThat(users.getFirst().getFileName().toString()).matches("u-[0-9a-f]{64}");
    assertThat(Files.readString(users.getFirst().resolve("user.json"), StandardCharsets.UTF_8)).isEqualTo("{\"user\":\"../../etc/passwd:CON\"}");
    assertThat(users.getFirst().resolve("n-core").resolve("d-clock.json")).exists();
    assertThat(new UserDocumentStore(dir, JSON).get(sub, "core", "clock")).isEqualTo(new Result.Found("\"local\""));
  }

  @Test
  void deleteRemovesItAndDeletingNothingIsFine() {
    UserDocumentStore store = new UserDocumentStore(dir, JSON);
    store.put(ALICE, "bookmarks", "tree", json("{}"));

    assertThat(store.delete(ALICE, "bookmarks", "tree")).isEqualTo(new Result.Written());
    assertThat(store.delete(ALICE, "bookmarks", "tree")).isEqualTo(new Result.Written());
    assertThat(new UserDocumentStore(dir, JSON).get(ALICE, "bookmarks", "tree")).isEqualTo(new Result.Missing());
    assertThat(new UserDocumentStore(dir, JSON).list(ALICE, "bookmarks")).isEqualTo(new Result.Names(List.of()));
  }

  @Test
  void aDocumentHasAtMost256KibAsCompactJson() {
    UserDocumentStore store = new UserDocumentStore(dir, JSON);
    assertThat(store.put(ALICE, "core", "big", ofSize(UserDocumentStore.MAX_BYTES))).isEqualTo(new Result.Written());
    Result tooBig = store.put(ALICE, "core", "bigger", ofSize(UserDocumentStore.MAX_BYTES + 1));
    assertRefused(tooBig, Reason.TOO_LARGE);
    assertThat(((Result.Refused) tooBig).message()).isEqualTo("the document has 262145 bytes as JSON, more than 262144");
    // White space does not count: the document is kept compact.
    assertThat(store.put(ALICE, "core", "spaced", json("[" + " ".repeat(UserDocumentStore.MAX_BYTES) + "1]"))).isEqualTo(new Result.Written());
    assertThat(store.get(ALICE, "core", "spaced")).isEqualTo(new Result.Found("[1]"));
  }

  @Test
  void aNamespaceHasAtMost200DocumentsPerUser() {
    UserDocumentStore store = new UserDocumentStore(dir, JSON);
    for (int i = 0; i < UserDocumentStore.MAX_PER_NAMESPACE; i++) {
      assertThat(store.put(ALICE, "bookmarks", "b" + i, json("1"))).isEqualTo(new Result.Written());
    }
    assertRefused(store.put(ALICE, "bookmarks", "one-more", json("1")), Reason.TOO_MANY);
    assertThat(store.put(ALICE, "bookmarks", "b7", json("2"))).as("replacing one").isEqualTo(new Result.Written());
    assertThat(store.put(ALICE, "core", "other", json("1"))).as("another namespace").isEqualTo(new Result.Written());
    assertThat(store.put(BOB, "bookmarks", "b0", json("1"))).as("another user").isEqualTo(new Result.Written());
    // Counted again from the files after a restart.
    assertRefused(new UserDocumentStore(dir, JSON).put(ALICE, "bookmarks", "one-more", json("1")), Reason.TOO_MANY);
  }

  @Test
  void aUserHasAtMost4MibInAllAndAReplacedDocumentCountsOnce() {
    UserDocumentStore store = new UserDocumentStore(dir, JSON);
    int documents = (int) (UserDocumentStore.MAX_PER_USER / UserDocumentStore.MAX_BYTES); // 16 full documents
    for (int i = 0; i < documents; i++) {
      assertThat(store.put(ALICE, "ns" + (i % 3), "d" + i, ofSize(UserDocumentStore.MAX_BYTES))).isEqualTo(new Result.Written());
    }
    assertRefused(store.put(ALICE, "core", "more", json("1")), Reason.USER_FULL);
    assertThat(store.put(ALICE, "ns0", "d0", ofSize(UserDocumentStore.MAX_BYTES))).as("the same size again").isEqualTo(new Result.Written());
    assertThat(store.put(BOB, "core", "more", json("1"))).as("another user").isEqualTo(new Result.Written());
    assertRefused(new UserDocumentStore(dir, JSON).put(ALICE, "core", "more", json("1")), Reason.USER_FULL); // counted from the files

    assertThat(store.delete(ALICE, "ns0", "d0")).isEqualTo(new Result.Written());
    assertThat(store.put(ALICE, "core", "more", json("1"))).as("room again").isEqualTo(new Result.Written());
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "Setup", "-x", ".x", "a/b", "a\\b", "a b", "ä"})
  void aNameIsLowercaseLettersDigitsDashesAndDots(String name) {
    UserDocumentStore store = new UserDocumentStore(dir, JSON);
    assertRefused(store.put(ALICE, "core", name, json("1")), Reason.INVALID);
    assertRefused(store.get(ALICE, "core", name), Reason.INVALID);
    assertRefused(store.delete(ALICE, "core", name), Reason.INVALID);
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "Core", "core.x", "1plugin", "-x", "a--b", "../core", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"})
  void aNamespaceIsCoreOrAPluginId(String namespace) {
    UserDocumentStore store = new UserDocumentStore(dir, JSON);
    assertRefused(store.list(ALICE, namespace), Reason.INVALID);
    assertRefused(store.put(ALICE, namespace, "x", json("1")), Reason.INVALID);
  }

  @ParameterizedTest
  @ValueSource(strings = {"con", "nul", "aux", "com1", "lpt1.json"})
  void namesWindowsReservesAsFileNamesWork(String name) {
    assertThat(new UserDocumentStore(dir, JSON).put(ALICE, "core", name, json("1"))).isEqualTo(new Result.Written());
    assertThat(new UserDocumentStore(dir, JSON).get(ALICE, "core", name)).isEqualTo(new Result.Found("1"));
  }

  @Test
  void aWriteTheDiskRefusesFailsWithoutNamingTheServersFolders() throws IOException {
    // A file where the namespace's folder belongs: the write cannot create it, on any platform.
    Path user = Files.createDirectories(dir.resolve(UserDocumentStore.FOLDER).resolve("u-" + UserDocumentStore.keyOf(ALICE)));
    Files.writeString(user.resolve("n-core"), "in the way");
    UserDocumentStore store = new UserDocumentStore(dir, JSON);

    assertThat(store.put(ALICE, "core", "clock", json("\"utc\""))).isEqualTo(new Result.Failed("the document cannot be stored"));
    assertThat(store.list(ALICE, "core")).as("nothing counted").isEqualTo(new Result.Names(List.of()));
    assertThat(store.put(ALICE, "bookmarks", "tree", json("{}"))).as("other namespaces still work").isEqualTo(new Result.Written());
  }

  @Test
  void aDamagedDocumentFileIsAFailureNotADocument() throws IOException {
    new UserDocumentStore(dir, JSON).put(ALICE, "core", "clock", json("\"utc\""));
    Path file = dir.resolve(UserDocumentStore.FOLDER).resolve("u-" + UserDocumentStore.keyOf(ALICE)).resolve("n-core/d-clock.json");
    Files.writeString(file, "{\"half\":", StandardCharsets.UTF_8);

    UserDocumentStore restarted = new UserDocumentStore(dir, JSON);
    assertThat(restarted.get(ALICE, "core", "clock")).isEqualTo(new Result.Failed("the document cannot be read"));
    assertThat(restarted.put(ALICE, "core", "clock", json("\"local\""))).as("a new write replaces it").isEqualTo(new Result.Written());
    assertThat(restarted.get(ALICE, "core", "clock")).isEqualTo(new Result.Found("\"local\""));
  }

  @Test
  void temporaryAndForeignFilesAndFoldersAreNoDocumentsAndDoNotCount() throws IOException {
    Path core = Files.createDirectories(dir.resolve(UserDocumentStore.FOLDER).resolve("u-" + UserDocumentStore.keyOf(ALICE)).resolve("n-core"));
    Files.writeString(core.resolve("d-big.json.tmp"), "x".repeat((int) UserDocumentStore.MAX_PER_USER)); // an interrupted write
    Files.createDirectories(core.resolve("d-folder.json"));
    Files.writeString(core.resolve("notes.txt"), "foreign");
    Files.createDirectories(core.resolveSibling("n-Not.A.Namespace"));

    UserDocumentStore store = new UserDocumentStore(dir, JSON);
    assertThat(store.list(ALICE, "core")).isEqualTo(new Result.Names(List.of()));
    assertThat(store.put(ALICE, "core", "clock", json("\"utc\""))).as("the temporary file's bytes do not count").isEqualTo(new Result.Written());
    assertThat(store.list(ALICE, "core")).isEqualTo(new Result.Names(List.of("clock")));
  }

  @Test
  void withoutADataDirectoryTheDocumentsLiveInMemory() {
    UserDocumentStore store = new UserDocumentStore(null, JSON);
    assertThat(store.put(ALICE, "core", "clock", json("\"utc\""))).isEqualTo(new Result.Written());
    assertThat(store.get(ALICE, "core", "clock")).isEqualTo(new Result.Found("\"utc\""));
    assertThat(store.delete(ALICE, "core", "clock")).isEqualTo(new Result.Written());
    assertThat(store.get(ALICE, "core", "clock")).isEqualTo(new Result.Missing());
  }
}
