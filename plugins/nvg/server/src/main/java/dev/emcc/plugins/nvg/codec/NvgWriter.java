package dev.emcc.plugins.nvg.codec;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.model.SecurityLabel;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Objects;
import java.util.TreeMap;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamWriter;
import org.jspecify.annotations.Nullable;

/**
 * Writes NVG 2.0.2 with the JDK's {@code XMLStreamWriter} (brief, sections 2 and 3): one {@code g}
 * per group (a layer, owner Q5), each item with its label in {@code metadata} as a STANAG 4778
 * binding of a STANAG 4774 label, as ANET does it <b>[spec check of the placement]</b>. The document
 * carries its own label the same way.
 */
public final class NvgWriter {

  /**
   * One {@code g}: a layer's objects.
   *
   * @param uri the group's {@code uri}, e.g. {@code urn:uuid:<layer id>}
   * @param label the group's {@code label}, the layer's name
   * @param items its items, in order
   */
  public record Group(String uri, String label, List<Item> items) {
    public Group {
      Objects.requireNonNull(uri, "uri");
      Objects.requireNonNull(label, "label");
      items = List.copyOf(items);
    }
  }

  private NvgWriter() {}

  /** A whole document as UTF-8 bytes. */
  public static Bytes write(@Nullable SecurityLabel documentLabel, Instant now, List<Group> groups) {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    try {
      XMLStreamWriter w = SafeXml.outputFactory().createXMLStreamWriter(out, "UTF-8");
      w.writeStartDocument("UTF-8", "1.0");
      writeNvg(w, documentLabel, now, groups);
      w.writeEndDocument();
      w.close();
    } catch (XMLStreamException e) {
      throw new IllegalStateException("cannot write NVG: " + e.getMessage(), e);
    }
    return Bytes.of(out.toByteArray());
  }

  /** The {@code nvg} element, e.g. inside a SOAP answer. */
  public static void writeNvg(XMLStreamWriter w, @Nullable SecurityLabel documentLabel, Instant now, List<Group> groups) throws XMLStreamException {
    w.setDefaultNamespace(NvgNames.NVG);
    w.writeStartElement("", "nvg", NvgNames.NVG);
    w.writeAttribute("version", NvgNames.WRITTEN_VERSION);
    if (documentLabel != null) {
      label(w, documentLabel, "", now);
    }
    for (Group group : groups) {
      w.writeStartElement("", "g", NvgNames.NVG);
      w.writeAttribute("uri", group.uri());
      w.writeAttribute("label", group.label());
      for (Item item : group.items()) {
        item(w, item, now);
      }
      w.writeEndElement();
    }
    w.writeEndElement();
  }

  /** One item, in the schema's order: metadata, ExtendedData, textInfo, TimeStamp, TimeSpan, extension, then its own content. */
  static void item(XMLStreamWriter w, Item item, Instant now) throws XMLStreamException {
    w.writeStartElement("", item.kind().element(), NvgNames.NVG);
    w.writeAttribute("uri", item.uri());
    for (var a : new TreeMap<>(item.attributes()).entrySet()) {
      w.writeAttribute(a.getKey(), a.getValue());
    }
    if (item.label() != null) {
      label(w, item.label(), item.uri(), now);
    }
    if (item.extendedData() != null) {
      SafeXml.writeKept(item.extendedData(), w);
    }
    if (item.textInfo() != null) {
      textElement(w, "textInfo", item.textInfo());
    }
    if (item.timeStamp() != null) {
      textElement(w, "TimeStamp", item.timeStamp());
    }
    if (item.timeBegin() != null || item.timeEnd() != null) {
      w.writeStartElement("", "TimeSpan", NvgNames.NVG);
      if (item.timeBegin() != null) {
        textElement(w, "begin", item.timeBegin());
      }
      if (item.timeEnd() != null) {
        textElement(w, "end", item.timeEnd());
      }
      w.writeEndElement();
    }
    if (item.extension() != null || item.foreign() != null) {
      w.writeStartElement("", "extension", NvgNames.NVG);
      if (item.extension() != null) {
        SafeXml.writeKept(item.extension(), w);
      }
      if (item.foreign() != null) {
        SafeXml.writeKept(item.foreign(), w);
      }
      w.writeEndElement();
    }
    if (item.kind() == Kind.TEXT) {
      textElement(w, "content", item.content() == null ? "" : item.content());
    }
    if (item.kind().isArea() && !item.excludes().isEmpty()) {
      w.writeStartElement("", "exclude", NvgNames.NVG);
      for (Ring ring : item.excludes()) {
        w.writeEmptyElement("", ring.element(), NvgNames.NVG);
        for (var a : new TreeMap<>(ring.attributes()).entrySet()) {
          w.writeAttribute(a.getKey(), a.getValue());
        }
      }
      w.writeEndElement();
    }
    w.writeEndElement();
  }

  /**
   * A label in {@code metadata}: {@code mb:BindingInformation} with one binding of an
   * {@code slab:originatorConfidentialityLabel} to {@code dataUri} (the item's {@code uri}, or empty
   * for the document itself). 4774 requires a {@code CreationDateTime}: the label's own, else now.
   */
  static void label(XMLStreamWriter w, SecurityLabel label, String dataUri, Instant now) throws XMLStreamException {
    w.writeStartElement("", "metadata", NvgNames.NVG);
    w.writeStartElement("mb", "BindingInformation", NvgNames.MB);
    w.writeNamespace("mb", NvgNames.MB);
    w.writeStartElement("mb", "MetadataBindingContainer", NvgNames.MB);
    w.writeStartElement("mb", "MetadataBinding", NvgNames.MB);
    w.writeStartElement("mb", "Metadata", NvgNames.MB);
    w.writeStartElement("slab", "originatorConfidentialityLabel", NvgNames.SLAB);
    w.writeNamespace("slab", NvgNames.SLAB);
    if (label.reviewDateTime() != null) {
      w.writeAttribute("ReviewDateTime", label.reviewDateTime().truncatedTo(ChronoUnit.MILLIS).toString());
    }
    w.writeStartElement("slab", "ConfidentialityInformation", NvgNames.SLAB);
    w.writeStartElement("slab", "PolicyIdentifier", NvgNames.SLAB);
    if (label.policyIdentifier().uri() != null) {
      w.writeAttribute("URI", label.policyIdentifier().uri());
    }
    w.writeCharacters(label.policyIdentifier().name());
    w.writeEndElement();
    w.writeStartElement("slab", "Classification", NvgNames.SLAB);
    w.writeCharacters(label.classification());
    w.writeEndElement();
    for (SecurityLabel.Category c : label.categories()) {
      w.writeStartElement("slab", "Category", NvgNames.SLAB);
      w.writeAttribute("TagName", c.tagName());
      w.writeAttribute("Type", c.type().name());
      if (c.uri() != null) {
        w.writeAttribute("URI", c.uri());
      }
      for (String value : c.values()) {
        w.writeStartElement("slab", "GenericValue", NvgNames.SLAB);
        w.writeCharacters(value);
        w.writeEndElement();
      }
      w.writeEndElement();
    }
    w.writeEndElement(); // ConfidentialityInformation
    w.writeStartElement("slab", "CreationDateTime", NvgNames.SLAB);
    Instant created = label.creationDateTime() == null ? now : label.creationDateTime();
    w.writeCharacters(created.truncatedTo(ChronoUnit.MILLIS).toString());
    w.writeEndElement();
    w.writeEndElement(); // originatorConfidentialityLabel
    w.writeEndElement(); // Metadata
    w.writeEmptyElement("mb", "DataReference", NvgNames.MB);
    w.writeAttribute("URI", dataUri);
    w.writeEndElement(); // MetadataBinding
    w.writeEndElement(); // MetadataBindingContainer
    w.writeEndElement(); // BindingInformation
    w.writeEndElement(); // metadata
  }

  private static void textElement(XMLStreamWriter w, String name, String text) throws XMLStreamException {
    w.writeStartElement("", name, NvgNames.NVG);
    w.writeCharacters(text);
    w.writeEndElement();
  }
}
