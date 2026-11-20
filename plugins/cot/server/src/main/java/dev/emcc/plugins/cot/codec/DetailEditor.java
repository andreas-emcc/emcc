package dev.emcc.plugins.cot.codec;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * Puts the core values of an object over the raw {@code <detail>} of the CoT event it came from
 * (brief function 17): the callsign in {@code contact}, the text in {@code remarks}, course and
 * speed in {@code track}, team and role in {@code __group}. <b>Everything else in the detail stays
 * as it was, byte for byte</b>: another element, a comment, an attribute this class does not know.
 * An element whose value is already what the object says is not touched at all, so an object that
 * has not changed gives the detail it came with.
 *
 * <p>It reads only the detail's direct children, with a plain scan that knows comments, CDATA,
 * processing instructions and quoted attribute values (the text was accepted by the XML parser
 * when it was received, so it is well-formed).
 *
 * <pre>{@code
 * DetailEditor.apply("<contact callsign=\"A\"/><priv x=\"1\"/>", new DetailEditor.Values("B", null, null, null, null, null))
 *     // <contact callsign="B"/><priv x="1"/>
 * }</pre>
 */
final class DetailEditor {

  /**
   * What the object says; {@code null} means the object says nothing, and the detail keeps what it has.
   *
   * @param callsign the object's name
   * @param remarks the object's description
   * @param course degrees from true north
   * @param speed metres per second
   * @param team the declared field {@code team}
   * @param role the declared field {@code role}
   */
  record Values(
      @Nullable String callsign,
      @Nullable String remarks,
      @Nullable Double course,
      @Nullable Double speed,
      @Nullable String team,
      @Nullable String role,
      @Nullable SymbolOut symbol) {

    /** Values that say nothing about the symbol code. */
    Values(@Nullable String callsign, @Nullable String remarks, @Nullable Double course, @Nullable Double speed, @Nullable String team, @Nullable String role) {
      this(callsign, remarks, course, speed, team, role, null);
    }
  }

  /**
   * The symbol code and amplifiers that go out in ATAK's form (brief function 28): {@code __milsym} and {@code __milicon} with the same id
   * and one {@code unitmodifier} child per amplifier. The detail's own {@code __milsym}, {@code __milicon}, {@code mil2525c} and {@code amp}
   * are put in their place or taken out, so that what goes out never contradicts itself; if they already say the same, nothing is touched.
   *
   * @param id the 2525C code, or {@code null} to take the four elements out (a symbol that has no code)
   * @param amplifiers the amplifiers as (ATAK's code letter, value)
   */
  record SymbolOut(@Nullable String id, List<Map.Entry<String, String>> amplifiers) {

    /** No code: the four elements are taken out. */
    static final SymbolOut NONE = new SymbolOut(null, List.of());

    String markup(String tag) {
      var xml = new StringBuilder("<").append(tag).append(" id=\"").append(CotXml.escape(id)).append('"');
      if (amplifiers.isEmpty()) {
        return xml.append("/>").toString();
      }
      xml.append('>');
      for (Map.Entry<String, String> a : amplifiers) {
        xml.append("<unitmodifier code=\"").append(a.getKey()).append("\">").append(CotXml.escape(a.getValue())).append("</unitmodifier>");
      }
      return xml.append("</").append(tag).append('>').toString();
    }
  }

  /** A direct child element of the detail: where it is in the text. */
  private record Span(String name, int start, int startTagEnd, int end, boolean selfClosing) {
    String startTag(String text) {
      return text.substring(start, startTagEnd + 1);
    }
  }

  private record Edit(int from, int to, String replacement) {}

  private static final Pattern UNIT_MODIFIER = Pattern.compile("<unitmodifier\\s+code\\s*=\\s*\"([^\"]*)\"[^>]*?(?:/>|>(.*?)</unitmodifier>)", Pattern.DOTALL);

  private static final Pattern ATTRIBUTE = Pattern.compile("\\s([A-Za-z_][\\w.:-]*)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')");

  private DetailEditor() {}

  /** The detail for an object that did not come from CoT: just what the object says. */
  static @Nullable String build(Values values) {
    return apply(null, values);
  }

  /**
   * The detail text with the values put over it; {@code null} if there is nothing to write.
   *
   * @param raw the detail as received, or {@code null} for an object that did not come from CoT
   */
  static @Nullable String apply(@Nullable String raw, Values values) {
    String text = raw == null ? "" : raw;
    List<Span> children = children(text);
    var edits = new ArrayList<Edit>();
    var appended = new StringBuilder();
    contact(text, children, values.callsign(), edits, appended);
    remarks(text, children, values.remarks(), edits, appended);
    track(text, children, values.course(), values.speed(), edits, appended);
    group(text, children, values.team(), values.role(), edits, appended);
    symbol(text, children, values.symbol(), edits, appended);

    edits.sort((a, b) -> Integer.compare(b.from(), a.from())); // from the end, so that the positions before stay valid
    var out = new StringBuilder(text);
    for (Edit e : edits) {
      out.replace(e.from(), e.to(), e.replacement());
    }
    out.append(appended);
    return out.isEmpty() ? null : out.toString();
  }

  // ---------------------------------------------------------------- the four elements

  private static void contact(String text, List<Span> children, @Nullable String wanted, List<Edit> edits, StringBuilder appended) {
    Span contact = find(children, "contact");
    if (wanted == null) {
      return;
    }
    if (contact == null) {
      appended.append("<contact callsign=\"").append(CotXml.escape(wanted)).append("\"/>");
      return;
    }
    String current = attribute(contact.startTag(text), "callsign");
    if (!wanted.equals(cut(current, 256))) {
      edits.add(setAttribute(text, contact, "callsign", CotXml.escape(wanted)));
    }
  }

  private static void remarks(String text, List<Span> children, @Nullable String wanted, List<Edit> edits, StringBuilder appended) {
    Span remarks = find(children, "remarks");
    if (wanted == null) {
      return;
    }
    if (remarks == null) {
      appended.append("<remarks>").append(CotXml.escape(wanted)).append("</remarks>");
      return;
    }
    String current = remarks.selfClosing() ? "" : plainText(text.substring(remarks.startTagEnd() + 1, remarks.end() - closingLength(text, remarks)));
    if (!wanted.equals(cut(current.strip(), 4096))) {
      edits.add(new Edit(remarks.start(), remarks.end(), "<remarks" + attributesOf(remarks, text) + ">" + CotXml.escape(wanted) + "</remarks>"));
    }
  }

  private static void track(String text, List<Span> children, @Nullable Double course, @Nullable Double speed, List<Edit> edits, StringBuilder appended) {
    Span track = find(children, "track");
    if (course == null && speed == null) {
      return;
    }
    if (track == null) {
      appended.append("<track");
      if (course != null) {
        appended.append(" course=\"").append(CotXml.plain(normalised(course))).append('"');
      }
      if (speed != null) {
        appended.append(" speed=\"").append(CotXml.plain(speed)).append('"');
      }
      appended.append("/>");
      return;
    }
    String tag = track.startTag(text);
    String changed = tag;
    if (course != null && !sameNumber(number(attribute(tag, "course")), course, true)) {
      changed = setAttributeText(changed, "course", CotXml.plain(normalised(course)));
    }
    if (speed != null && !sameNumber(number(attribute(tag, "speed")), speed, false)) {
      changed = setAttributeText(changed, "speed", CotXml.plain(speed));
    }
    if (!changed.equals(tag)) {
      edits.add(new Edit(track.start(), track.startTagEnd() + 1, changed));
    }
  }

  private static void group(String text, List<Span> children, @Nullable String team, @Nullable String role, List<Edit> edits, StringBuilder appended) {
    Span group = find(children, "__group");
    if (team == null && role == null) {
      return; // nothing known: what the detail says stays
    }
    if (group == null) {
      appended.append("<__group");
      if (team != null) {
        appended.append(" name=\"").append(CotXml.escape(team)).append('"');
      }
      if (role != null) {
        appended.append(" role=\"").append(CotXml.escape(role)).append('"');
      }
      appended.append("/>");
      return;
    }
    String tag = group.startTag(text);
    String changed = tag;
    if (team != null && !team.equals(attribute(tag, "name"))) {
      changed = setAttributeText(changed, "name", CotXml.escape(team));
    }
    if (role != null && !role.equals(attribute(tag, "role"))) {
      changed = setAttributeText(changed, "role", CotXml.escape(role));
    }
    if (!changed.equals(tag)) {
      edits.add(new Edit(group.start(), group.startTagEnd() + 1, changed));
    }
  }

  /** The symbol code and amplifiers (brief function 28); {@code null} leaves the detail's own elements as they are. */
  private static void symbol(String text, List<Span> children, @Nullable SymbolOut wanted, List<Edit> edits, StringBuilder appended) {
    if (wanted == null) {
      return;
    }
    List<Span> milsyms = all(children, "__milsym");
    List<Span> milicons = all(children, "__milicon");
    List<Span> others = new ArrayList<>(all(children, "mil2525c"));
    others.addAll(all(children, "amp"));
    if (wanted.id() == null) {
      for (Span s : children) {
        if (milsyms.contains(s) || milicons.contains(s) || others.contains(s)) {
          edits.add(new Edit(s.start(), s.end(), ""));
        }
      }
      return;
    }
    if (milsyms.size() == 1 && milicons.size() == 1 && others.isEmpty()
        && sameSymbol(text, milsyms.get(0), wanted) && sameSymbol(text, milicons.get(0), wanted)) {
      return; // already says what the object says: not touched
    }
    place(milicons, "__milicon", wanted, edits, appended);
    place(milsyms, "__milsym", wanted, edits, appended);
    for (Span s : others) {
      edits.add(new Edit(s.start(), s.end(), ""));
    }
  }

  /** The first element of a name is replaced by the new one, the others are taken out; none: the new one is appended. */
  private static void place(List<Span> spans, String tag, SymbolOut wanted, List<Edit> edits, StringBuilder appended) {
    if (spans.isEmpty()) {
      appended.append(wanted.markup(tag));
      return;
    }
    for (int i = 0; i < spans.size(); i++) {
      Span s = spans.get(i);
      edits.add(new Edit(s.start(), s.end(), i == 0 ? wanted.markup(tag) : ""));
    }
  }

  /** Whether the element has the id and the (non-empty) amplifiers the object says. */
  private static boolean sameSymbol(String text, Span element, SymbolOut wanted) {
    if (!wanted.id().equals(attribute(element.startTag(text), "id"))) {
      return false;
    }
    var have = new ArrayList<Map.Entry<String, String>>();
    if (!element.selfClosing()) {
      String inner = text.substring(element.startTagEnd() + 1, element.end() - closingLength(text, element));
      Matcher m = UNIT_MODIFIER.matcher(inner);
      while (m.find()) {
        String value = m.group(2) == null ? "" : unescape(m.group(2)).strip();
        if (!value.isEmpty()) {
          have.add(Map.entry(m.group(1), value));
        }
      }
    }
    return have.equals(wanted.amplifiers());
  }

  private static List<Span> all(List<Span> children, String name) {
    var found = new ArrayList<Span>();
    for (Span s : children) {
      if (s.name().equals(name)) {
        found.add(s);
      }
    }
    return found;
  }

  // ---------------------------------------------------------------- attributes

  /** The decoded value of an attribute of a start tag, or {@code null}. */
  private static @Nullable String attribute(String startTag, String name) {
    Matcher m = ATTRIBUTE.matcher(startTag);
    while (m.find()) {
      if (m.group(1).equals(name)) {
        return unescape(m.group(2) != null ? m.group(2) : m.group(3));
      }
    }
    return null;
  }

  private static Edit setAttribute(String text, Span element, String name, String escapedValue) {
    return new Edit(element.start(), element.startTagEnd() + 1, setAttributeText(element.startTag(text), name, escapedValue));
  }

  /** The start tag with the attribute set: its value replaced where it is, or added before the end of the tag. */
  private static String setAttributeText(String startTag, String name, String escapedValue) {
    Matcher m = ATTRIBUTE.matcher(startTag);
    while (m.find()) {
      if (m.group(1).equals(name)) {
        int valueStart = m.group(2) != null ? m.start(2) : m.start(3);
        int valueEnd = m.group(2) != null ? m.end(2) : m.end(3);
        return startTag.substring(0, valueStart) + escapedValue + startTag.substring(valueEnd);
      }
    }
    boolean selfClosing = startTag.endsWith("/>");
    String head = startTag.substring(0, startTag.length() - (selfClosing ? 2 : 1)).stripTrailing();
    return head + " " + name + "=\"" + escapedValue + "\"" + (selfClosing ? "/>" : ">");
  }

  private static String attributesOf(Span element, String text) {
    String tag = element.startTag(text);
    int nameEnd = 1;
    while (nameEnd < tag.length() && !Character.isWhitespace(tag.charAt(nameEnd)) && tag.charAt(nameEnd) != '>' && tag.charAt(nameEnd) != '/') {
      nameEnd++;
    }
    String rest = tag.substring(nameEnd, tag.length() - (tag.endsWith("/>") ? 2 : 1));
    return rest.stripTrailing().isEmpty() ? "" : rest.stripTrailing();
  }

  // ---------------------------------------------------------------- numbers and text

  private static @Nullable Double number(@Nullable String text) {
    if (text == null) {
      return null;
    }
    try {
      double value = Double.parseDouble(text.strip());
      return Double.isFinite(value) ? value : null;
    } catch (NumberFormatException e) {
      return null;
    }
  }

  private static boolean sameNumber(@Nullable Double current, double wanted, boolean angle) {
    if (current == null) {
      return false;
    }
    return Math.abs((angle ? normalised(current) : current) - (angle ? normalised(wanted) : wanted)) < 1e-9;
  }

  private static double normalised(double degrees) {
    return ((degrees % 360) + 360) % 360;
  }

  private static @Nullable String cut(@Nullable String text, int max) {
    return text == null || text.length() <= max ? text : text.substring(0, max);
  }

  /** The text of an element's content as the parser reads it: comments and tags gone, CDATA as it is, entities resolved. */
  private static String plainText(String content) {
    var out = new StringBuilder(content.length());
    int i = 0;
    while (i < content.length()) {
      int lt = content.indexOf('<', i);
      if (lt < 0) {
        out.append(unescape(content.substring(i)));
        break;
      }
      out.append(unescape(content.substring(i, lt)));
      if (content.startsWith("<!--", lt)) {
        i = after(content, "-->", lt + 4);
      } else if (content.startsWith("<![CDATA[", lt)) {
        int end = content.indexOf("]]>", lt + 9);
        out.append(content, lt + 9, end < 0 ? content.length() : end);
        i = end < 0 ? -1 : end + 3;
      } else {
        int gt = endOfTag(content, lt + 1);
        i = gt < 0 ? -1 : gt + 1;
      }
      if (i < 0) {
        break;
      }
    }
    return out.toString();
  }

  /** XML's five predefined entities and numeric references; anything else is left as it is. */
  private static String unescape(String text) {
    if (text.indexOf('&') < 0) {
      return text;
    }
    var out = new StringBuilder(text.length());
    for (int i = 0; i < text.length(); i++) {
      char c = text.charAt(i);
      int semicolon = c == '&' ? text.indexOf(';', i) : -1;
      if (semicolon < 0 || semicolon - i > 10) {
        out.append(c);
        continue;
      }
      String entity = text.substring(i + 1, semicolon);
      String decoded = switch (entity) {
        case "amp" -> "&";
        case "lt" -> "<";
        case "gt" -> ">";
        case "quot" -> "\"";
        case "apos" -> "'";
        default -> numericReference(entity);
      };
      if (decoded == null) {
        out.append(c);
      } else {
        out.append(decoded);
        i = semicolon;
      }
    }
    return out.toString();
  }

  private static @Nullable String numericReference(String entity) {
    try {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        return new String(Character.toChars(Integer.parseInt(entity.substring(2), 16)));
      }
      if (entity.startsWith("#")) {
        return new String(Character.toChars(Integer.parseInt(entity.substring(1))));
      }
    } catch (IllegalArgumentException e) {
      // not a code point
    }
    return null;
  }

  // ---------------------------------------------------------------- the scan

  private static @Nullable Span find(List<Span> children, String name) {
    for (Span span : children) {
      if (span.name().equals(name)) {
        return span;
      }
    }
    return null;
  }

  /** The length of the end tag that closes {@code span} ({@code </remarks>}, with any white space before its {@code >}). */
  private static int closingLength(String text, Span span) {
    int open = text.lastIndexOf("</", span.end() - 1);
    return span.end() - open;
  }

  /** The direct child elements of the detail, in order. */
  private static List<Span> children(String text) {
    var spans = new ArrayList<Span>();
    int depth = 0;
    int i = 0;
    int openStart = -1;
    int openTagEnd = -1;
    String openName = "";
    while (i >= 0 && i < text.length()) {
      int lt = text.indexOf('<', i);
      if (lt < 0) {
        break;
      }
      if (text.startsWith("<!--", lt)) {
        i = after(text, "-->", lt + 4);
      } else if (text.startsWith("<![CDATA[", lt)) {
        i = after(text, "]]>", lt + 9);
      } else if (text.startsWith("<?", lt)) {
        i = after(text, "?>", lt + 2);
      } else if (text.startsWith("</", lt)) {
        int gt = text.indexOf('>', lt + 2);
        if (gt < 0) {
          break;
        }
        depth--;
        if (depth == 0 && openStart >= 0) {
          spans.add(new Span(openName, openStart, openTagEnd, gt + 1, false));
          openStart = -1;
        }
        i = gt + 1;
      } else {
        int gt = endOfTag(text, lt + 1);
        if (gt < 0) {
          break;
        }
        boolean selfClosing = text.charAt(gt - 1) == '/';
        if (depth == 0) {
          if (selfClosing) {
            spans.add(new Span(nameAt(text, lt + 1), lt, gt, gt + 1, true));
          } else {
            openStart = lt;
            openTagEnd = gt;
            openName = nameAt(text, lt + 1);
          }
        }
        if (!selfClosing) {
          depth++;
        }
        i = gt + 1;
      }
    }
    return spans;
  }

  private static int after(String text, String end, int from) {
    int at = text.indexOf(end, from);
    return at < 0 ? -1 : at + end.length();
  }

  private static int endOfTag(String text, int from) {
    char quote = 0;
    for (int i = from; i < text.length(); i++) {
      char c = text.charAt(i);
      if (quote != 0) {
        if (c == quote) {
          quote = 0;
        }
      } else if (c == '"' || c == '\'') {
        quote = c;
      } else if (c == '>') {
        return i;
      }
    }
    return -1;
  }

  private static String nameAt(String text, int from) {
    int i = from;
    while (i < text.length() && !Character.isWhitespace(text.charAt(i)) && text.charAt(i) != '>' && text.charAt(i) != '/') {
      i++;
    }
    return text.substring(from, i);
  }
}
