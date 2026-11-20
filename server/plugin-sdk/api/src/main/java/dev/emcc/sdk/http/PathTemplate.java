package dev.emcc.sdk.http;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * A path template for plugin endpoints, relative to {@code /api/plugins/{pluginId}}. Immutable and
 * thread-safe; ECore and the test kit match with it, so both follow the same rules.
 *
 * <p>Syntax: segments separated by {@code /}. A segment holds literal text and {@code {name}}
 * placeholders. A placeholder matches one or more characters within <b>one</b> segment (never a
 * {@code /}), up to the literal text that follows it, so {@code {y}.png} matches {@code 9.png}
 * with {@code y = 9}. Two placeholders must not follow each other directly, and a name may occur
 * only once. Names are {@code [a-z][a-zA-Z0-9]*}. Values are percent-decoded by the edge before
 * matching, and returned as strings.
 *
 * <pre>{@code
 * PathTemplate t = PathTemplate.parse("/tiles/{z}/{x}/{y}.png");
 * t.match("/tiles/5/17/9.png")   // {z=5, x=17, y=9}
 * t.match("/tiles/5/17.png")     // null
 * }</pre>
 */
public final class PathTemplate {

  private static final Pattern PLACEHOLDER = Pattern.compile("\\{([a-z][a-zA-Z0-9]*)\\}");
  private static final Pattern LITERAL = Pattern.compile("[A-Za-z0-9._~!$&'()*+,;=:@-]*");

  private final String template;
  private final Pattern pattern;
  private final List<String> names;

  private PathTemplate(String template) {
    this.template = Objects.requireNonNull(template, "template");
    var found = new ArrayList<String>();
    this.pattern = compile(template, found);
    this.names = List.copyOf(found);
  }

  public static PathTemplate parse(String template) {
    return new PathTemplate(template);
  }

  public String template() {
    return template;
  }

  /** The placeholder names, in order. */
  public List<String> names() {
    return names;
  }

  /** The placeholder values if {@code path} matches, otherwise {@code null}. */
  public @Nullable Map<String, String> match(String path) {
    Matcher m = pattern.matcher(path);
    if (!m.matches()) {
      return null;
    }
    var values = new LinkedHashMap<String, String>();
    for (int i = 0; i < names.size(); i++) {
      values.put(names.get(i), m.group(i + 1));
    }
    return Collections.unmodifiableMap(values);
  }

  @Override
  public boolean equals(@Nullable Object other) {
    return other instanceof PathTemplate t && template.equals(t.template);
  }

  @Override
  public int hashCode() {
    return template.hashCode();
  }

  @Override
  public String toString() {
    return template;
  }

  private static Pattern compile(String template, List<String> names) {
    if (!template.startsWith("/") || template.length() > 256) {
      throw new IllegalArgumentException("template must start with '/' and be at most 256 characters: " + template);
    }
    var regex = new StringBuilder();
    for (String segment : template.substring(1).split("/", -1)) {
      if (segment.isEmpty()) {
        throw new IllegalArgumentException("empty segment in " + template);
      }
      regex.append('/');
      Matcher p = PLACEHOLDER.matcher(segment);
      int pos = 0;
      boolean previousWasPlaceholder = false;
      while (p.find()) {
        String literal = segment.substring(pos, p.start());
        checkLiteral(literal, template);
        if (literal.isEmpty() && previousWasPlaceholder) {
          throw new IllegalArgumentException("two placeholders in a row in " + template);
        }
        appendLiteral(regex, literal);
        String name = p.group(1);
        if (names.contains(name)) {
          throw new IllegalArgumentException("placeholder {" + name + "} used twice in " + template);
        }
        names.add(name);
        regex.append("([^/]+?)");
        pos = p.end();
        previousWasPlaceholder = true;
      }
      String rest = segment.substring(pos);
      checkLiteral(rest, template);
      appendLiteral(regex, rest);
    }
    return Pattern.compile(regex.toString());
  }

  private static void appendLiteral(StringBuilder regex, String literal) {
    if (!literal.isEmpty()) {
      regex.append(Pattern.quote(literal));
    }
  }

  private static void checkLiteral(String literal, String template) {
    if (!LITERAL.matcher(literal).matches()) {
      throw new IllegalArgumentException("invalid characters in " + template);
    }
  }
}
