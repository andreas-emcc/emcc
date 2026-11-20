package dev.emcc.app;

import org.jspecify.annotations.Nullable;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code emc2.labeling.*}: how a premade label of Settings › Labeling is written as text (T-170,
 * owner OK, 2026-11-10), e.g. {@code NATO SECRET · REL TO SWE, NOR, FIN}: the policy and the
 * classification with a space between, then {@code field-separator}, then {@code
 * releasable-to-prefix}, a space and the values with {@code releasable-to-separator} between them. A
 * label released to none ends after its classification.
 *
 * <p>A value may stand in double quotes, which keeps its spaces at the start and end: the text
 * between the first and the last quote is taken as it is. Without quotes the value is taken as
 * Spring reads it (spaces at the ends dropped). The browsers get the three in {@code /api/config}.
 *
 * @param fieldSeparator between the classification and the Releasable To part
 * @param releasableToSeparator between the Releasable To values
 * @param releasableToPrefix before the Releasable To values
 */
@ConfigurationProperties("emc2.labeling")
record LabelingProperties(@Nullable String fieldSeparator, @Nullable String releasableToSeparator, @Nullable String releasableToPrefix) {

  /** The form as the browsers get it ({@code /api/config}'s {@code labelFormat}). */
  record Format(String fieldSeparator, String releasableToSeparator, String releasableToPrefix) {}

  Format format() {
    return new Format(text(fieldSeparator, " · "), text(releasableToSeparator, ", "), text(releasableToPrefix, "REL TO"));
  }

  /** {@code value} without its double quotes, if it stands in them; {@code otherwise} when not set. */
  static String text(@Nullable String value, String otherwise) {
    if (value == null) {
      return otherwise;
    }
    String v = value.strip();
    return v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"") ? v.substring(1, v.length() - 1) : v;
  }
}
