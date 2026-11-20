package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.model.SecurityLabel;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** {@code emc2.classifications.order.<policy>} (Settings › Layers, ADR-0031 point 3). */
class ClassificationPropertiesTest {

  private static final SecurityLabel NATO = SecurityLabel.of("NATO", "UNCLASSIFIED");

  @Test
  void theOrdersAreTrimmedAndKeptByPolicyLowestFirst() {
    ClassificationProperties properties = new ClassificationProperties(Map.of(
        "NATO", List.of("UNCLASSIFIED", " RESTRICTED", "SECRET "), "SWE", List.of("OKLASSIFICERAD", "BEGRÄNSAT HEMLIG")));
    assertThat(properties.checked(NATO)).isEqualTo(Map.of(
        "NATO", List.of("UNCLASSIFIED", "RESTRICTED", "SECRET"), "SWE", List.of("OKLASSIFICERAD", "BEGRÄNSAT HEMLIG")));
    assertThat(new ClassificationProperties(null).checked(NATO)).isEmpty();
  }

  @Test
  void aWrongOrderStopsTheStartNamingTheSetting() {
    assertThatThrownBy(() -> new ClassificationProperties(Map.of("NATO", List.of())).checked(NATO))
        .isInstanceOf(IllegalStateException.class).hasMessageStartingWith("emc2.classifications.order.NATO is empty");
    assertThatThrownBy(() -> new ClassificationProperties(Map.of("NATO", List.of("UNCLASSIFIED", " "))).checked(NATO))
        .hasMessageContaining("empty or longer than 64 characters");
    assertThatThrownBy(() -> new ClassificationProperties(Map.of("NATO", List.of("UNCLASSIFIED", "x".repeat(65)))).checked(NATO))
        .hasMessageContaining("empty or longer than 64 characters");
    assertThatThrownBy(() -> new ClassificationProperties(Map.of("NATO", List.of("UNCLASSIFIED", "SECRET", "SECRET "))).checked(NATO))
        .hasMessage("emc2.classifications.order.NATO names SECRET twice");
  }

  @Test
  void theDefaultLabelsClassificationMustBeInItsPolicysOrder() {
    assertThatThrownBy(() -> new ClassificationProperties(Map.of("NATO", List.of("RESTRICTED", "SECRET"))).checked(NATO))
        .hasMessage("emc2.classifications.order.NATO does not hold the default label's classification UNCLASSIFIED"
            + " (emc2.default-label.classification)");
    assertThat(new ClassificationProperties(Map.of("SWE", List.of("OKLASSIFICERAD"))).checked(NATO))
        .as("a default label whose policy has no order").containsOnlyKeys("SWE");
    assertThatThrownBy(() -> new ClassificationProperties(Map.of("nato", List.of("RESTRICTED"))).checked(NATO))
        .as("an environment variable's lower-case name is the same policy").hasMessageContaining("emc2.classifications.order.nato");
  }

  @Test
  void thePluginsGetTheCheckedOrdersAndTwoNamesOfOnePolicyStopTheStart() {
    Map<String, List<String>> configured = new java.util.LinkedHashMap<>();
    configured.put("NATO", List.of("UNCLASSIFIED", "SECRET"));
    configured.put("SWE", List.of(" OKLASSIFICERAD "));

    assertThat(new ClassificationProperties(configured).checkedForPlugins(NATO))
        .containsExactly(Map.entry("NATO", List.of("UNCLASSIFIED", "SECRET")), Map.entry("SWE", List.of("OKLASSIFICERAD")));
    configured.put("swe", List.of("OKLASSIFICERAD"));
    assertThatThrownBy(() -> new ClassificationProperties(configured).checkedForPlugins(NATO))
        .isInstanceOf(IllegalStateException.class).hasMessageStartingWith("emc2.classifications.order: ");
  }

  @Test
  void theOrdersKeepTheOrderTheyWereConfiguredIn() {
    Map<String, List<String>> configured = new java.util.LinkedHashMap<>();
    for (String policy : List.of("NATO", "SWE", "EU", "FIN", "NOR")) {
      configured.put(policy, List.of("UNCLASSIFIED"));
    }
    assertThat(new ClassificationProperties(configured).checked(NATO).keySet()).containsExactly("NATO", "SWE", "EU", "FIN", "NOR");
  }
}
