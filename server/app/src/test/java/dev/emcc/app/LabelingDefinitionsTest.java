package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Settings › Labeling's definitions (T-170 round 3b; owner OY, OZ A, T-170 3b Q1 and A1 to A5). */
class LabelingDefinitionsTest {

  private static List<String> problems(String text) {
    List<String> out = new ArrayList<>();
    LabelingDefinitions.checked(new ModelJson().parse(text), out);
    return out;
  }

  @Test
  void theShippedDefinitionsGiveNatoItsSetAndSweItsNationalSetThenNatos() {
    LabelingDefinitions shipped = new LabelingDefinitions("");

    assertThat(shipped.source()).isEqualTo("labeling-definitions.json (shipped)");
    assertThat(shipped.classificationsByPolicy()).isEqualTo(Map.of(
        "NATO", List.of("COSMIC TOP SECRET", "SECRET", "CONFIDENTIAL", "RESTRICTED", "UNCLASSIFIED"),
        "SWE", List.of("KVALIFICERAT HEMLIG", "HEMLIG", "KONFIDENTIELL", "BEGRÄNSAT HEMLIG", "EJ SEKRETESS",
            "COSMIC TOP SECRET", "SECRET", "CONFIDENTIAL", "RESTRICTED", "UNCLASSIFIED")));
    assertThat(shipped.json().get("classificationSets").get(1).get("name").stringValue()).isEqualTo("Swedish national");
    assertThat(shipped.json().get("classificationSets").get(0).get("classifications").get(1).toString())
        .isEqualTo("{\"name\":\"SECRET\",\"color\":\"#b8423a\"}");
  }

  @Test
  void aWrongFileStopsTheStartNamingWhatIsWrong() {
    assertThatThrownBy(() -> LabelingDefinitions.of("{\"policies\":"))
        .isInstanceOf(IllegalStateException.class).hasMessageStartingWith("the labeling definitions is not JSON");
    assertThatThrownBy(() -> LabelingDefinitions.of("{\"classificationSets\":[],\"policies\":[]}"))
        .isInstanceOf(IllegalStateException.class).hasMessage("the labeling definitions is not valid labeling definitions: "
            + "classificationSets is a list of one set or more; policies is a list of one policy or more");
  }

  @Test
  void takesCommentsInTheHandEditedFileButNoDuplicateName() { // ADR-0060 point 2
    String set = "{\"id\":\"a\",\"name\":\"A\",\"classifications\":[{\"name\":\"X\",\"color\":\"#000000\"}]}";
    LabelingDefinitions commented = LabelingDefinitions.of("// the sets\n{\"classificationSets\":[" + set + "], /* and the policies */\n"
        + "\"policies\":[{\"name\":\"P\",\"classificationSets\":[\"a\"]}]}");
    assertThat(commented).isNotNull();
    assertThatThrownBy(() -> LabelingDefinitions.of("{\"policies\":[],\"policies\":[]}"))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("not JSON");
  }

  @Test
  void eachSetAndPolicyIsChecked() {
    String set = "{\"id\":\"a\",\"name\":\"A\",\"classifications\":[{\"name\":\"X\",\"color\":\"#000000\"}]}";
    assertThat(problems("{\"classificationSets\":[" + set + "],\"policies\":[{\"name\":\"P\",\"classificationSets\":[\"a\"]}]}")).isEmpty();
    assertThat(problems("{\"classificationSets\":[{\"id\":\"A b\",\"name\":\"A\",\"classifications\":[]}],\"policies\":[{\"name\":\"P\",\"classificationSets\":[\"a\"]}],\"x\":1}"))
        .containsExactly("x is not a part of the labeling definitions", "classificationSets[0].id is 1 to 32 lower-case letters, digits and hyphens",
            "policies[0] names the set a, which classificationSets does not have");
    assertThat(problems("{\"classificationSets\":[{\"id\":\"a\",\"name\":\" A\",\"classifications\":[{\"name\":\"X\",\"color\":\"red\"},"
        + "{\"name\":\"X\",\"color\":\"#000000\"}]}],\"policies\":[{\"name\":\"P\",\"classificationSets\":[\"a\",\"a\"]},{\"name\":\"p\",\"classificationSets\":[]}]}"))
        .containsExactly("classificationSets[0].name is a text of 1 to 64 characters, without spaces at its ends",
            "classificationSets[0].classifications[0].color is #rrggbb, e.g. #b8423a", "classificationSets[0].classifications[1] names X a second time",
            "policies[0] names the set a twice", "policies[1] names the policy p a second time",
            "policies[1].classificationSets is a list of one set id or more");
  }

  @Test
  void withinAPolicyAClassificationIsInOneSetOnly() {
    String sets = "{\"id\":\"a\",\"name\":\"A\",\"classifications\":[{\"name\":\"X\",\"color\":\"#000000\"}]},"
        + "{\"id\":\"b\",\"name\":\"B\",\"classifications\":[{\"name\":\"X\",\"color\":\"#ffffff\"}]}";
    assertThat(problems("{\"classificationSets\":[" + sets + "],\"policies\":[{\"name\":\"P\",\"classificationSets\":[\"a\",\"b\"]}]}"))
        .containsExactly("policies[0] has X in two of its sets; within a policy a classification is in one set only");
    assertThat(problems("{\"classificationSets\":[" + sets + "],\"policies\":[{\"name\":\"P\",\"classificationSets\":[\"a\"]},"
        + "{\"name\":\"Q\",\"classificationSets\":[\"b\"]}]}")).as("in two policies is fine").isEmpty();
  }
}
