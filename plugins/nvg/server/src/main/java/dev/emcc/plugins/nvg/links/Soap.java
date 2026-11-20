package dev.emcc.plugins.nvg.links;

import dev.emcc.plugins.nvg.codec.NvgNames;
import dev.emcc.plugins.nvg.codec.NvgWriter;
import dev.emcc.plugins.nvg.codec.SafeXml;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.model.SecurityLabel;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;
import javax.xml.stream.XMLStreamWriter;
import org.jspecify.annotations.Nullable;

/**
 * The NVG web service's SOAP messages (brief, section 4): SOAP 1.1, document/literal, the TIDE
 * binding {@code NVGBinding2012}; the provider also answers SOAP 1.2 in SOAP 1.2 (N5) <b>[spec
 * check: whether 1.2 is required]</b>. Untrusted envelopes are read with the hardened reader: no
 * DTD, no external entity, a depth limit.
 */
public final class Soap {

  public static final String SOAP11 = "http://schemas.xmlsoap.org/soap/envelope/";
  public static final String SOAP12 = "http://www.w3.org/2003/05/soap-envelope";

  /** The operations' namespace (the WSDL's target namespace). */
  public static final String WSDL = "https://tide.act.nato.int/wsdl/2012/nvg";

  /** {@code SOAPAction} of an operation, quoted, as the WSDL gives it. */
  public static String action(String operation) {
    return "\"" + WSDL + "/" + operation + "\"";
  }

  /** The media type of a SOAP version's messages. */
  public static String mediaType(String version) {
    return version.equals("1.2") ? "application/soap+xml; charset=utf-8" : "text/xml; charset=utf-8";
  }

  /** How deep an envelope may nest outside the NVG document (which has its own limit). */
  static final int MAX_DEPTH = 64;

  private Soap() {}

  /** One answer in {@code nvg_filter}. */
  public record FilterAnswer(String refid, String value) {
    public FilterAnswer {
      Objects.requireNonNull(refid, "refid");
      Objects.requireNonNull(value, "value");
    }
  }

  /**
   * One filter item a provider offers ({@code nvg_capabilities}).
   *
   * @param kind {@code input}, {@code select}, {@code table} or {@code matrix}
   * @param id its id, the {@code refid} of an answer
   * @param name its label
   * @param type an input's type, e.g. {@code int}, else empty
   */
  public record CapabilityItem(String kind, String id, String name, String type) {}

  // --- consumer: requests and the provider's answers -----------------------------------------------

  /** A {@code GetNvg} request in SOAP 1.1, with the answers as {@code input_response}s (empty filter when none). */
  public static Bytes getNvgRequest(List<FilterAnswer> answers) {
    return write("1.1", w -> {
      w.writeStartElement("nvgw", "GetNvg", WSDL);
      w.writeNamespace("nvgw", WSDL);
      w.writeStartElement("nvg", "nvg_filter", NvgNames.NVG);
      w.writeNamespace("nvg", NvgNames.NVG);
      w.writeAttribute("version", NvgNames.WRITTEN_VERSION);
      for (FilterAnswer a : answers) {
        w.writeStartElement("nvg", "input_response", NvgNames.NVG);
        w.writeAttribute("refid", a.refid());
        w.writeCharacters(a.value());
        w.writeEndElement();
      }
      w.writeEndElement();
      w.writeEndElement();
    });
  }

  /** A {@code GetCapabilities} request in SOAP 1.1. */
  public static Bytes getCapabilitiesRequest() {
    return write("1.1", w -> {
      w.writeEmptyElement("nvgw", "GetCapabilities", WSDL);
      w.writeNamespace("nvgw", WSDL);
    });
  }

  /**
   * What a provider's answer held.
   *
   * @param nvg the {@code nvg} document, as a document of its own, or {@code null}
   * @param fault the fault's text when the answer is a SOAP fault, else {@code null}
   * @param counter a refusal's counter ({@code refused: ...}) when the answer could not be read, else {@code null}
   * @param reason the refusal's reason, else {@code null}
   */
  public record Unwrapped(@Nullable Bytes nvg, @Nullable String fault, @Nullable String counter, @Nullable String reason) {
    static Unwrapped refused(String counter, String reason) {
      return new Unwrapped(null, null, counter, reason);
    }
  }

  /** Takes the {@code nvg} document out of a {@code GetNvgResponse}, or the fault's text. */
  public static Unwrapped unwrapNvg(Bytes answer, int maxBytes) {
    if (answer.size() > maxBytes) {
      return Unwrapped.refused("refused: limit size", "the answer is larger than " + (maxBytes / (1024 * 1024)) + " MiB");
    }
    try {
      XMLStreamReader r = SafeXml.inputFactory().createXMLStreamReader(answer.asInputStream());
      try {
        Body body = body(r);
        if (body.fault != null) {
          return new Unwrapped(null, body.fault, null, null);
        }
        // At GetNvgResponse: its nvg child.
        if (!r.getLocalName().equals("GetNvgResponse")) {
          return Unwrapped.refused("refused: not NVG", "the answer is " + r.getLocalName() + ", not GetNvgResponse");
        }
        int depth = 0;
        while (true) {
          int ev = r.next();
          if (ev == XMLStreamConstants.START_ELEMENT) {
            if (r.getLocalName().equals("nvg")) {
              ByteArrayOutputStream out = new ByteArrayOutputStream();
              XMLStreamWriter w = SafeXml.outputFactory().createXMLStreamWriter(out, "UTF-8");
              w.writeStartDocument("UTF-8", "1.0");
              copy(r, w);
              w.writeEndDocument();
              w.close();
              return new Unwrapped(Bytes.of(out.toByteArray()), null, null, null);
            }
            if (++depth > MAX_DEPTH) {
              return Unwrapped.refused("refused: limit depth", "the answer nests deeper than " + MAX_DEPTH);
            }
          } else if (ev == XMLStreamConstants.END_ELEMENT) {
            if (--depth < 0) {
              return Unwrapped.refused("refused: not NVG", "GetNvgResponse holds no nvg");
            }
          } else if (ev == XMLStreamConstants.END_DOCUMENT) {
            return Unwrapped.refused("refused: not NVG", "GetNvgResponse holds no nvg");
          }
        }
      } finally {
        r.close();
      }
    } catch (Refused e) {
      return Unwrapped.refused(e.counter, e.getMessage());
    } catch (XMLStreamException | RuntimeException e) {
      String text = String.valueOf(e.getMessage());
      if (text.contains("DOCTYPE") || text.contains("DTD")) {
        return Unwrapped.refused("refused: DTD", "a document with a DTD is refused");
      }
      return Unwrapped.refused("refused: not XML", "not XML: " + clip(text));
    }
  }

  /**
   * A provider's capabilities, or why there are none.
   *
   * @param items the filter items, or {@code null}
   * @param problem a fault's text or why the answer could not be read, else {@code null}
   */
  public record Capabilities(@Nullable List<CapabilityItem> items, @Nullable String problem) {}

  /** Reads a {@code GetCapabilitiesResponse}: its filter items. */
  public static Capabilities readCapabilities(Bytes answer) {
    if (answer.size() > 1024 * 1024) {
      return new Capabilities(null, "the answer is larger than 1 MiB");
    }
    try {
      XMLStreamReader r = SafeXml.inputFactory().createXMLStreamReader(answer.asInputStream());
      try {
        Body body = body(r);
        if (body.fault != null) {
          return new Capabilities(null, "SOAP fault: " + body.fault);
        }
        List<CapabilityItem> items = new ArrayList<>();
        java.util.ArrayDeque<String> stack = new java.util.ArrayDeque<>();
        while (r.hasNext()) {
          int ev = r.next();
          if (ev == XMLStreamConstants.START_ELEMENT) {
            if (stack.size() >= MAX_DEPTH) {
              return new Capabilities(null, "the answer nests deeper than " + MAX_DEPTH);
            }
            String local = r.getLocalName();
            String id = r.getAttributeValue(null, "id");
            boolean item = List.of("input", "select", "table", "matrix").contains(local) && "nvg_capabilities".equals(stack.peek());
            if (id != null && item && items.size() < 256) {
              String name = r.getAttributeValue(null, "name");
              String type = r.getAttributeValue(null, "type");
              items.add(new CapabilityItem(local, clip(id), name == null ? "" : clip(name), type == null ? "" : clip(type)));
            }
            stack.push(local);
          } else if (ev == XMLStreamConstants.END_ELEMENT) {
            if (stack.isEmpty()) {
              break;
            }
            stack.pop();
          }
        }
        return new Capabilities(items, null);
      } finally {
        r.close();
      }
    } catch (Refused e) {
      return new Capabilities(null, e.getMessage());
    } catch (XMLStreamException | RuntimeException e) {
      return new Capabilities(null, "not XML: " + clip(String.valueOf(e.getMessage())));
    }
  }

  // --- provider: requests and answers ------------------------------------------------------------

  /**
   * A request to the provider.
   *
   * @param version {@code 1.1} or {@code 1.2}, by the envelope's namespace
   * @param operation {@code GetCapabilities}, {@code GetNvg}, or the element found
   * @param selected the {@code select_response} answers by {@code refid}
   * @param inputs the {@code input_response} answers by {@code refid}
   * @param problem why the request cannot be answered, else {@code null}
   */
  public record Request(String version, String operation, Map<String, List<String>> selected, Map<String, String> inputs, @Nullable String problem) {
    public Request {
      selected = Map.copyOf(selected);
      inputs = Map.copyOf(inputs);
    }
  }

  /** Reads a request; never throws. */
  public static Request readRequest(Bytes body, @Nullable String contentType) {
    String fallbackVersion = contentType != null && contentType.toLowerCase(java.util.Locale.ROOT).startsWith("application/soap+xml") ? "1.2" : "1.1";
    try {
      XMLStreamReader r = SafeXml.inputFactory().createXMLStreamReader(body.asInputStream());
      try {
        Body b = body(r);
        if (b.fault != null) {
          return new Request(b.version, "Fault", Map.of(), Map.of(), "a fault is not a request");
        }
        String operation = r.getLocalName();
        if (!Objects.equals(r.getNamespaceURI(), WSDL) || !(operation.equals("GetCapabilities") || operation.equals("GetNvg"))) {
          return new Request(b.version, operation, Map.of(), Map.of(), "unknown operation " + clip(operation));
        }
        Map<String, List<String>> selected = new LinkedHashMap<>();
        Map<String, String> inputs = new LinkedHashMap<>();
        int depth = 0;
        String refid = null;
        String kind = "";
        while (r.hasNext()) {
          int ev = r.next();
          if (ev == XMLStreamConstants.START_ELEMENT) {
            if (++depth > MAX_DEPTH) {
              return new Request(b.version, operation, Map.of(), Map.of(), "the request nests deeper than " + MAX_DEPTH);
            }
            String local = r.getLocalName();
            if (local.equals("input_response") || local.equals("select_response")) {
              refid = r.getAttributeValue(null, "refid");
              kind = local;
              if (local.equals("input_response") && refid != null) {
                inputs.put(refid, clip(r.getElementText().strip()));
                depth--;
                refid = null;
              }
            } else if (local.equals("selected") && "select_response".equals(kind) && refid != null) {
              selected.computeIfAbsent(refid, k -> new ArrayList<>()).add(clip(r.getElementText().strip()));
              depth--;
            }
          } else if (ev == XMLStreamConstants.END_ELEMENT) {
            depth--;
            if (r.getLocalName().equals("select_response")) {
              refid = null;
              kind = "";
            }
          }
        }
        return new Request(b.version, operation, selected, inputs, null);
      } finally {
        r.close();
      }
    } catch (Refused e) {
      return new Request(fallbackVersion, "", Map.of(), Map.of(), e.getMessage());
    } catch (XMLStreamException | RuntimeException e) {
      String text = String.valueOf(e.getMessage());
      String problem = text.contains("DOCTYPE") || text.contains("DTD") ? "a request with a DTD is refused" : "not XML";
      return new Request(fallbackVersion, "", Map.of(), Map.of(), problem);
    }
  }

  /** A {@code GetCapabilitiesResponse} offering one select item, {@code layers}, with the source layers (N4). */
  public static Bytes capabilitiesResponse(String version, List<Map.Entry<String, String>> layers) {
    return write(version, w -> {
      w.writeStartElement("nvgw", "GetCapabilitiesResponse", WSDL);
      w.writeNamespace("nvgw", WSDL);
      w.writeStartElement("nvg", "nvg_capabilities", NvgNames.NVG);
      w.writeNamespace("nvg", NvgNames.NVG);
      w.writeAttribute("version", NvgNames.WRITTEN_VERSION);
      w.writeStartElement("nvg", "select", NvgNames.NVG);
      w.writeAttribute("id", "layers");
      w.writeAttribute("name", "Layers");
      w.writeAttribute("multiple", "true");
      w.writeStartElement("nvg", "values", NvgNames.NVG);
      for (Map.Entry<String, String> layer : layers) {
        w.writeEmptyElement("nvg", "value", NvgNames.NVG);
        w.writeAttribute("id", layer.getKey());
        w.writeAttribute("name", layer.getValue());
      }
      w.writeEndElement();
      w.writeEndElement();
      w.writeEndElement();
      w.writeEndElement();
    });
  }

  /** A {@code GetNvgResponse} with the document. */
  public static Bytes getNvgResponse(String version, @Nullable SecurityLabel label, Instant now, List<NvgWriter.Group> groups) {
    return write(version, w -> {
      w.writeStartElement("nvgw", "GetNvgResponse", WSDL);
      w.writeNamespace("nvgw", WSDL);
      NvgWriter.writeNvg(w, label, now, groups);
      w.writeEndElement();
    });
  }

  /** A fault: {@code client} for a bad request, else {@code server}. */
  public static Bytes fault(String version, boolean client, String text) {
    return write(version, w -> {
      String ns = version.equals("1.2") ? SOAP12 : SOAP11;
      w.writeStartElement("soap", "Fault", ns);
      if (version.equals("1.2")) {
        w.writeStartElement("soap", "Code", ns);
        w.writeStartElement("soap", "Value", ns);
        w.writeCharacters(client ? "soap:Sender" : "soap:Receiver");
        w.writeEndElement();
        w.writeEndElement();
        w.writeStartElement("soap", "Reason", ns);
        w.writeStartElement("soap", "Text", ns);
        w.writeAttribute("xml", "http://www.w3.org/XML/1998/namespace", "lang", "en");
        w.writeCharacters(text);
        w.writeEndElement();
        w.writeEndElement();
      } else {
        w.writeStartElement("faultcode");
        w.writeCharacters(client ? "soap:Client" : "soap:Server");
        w.writeEndElement();
        w.writeStartElement("faultstring");
        w.writeCharacters(text);
        w.writeEndElement();
      }
      w.writeEndElement();
    });
  }

  // --- shared -------------------------------------------------------------------------------

  /** Writes the body's content. */
  interface BodyWriter {
    void write(XMLStreamWriter w) throws XMLStreamException;
  }

  private static Bytes write(String version, BodyWriter body) {
    String ns = version.equals("1.2") ? SOAP12 : SOAP11;
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    try {
      XMLStreamWriter w = SafeXml.outputFactory().createXMLStreamWriter(out, "UTF-8");
      w.writeStartDocument("UTF-8", "1.0");
      w.writeStartElement("soap", "Envelope", ns);
      w.writeNamespace("soap", ns);
      w.writeStartElement("soap", "Body", ns);
      body.write(w);
      w.writeEndElement();
      w.writeEndElement();
      w.writeEndDocument();
      w.close();
    } catch (XMLStreamException e) {
      throw new IllegalStateException("cannot write SOAP: " + e.getMessage(), e);
    }
    return Bytes.of(out.toByteArray());
  }

  /** Where {@link #body} left the reader: at the body's first element; a fault's text when it is a fault. */
  private record Body(String version, @Nullable String fault) {}

  /** Reads up to the body's first element; refuses a DTD and anything that is not an envelope. */
  private static Body body(XMLStreamReader r) throws XMLStreamException {
    while (true) {
      int ev = r.next();
      if (ev == XMLStreamConstants.DTD) {
        throw new Refused("refused: DTD", "a document with a DTD is refused");
      }
      if (ev == XMLStreamConstants.START_ELEMENT) {
        break;
      }
      if (ev == XMLStreamConstants.END_DOCUMENT) {
        throw new Refused("refused: not XML", "no element");
      }
    }
    String ns = r.getNamespaceURI();
    if (!r.getLocalName().equals("Envelope") || !(SOAP11.equals(ns) || SOAP12.equals(ns))) {
      throw new Refused("refused: not SOAP", "not a SOAP envelope: " + clip(r.getLocalName()));
    }
    String version = SOAP12.equals(ns) ? "1.2" : "1.1";
    // Header (skipped) and Body.
    while (true) {
      int ev = r.nextTag();
      if (ev == XMLStreamConstants.END_ELEMENT) {
        throw new Refused("refused: not SOAP", "the envelope has no body");
      }
      if (r.getLocalName().equals("Body") && ns.equals(r.getNamespaceURI())) {
        break;
      }
      skip(r);
    }
    int ev = r.nextTag();
    if (ev == XMLStreamConstants.END_ELEMENT) {
      throw new Refused("refused: not SOAP", "the body is empty");
    }
    if (r.getLocalName().equals("Fault") && ns.equals(r.getNamespaceURI())) {
      return new Body(version, faultText(r));
    }
    return new Body(version, null);
  }

  /** The text of a fault: SOAP 1.1's {@code faultstring}, SOAP 1.2's {@code Reason/Text}. */
  private static String faultText(XMLStreamReader r) throws XMLStreamException {
    int depth = 1;
    String text = null;
    while (depth > 0 && r.hasNext()) {
      int ev = r.next();
      if (ev == XMLStreamConstants.START_ELEMENT) {
        depth++;
        if ((r.getLocalName().equals("faultstring") || r.getLocalName().equals("Text")) && text == null) {
          text = r.getElementText().strip();
          depth--;
        }
      } else if (ev == XMLStreamConstants.END_ELEMENT) {
        depth--;
      }
    }
    return text == null || text.isEmpty() ? "(no text)" : clip(text);
  }

  private static void skip(XMLStreamReader r) throws XMLStreamException {
    int depth = 1;
    while (depth > 0) {
      int ev = r.next();
      if (ev == XMLStreamConstants.START_ELEMENT) {
        if (++depth > MAX_DEPTH) {
          throw new Refused("refused: limit depth", "the envelope nests deeper than " + MAX_DEPTH);
        }
      } else if (ev == XMLStreamConstants.END_ELEMENT) {
        depth--;
      }
    }
  }

  /** Copies the current element to {@code w}, keeping no comments; the NVG reader checks its depth afterwards. */
  private static void copy(XMLStreamReader r, XMLStreamWriter w) throws XMLStreamException {
    int level = 0;
    while (true) {
      int ev = r.getEventType();
      if (ev == XMLStreamConstants.DTD) {
        throw new Refused("refused: DTD", "a document with a DTD is refused");
      }
      SafeXml.copyEvent(r, w);
      if (ev == XMLStreamConstants.START_ELEMENT) {
        level++;
      } else if (ev == XMLStreamConstants.END_ELEMENT && --level == 0) {
        return;
      }
      r.next();
    }
  }

  private static String clip(String text) {
    return text.length() <= 200 ? text : text.substring(0, 200) + "…";
  }

  /** Ends reading with a counter and a reason. */
  private static final class Refused extends RuntimeException {
    private static final long serialVersionUID = 1L;
    final String counter;

    Refused(String counter, String reason) {
      super(reason, null, false, false);
      this.counter = counter;
    }
  }
}
