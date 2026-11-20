package dev.emcc.ecore.plugin;

import dev.emcc.sdk.Sdk;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * Matches a manifest's {@code sdkVersion} range against the SDK version, with npm semver semantics
 * (SDK v0 design, "Versioning"): an exact version, or a caret ({@code ^}), tilde ({@code ~}) or
 * {@code >=} range. A prerelease SDK version matches only an exact range. The shell decides with
 * the same rules; both run the shared cases in {@code model/examples/sdk-version-matching.json}.
 */
final class SdkVersions {

  /**
   * The version of the Plugin SDK this ECore implements: the SDK's own constant (CR-0005), taken at
   * compile time from the SDK ECore is built against.
   */
  static final String SDK_VERSION = Sdk.VERSION;

  private static final Pattern VERSION =
      Pattern.compile("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?");
  private static final Pattern RANGE = Pattern.compile("(\\^|~|>=)?(.+)");

  private SdkVersions() {}

  /** A parsed version: major, minor, patch and the prerelease identifiers (empty for a release). */
  record Version(long major, long minor, long patch, List<String> prerelease) implements Comparable<Version> {

    static @Nullable Version parse(String text) {
      Matcher m = VERSION.matcher(text);
      if (!m.matches()) {
        return null;
      }
      String pre = m.group(4);
      return new Version(Long.parseLong(m.group(1)), Long.parseLong(m.group(2)), Long.parseLong(m.group(3)),
          pre == null ? List.of() : List.of(pre.split("\\.", -1)));
    }

    boolean isPrerelease() {
      return !prerelease.isEmpty();
    }

    /** SemVer precedence: a prerelease is lower than its release; identifiers compare in order. */
    @Override
    public int compareTo(Version other) {
      int c = Long.compare(major, other.major);
      if (c == 0) {
        c = Long.compare(minor, other.minor);
      }
      if (c == 0) {
        c = Long.compare(patch, other.patch);
      }
      if (c != 0) {
        return c;
      }
      if (prerelease.isEmpty() || other.prerelease.isEmpty()) {
        return Boolean.compare(prerelease.isEmpty(), other.prerelease.isEmpty());
      }
      for (int i = 0; i < Math.min(prerelease.size(), other.prerelease.size()); i++) {
        c = compareIdentifier(prerelease.get(i), other.prerelease.get(i));
        if (c != 0) {
          return c;
        }
      }
      return Integer.compare(prerelease.size(), other.prerelease.size());
    }

    private static int compareIdentifier(String a, String b) {
      boolean numericA = a.chars().allMatch(Character::isDigit);
      boolean numericB = b.chars().allMatch(Character::isDigit);
      if (numericA && numericB) {
        return new java.math.BigInteger(a).compareTo(new java.math.BigInteger(b));
      }
      if (numericA != numericB) {
        return numericA ? -1 : 1; // numeric identifiers are lower
      }
      return a.compareTo(b);
    }
  }

  /**
   * Whether {@code version} lies in {@code range}.
   *
   * @throws IllegalArgumentException if either is malformed
   */
  static boolean compatible(String range, String version) {
    Version v = require(version);
    Matcher m = RANGE.matcher(range);
    if (!m.matches()) {
      throw new IllegalArgumentException("not a version range: " + range);
    }
    String operator = m.group(1);
    Version low = require(m.group(2));
    if (operator == null) {
      return v.compareTo(low) == 0;
    }
    if (v.isPrerelease() || v.compareTo(low) < 0) {
      return false;
    }
    return switch (operator) {
      case ">=" -> true;
      case "~" -> v.major() == low.major() && v.minor() == low.minor();
      case "^" -> {
        if (low.major() > 0) {
          yield v.major() == low.major();
        }
        if (low.minor() > 0) {
          yield v.major() == 0 && v.minor() == low.minor();
        }
        yield v.major() == 0 && v.minor() == 0 && v.patch() == low.patch();
      }
      default -> throw new IllegalArgumentException("not a version range: " + range);
    };
  }

  private static Version require(String text) {
    Version v = Version.parse(text);
    if (v == null) {
      throw new IllegalArgumentException("not a version: " + text);
    }
    return v;
  }
}
