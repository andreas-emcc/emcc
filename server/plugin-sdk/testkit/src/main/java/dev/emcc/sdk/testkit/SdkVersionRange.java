package dev.emcc.sdk.testkit;

import java.math.BigInteger;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Matches a manifest's {@code sdkVersion} range with npm semver semantics, as ECore and the shell
 * do (docs/plugins/sdk-v0.md, "Versioning"): an exact version, or a caret ({@code ^}), tilde
 * ({@code ~}) or {@code >=} range; a prerelease version matches only an exact range. Tested against
 * the shared cases in {@code model/examples/sdk-version-matching.json}.
 *
 * <pre>{@code
 * assertThat(SdkVersionRange.accepts(manifest.getString("sdkVersion"), Sdk.VERSION)).isTrue();
 * }</pre>
 */
public final class SdkVersionRange {

  private static final Pattern VERSION =
      Pattern.compile("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?");
  private static final Pattern RANGE = Pattern.compile("(\\^|~|>=)?(.+)");

  private SdkVersionRange() {}

  private record Version(long major, long minor, long patch, List<String> prerelease) implements Comparable<Version> {

    static Version parse(String text) {
      Matcher m = VERSION.matcher(text);
      if (!m.matches()) {
        throw new IllegalArgumentException("not a version: " + text);
      }
      String pre = m.group(4);
      return new Version(Long.parseLong(m.group(1)), Long.parseLong(m.group(2)), Long.parseLong(m.group(3)),
          pre == null ? List.of() : List.of(pre.split("\\.", -1)));
    }

    /** SemVer precedence: a prerelease is lower than its release; identifiers compare in order. */
    @Override
    public int compareTo(Version o) {
      int c = Long.compare(major, o.major);
      c = c != 0 ? c : Long.compare(minor, o.minor);
      c = c != 0 ? c : Long.compare(patch, o.patch);
      if (c != 0 || prerelease.isEmpty() || o.prerelease.isEmpty()) {
        return c != 0 ? c : Boolean.compare(prerelease.isEmpty(), o.prerelease.isEmpty());
      }
      for (int i = 0; i < Math.min(prerelease.size(), o.prerelease.size()); i++) {
        c = compareIdentifier(prerelease.get(i), o.prerelease.get(i));
        if (c != 0) {
          return c;
        }
      }
      return Integer.compare(prerelease.size(), o.prerelease.size());
    }

    private static int compareIdentifier(String a, String b) {
      boolean numericA = a.chars().allMatch(Character::isDigit);
      boolean numericB = b.chars().allMatch(Character::isDigit);
      if (numericA && numericB) {
        return new BigInteger(a).compareTo(new BigInteger(b));
      }
      return numericA != numericB ? (numericA ? -1 : 1) : a.compareTo(b); // numeric identifiers are lower
    }
  }

  /**
   * Whether {@code version} lies in {@code range}.
   *
   * @throws IllegalArgumentException if either is malformed
   */
  public static boolean accepts(String range, String version) {
    Version v = Version.parse(version);
    Matcher m = RANGE.matcher(range);
    if (!m.matches()) {
      throw new IllegalArgumentException("not a version range: " + range);
    }
    String operator = m.group(1);
    Version low = Version.parse(m.group(2));
    if (operator == null) {
      return v.compareTo(low) == 0;
    }
    if (!v.prerelease().isEmpty() || v.compareTo(low) < 0) {
      return false;
    }
    return switch (operator) {
      case ">=" -> true;
      case "~" -> v.major() == low.major() && v.minor() == low.minor();
      case "^" -> low.major() > 0 ? v.major() == low.major()
          : low.minor() > 0 ? v.major() == 0 && v.minor() == low.minor()
          : v.major() == 0 && v.minor() == 0 && v.patch() == low.patch();
      default -> throw new IllegalArgumentException("not a version range: " + range);
    };
  }
}
