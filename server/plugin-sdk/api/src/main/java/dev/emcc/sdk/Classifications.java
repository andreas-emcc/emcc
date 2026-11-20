package dev.emcc.sdk;

import dev.emcc.sdk.model.SecurityLabel;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/**
 * SDK 1.2.0: the configured order of classifications per security policy, lowest first, from the
 * same configuration as the shell's Settings › Layers (ADR-0031 point 3; {@code
 * context.classifications()}). Fixed while the server runs. An output plugin compares each
 * object's label with its link's highest classification ({@link ClassificationLimit}; ADR-0037
 * point 8). An immutable value.
 *
 * <pre>{@code
 * ClassificationLimit limit = ClassificationLimit.from(link.get("highestClassification"), context.defaultLabel());
 * if (!context.classifications().within(content.label(), limit)) {
 *   skipped("above the link's classification");
 * }
 * }</pre>
 *
 * <p><b>Policy names match ignoring case</b>, as in the server's configuration, where a policy
 * set as an environment variable arrives in lower case ({@code nato}); classifications match
 * exactly.
 *
 * <p><b>A label has a place in an order only if its policy has one and its classification is in
 * it.</b> A label without a place, or of another policy than the limit's, is {@link
 * Comparison#OUTSIDE}: it counts as above any limit and is never sent.
 *
 * @param orders each policy's name with its classifications, lowest first; each order holds at
 *     least one classification, each once, and no two names differ only in case
 */
public record Classifications(Map<String, List<String>> orders) {

  /** The NATO order, the default configuration. */
  public static final List<String> NATO = List.of("UNCLASSIFIED", "RESTRICTED", "CONFIDENTIAL", "SECRET", "COSMIC TOP SECRET");

  /** Where a label stands to a limit. */
  public enum Comparison {
    /** Below the limit, in the limit's policy. */
    LOWER,
    /** At the limit. */
    SAME,
    /** Above the limit, in the limit's policy. */
    HIGHER,
    /** No place to compare: another policy, or a classification outside the order. Counts as above. */
    OUTSIDE
  }

  public Classifications {
    var copy = new LinkedHashMap<String, List<String>>();
    var names = new HashSet<String>();
    orders.forEach((policy, order) -> {
      Objects.requireNonNull(policy, "policy");
      if (!names.add(policy.toLowerCase(Locale.ROOT))) {
        throw new IllegalArgumentException("two policies differ only in case: " + policy);
      }
      List<String> o = List.copyOf(order);
      if (o.isEmpty() || new HashSet<>(o).size() != o.size()) {
        throw new IllegalArgumentException("the order of " + policy + " must hold each classification once, at least one");
      }
      copy.put(policy, o);
    });
    orders = Map.copyOf(copy);
  }

  /** The default configuration: the NATO policy with the {@link #NATO} order. */
  public static Classifications nato() {
    return new Classifications(Map.of("NATO", NATO));
  }

  /** The policy's classifications, lowest first, its name matched ignoring case; empty if it has no order. */
  public List<String> order(String policy) {
    for (Map.Entry<String, List<String>> e : orders.entrySet()) {
      if (e.getKey().equalsIgnoreCase(policy)) {
        return e.getValue();
      }
    }
    return List.of();
  }

  /** Where {@code label} stands to {@code limit}. */
  public Comparison compare(SecurityLabel label, ClassificationLimit limit) {
    if (!label.policyIdentifier().name().equalsIgnoreCase(limit.policy())) {
      return Comparison.OUTSIDE;
    }
    List<String> order = order(limit.policy());
    int at = order.indexOf(label.classification());
    int max = order.indexOf(limit.classification());
    if (at < 0 || max < 0) {
      return Comparison.OUTSIDE;
    }
    return at < max ? Comparison.LOWER : at == max ? Comparison.SAME : Comparison.HIGHER;
  }

  /** Whether {@code label} is at or below {@code limit}: what an output may send. */
  public boolean within(SecurityLabel label, ClassificationLimit limit) {
    Comparison c = compare(label, limit);
    return c == Comparison.LOWER || c == Comparison.SAME;
  }

  /**
   * Whether {@code limit} names a classification in its policy's order. A limit that does not lets
   * nothing through; the plugin reports it in its status.
   */
  public boolean knows(ClassificationLimit limit) {
    return order(limit.policy()).contains(limit.classification());
  }
}
