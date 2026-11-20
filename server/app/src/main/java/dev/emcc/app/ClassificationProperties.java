package dev.emcc.app;

import dev.emcc.sdk.Classifications;
import dev.emcc.sdk.model.SecurityLabel;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code emc2.classifications.order.<policy>}: the order of each security policy's classifications,
 * lowest first (ADR-0031 point 3, overview 4.9). Settings › Layers offers a layer only the
 * classifications of its policy's order, and raises objects whose classification is lower in it.
 * The default is NATO's order:
 *
 * <pre>
 * emc2.classifications.order.NATO=UNCLASSIFIED,RESTRICTED,CONFIDENTIAL,SECRET,COSMIC TOP SECRET
 * </pre>
 *
 * <p>A policy's name matches a label's ignoring case: as an environment variable
 * ({@code EMC2_CLASSIFICATIONS_ORDER_NATO}) the name arrives in lower case. A classification with a
 * comma in it is written one by one: {@code emc2.classifications.order.NATO[0]=...}.
 *
 * <p>Labels do not limit access yet (ADR-0020); the security policy definitions come with that.
 *
 * @param order the classifications by policy name, lowest first; null when none are configured
 */
@ConfigurationProperties("emc2.classifications")
record ClassificationProperties(@Nullable Map<String, List<String>> order) {

  /** The longest classification a label holds ({@link SecurityLabel}). */
  private static final int MAX_LENGTH = 64;

  /**
   * The orders as configured, in that order, checked: each a list of distinct classifications of 1
   * to 64 characters (trimmed); the default label's classification in its policy's order, if its
   * policy has one (the policy's name ignoring case).
   *
   * @throws IllegalStateException naming the setting that is wrong, which stops the start
   */
  Map<String, List<String>> checked(SecurityLabel defaultLabel) {
    Map<String, List<String>> out = new LinkedHashMap<>();
    if (order != null) {
      order.forEach((policy, classifications) -> out.put(policy, checked(policy, classifications)));
    }
    String policy = defaultLabel.policyIdentifier().name().toLowerCase(Locale.ROOT);
    for (Map.Entry<String, List<String>> own : out.entrySet()) {
      if (own.getKey().toLowerCase(Locale.ROOT).equals(policy) && !own.getValue().contains(defaultLabel.classification())) {
        throw new IllegalStateException("emc2.classifications.order." + own.getKey() + " does not hold the default"
            + " label's classification " + defaultLabel.classification() + " (emc2.default-label.classification)");
      }
    }
    return Collections.unmodifiableMap(out);
  }

  /**
   * The checked orders ({@link #checked}), in the configured order, also checked as the plugins get
   * them ({@code classifications()}, SDK 1.2.0), which keeps no order of policies.
   *
   * @throws IllegalStateException naming the setting that is wrong, which stops the start
   */
  Map<String, List<String>> checkedForPlugins(SecurityLabel defaultLabel) {
    Map<String, List<String>> orders = checked(defaultLabel);
    try {
      new Classifications(orders);
    } catch (IllegalArgumentException e) {
      throw new IllegalStateException("emc2.classifications.order: " + e.getMessage(), e); // e.g. two names that differ only in case
    }
    return orders;
  }

  private static List<String> checked(String policy, @Nullable List<String> classifications) {
    String setting = "emc2.classifications.order." + policy;
    if (classifications == null || classifications.isEmpty()) {
      throw new IllegalStateException(setting + " is empty: name the classifications, lowest first, separated by commas");
    }
    Set<String> seen = new HashSet<>();
    List<String> out = classifications.stream().map(String::trim).toList();
    for (String c : out) {
      if (c.isEmpty() || c.length() > MAX_LENGTH) {
        throw new IllegalStateException(setting + " has a classification that is empty or longer than " + MAX_LENGTH + " characters");
      }
      if (!seen.add(c)) {
        throw new IllegalStateException(setting + " names " + c + " twice");
      }
    }
    return out;
  }
}
