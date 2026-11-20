package dev.emcc.sdk.model;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * A STANAG 4774 confidentiality label, mandatory on every object and layer (ADR-0007). The
 * mapping to the ADatP-4774 XML is in the model README. Labels are stored, shown and forwarded,
 * and an output link's highest classification holds back what is above it; they do not decide a
 * user's access.
 *
 * <pre>{@code
 * new SecurityLabel(new SecurityLabel.Policy("NATO", null), "UNCLASSIFIED",
 *     List.of(new SecurityLabel.Category("Releasable to", SecurityLabel.CategoryType.PERMISSIVE, null, List.of("SWE", "NATO"))),
 *     null, null)
 * }</pre>
 *
 * @param policyIdentifier the security policy
 * @param classification a classification defined by the policy, 1 to 64 characters
 * @param categories further categories; empty when there are none
 * @param creationDateTime when the label was created, or {@code null}
 * @param reviewDateTime when the label should be reviewed, or {@code null}
 */
public record SecurityLabel(
    Policy policyIdentifier,
    String classification,
    List<Category> categories,
    @Nullable Instant creationDateTime,
    @Nullable Instant reviewDateTime) {

  public SecurityLabel {
    Objects.requireNonNull(policyIdentifier, "policyIdentifier");
    Objects.requireNonNull(classification, "classification");
    if (classification.isEmpty() || classification.length() > 64) {
      throw new IllegalArgumentException("classification must be 1..64 characters");
    }
    categories = List.copyOf(categories);
  }

  /** A label with a policy and a classification only. */
  public static SecurityLabel of(String policy, String classification) {
    return new SecurityLabel(new Policy(policy, null), classification, List.of(), null, null);
  }

  /**
   * The security policy the label belongs to.
   *
   * @param name e.g. {@code NATO}
   * @param uri the policy's URI, or {@code null}
   */
  public record Policy(String name, @Nullable String uri) {
    public Policy {
      Objects.requireNonNull(name, "name");
    }
  }

  /**
   * A category such as releasability.
   *
   * @param tagName e.g. {@code Releasable to}
   * @param type how the category combines
   * @param uri the category's URI, or {@code null}
   * @param values at least one value
   */
  public record Category(String tagName, CategoryType type, @Nullable String uri, List<String> values) {
    public Category {
      Objects.requireNonNull(tagName, "tagName");
      Objects.requireNonNull(type, "type");
      values = List.copyOf(values);
      if (values.isEmpty()) {
        throw new IllegalArgumentException("a category needs at least one value");
      }
    }
  }

  /** ADatP-4774 category types; lower case in JSON. */
  public enum CategoryType {
    PERMISSIVE,
    RESTRICTIVE,
    INFORMATIVE;

    public String json() {
      return name().toLowerCase(java.util.Locale.ROOT);
    }

    public static CategoryType fromJson(String value) {
      return valueOf(value.toUpperCase(java.util.Locale.ROOT));
    }
  }
}
