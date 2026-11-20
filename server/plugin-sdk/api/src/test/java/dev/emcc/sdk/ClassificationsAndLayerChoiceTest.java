package dev.emcc.sdk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Classifications.Comparison;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.SecurityLabel;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** SDK 1.2.0 (CR-0025 part 3): classifications with their limit (R7), and the layer picker's value. */
class ClassificationsAndLayerChoiceTest {

  private final Classifications orders =
      new Classifications(Map.of("NATO", Classifications.NATO, "SE", List.of("UNCLASSIFIED", "RESTRICTED", "SECRET")));

  private static SecurityLabel label(String policy, String classification) {
    return SecurityLabel.of(policy, classification);
  }

  @Test
  void aLabelComparesWithTheLimitInItsOwnPolicysOrder() {
    var limit = new ClassificationLimit("NATO", "CONFIDENTIAL");
    assertThat(orders.compare(label("NATO", "RESTRICTED"), limit)).isEqualTo(Comparison.LOWER);
    assertThat(orders.compare(label("NATO", "CONFIDENTIAL"), limit)).isEqualTo(Comparison.SAME);
    assertThat(orders.compare(label("NATO", "SECRET"), limit)).isEqualTo(Comparison.HIGHER);
    assertThat(orders.within(label("NATO", "CONFIDENTIAL"), limit)).isTrue();
    assertThat(orders.within(label("NATO", "SECRET"), limit)).isFalse();
  }

  @Test
  void anotherPolicyOrAClassificationOutsideTheOrderCountsAsAbove() {
    var limit = new ClassificationLimit("NATO", "SECRET");
    assertThat(orders.compare(label("SE", "UNCLASSIFIED"), limit)).as("another policy (R7)").isEqualTo(Comparison.OUTSIDE);
    assertThat(orders.compare(label("NATO", "TOP SECRET"), limit)).as("not in the order").isEqualTo(Comparison.OUTSIDE);
    assertThat(orders.compare(label("EU", "RESTRICTED"), new ClassificationLimit("EU", "SECRET"))).as("no order").isEqualTo(Comparison.OUTSIDE);
    assertThat(orders.within(label("SE", "UNCLASSIFIED"), limit)).isFalse();
  }

  @Test
  void aLimitOutsideTheOrderLetsNothingThroughAndIsReported() {
    var unknown = new ClassificationLimit("NATO", "NATO SECRET");
    assertThat(orders.knows(unknown)).isFalse();
    assertThat(orders.within(label("NATO", "UNCLASSIFIED"), unknown)).isFalse();
    assertThat(orders.knows(new ClassificationLimit("SE", "SECRET"))).isTrue();
  }

  @Test
  void policyNamesMatchIgnoringCaseAsInTheServersConfiguration() {
    // An order set as an environment variable arrives as "nato" (ClassificationProperties).
    var fromEnvironment = new Classifications(Map.of("nato", Classifications.NATO));
    var limit = new ClassificationLimit("NATO", "SECRET");
    assertThat(fromEnvironment.compare(label("NATO", "SECRET"), limit)).isEqualTo(Comparison.SAME);
    assertThat(fromEnvironment.compare(label("Nato", "RESTRICTED"), limit)).isEqualTo(Comparison.LOWER);
    assertThat(fromEnvironment.knows(limit)).isTrue();
    assertThat(fromEnvironment.order("NATO")).containsExactlyElementsOf(Classifications.NATO);
    assertThat(fromEnvironment.compare(label("NATO", "secret"), limit)).as("classifications match exactly").isEqualTo(Comparison.OUTSIDE);
    assertThatThrownBy(() -> new Classifications(Map.of("NATO", Classifications.NATO, "nato", Classifications.NATO)))
        .hasMessageContaining("only in case");
  }

  @Test
  void ordersAndLimitsAreCheckedValues() {
    var source = new java.util.HashMap<String, List<String>>(Map.of("NATO", new java.util.ArrayList<>(Classifications.NATO)));
    var copied = new Classifications(source);
    source.get("NATO").clear();
    source.put("EU", List.of("RESTRICTED"));
    assertThat(copied.order("NATO")).as("a copy").containsExactlyElementsOf(Classifications.NATO);
    assertThat(copied.order("EU")).isEmpty();
    assertThatThrownBy(() -> copied.orders().put("EU", List.of("X"))).isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> new ClassificationLimit(" ", "SECRET")).hasMessageContaining("policy");
    assertThatThrownBy(() -> new ClassificationLimit("NATO", "")).hasMessageContaining("classification");
    assertThatThrownBy(() -> new ClassificationLimit("NATO", "S".repeat(65))).hasMessageContaining("classification");
  }

  @Test
  void ordersHoldEachClassificationOnceAndTheDefaultIsNato() {
    assertThat(Classifications.nato().order("NATO")).containsExactlyElementsOf(Classifications.NATO);
    assertThat(Classifications.nato().order("SE")).isEmpty();
    assertThatThrownBy(() -> new Classifications(Map.of("NATO", List.of()))).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Classifications(Map.of("NATO", List.of("SECRET", "SECRET")))).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void anAbsentLimitIsTheDefaultLabels() {
    SecurityLabel defaultLabel = label("NATO", "RESTRICTED");
    assertThat(ClassificationLimit.from(null, defaultLabel)).isEqualTo(new ClassificationLimit("NATO", "RESTRICTED"));
    assertThat(ClassificationLimit.from(JsonNull.INSTANCE, defaultLabel)).isEqualTo(new ClassificationLimit("NATO", "RESTRICTED"));
    JsonObject setting = JsonObject.builder().put("policy", JsonString.of("SE")).put("classification", JsonString.of("SECRET")).build();
    assertThat(ClassificationLimit.from(setting, defaultLabel)).isEqualTo(new ClassificationLimit("SE", "SECRET"));
    assertThatThrownBy(() -> ClassificationLimit.from(JsonString.of("SECRET"), defaultLabel)).as("a bare text names no policy (R7)").hasMessageContaining("policy");
    assertThatThrownBy(() -> ClassificationLimit.from(setting.without("policy"), defaultLabel)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aPickedLayerIsAnExistingOneOrANewOne() {
    UUID id = UUID.fromString("7d3f1a52-2b4e-4c1f-9e0a-5b6c7d8e9f10");
    LayerChoice existing = LayerChoice.from(JsonObject.builder().put("id", JsonString.of(id.toString())).put("name", JsonString.of("TAK North")).build());
    assertThat(existing).isEqualTo(new LayerChoice(id, "TAK North"));
    assertThat(existing.isNew()).isFalse();
    LayerChoice fresh = LayerChoice.from(JsonObject.builder().put("name", JsonString.of("Simulated tracks")).build());
    assertThat(fresh).isEqualTo(new LayerChoice(null, "Simulated tracks"));
    assertThat(fresh.isNew()).isTrue();
    assertThat(LayerChoice.from(null)).as("the setting names none").isNull();
    assertThat(LayerChoice.from(JsonNull.INSTANCE)).isNull();
  }

  @Test
  void pickedLayersAreAnArrayAndBadValuesAreRefused() {
    var a = JsonObject.builder().put("name", JsonString.of("A")).build();
    var b = JsonObject.builder().put("name", JsonString.of("B")).build();
    assertThat(LayerChoice.list(JsonArray.of(a, b))).extracting(LayerChoice::name).containsExactly("A", "B");
    assertThat(LayerChoice.list(null)).isEmpty();
    assertThatThrownBy(() -> LayerChoice.list(a)).hasMessageContaining("array");
    assertThatThrownBy(() -> LayerChoice.list(JsonArray.of(a, JsonNull.INSTANCE))).hasMessageContaining("null");
    assertThatThrownBy(() -> LayerChoice.from(JsonObject.empty())).hasMessageContaining("name");
    assertThatThrownBy(() -> LayerChoice.from(a.with("id", JsonNumber.of(7)))).hasMessageContaining("UUID");
    assertThatThrownBy(() -> LayerChoice.from(a.with("id", JsonString.of("not-a-uuid")))).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> LayerChoice.from(a.with("id", JsonString.of("1-1-1-1-1")))).as("only the usual form").hasMessageContaining("usual form");
    assertThat(LayerChoice.from(a.with("id", JsonString.of("7D3F1A52-2B4E-4C1F-9E0A-5B6C7D8E9F10")))).as("upper-case hex is a UUID too").isNotNull();
    assertThatThrownBy(() -> LayerChoice.from(JsonObject.builder().put("name", JsonString.of(" ")).build())).hasMessageContaining("name");
  }
}
