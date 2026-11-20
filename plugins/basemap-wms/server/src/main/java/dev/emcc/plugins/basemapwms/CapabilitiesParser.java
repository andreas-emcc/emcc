package dev.emcc.plugins.basemapwms;

import dev.emcc.sdk.Bytes;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import javax.xml.parsers.SAXParserFactory;
import org.jspecify.annotations.Nullable;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;
import org.xml.sax.XMLReader;
import org.xml.sax.ext.DeclHandler;

/**
 * Reads the layers of a WMS capabilities document (1.1.1 and 1.3.0) with the JDK's parser, with DTDs and external entities
 * switched off: a bare DOCTYPE is accepted, a DOCTYPE that declares anything or an entity is refused, and nothing is fetched to read it.
 */
final class CapabilitiesParser {

  /** More layers than any real server has; a bigger document is refused. */
  static final int MAX_LAYERS = 10_000;
  private static final int MAX_DEPTH = 64;

  private CapabilitiesParser() {}

  /** A document that cannot be used, with the reason for the status. */
  static final class Unreadable extends Exception {
    private static final long serialVersionUID = 1L;

    Unreadable(String message) {
      super(message);
    }

    Unreadable(String message, Throwable cause) {
      super(message, cause);
    }
  }

  /**
   * The named layers in the document's order, a parent before its children, each with the projections it lists and those
   * it inherits.
   */
  static List<LayerInfo> parse(Bytes body) throws Unreadable {
    Document document = read(body);
    Element root = document.getDocumentElement();
    String rootName = local(root);
    if (rootName.equals("ServiceExceptionReport")) {
      throw new Unreadable("the server answered a service exception: " + abbreviate(root.getTextContent()));
    }
    if (!rootName.equals("WMS_Capabilities") && !rootName.equals("WMT_MS_Capabilities")) {
      throw new Unreadable("not a WMS capabilities document (" + rootName + ")");
    }
    @Nullable Element capability = child(root, "Capability");
    @Nullable Element top = capability == null ? null : child(capability, "Layer");
    List<LayerInfo> layers = new ArrayList<>();
    if (top != null) {
      walk(top, new LinkedHashSet<>(), layers, 0);
    }
    return layers;
  }

  private static Document read(Bytes body) throws Unreadable {
    try {
      DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
      factory.setNamespaceAware(true);
      factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
      // A bare DOCTYPE is accepted, as WMS 1.1.1 servers such as GeoServer send one; its DTD is never loaded (below).
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", false);
      factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
      factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
      factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
      factory.setXIncludeAware(false);
      factory.setExpandEntityReferences(false);
      factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
      factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
      DocumentBuilder builder = factory.newDocumentBuilder();
      builder.setEntityResolver((publicId, systemId) -> {
        throw new SAXException("external entities and DTDs are never loaded");
      });
      builder.setErrorHandler(null);
      refuseInternalSubset(body);
      return builder.parse(body.asInputStream());
    } catch (ParserConfigurationException e) {
      throw new IllegalStateException("the JDK's XML parser cannot be set up safely", e);
    } catch (SAXException | IOException e) {
      throw new Unreadable("the capabilities are not readable XML: " + abbreviate(String.valueOf(e.getMessage())), e);
    }
  }

  /**
   * A DOCTYPE may name an external DTD, which is never loaded, but it may not declare anything itself: an internal subset
   * with an element, attribute, notation or entity declaration is refused. A first pass with a declaration handler finds them.
   */
  private static void refuseInternalSubset(Bytes body) throws SAXException, IOException, ParserConfigurationException {
    SAXParserFactory factory = SAXParserFactory.newInstance();
    factory.setNamespaceAware(true);
    factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", false);
    factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
    // A reference to an external parameter entity reaches the resolver, which refuses it; the document's own DTD is not asked for.
    factory.setFeature("http://xml.org/sax/features/external-parameter-entities", true);
    factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
    XMLReader reader = factory.newSAXParser().getXMLReader();
    reader.setEntityResolver((publicId, systemId) -> {
      throw new SAXException("external entities and DTDs are never loaded");
    });
    reader.setProperty("http://xml.org/sax/properties/declaration-handler", new DeclHandler() {
      @Override
      public void elementDecl(String name, String model) throws SAXException {
        throw refused();
      }

      @Override
      public void attributeDecl(String element, String attribute, String type, @Nullable String mode, @Nullable String value) throws SAXException {
        throw refused();
      }

      @Override
      public void internalEntityDecl(String name, String value) throws SAXException {
        throw refused();
      }

      @Override
      public void externalEntityDecl(String name, @Nullable String publicId, String systemId) throws SAXException {
        throw refused();
      }

      private SAXException refused() {
        return new SAXException("the DOCTYPE declares something: only a bare DOCTYPE is accepted");
      }
    });
    reader.setDTDHandler(new org.xml.sax.DTDHandler() {
      @Override
      public void notationDecl(String name, @Nullable String publicId, @Nullable String systemId) throws SAXException {
        throw new SAXException("the DOCTYPE declares something: only a bare DOCTYPE is accepted");
      }

      @Override
      public void unparsedEntityDecl(String name, @Nullable String publicId, String systemId, String notationName) throws SAXException {
        throw new SAXException("the DOCTYPE declares something: only a bare DOCTYPE is accepted");
      }
    });
    reader.parse(new InputSource(body.asInputStream()));
  }

  private static void walk(Element layer, Set<String> inherited, List<LayerInfo> out, int depth) throws Unreadable {
    if (depth > MAX_DEPTH) {
      throw new Unreadable("the layers are nested deeper than " + MAX_DEPTH);
    }
    Set<String> projections = new LinkedHashSet<>(inherited);
    @Nullable String name = null;
    @Nullable String title = null;
    for (Node n = layer.getFirstChild(); n != null; n = n.getNextSibling()) {
      if (!(n instanceof Element e)) {
        continue;
      }
      switch (local(e)) {
        case "Name" -> name = e.getTextContent().strip();
        case "Title" -> title = e.getTextContent().strip();
        case "CRS", "SRS" -> {
          for (String code : e.getTextContent().strip().split("\\s+")) {
            if (!code.isEmpty()) {
              projections.add(code.toUpperCase(Locale.ROOT));
            }
          }
        }
        default -> { }
      }
    }
    if (name != null && !name.isEmpty()) {
      if (out.size() >= MAX_LAYERS) {
        throw new Unreadable("the server lists more than " + MAX_LAYERS + " layers");
      }
      out.add(new LayerInfo(name, title == null || title.isEmpty() ? name : title, List.copyOf(projections)));
    }
    for (Node n = layer.getFirstChild(); n != null; n = n.getNextSibling()) {
      if (n instanceof Element e && local(e).equals("Layer")) {
        walk(e, projections, out, depth + 1);
      }
    }
  }

  private static @Nullable Element child(Element parent, String name) {
    for (Node n = parent.getFirstChild(); n != null; n = n.getNextSibling()) {
      if (n instanceof Element e && local(e).equals(name)) {
        return e;
      }
    }
    return null;
  }

  private static String local(Element e) {
    String name = e.getLocalName();
    return name == null ? e.getTagName() : name;
  }

  private static String abbreviate(String text) {
    String flat = text.strip().replaceAll("\\s+", " ");
    return flat.length() <= 200 ? flat : flat.substring(0, 200) + "...";
  }
}
