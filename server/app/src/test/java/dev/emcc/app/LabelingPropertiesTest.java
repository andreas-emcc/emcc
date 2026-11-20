package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** {@code emc2.labeling.*} (T-170): a value in double quotes keeps its spaces; without one, the owner's default form. */
class LabelingPropertiesTest {

  @Test
  void aQuotedValueIsTakenAsItIsBetweenItsQuotes() {
    assertThat(LabelingProperties.text("\" · \"", "x")).isEqualTo(" · ");
    assertThat(LabelingProperties.text("\"\"", "x")).as("empty").isEmpty();
    assertThat(LabelingProperties.text("\"a \"quoted\" b\"", "x")).as("between the first and the last").isEqualTo("a \"quoted\" b");
    assertThat(LabelingProperties.text(" / ", "x")).as("unquoted: the ends dropped").isEqualTo("/");
    assertThat(LabelingProperties.text("\"", "x")).as("one quote is no pair").isEqualTo("\"");
    assertThat(LabelingProperties.text(null, "x")).isEqualTo("x");
  }

  @Test
  void withoutConfigurationTheFormIsTheOwnersDefault() {
    assertThat(new LabelingProperties(null, null, null).format())
        .isEqualTo(new LabelingProperties.Format(" · ", ", ", "REL TO"));
  }
}
