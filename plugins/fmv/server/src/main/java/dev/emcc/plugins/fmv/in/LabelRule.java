package dev.emcc.plugins.fmv.in;

import dev.emcc.sdk.model.SecurityLabel;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * A set's label (brief section 3; ADR-0057 point 4; as {@code gmti}'s {@code P4}): with {@code map}, ST
 * 0102 tag 1 (1 UNCLASSIFIED to 5 TOP SECRET) becomes a classification of the link label's policy, by
 * the link's names (NATO's by default); with {@code link label}, everything gets the link's label.
 * A set without ST 0102, or with a value the mapping cannot place, gets the link's label and is
 * counted ({@code unmapped classification}).
 *
 * @param map {@code classification: map}; false is {@code link label}
 * @param linkLabel the link's label, else the server's default
 * @param names the policy's classifications for ST 0102 tag 1's values 1 (unclassified) to 5 (top secret)
 */
public record LabelRule(boolean map, SecurityLabel linkLabel, List<String> names) {

  /** NATO's names for ST 0102 tag 1's values 1 to 5, as the SDK's NATO order names them. */
  public static final List<String> NATO = List.of("UNCLASSIFIED", "RESTRICTED", "CONFIDENTIAL", "SECRET", "COSMIC TOP SECRET");

  public LabelRule {
    Objects.requireNonNull(linkLabel, "linkLabel");
    names = List.copyOf(names);
    if (names.size() != 5) {
      throw new IllegalArgumentException("five names, for ST 0102 tag 1's values 1 to 5: " + names);
    }
  }

  /** What a set's classification gives. */
  public record Result(SecurityLabel label, boolean mapped) {}

  /** The label for ST 0102 tag 1's value, or for none ({@code null}: the set had no ST 0102). */
  public Result label(@Nullable Integer classification) {
    if (!map) {
      return new Result(linkLabel, true);
    }
    if (classification == null || classification < 1 || classification > 5) {
      return new Result(linkLabel, false);
    }
    String name = names.get(classification - 1);
    if (name.equals(linkLabel.classification())) {
      return new Result(linkLabel, true);
    }
    return new Result(new SecurityLabel(linkLabel.policyIdentifier(), name, List.of(), null, null), true);
  }
}
