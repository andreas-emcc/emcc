package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

class TestJsonTest {

  /** Surefire runs in the module folder, server/plugin-sdk/testkit. */
  static final Path MODEL = Path.of("../../../model");

  @Test
  void parsesAndWritesEveryModelExampleLosslessly() throws IOException {
    List<Path> files;
    try (Stream<Path> s = Stream.of("valid", "invalid", "invalid-by-rule").flatMap(d -> list(MODEL.resolve("examples").resolve(d)))) {
      files = s.toList();
    }
    assertThat(files).hasSizeGreaterThan(30);
    for (Path f : files) {
      JsonValue v = TestJson.parse(Files.readString(f));
      assertThat(TestJson.parse(TestJson.write(v))).as(f.toString()).isEqualTo(v);
      ModelCodecContractTest.kindFromName(f.getFileName().toString().replaceFirst("^rule-\\d+-", ""));
    }
  }

  @Test
  void keepsNumberTextExactly() {
    String json = "{\"n\":0.10000000000000000555111512312578270211815834045410156250001}";
    assertThat(TestJson.write(TestJson.parse(json))).isEqualTo(json);
  }

  @Test
  void isStrict() {
    for (String bad : List.of("{\"a\":1,}", "[1,]", "{\"a\":1,\"a\":2}", "01", "{a:1}", "\"x", "[1] 2", "// c\n1")) {
      assertThatThrownBy(() -> TestJson.parse(bad)).as(bad).isInstanceOf(IllegalArgumentException.class);
    }
  }

  @Test
  void parsesAnyDepthWithoutUsingTheThreadsStack() {
    int levels = 100_000; // far past any thread's stack for a recursive parser
    JsonValue v = TestJson.parse("[".repeat(levels) + "]".repeat(levels));
    int depth = 1;
    while (v instanceof JsonArray a && a.size() == 1) {
      v = a.get(0);
      depth++;
    }
    assertThat(depth).isEqualTo(levels);
    assertThat(v).isEqualTo(new JsonArray(List.of()));
    v = TestJson.parse("{\"a\":".repeat(levels) + "1" + "}".repeat(levels));
    depth = 0;
    while (v instanceof JsonObject o && o.size() == 1) {
      v = o.get("a");
      depth++;
    }
    assertThat(depth).isEqualTo(levels);
    assertThat(v).isEqualTo(JsonNumber.of("1"));
  }

  @Test
  void refusesNestingPastItsLimit() {
    assertThat(TestJson.parse("[".repeat(3) + "]".repeat(3), 3)).isNotNull();
    assertThat(TestJson.parse("[[],{\"a\":[1]}]", 3)).isNotNull();
    assertThat(TestJson.parse("[[1],[1],[1]]", 2)).as("closing a container gives its level back").isNotNull();
    assertThat(TestJson.parse("[{\"a\":[1]},{\"a\":[1]}]", 3)).isNotNull();
    for (String bad : List.of("[".repeat(4) + "]".repeat(4), "{\"a\":".repeat(4) + "1" + "}".repeat(4), "[{\"a\":[[]]}]")) {
      assertThatThrownBy(() -> TestJson.parse(bad, 3)).as(bad).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("nested deeper than 3");
    }
  }

  @Test
  void keepsTheShapeOfMixedNesting() {
    String json = "[{\"a\":[1,{\"b\":[]},\"x\"],\"c\":{},\"d\":[[true],[null,false]]},2,[],{\"e\":{\"f\":{}}}]";
    assertThat(TestJson.write(TestJson.parse(json))).isEqualTo(json);
    assertThat(TestJson.write(TestJson.parse(" [ { \"a\" : [ 1 , 2 ] } , [ ] ] "))).isEqualTo("[{\"a\":[1,2]},[]]");
  }

  @Test
  void normalizeTreatsEmptyOptionalMembersAsAbsentButLeavesExtensionDataAlone() {
    JsonValue a = TestJson.parse("{\"style\":{},\"properties\":{},\"symbol\":{\"modifiers\":{}},\"extensions\":{\"x\":{\"style\":{}}}}");
    JsonValue b = TestJson.parse("{\"symbol\":{},\"extensions\":{\"x\":{\"style\":{}}}}");
    assertThat(TestJson.normalize(a)).isEqualTo(TestJson.normalize(b));
    JsonObject ext = ((JsonObject) TestJson.normalize(a)).getObject("extensions").getObject("x");
    assertThat(ext.has("style")).as("extension data is opaque").isTrue();
  }

  @Test
  void normalizeTreatsBothApp6eFormsAsEqual() {
    JsonValue longForm = TestJson.parse("{\"symbol\":{\"standard\":\"APP-6E\",\"sidc\":\"130310000012110000000000000000\"}}");
    JsonValue shortForm = TestJson.parse("{\"symbol\":{\"standard\":\"APP-6E\",\"sidc\":\"13031000001211000000\"}}");
    JsonValue withCountry = TestJson.parse("{\"symbol\":{\"standard\":\"APP-6E\",\"sidc\":\"130310000012110000000000000752\"}}");
    assertThat(TestJson.normalize(longForm)).isEqualTo(TestJson.normalize(shortForm));
    assertThat(TestJson.normalize(withCountry)).isNotEqualTo(TestJson.normalize(shortForm));
  }

  /** Data model 1.2.0, R2: View's layers carry no workspace, and readers treat core.view alike. */
  @Test
  void normalizeTreatsCoreViewAsAnAbsentWorkspaceExceptInAnUpdate() throws IOException {
    JsonValue explicit = TestJson.parse(Files.readString(MODEL.resolve("examples/valid/layer-in-view.json")));
    JsonValue absent = TestJson.parse(Files.readString(MODEL.resolve("examples/valid/layer.json")));
    assertThat(((JsonObject) explicit).getString("workspace")).isEqualTo("core.view");
    assertThat(TestJson.normalize(explicit)).isEqualTo(TestJson.normalize(absent));
    assertThat(TestJson.normalize(TestJson.parse("{\"operation\":\"create\",\"data\":{\"name\":\"L\",\"workspace\":\"core.view\"}}")))
        .isEqualTo(TestJson.normalize(TestJson.parse("{\"operation\":\"create\",\"data\":{\"name\":\"L\"}}")));
    assertThat(TestJson.normalize(TestJson.parse("{\"operation\":\"update\",\"data\":{\"name\":\"L\",\"workspace\":\"core.view\"}}")))
        .as("on update, absent keeps the stored workspace and core.view must equal it")
        .isNotEqualTo(TestJson.normalize(TestJson.parse("{\"operation\":\"update\",\"data\":{\"name\":\"L\"}}")));
    assertThat(TestJson.normalize(TestJson.parse("{\"workspace\":\"simulator.simulation\"}")))
        .as("other workspaces stay")
        .isNotEqualTo(TestJson.normalize(TestJson.parse("{}")));
  }

  /** CR-0004: core numbers are doubles in the SDK's model types, so they are compared as doubles. */
  @Test
  void normalizeComparesCoreNumbersAsDoubles() throws IOException {
    // 17 significant digits, more than a double keeps; a codec on the SDK types writes the nearest double.
    String original = Files.readString(MODEL.resolve("examples/valid/object-extension-high-precision.json"));
    String asDoubles = original.replace("[17.123456789012345, 61.987654321098765]", "[17.123456789012344,61.987654321098766]");
    assertThat(asDoubles).isNotEqualTo(original);
    assertThat(TestJson.normalize(TestJson.parse(asDoubles))).isEqualTo(TestJson.normalize(TestJson.parse(original)));

    assertThat(TestJson.normalize(TestJson.parse("{\"version\":4,\"r\":[2.50,-0.0]}")))
        .isEqualTo(TestJson.normalize(TestJson.parse("{\"version\":4.0,\"r\":[2.5,0]}")));
    assertThat(TestJson.normalize(TestJson.parse("{\"coordinates\":[17.1234567890123,61.9876543210988]}")))
        .as("different doubles stay different")
        .isNotEqualTo(TestJson.normalize(TestJson.parse("{\"coordinates\":[17.123456789012345,61.987654321098765]}")));
  }

  /** CR-0004 and ADR-0007: numbers in free-form JSON keep their exact value, at any depth. */
  @Test
  void normalizeKeepsFreeFormNumbersExact() {
    for (String wrapper : List.of("{\"extensions\":{\"nvg-in\":%s}}", "{\"data\":{\"extensions\":{\"nvg-in\":%s}}}", "{\"settings\":{\"type\":\"object\",\"properties\":%s}}")) {
      JsonValue exact = TestJson.parse(wrapper.formatted("{\"n\":17.123456789012345,\"list\":[0.10000000000000000555111512312578270211815834045410156250001]}"));
      JsonValue rounded = TestJson.parse(wrapper.formatted("{\"n\":17.123456789012344,\"list\":[0.1]}"));
      JsonValue sameValue = TestJson.parse(wrapper.formatted("{\"n\":17.1234567890123450,\"list\":[1.0000000000000000555111512312578270211815834045410156250001e-1]}"));
      assertThat(TestJson.normalize(rounded)).as(wrapper).isNotEqualTo(TestJson.normalize(exact));
      assertThat(TestJson.normalize(sameValue)).as(wrapper + ": equal by exact value").isEqualTo(TestJson.normalize(exact));
    }
  }

  private static Stream<Path> list(Path dir) {
    try {
      return Files.list(dir).filter(p -> p.toString().endsWith(".json")).toList().stream();
    } catch (IOException e) {
      throw new java.io.UncheckedIOException(e);
    }
  }
}
