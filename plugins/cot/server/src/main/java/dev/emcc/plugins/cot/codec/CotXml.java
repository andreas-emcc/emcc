package dev.emcc.plugins.cot.codec;

import java.io.IOException;
import java.io.StringReader;
import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import org.jspecify.annotations.Nullable;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.xml.sax.ErrorHandler;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;

/**
 * CoT events as XML text, in both directions. Reading uses the JDK's own parser with <b>DTDs and
 * external entities switched off</b> (no XXE): a document with a DOCTYPE is refused, and nothing
 * is fetched. It keeps the content of {@code <detail>} as the exact text it was received in.
 *
 * <p>An instance holds a parser factory and is <b>not thread-safe</b>: give each reader its own.
 * Writing is static. The writer emits the event's own {@code detail} text as it is; it does not
 * rebuild {@code contact}, {@code remarks} or {@code track} from the mapped fields (that is for the
 * outgoing side, later).
 *
 * <pre>{@code
 * CotEvent event = new CotXml().parse(xml);      // throws CotParseException for anything unusable
 * String again = CotXml.write(event);
 * }</pre>
 */
public final class CotXml {

  private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

  private static final ErrorHandler STRICT = new ErrorHandler() {
    @Override
    public void warning(SAXParseException exception) {
      // Not an error; and nothing is printed to System.err, which the default handler would do.
    }

    @Override
    public void error(SAXParseException exception) throws SAXException {
      throw exception;
    }

    @Override
    public void fatalError(SAXParseException exception) throws SAXException {
      throw exception;
    }
  };

  private final DocumentBuilderFactory factory;

  public CotXml() {
    this.factory = hardenedFactory();
  }

  /** A parser factory with DTDs, external entities and XInclude off: for every text that comes from the network. */
  static DocumentBuilderFactory hardenedFactory() {
    DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
    try {
      factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
      factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
      factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
      factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
      factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
      factory.setAttribute("jdk.xml.maxElementDepth", "64"); // CoT is shallow; a deep document would only strain the parser
    } catch (ParserConfigurationException | IllegalArgumentException e) {
      // A parser that cannot switch these off must not read network data.
      throw new IllegalStateException("the XML parser cannot be made safe: " + e.getMessage(), e);
    }
    factory.setXIncludeAware(false);
    factory.setExpandEntityReferences(false);
    factory.setNamespaceAware(false);
    return factory;
  }

  /** Reads one event from the first {@code length} bytes of {@code utf8}. */
  public CotEvent parse(byte[] utf8, int length) throws CotParseException {
    String text;
    try {
      text = StandardCharsets.UTF_8.newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
          .decode(ByteBuffer.wrap(utf8, 0, length))
          .toString();
    } catch (CharacterCodingException e) {
      throw new CotParseException("not valid UTF-8", e);
    }
    return parse(text);
  }

  /** Reads one event. */
  public CotEvent parse(String xml) throws CotParseException {
    String text = xml.startsWith("\uFEFF") ? xml.substring(1) : xml;
    Document document;
    try {
      DocumentBuilder builder = factory.newDocumentBuilder();
      builder.setErrorHandler(STRICT);
      builder.setEntityResolver((publicId, systemId) -> {
        throw new SAXException("external entities are not allowed");
      });
      document = builder.parse(new InputSource(new StringReader(text)));
    } catch (SAXException | IOException e) {
      throw new CotParseException("not a well-formed CoT document: " + firstLine(e.getMessage()), e);
    } catch (ParserConfigurationException e) {
      throw new IllegalStateException("the XML parser cannot be created: " + e.getMessage(), e);
    }
    Element event = document.getDocumentElement();
    if (!event.getTagName().equals("event")) {
      throw new CotParseException("the root element is <" + event.getTagName() + ">, not <event>");
    }
    Element point = child(event, "point");
    if (point == null) {
      throw new CotParseException("the event has no <point>");
    }
    Element detail = child(event, "detail");
    Element contact = detail == null ? null : child(detail, "contact");
    Element remarks = detail == null ? null : child(detail, "remarks");
    Element track = detail == null ? null : child(detail, "track");
    try {
      return new CotEvent(
          required(event, "uid"),
          required(event, "type"),
          attribute(event, "how"),
          attribute(event, "version"),
          instant(event, "time"),
          instant(event, "start"),
          instant(event, "stale"),
          attribute(event, "access"),
          attribute(event, "qos"),
          attribute(event, "opex"),
          attribute(event, "caveat"),
          attributeOr(event, "releasableTo", "releaseableTo"),
          requiredNumber(point, "lat"),
          requiredNumber(point, "lon"),
          known(optionalNumber(point, "hae")),
          attribute(point, "ce"),
          attribute(point, "le"),
          contact == null ? null : attribute(contact, "callsign"),
          remarks == null ? null : blankToNull(remarks.getTextContent()),
          track == null ? null : known(optionalNumber(track, "course")),
          track == null ? null : known(optionalNumber(track, "speed")),
          detail == null ? null : rawDetail(text),
          group(detail));
    } catch (IllegalArgumentException e) {
      throw new CotParseException(e.getMessage() == null ? "invalid CoT event" : e.getMessage(), e);
    }
  }

  // ---------------------------------------------------------------- writing

  /** The event as XML text. Times are written with milliseconds in UTC. */
  public static String write(CotEvent event) {
    var xml = new StringBuilder(512);
    xml.append("<event version=\"").append(escape(event.version() == null ? "2.0" : event.version())).append('"');
    attr(xml, "uid", event.uid());
    attr(xml, "type", event.type());
    attr(xml, "how", event.how());
    attr(xml, "time", event.time() == null ? null : TIME.format(event.time()));
    attr(xml, "start", event.start() == null ? null : TIME.format(event.start()));
    attr(xml, "stale", event.stale() == null ? null : TIME.format(event.stale()));
    attr(xml, "access", event.access());
    attr(xml, "qos", event.qos());
    attr(xml, "opex", event.opex());
    attr(xml, "caveat", event.caveat());
    attr(xml, "releasableTo", event.releasableTo());
    xml.append("><point");
    attr(xml, "lat", plain(event.lat()));
    attr(xml, "lon", plain(event.lon()));
    attr(xml, "hae", plain(event.hae() == null ? CotEvent.UNKNOWN : event.hae()));
    attr(xml, "ce", event.ce() == null ? "9999999.0" : event.ce());
    attr(xml, "le", event.le() == null ? "9999999.0" : event.le());
    xml.append("/>");
    if (event.detail() == null) {
      xml.append("<detail/>");
    } else {
      xml.append("<detail>").append(event.detail()).append("</detail>");
    }
    return xml.append("</event>").toString();
  }

  /**
   * The event as text with everything that changes without the event changing left out: the three times,
   * and the {@code <_flow-tags_>} element TAK Servers add when they relay an event. Two events with the
   * same signature say the same (brief function 19).
   */
  public static String signature(CotEvent event) {
    String detail = event.detail() == null ? null : FLOW_TAGS.matcher(event.detail()).replaceAll("");
    Instant fixed = Instant.EPOCH;
    return write(event.withTimes(fixed, fixed, fixed).withDetail(detail == null || detail.isEmpty() ? null : detail));
  }

  private static final java.util.regex.Pattern FLOW_TAGS = java.util.regex.Pattern.compile("<_flow-tags_(\\s[^>]*)?/>");

  /**
   * The presence event: one {@code t-x-c-t} ping that tells a TAK Server there is a client, with
   * the callsign in {@code contact}. It is stale after a minute and sits at 0, 0, where nobody
   * draws it.
   */
  public static String presence(String callsign, Instant now) {
    String uid = "emc2-" + callsign.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
    Instant time = now.truncatedTo(ChronoUnit.MILLIS);
    return write(new CotEvent(
        uid.length() > 64 ? uid.substring(0, 64) : uid,
        "t-x-c-t", "m-g", "2.0", time, time, time.plusSeconds(60),
        null, null, null, null, null,
        0.0, 0.0, null, null, null,
        callsign, null, null, null,
        "<contact callsign=\"" + escape(callsign) + "\"/>",
        null));
  }

  // ---------------------------------------------------------------- reading helpers

  /** {@code detail/__group}, a direct child only: what is in a comment, CDATA or deeper is not it. */
  private static @Nullable CotGroup group(@Nullable Element detail) {
    Element group = detail == null ? null : child(detail, "__group");
    return group == null ? null : CotGroup.of(attribute(group, "name"), attribute(group, "role"));
  }

  private static @Nullable Element child(Element parent, String name) {
    for (Node n = parent.getFirstChild(); n != null; n = n.getNextSibling()) {
      if (n instanceof Element e && e.getTagName().equals(name)) {
        return e;
      }
    }
    return null;
  }

  private static @Nullable String attribute(Element element, String name) {
    return element.hasAttribute(name) ? blankToNull(element.getAttribute(name)) : null;
  }

  private static @Nullable String attributeOr(Element element, String name, String alternative) {
    String value = attribute(element, name);
    return value != null ? value : attribute(element, alternative);
  }

  private static String required(Element element, String name) throws CotParseException {
    String value = attribute(element, name);
    if (value == null) {
      throw new CotParseException("<" + element.getTagName() + "> has no " + name);
    }
    return value;
  }

  private static double requiredNumber(Element element, String name) throws CotParseException {
    String value = required(element, name);
    try {
      return finite(value);
    } catch (NumberFormatException e) {
      throw new CotParseException("<" + element.getTagName() + "> " + name + " is not a number: " + shorten(value));
    }
  }

  /** A number, or {@code null} if absent or not a (finite) number: a bad optional value does not spoil the event. */
  private static @Nullable Double optionalNumber(Element element, String name) {
    String value = attribute(element, name);
    if (value == null) {
      return null;
    }
    try {
      return finite(value);
    } catch (NumberFormatException e) {
      return null;
    }
  }

  /** CoT writes 9999999.0 for a value it does not know: that is no value. */
  private static @Nullable Double known(@Nullable Double value) {
    return value == null || Math.abs(value) >= CotEvent.UNKNOWN ? null : value;
  }

  private static double finite(String value) {
    double number = Double.parseDouble(value.trim());
    if (!Double.isFinite(number)) {
      throw new NumberFormatException("not finite");
    }
    return number;
  }

  private static @Nullable Instant instant(Element element, String name) throws CotParseException {
    String value = attribute(element, name);
    if (value == null) {
      return null;
    }
    try {
      return Instant.parse(value.trim()).truncatedTo(ChronoUnit.MILLIS);
    } catch (DateTimeException e) {
      throw new CotParseException("<" + element.getTagName() + "> " + name + " is not a time: " + shorten(value));
    }
  }

  private static @Nullable String blankToNull(@Nullable String text) {
    if (text == null) {
      return null;
    }
    String trimmed = text.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private static String firstLine(@Nullable String message) {
    if (message == null) {
      return "unknown error";
    }
    int end = message.indexOf('\n');
    return shorten(end < 0 ? message : message.substring(0, end));
  }

  private static String shorten(String text) {
    return text.length() > 80 ? text.substring(0, 80) + "..." : text;
  }

  /**
   * The content of the event's own {@code <detail>} element, exactly as it was written, or {@code
   * null} if there is none or it holds only white space. The text is already known to be
   * well-formed (the parser accepted it) and to have no DOCTYPE, so a plain scan that knows
   * comments, CDATA, processing instructions and quoted attribute values finds the element's end.
   */
  static @Nullable String rawDetail(String xml) {
    int depth = 0;
    int innerStart = -1;
    int i = 0;
    while (i >= 0 && i < xml.length()) {
      int lt = xml.indexOf('<', i);
      if (lt < 0) {
        return null;
      }
      if (xml.startsWith("<!--", lt)) {
        i = after(xml, "-->", lt + 4);
      } else if (xml.startsWith("<![CDATA[", lt)) {
        i = after(xml, "]]>", lt + 9);
      } else if (xml.startsWith("<?", lt)) {
        i = after(xml, "?>", lt + 2);
      } else if (xml.startsWith("</", lt)) {
        depth--;
        if (innerStart >= 0 && depth == 1) {
          String inner = xml.substring(innerStart, lt);
          return blankToNull(inner) == null ? null : inner;
        }
        i = after(xml, ">", lt + 2);
      } else {
        int gt = endOfTag(xml, lt + 1);
        if (gt < 0) {
          return null;
        }
        boolean selfClosing = xml.charAt(gt - 1) == '/';
        if (depth == 1 && innerStart < 0 && nameAt(xml, lt + 1).equals("detail")) {
          if (selfClosing) {
            return null;
          }
          innerStart = gt + 1;
        }
        if (!selfClosing) {
          depth++;
        }
        i = gt + 1;
      }
    }
    return null;
  }

  private static int after(String xml, String end, int from) {
    int at = xml.indexOf(end, from);
    return at < 0 ? -1 : at + end.length();
  }

  /** The index of the {@code >} that ends a start tag whose name begins at {@code from}; a {@code >} inside quotes does not count. */
  private static int endOfTag(String xml, int from) {
    char quote = 0;
    for (int i = from; i < xml.length(); i++) {
      char c = xml.charAt(i);
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

  private static String nameAt(String xml, int from) {
    int i = from;
    while (i < xml.length() && !Character.isWhitespace(xml.charAt(i)) && xml.charAt(i) != '>' && xml.charAt(i) != '/') {
      i++;
    }
    return xml.substring(from, i);
  }

  // ---------------------------------------------------------------- writing helpers

  private static void attr(StringBuilder xml, String name, @Nullable String value) {
    if (value != null) {
      xml.append(' ').append(name).append("=\"").append(escape(value)).append('"');
    }
  }

  static String plain(double number) {
    String plain = BigDecimal.valueOf(number).stripTrailingZeros().toPlainString();
    return plain.indexOf('.') < 0 ? plain + ".0" : plain;
  }

  static String escape(String text) {
    var out = new StringBuilder(text.length() + 8);
    for (int i = 0; i < text.length(); i++) {
      char c = text.charAt(i);
      switch (c) {
        case '&' -> out.append("&amp;");
        case '<' -> out.append("&lt;");
        case '>' -> out.append("&gt;");
        case '"' -> out.append("&quot;");
        case '\'' -> out.append("&apos;");
        case '\n', '\r', '\t' -> out.append("&#").append((int) c).append(';');
        default -> {
          if (c >= 0x20) {
            out.append(c);
          }
        }
      }
    }
    return out.toString();
  }
}
