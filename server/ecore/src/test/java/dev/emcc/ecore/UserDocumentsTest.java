package dev.emcc.ecore;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.persistence.UserDocumentStore;
import dev.emcc.ecore.persistence.UserDocumentStore.Result;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** The edge's way to the user documents: one worker, one answer per call, namespaces checked first. */
class UserDocumentsTest {

  private static final ModelJson JSON = new ModelJson();

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final UserDocuments documents = new UserDocuments(runtime, new UserDocumentStore(null, JSON), Set.of("bookmarks")::contains);

  @AfterEach
  void close() {
    runtime.close();
  }

  private Result call(UserDocuments.Call call) {
    Probe<Result> answers = new Probe<>();
    documents.call(call, answers::add);
    Result answer = answers.next();
    assertThat(answers.drain()).as("one answer only").isEmpty();
    return answer;
  }

  @Test
  void theShellAndAPluginWithAWebPartHaveTheirNamespacesEachUserHisOwn() {
    UserDocuments.Call put = new UserDocuments.Call(UserDocuments.Kind.PUT, "u-alice", "bookmarks", "tree", JSON.parse("{\"folders\":[]}"));
    assertThat(call(put)).isEqualTo(new Result.Written());
    assertThat(call(new UserDocuments.Call(UserDocuments.Kind.PUT, "u-alice", "core", "clock", JSON.parse("\"utc\"")))).isEqualTo(new Result.Written());

    assertThat(call(new UserDocuments.Call(UserDocuments.Kind.GET, "u-alice", "bookmarks", "tree", null)))
        .isEqualTo(new Result.Found("{\"folders\":[]}"));
    assertThat(call(new UserDocuments.Call(UserDocuments.Kind.LIST, "u-alice", "core", null, null))).isEqualTo(new Result.Names(List.of("clock")));
    assertThat(call(new UserDocuments.Call(UserDocuments.Kind.GET, "u-bob", "bookmarks", "tree", null))).isEqualTo(new Result.Missing());
    assertThat(call(new UserDocuments.Call(UserDocuments.Kind.DELETE, "u-alice", "bookmarks", "tree", null))).isEqualTo(new Result.Written());
    assertThat(call(new UserDocuments.Call(UserDocuments.Kind.GET, "u-alice", "bookmarks", "tree", null))).isEqualTo(new Result.Missing());
  }

  @Test
  void aNamespaceThatIsNoRunningPluginWithAWebPartIsRefused() {
    for (String namespace : List.of("cot", "core-shell", "Bookmarks")) {
      Result answer = call(new UserDocuments.Call(UserDocuments.Kind.LIST, "u-alice", namespace, null, null));
      assertThat(answer).as(namespace)
          .isEqualTo(new Result.Refused(UserDocumentStore.Reason.UNKNOWN_NAMESPACE, "no running plugin with a web part has the id " + namespace));
    }
  }

  @Test
  void aCallHasANameExceptAListAndAValueOnlyForAPut() {
    assertThatThrownBy(() -> new UserDocuments.Call(UserDocuments.Kind.LIST, "u", "core", "x", null)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new UserDocuments.Call(UserDocuments.Kind.GET, "u", "core", null, null)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new UserDocuments.Call(UserDocuments.Kind.PUT, "u", "core", "x", null)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new UserDocuments.Call(UserDocuments.Kind.DELETE, "u", "core", "x", JSON.parse("1")))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
