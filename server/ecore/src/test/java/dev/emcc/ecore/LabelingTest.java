package dev.emcc.ecore;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.json.Problem;
import dev.emcc.ecore.live.LiveGateway;
import dev.emcc.ecore.live.LiveSink;
import dev.emcc.ecore.persistence.ConfigStore;
import dev.emcc.ecore.persistence.Configuration;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.DataTypes;
import dev.emcc.ecore.store.ObjectStore;
import dev.emcc.ecore.store.PictureState;
import dev.emcc.ecore.store.Requester;
import dev.emcc.ecore.store.StoreMsg;
import java.nio.file.Path;
import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Settings › Labeling in ECore (T-170 round 3): the premade labels, checked, kept with the configuration, and every browser told. */
class LabelingTest {

  private static final ModelJson JSON = new ModelJson();
  private static final Map<String, List<String>> ORDERS = Map.of(
      "NATO", List.of("UNCLASSIFIED", "RESTRICTED", "CONFIDENTIAL", "SECRET", "COSMIC TOP SECRET"), "SWE", List.of("EJ SEKRETESS", "BEGRÄNSAT HEMLIG", "SECRET"));

  @TempDir Path data;

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final WorkerHandle<StoreMsg> store = runtime.owner("core-store").spawn(
      WorkerOptions.<StoreMsg>of("object-store", () -> new ObjectStore(new PictureState(), runtime, Clock.systemUTC(), new DataTypes())));
  private final LiveGateway live = new LiveGateway(runtime, store, JSON, Clock.systemUTC(), 10, LiveGateway.DEFAULT_MAX_BUDGET);

  @AfterEach
  void close() {
    runtime.close();
  }

  private static final class Browser implements LiveSink {
    final Probe<String> types = new Probe<>();

    @Override
    public void send(String text) {
      types.add(JSON.parse(text).get("type").asString());
    }

    @Override
    public void ping() {}

    @Override
    public void close(int status, String reason) {}
  }

  private static String label(String policy, String classification, String... values) {
    String categories = values.length == 0 ? ""
        : ",\"categories\":[{\"tagName\":\"Releasable To\",\"type\":\"permissive\",\"values\":[\"" + String.join("\",\"", values) + "\"]}]";
    return "{\"policyIdentifier\":{\"name\":\"" + policy + "\"},\"classification\":\"" + classification + "\"" + categories + "}";
  }

  private static String nato(String values, String... labels) {
    return "{\"policies\":{\"NATO\":{\"releasableTo\":" + values + ",\"labels\":[" + String.join(",", labels) + "]}}}";
  }

  private static List<Problem> problems(String value) {
    return Labeling.problems(JSON.parse(value), ORDERS);
  }

  @Test
  void premadeLabelsAreStoredWithTheConfigurationAndEveryBrowserIsTold() {
    Labeling labeling = new Labeling(new Configuration(new ConfigStore(data, JSON)), live, JSON);
    Browser alice = new Browser();
    Browser bob = new Browser();
    live.open(Requester.user("u-alice", Set.of()), alice);
    live.open(Requester.user("u-bob", Set.of()), bob);
    List.of(alice, bob).forEach(b -> assertThat(b.types.next()).isEqualTo("welcome"));
    assertThat(labeling.current()).as("none yet").hasToString("{\"policies\":{}}");

    String premade = nato("[\"SWE\",\"NOR\",\"Exercise Northern Coast\"]", label("NATO", "SECRET", "SWE", "NOR"), label("NATO", "UNCLASSIFIED"));
    assertThat(labeling.set(JSON.parse(premade), ORDERS)).isEmpty();

    assertThat(alice.types.next()).isEqualTo("labeling");
    assertThat(bob.types.next()).as("every browser").isEqualTo("labeling");
    assertThat(labeling.current()).hasToString(premade);
    Labeling restarted = new Labeling(new Configuration(new ConfigStore(data, JSON)), live, JSON);
    assertThat(restarted.current()).as("in ecore-config.json").hasToString(premade);
  }

  @Test
  void aRefusedChangeKeepsWhatWasStoredAndTellsNobody() {
    Labeling labeling = new Labeling(new Configuration(new ConfigStore(null, JSON)), live, JSON);
    Browser alice = new Browser();
    live.open(Requester.user("u-alice", Set.of()), alice);
    assertThat(alice.types.next()).isEqualTo("welcome");

    assertThat(labeling.set(JSON.parse(nato("[\"SWE\",\"swe\"]")), ORDERS)).containsExactly(new Problem("/policies/NATO/releasableTo/1", "swe is in the list already"));

    assertThat(labeling.current()).hasToString("{\"policies\":{}}");
    assertThat(alice.types.drain()).isEmpty();
  }

  @Test
  void theWholeLabelingIsCheckedAgainstTheConfiguredPoliciesAndClassifications() {
    assertThat(problems("{\"policies\":{}}")).isEmpty();
    assertThat(problems("{\"policies\":{\"NATO\":{}}}")).as("both parts may be left out").isEmpty();
    assertThat(problems("[]")).extracting(Problem::path).containsExactly("");
    assertThat(problems("{\"policies\":[],\"extra\":1}")).extracting(Problem::path).containsExactly("/extra", "/policies");
    assertThat(problems("{\"policies\":{\"NATO2\":{},\"a/b\":{}}}")).containsExactly(
        new Problem("/policies/NATO2", "NATO2 is not a policy in the labeling definitions"),
        new Problem("/policies/a~1b", "a/b is not a policy in the labeling definitions"));
    assertThat(problems("{\"policies\":{\"NATO\":{\"owner\":\"x\",\"labels\":{}}}}")).extracting(Problem::path)
        .containsExactly("/policies/NATO/owner", "/policies/NATO/labels");
    assertThat(problems(nato("[]", label("NATO", "SECRET+")))).containsExactly(new Problem("/policies/NATO/labels/0/classification",
        "SECRET+ is not one of NATO's classifications in the labeling definitions (UNCLASSIFIED, RESTRICTED, CONFIDENTIAL, SECRET, COSMIC TOP SECRET)"));
    assertThat(problems(nato("[]", label("SWE", "SECRET")))).containsExactly(
        new Problem("/policies/NATO/labels/0/policyIdentifier/name", "the label's policy is NATO, the policy it is listed under"));
    assertThat(problems("{\"policies\":{\"SWE\":{\"labels\":[" + label("SWE", "BEGRÄNSAT HEMLIG") + "," + label("SWE", "SECRET") + "]}}}"))
        .as("another policy, a classification of each of its sets (round 3b)").isEmpty();
  }

  @Test
  void theReleasableToListHasNoValueTwiceIgnoringCaseAndNoBlankOrOverlongValue() {
    assertThat(problems(nato("[\"SWE\",\"NOR\",\"Exercise Northern Coast\"]"))).isEmpty();
    assertThat(problems(nato("[\"SWE\",\"\",\" NOR\",1,\"" + "x".repeat(129) + "\",\"Swe\"]"))).containsExactly(
        new Problem("/policies/NATO/releasableTo/1", "a value is a text of 1 to 128 characters"),
        new Problem("/policies/NATO/releasableTo/2", "a value has no spaces at its start or end"),
        new Problem("/policies/NATO/releasableTo/3", "a value is a text of 1 to 128 characters"),
        new Problem("/policies/NATO/releasableTo/4", "a value is a text of 1 to 128 characters"),
        new Problem("/policies/NATO/releasableTo/5", "Swe is in the list already"));
    assertThat(problems(nato("\"SWE\""))).extracting(Problem::path).containsExactly("/policies/NATO/releasableTo");
  }

  @Test
  void aLabelIsReleasableOnlyToTheListsValuesAsOneReleasableToCategory() {
    String values = "[\"SWE\",\"NOR\",\"FIN\"]";
    assertThat(problems(nato(values, label("NATO", "SECRET", "SWE", "FIN"), label("NATO", "SECRET")))).isEmpty();
    assertThat(problems(nato(values, label("NATO", "SECRET", "SWE", "DNK", "SWE")))).containsExactly(
        new Problem("/policies/NATO/labels/0/categories/0/values/1", "DNK is not in the policy's Releasable To list"),
        new Problem("/policies/NATO/labels/0/categories/0/values/2", "SWE is in the label already"));
    assertThat(problems(nato(values, "{\"policyIdentifier\":{\"name\":\"NATO\",\"uri\":\"u\"},\"classification\":\"SECRET\",\"privacyMark\":\"x\","
        + "\"categories\":[{\"tagName\":\"Releasable\",\"type\":\"restrictive\",\"values\":[],\"uri\":\"u\"}]}")))
        .extracting(Problem::path).containsExactly("/policies/NATO/labels/0/privacyMark", "/policies/NATO/labels/0/policyIdentifier",
            "/policies/NATO/labels/0/categories/0/uri", "/policies/NATO/labels/0/categories/0/tagName",
            "/policies/NATO/labels/0/categories/0/type", "/policies/NATO/labels/0/categories/0/values");
    String two = "{\"policyIdentifier\":{\"name\":\"NATO\"},\"classification\":\"SECRET\",\"categories\":[{\"tagName\":\"Releasable To\","
        + "\"type\":\"permissive\",\"values\":[\"SWE\"]},{\"tagName\":\"Releasable To\",\"type\":\"permissive\",\"values\":[\"NOR\"]}]}";
    assertThat(problems(nato(values, two))).extracting(Problem::path).containsExactly("/policies/NATO/labels/0/categories");
  }

  @Test
  void noTwoLabelsOfAPolicyAreTheSameWhateverTheOrderOfTheirValues() {
    String values = "[\"SWE\",\"NOR\",\"FIN\"]";
    assertThat(problems(nato(values, label("NATO", "SECRET", "SWE", "NOR"), label("NATO", "SECRET", "NOR"), label("NATO", "RESTRICTED", "SWE", "NOR"))))
        .as("another value or classification is another label").isEmpty();
    assertThat(problems(nato(values, label("NATO", "SECRET", "SWE", "NOR"), label("NATO", "SECRET"), label("NATO", "SECRET", "NOR", "SWE"),
        label("NATO", "SECRET")))).containsExactly(
        new Problem("/policies/NATO/labels/2", "the same label as /policies/NATO/labels/0: the order of the values does not matter"),
        new Problem("/policies/NATO/labels/3", "the same label as /policies/NATO/labels/1: the order of the values does not matter"));
  }
}
