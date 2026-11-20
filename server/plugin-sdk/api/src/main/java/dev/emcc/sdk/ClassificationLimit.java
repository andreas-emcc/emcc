package dev.emcc.sdk;

import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.SecurityLabel;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.2.0: an output link's highest classification (ADR-0037 point 8; the ACA's R7): a
 * classification <b>with its policy</b>, since labels name their policy and the order is per
 * policy. Objects above it, of another policy, or with a classification outside the order are
 * skipped and counted ({@link Classifications#within}).
 *
 * <p>The setting to copy (the design pattern): {@code "highestClassification": {"type": "object",
 * "properties": {"policy": {"type": "string"}, "classification": {"type": "string"}}, "required":
 * ["policy", "classification"]}}, with no default: a manifest cannot name the server's default
 * label, so absent means the policy and classification of {@code context.defaultLabel()}.
 *
 * @param policy the policy's name, e.g. {@code NATO}
 * @param classification a classification of that policy, 1 to 64 characters
 */
public record ClassificationLimit(String policy, String classification) {

  public ClassificationLimit {
    Objects.requireNonNull(policy, "policy");
    Objects.requireNonNull(classification, "classification");
    if (policy.isBlank()) {
      throw new IllegalArgumentException("policy must not be blank");
    }
    if (classification.isEmpty() || classification.length() > 64) {
      throw new IllegalArgumentException("classification must be 1..64 characters");
    }
  }

  /** The limit at {@code label}'s policy and classification. */
  public static ClassificationLimit of(SecurityLabel label) {
    return new ClassificationLimit(label.policyIdentifier().name(), label.classification());
  }

  /**
   * Reads the setting {@code {policy, classification}}; absent or {@code null} gives {@code
   * defaultLabel}'s.
   *
   * @throws IllegalArgumentException if the setting is not such an object
   */
  public static ClassificationLimit from(@Nullable JsonValue setting, SecurityLabel defaultLabel) {
    if (setting == null || setting instanceof JsonNull) {
      return of(defaultLabel);
    }
    if (!(setting instanceof JsonObject o) || !(o.get("policy") instanceof JsonString p) || !(o.get("classification") instanceof JsonString c)) {
      throw new IllegalArgumentException("a highest classification is {\"policy\": ..., \"classification\": ...}");
    }
    return new ClassificationLimit(p.value(), c.value());
  }
}
