package dev.emcc.plugins.nvg.codec;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.model.SecurityLabel;
import java.io.StringWriter;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;
import javax.xml.stream.XMLStreamWriter;
import org.jspecify.annotations.Nullable;

/**
 * Reads an NVG 2.0.x document from untrusted bytes (brief, sections 2 to 4). Pure: no I/O beyond
 * the bytes it is given. Refuses, with a reason and nothing read:
 *
 * <ul>
 *   <li>a document over {@link Limits#maxBytes}, deeper than {@link Limits#maxDepth}, with more than
 *       {@link Limits#maxItems} items or {@link Limits#maxPoints} points, or with an attribute or a
 *       text over {@link Limits#maxText} ({@code refused: limit <which>});
 *   <li>a document with a DTD ({@code refused: DTD}); external entities are never resolved;
 *   <li>bytes that are not well-formed XML ({@code refused: not XML}), or whose root is not NVG's
 *       {@code nvg} ({@code refused: not NVG});
 *   <li>a version other than 2.0.0 to 2.0.2 ({@code refused: version}).
 * </ul>
 *
 * <p>Groups and composites are flattened into the items (brief, section 3). Skipped, and counted:
 * {@code content-item}, elements it does not know, and elements of other namespaces outside an item
 * (inside an item they are kept as XML text).
 */
public final class NvgReader {

  private final Limits limits;
  private final XMLStreamReader r;
  private final Map<String, Long> skipped = new LinkedHashMap<>();
  private final List<Item> items = new ArrayList<>();
  private int depth;
  private int itemCount;
  private long points;

  private NvgReader(Limits limits, XMLStreamReader r) {
    this.limits = limits;
    this.r = r;
  }

  /** Reads {@code bytes}; never throws for bad input. */
  public static ReadResult read(Bytes bytes, Limits limits) {
    if (bytes.size() > limits.maxBytes()) {
      return ReadResult.refused("refused: limit size", "the document is larger than " + megabytes(limits.maxBytes()));
    }
    XMLStreamReader reader;
    try {
      reader = SafeXml.inputFactory().createXMLStreamReader(bytes.asInputStream());
    } catch (XMLStreamException e) {
      return ReadResult.refused("refused: not XML", "not XML: " + brief(e));
    }
    try {
      return ReadResult.read(new NvgReader(limits, reader).document());
    } catch (Refusal refusal) {
      return ReadResult.refused(refusal.counter, refusal.reason);
    } catch (XMLStreamException | RuntimeException e) {
      // The JDK's parser reports a DTD it does not support, an undeclared entity or broken XML this way.
      String text = String.valueOf(e.getMessage());
      if (text.contains("DOCTYPE") || text.contains("DTD")) {
        return ReadResult.refused("refused: DTD", "a document with a DTD is refused");
      }
      return ReadResult.refused("refused: not XML", "not XML: " + brief(e));
    } finally {
      try {
        reader.close();
      } catch (XMLStreamException ignored) {
        // nothing to release beyond the bytes
      }
    }
  }

  private NvgDocument document() throws XMLStreamException {
    // The prolog: a DTD is refused before anything else is read.
    while (true) {
      int ev = next();
      if (ev == XMLStreamConstants.DTD) {
        throw new Refusal("refused: DTD", "a document with a DTD is refused");
      }
      if (ev == XMLStreamConstants.START_ELEMENT) {
        break;
      }
      if (ev == XMLStreamConstants.END_DOCUMENT) {
        throw new Refusal("refused: not XML", "not XML: no element");
      }
    }
    if (!r.getLocalName().equals("nvg") || !NvgNames.isNvg(ns())) {
      throw new Refusal("refused: not NVG", "the root element is " + r.getLocalName() + ", not nvg");
    }
    String version = r.getAttributeValue(null, "version");
    if (version == null || !NvgNames.READ_VERSIONS.contains(version.strip())) {
      String shown = version == null ? "without a version" : clip(version.strip(), 32);
      throw new Refusal("refused: version", "NVG " + shown + " is not supported; 2.0.x only");
    }
    Scope root = new Scope(List.of(), null, false);
    container(root, true);
    // After the root: only comments and whitespace may follow.
    while (r.hasNext()) {
      if (next() == XMLStreamConstants.DTD) {
        throw new Refusal("refused: DTD", "a document with a DTD is refused");
      }
    }
    return new NvgDocument(version.strip(), root.label, root.labelUnreadable, items, skipped);
  }

  /** The labels and the path that the items of a group (or the document) inherit. */
  private static final class Scope {
    final List<String> groupPath;
    @Nullable SecurityLabel label;
    boolean labelUnreadable;

    Scope(List<String> groupPath, @Nullable SecurityLabel label, boolean labelUnreadable) {
      this.groupPath = groupPath;
      this.label = label;
      this.labelUnreadable = labelUnreadable;
    }
  }

  /** Reads the children of the document or a {@code g}, up to the container's end. */
  private void container(Scope scope, boolean document) throws XMLStreamException {
    while (true) {
      int ev = next();
      if (ev == XMLStreamConstants.END_ELEMENT) {
        return;
      }
      if (ev != XMLStreamConstants.START_ELEMENT) {
        continue;
      }
      String local = r.getLocalName();
      if (!NvgNames.isNvg(ns())) {
        count("skipped: foreign element");
        skip();
        continue;
      }
      switch (local) {
        case "metadata", "extension" -> {
          Found found = labelAndKept(false);
          if (found.label != null && scope.label == null) {
            scope.label = found.label;
          }
          scope.labelUnreadable |= found.unreadable && found.label == null;
        }
        case "Schema", "ExtendedData", "textInfo", "TimeStamp", "TimeSpan" -> skip();
        case "g" -> {
          countItem();
          String label = r.getAttributeValue(null, "label");
          List<String> path = new ArrayList<>(scope.groupPath);
          path.add(label == null ? "" : label);
          // A group's own label (its metadata) is read before its content, so its items inherit it.
          container(new Scope(List.copyOf(path), scope.label, scope.labelUnreadable), false);
        }
        case "composite" -> {
          countItem();
          composite(scope);
        }
        case "content-item" -> {
          countItem();
          count("skipped: content-item");
          skip();
        }
        default -> {
          Kind kind = Kind.of(local);
          if (kind == null) {
            count("skipped: unknown element");
            skip();
          } else {
            countItem();
            item(kind, scope, null, null, 0);
          }
        }
      }
    }
  }

  /** A {@code composite}: each shape inside becomes an item of its own, numbered from 1. */
  private void composite(Scope scope) throws XMLStreamException {
    String uri = r.getAttributeValue(null, "uri");
    String symbol = r.getAttributeValue(null, "symbol");
    Scope own = new Scope(scope.groupPath, scope.label, scope.labelUnreadable);
    boolean ownLabel = false;
    int part = 0;
    while (true) {
      int ev = next();
      if (ev == XMLStreamConstants.END_ELEMENT) {
        return;
      }
      if (ev != XMLStreamConstants.START_ELEMENT) {
        continue;
      }
      if (!NvgNames.isNvg(ns())) {
        count("skipped: foreign element");
        skip();
        continue;
      }
      String local = r.getLocalName();
      Kind kind = Kind.of(local);
      if (local.equals("metadata") || local.equals("extension")) {
        Found found = labelAndKept(false);
        if (found.label != null && !ownLabel) {
          own.label = found.label;
          ownLabel = true;
        }
        own.labelUnreadable |= found.unreadable && found.label == null;
      } else if (kind != null) {
        countItem();
        part++;
        item(kind, own, uri == null ? "composite" : uri, symbol, part);
      } else if (local.equals("content-item")) {
        countItem();
        count("skipped: content-item");
        skip();
      } else {
        if (!List.of("ExtendedData", "textInfo", "TimeStamp", "TimeSpan").contains(local)) {
          count("skipped: unknown element");
        }
        skip();
      }
    }
  }

  private void item(Kind kind, Scope scope, @Nullable String compositeUri, @Nullable String compositeSymbol, int part) throws XMLStreamException {
    String uri = null;
    Map<String, String> attributes = new LinkedHashMap<>();
    for (int i = 0; i < r.getAttributeCount(); i++) {
      String ans = r.getAttributeNamespace(i);
      if (ans != null && !ans.isEmpty()) {
        continue; // attributes of other namespaces (anyAttribute) are not kept
      }
      String name = r.getAttributeLocalName(i);
      if (name.equals("uri")) {
        uri = r.getAttributeValue(i).strip();
      } else {
        attributes.put(name, r.getAttributeValue(i));
      }
    }
    if (uri == null || uri.isEmpty()) {
      if (compositeUri == null) {
        count("skipped: no uri");
        skip();
        return;
      }
      uri = compositeUri + "#" + part;
    }
    Item.Builder b = Item.builder(kind, uri);
    attributes.forEach(b::attribute);
    SecurityLabel own = null;
    boolean unreadable = false;
    StringBuilder kept = new StringBuilder();
    StringBuilder foreign = new StringBuilder();
    while (true) {
      int ev = next();
      if (ev == XMLStreamConstants.END_ELEMENT) {
        break;
      }
      if (ev != XMLStreamConstants.START_ELEMENT) {
        continue;
      }
      if (!NvgNames.isNvg(ns())) {
        foreign.append(capture());
        continue;
      }
      switch (r.getLocalName()) {
        case "metadata", "extension" -> {
          Found found = labelAndKept(true);
          if (found.label != null && own == null) {
            own = found.label;
          }
          unreadable |= found.unreadable;
          kept.append(found.kept);
        }
        case "ExtendedData" -> b.extendedData(capture());
        case "textInfo" -> b.textInfo(text());
        case "TimeStamp" -> b.timeStamp(text().strip());
        case "TimeSpan" -> timeSpan(b);
        case "content" -> {
          if (kind == Kind.TEXT) {
            b.content(text());
          } else {
            count("skipped: unknown element");
            skip();
          }
        }
        case "exclude" -> {
          if (kind.isArea()) {
            excludes(b);
          } else {
            count("skipped: unknown element");
            skip();
          }
        }
        default -> {
          count("skipped: unknown element");
          skip();
        }
      }
    }
    if (own != null) {
      b.label(own);
    } else if (unreadable) {
      b.labelUnreadable(true);
    } else {
      b.label(scope.label).labelUnreadable(scope.labelUnreadable);
    }
    b.extension(kept.isEmpty() ? null : kept.toString());
    b.foreign(foreign.isEmpty() ? null : foreign.toString());
    b.groupPath(scope.groupPath);
    b.composite(part == 0 ? null : compositeUri, compositeSymbol, part);
    items.add(b.build());
  }

  private void timeSpan(Item.Builder b) throws XMLStreamException {
    String begin = null;
    String end = null;
    while (true) {
      int ev = next();
      if (ev == XMLStreamConstants.END_ELEMENT) {
        break;
      }
      if (ev == XMLStreamConstants.START_ELEMENT) {
        switch (r.getLocalName()) {
          case "begin" -> begin = text().strip();
          case "end" -> end = text().strip();
          default -> skip();
        }
      }
    }
    b.timeSpan(begin, end);
  }

  private void excludes(Item.Builder b) throws XMLStreamException {
    while (true) {
      int ev = next();
      if (ev == XMLStreamConstants.END_ELEMENT) {
        return;
      }
      if (ev == XMLStreamConstants.START_ELEMENT) {
        Map<String, String> attributes = new LinkedHashMap<>();
        for (int i = 0; i < r.getAttributeCount(); i++) {
          String ans = r.getAttributeNamespace(i);
          if (ans == null || ans.isEmpty()) {
            attributes.put(r.getAttributeLocalName(i), r.getAttributeValue(i));
          }
        }
        b.exclude(new Ring(r.getLocalName(), attributes));
        skip();
      }
    }
  }

  /** What {@code metadata} or {@code extension} held: the first label, and the rest as XML text. */
  private record Found(@Nullable SecurityLabel label, boolean unreadable, String kept) {}

  /** Reads a {@code metadata} or {@code extension}: the label from its binding, the rest kept when {@code keep}. */
  private Found labelAndKept(boolean keep) throws XMLStreamException {
    SecurityLabel label = null;
    boolean unreadable = false;
    StringBuilder kept = new StringBuilder();
    while (true) {
      int ev = next();
      if (ev == XMLStreamConstants.END_ELEMENT) {
        return new Found(label, unreadable, kept.toString());
      }
      if (ev != XMLStreamConstants.START_ELEMENT) {
        continue;
      }
      String ns = ns();
      String local = r.getLocalName();
      boolean binding = local.equals("BindingInformation") && (ns.equals(NvgNames.MB) || NvgNames.isNvg(ns));
      boolean bareLabel = ns.equals(NvgNames.SLAB) && local.toLowerCase(Locale.ROOT).endsWith("confidentialitylabel");
      if (binding || bareLabel) {
        LabelReader found = new LabelReader();
        found.walk();
        if (label == null) {
          if (found.label() != null) {
            label = found.label();
          } else if (found.seen) {
            unreadable = true;
          }
        }
      } else if (keep) {
        kept.append(capture());
      } else {
        skip();
      }
    }
  }

  /**
   * Reads the first STANAG 4774 label in the current element (a 4778 binding or a bare label) and
   * consumes the element: policy, classification, categories, creation and review times.
   */
  private final class LabelReader {
    boolean seen;
    boolean bad;
    @Nullable String policy;
    @Nullable String policyUri;
    @Nullable String classification;
    final List<SecurityLabel.Category> categories = new ArrayList<>();
    @Nullable Instant created;
    @Nullable Instant review;
    boolean done;

    void walk() throws XMLStreamException {
      int target = depth - 1;
      int labelDepth = -1;
      if (isLabelElement()) {
        labelDepth = depth;
        startLabel();
      }
      while (true) {
        int ev = next();
        if (ev == XMLStreamConstants.END_ELEMENT) {
          if (depth == labelDepth - 1) {
            done = true;
          }
          if (depth == target) {
            return;
          }
          continue;
        }
        if (ev != XMLStreamConstants.START_ELEMENT || done) {
          continue;
        }
        if (labelDepth < 0 && isLabelElement()) {
          labelDepth = depth;
          startLabel();
        } else if (labelDepth >= 0 && ns().equals(NvgNames.SLAB)) {
          switch (r.getLocalName()) {
            case "PolicyIdentifier" -> {
              policyUri = r.getAttributeValue(null, "URI");
              policy = text().strip();
            }
            case "Classification" -> classification = text().strip();
            case "Category" -> category();
            case "CreationDateTime" -> created = instant(text());
            default -> {
              // ConfidentialityInformation and others: their children are read as they come
            }
          }
        }
      }
    }

    private boolean isLabelElement() {
      return ns().equals(NvgNames.SLAB) && r.getLocalName().toLowerCase(Locale.ROOT).endsWith("confidentialitylabel");
    }

    private void startLabel() {
      seen = true;
      review = instant(r.getAttributeValue(null, "ReviewDateTime"));
    }

    private void category() throws XMLStreamException {
      String tag = r.getAttributeValue(null, "TagName");
      String type = r.getAttributeValue(null, "Type");
      String uri = r.getAttributeValue(null, "URI");
      List<String> values = new ArrayList<>();
      while (true) {
        int ev = next();
        if (ev == XMLStreamConstants.END_ELEMENT) {
          break;
        }
        if (ev == XMLStreamConstants.START_ELEMENT) {
          values.add(text().strip());
        }
      }
      try {
        if (tag == null || type == null || values.isEmpty()) {
          bad = true;
          return;
        }
        categories.add(new SecurityLabel.Category(tag, SecurityLabel.CategoryType.valueOf(type.strip()), uri, values));
      } catch (IllegalArgumentException e) {
        bad = true;
      }
    }

    @Nullable SecurityLabel label() {
      if (!seen || bad || policy == null || policy.isEmpty() || classification == null) {
        return null;
      }
      try {
        return new SecurityLabel(new SecurityLabel.Policy(policy, policyUri), classification, categories, created, review);
      } catch (IllegalArgumentException e) {
        return null;
      }
    }
  }

  private static @Nullable Instant instant(@Nullable String text) {
    if (text == null || text.isBlank()) {
      return null;
    }
    try {
      return OffsetDateTime.parse(text.strip()).toInstant();
    } catch (DateTimeParseException e) {
      return null;
    }
  }

  /** The current element's text; nested elements are skipped. */
  private String text() throws XMLStreamException {
    StringBuilder text = new StringBuilder();
    while (true) {
      int ev = next();
      switch (ev) {
        case XMLStreamConstants.CHARACTERS, XMLStreamConstants.CDATA, XMLStreamConstants.SPACE -> {
          text.append(r.getText());
          if (text.length() > limits.maxText()) {
            throw new Refusal("refused: limit text", "a text is longer than " + limits.maxText() + " characters");
          }
        }
        case XMLStreamConstants.START_ELEMENT -> skip();
        case XMLStreamConstants.END_ELEMENT -> {
          return text.toString();
        }
        default -> {
          // comments
        }
      }
    }
  }

  /** The current element, with everything inside, as XML text; consumes it. */
  private String capture() throws XMLStreamException {
    StringWriter out = new StringWriter();
    XMLStreamWriter w = SafeXml.outputFactory().createXMLStreamWriter(out);
    int level = 0;
    while (true) {
      int ev = r.getEventType();
      if (ev == XMLStreamConstants.START_ELEMENT) {
        level++;
      }
      SafeXml.copyEvent(r, w);
      if (ev == XMLStreamConstants.END_ELEMENT) {
        level--;
        if (level == 0) {
          break;
        }
      }
      if (out.getBuffer().length() > limits.maxText()) {
        throw new Refusal("refused: limit text", "an element is longer than " + limits.maxText() + " characters");
      }
      next();
    }
    w.close();
    return out.toString();
  }

  /** Consumes the current element (at its {@code START_ELEMENT}) and everything inside. */
  private void skip() throws XMLStreamException {
    int target = depth - 1;
    while (true) {
      int ev = next();
      if (ev == XMLStreamConstants.END_ELEMENT && depth == target) {
        return;
      }
    }
  }

  /** The next event, with the depth, the attribute sizes and the points counted. */
  private int next() throws XMLStreamException {
    int ev = r.next();
    if (ev == XMLStreamConstants.START_ELEMENT) {
      depth++;
      if (depth > limits.maxDepth()) {
        throw new Refusal("refused: limit depth", "elements nest deeper than " + limits.maxDepth());
      }
      for (int i = 0; i < r.getAttributeCount(); i++) {
        String value = r.getAttributeValue(i);
        if (value.length() > limits.maxText()) {
          throw new Refusal("refused: limit text", "an attribute is longer than " + limits.maxText() + " characters");
        }
        if (r.getAttributeLocalName(i).equals("points")) {
          points += countPairs(value);
          if (points > limits.maxPoints()) {
            throw new Refusal("refused: limit points", "the document has more than " + limits.maxPoints() + " points");
          }
        }
      }
    } else if (ev == XMLStreamConstants.END_ELEMENT) {
      depth--;
    }
    return ev;
  }

  private void countItem() {
    itemCount++;
    if (itemCount > limits.maxItems()) {
      throw new Refusal("refused: limit items", "the document has more than " + limits.maxItems() + " items");
    }
  }

  private static long countPairs(String points) {
    long n = 0;
    boolean inToken = false;
    for (int i = 0; i < points.length(); i++) {
      boolean space = Character.isWhitespace(points.charAt(i));
      if (!space && !inToken) {
        n++;
      }
      inToken = !space;
    }
    return n;
  }

  private void count(String counter) {
    skipped.merge(counter, 1L, Long::sum);
  }

  private String ns() {
    String ns = r.getNamespaceURI();
    return ns == null ? "" : ns;
  }

  private static String megabytes(int bytes) {
    return bytes % Limits.MIB == 0 ? (bytes / Limits.MIB) + " MiB" : bytes + " bytes";
  }

  private static String brief(Exception e) {
    String message = String.valueOf(e.getMessage()).replaceAll("\\s+", " ").strip();
    return clip(message, 200);
  }

  private static String clip(String text, int max) {
    return text.length() <= max ? text : text.substring(0, max) + "…";
  }

  /** Ends reading with a reason; caught in {@link #read}. */
  private static final class Refusal extends RuntimeException {
    private static final long serialVersionUID = 1L;
    final String counter;
    final String reason;

    Refusal(String counter, String reason) {
      super(reason, null, false, false);
      this.counter = counter;
      this.reason = reason;
    }
  }
}
