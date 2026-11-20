package dev.emcc.plugins.nvg.codec;

import java.io.StringReader;
import java.io.StringWriter;
import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLOutputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;
import javax.xml.stream.XMLStreamWriter;

/**
 * The JDK's StAX, hardened for untrusted XML (brief, section 4; {@code nvg.md} G6): no DTDs, no
 * external entities, no entity resolution. A new factory per use: factories are mutable, so none
 * is kept in a static field (rule C2).
 */
public final class SafeXml {

  private SafeXml() {}

  /** A reader factory that supports no DTD and resolves no external entity. */
  public static XMLInputFactory inputFactory() {
    XMLInputFactory f = XMLInputFactory.newDefaultFactory();
    f.setProperty(XMLInputFactory.SUPPORT_DTD, false);
    f.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);
    f.setProperty(XMLInputFactory.IS_COALESCING, true);
    f.setXMLResolver((publicId, systemId, baseUri, namespace) -> {
      throw new XMLStreamException("external entities are refused");
    });
    return f;
  }

  /** A writer factory that declares namespaces where needed. */
  public static XMLOutputFactory outputFactory() {
    XMLOutputFactory f = XMLOutputFactory.newDefaultFactory();
    f.setProperty(XMLOutputFactory.IS_REPAIRING_NAMESPACES, true);
    return f;
  }

  /**
   * Copies the current element of {@code r} (at its {@code START_ELEMENT}), with everything inside,
   * to {@code w}; leaves {@code r} at its {@code END_ELEMENT}. Comments and processing instructions
   * are dropped.
   */
  static void copyElement(XMLStreamReader r, XMLStreamWriter w) throws XMLStreamException {
    int level = 0;
    while (true) {
      int ev = r.getEventType();
      copyEvent(r, w);
      if (ev == XMLStreamConstants.START_ELEMENT) {
        level++;
      } else if (ev == XMLStreamConstants.END_ELEMENT) {
        level--;
        if (level == 0) {
          return;
        }
      }
      r.next();
    }
  }

  /**
   * Copies the current event of {@code r} to {@code w} (a repairing writer): elements with their
   * attributes and their prefixed namespace declarations (which QName values may use), and text.
   */
  public static void copyEvent(XMLStreamReader r, XMLStreamWriter w) throws XMLStreamException {
    switch (r.getEventType()) {
      case XMLStreamConstants.START_ELEMENT -> {
        String prefix = r.getPrefix() == null ? "" : r.getPrefix();
        String ns = r.getNamespaceURI() == null ? "" : r.getNamespaceURI();
        w.writeStartElement(prefix, r.getLocalName(), ns);
        for (int i = 0; i < r.getNamespaceCount(); i++) {
          String p = r.getNamespacePrefix(i);
          String uri = r.getNamespaceURI(i) == null ? "" : r.getNamespaceURI(i);
          if (p != null && !p.isEmpty() && !p.equals(prefix)) {
            w.writeNamespace(p, uri);
          }
        }
        for (int i = 0; i < r.getAttributeCount(); i++) {
          String ans = r.getAttributeNamespace(i);
          if (ans == null || ans.isEmpty()) {
            w.writeAttribute(r.getAttributeLocalName(i), r.getAttributeValue(i));
          } else {
            String ap = r.getAttributePrefix(i);
            w.writeAttribute(ap == null ? "" : ap, ans, r.getAttributeLocalName(i), r.getAttributeValue(i));
          }
        }
      }
      case XMLStreamConstants.END_ELEMENT -> w.writeEndElement();
      case XMLStreamConstants.CHARACTERS, XMLStreamConstants.CDATA, XMLStreamConstants.SPACE -> w.writeCharacters(r.getText());
      default -> {
        // comments and processing instructions are not kept
      }
    }
  }

  /**
   * Writes XML text kept by the reader (one or more elements, as {@link NvgReader} captured them) to
   * {@code w}, re-read with the hardened reader.
   */
  public static void writeKept(String xml, XMLStreamWriter w) throws XMLStreamException {
    XMLStreamReader r = inputFactory().createXMLStreamReader(new StringReader("<kept>" + xml + "</kept>"));
    try {
      r.nextTag();
      while (true) {
        int ev = r.next();
        if (ev == XMLStreamConstants.START_ELEMENT) {
          copyElement(r, w);
        } else if (ev == XMLStreamConstants.END_ELEMENT || ev == XMLStreamConstants.END_DOCUMENT) {
          return;
        }
      }
    } finally {
      r.close();
    }
  }

  /** Whether {@code xml}, as kept text, reads back as one or more elements. */
  public static boolean isWellFormedKept(String xml) {
    try {
      StringWriter out = new StringWriter();
      XMLStreamWriter w = outputFactory().createXMLStreamWriter(out);
      w.writeStartElement("x");
      writeKept(xml, w);
      w.writeEndElement();
      w.close();
      return true;
    } catch (XMLStreamException e) {
      return false;
    }
  }
}
