package dev.emcc.plugins.gmti.in;

import dev.emcc.sdk.model.SecurityLabel;
import java.util.List;
import java.util.Objects;

/**
 * A packet's label (brief section 3, the {@code P4} row; ADR-0020): with {@code map}, {@code P4} 1
 * to 5 becomes a classification of the link label's policy, by the link's names (NATO's by
 * default); with {@code link label}, every packet gets the link's label (A2). A packet that cannot
 * be mapped gets the link's label and is counted ({@code label not mapped}).
 *
 * @param map {@code classification: map}; false is {@code link label}
 * @param linkLabel the link's label, else the server's default
 * @param names the policy's classifications for {@code P4} 1 (top secret) to 5 (unclassified)
 */
public record LabelRule(boolean map, SecurityLabel linkLabel, List<String> names) {

  /** NATO's names for {@code P4} 1 to 5 (AEDP Table 3-2), as the SDK's NATO order names them. */
  public static final List<String> NATO = List.of("COSMIC TOP SECRET", "SECRET", "CONFIDENTIAL", "RESTRICTED", "UNCLASSIFIED");

  public LabelRule {
    Objects.requireNonNull(linkLabel, "linkLabel");
    names = List.copyOf(names);
    if (names.size() != 5) {
      throw new IllegalArgumentException("five names, for P4 1 to 5: " + names);
    }
  }

  /** What a packet's {@code P4} gives. */
  public record Result(SecurityLabel label, boolean mapped) {}

  public Result label(int classification) {
    if (!map) {
      return new Result(linkLabel, true);
    }
    if (classification < 1 || classification > 5) {
      return new Result(linkLabel, false);
    }
    String name = names.get(classification - 1);
    if (name.equals(linkLabel.classification())) {
      return new Result(linkLabel, true);
    }
    return new Result(new SecurityLabel(linkLabel.policyIdentifier(), name, List.of(), null, null), true);
  }
}
