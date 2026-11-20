package dev.emcc.plugins.cot.codec;

import dev.emcc.sdk.model.TextModifier;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.jspecify.annotations.Nullable;
import org.w3c.dom.Element;
import org.w3c.dom.Node;

/**
 * The symbol's code and amplifiers in a CoT {@code <detail>} (brief functions 26 to 28, T-129), and the way back.
 *
 * <p><b>In:</b> the code is {@code __milsym/@id}, else {@code __milicon/@id}, else {@code mil2525c/@SIDC} (ATAK's and WinTAK's elements),
 * upper-cased. The amplifiers are ATAK's {@code <unitmodifier code="C">12</unitmodifier>} children of {@code __milsym} (else of
 * {@code __milicon}) and WinTAK's {@code <amp unique_designation="…" higher_formation="…" quantity="…" status="…"/>} attributes;
 * ATAK's win. A code or attribute not in the table, an empty value and one over 128 characters (the model's limit) are left out.
 * {@code <remarks>} is not read.
 *
 * <p><b>Out:</b> {@link #letters()} are the codes in the order of the brief's table.
 */
final class UnitModifiers {

  /** What a detail says about the symbol: the code as written (upper-cased), and the amplifiers. */
  record Read(String code, Map<TextModifier, String> amplifiers) {}

  /** ATAK's {@code unitmodifier/@code} to the model's modifier, in the order of the brief's table (function 27). */
  private static final Map<String, TextModifier> BY_LETTER = new LinkedHashMap<>();

  static {
    BY_LETTER.put("C", TextModifier.QUANTITY);
    BY_LETTER.put("F", TextModifier.REINFORCED_REDUCED);
    BY_LETTER.put("G", TextModifier.STAFF_COMMENTS);
    BY_LETTER.put("H", TextModifier.ADDITIONAL_INFORMATION);
    BY_LETTER.put("J", TextModifier.EVALUATION_RATING);
    BY_LETTER.put("K", TextModifier.COMBAT_EFFECTIVENESS);
    BY_LETTER.put("L", TextModifier.SIGNATURE_EQUIPMENT);
    BY_LETTER.put("M", TextModifier.HIGHER_FORMATION);
    BY_LETTER.put("N", TextModifier.HOSTILE);
    BY_LETTER.put("P", TextModifier.IFF_SIF);
    BY_LETTER.put("R2", TextModifier.SIGINT);
    BY_LETTER.put("T", TextModifier.UNIQUE_DESIGNATION);
    BY_LETTER.put("V", TextModifier.TYPE);
    BY_LETTER.put("W", TextModifier.DTG);
    BY_LETTER.put("X", TextModifier.ALTITUDE_DEPTH);
    BY_LETTER.put("Y", TextModifier.LOCATION);
    BY_LETTER.put("AA", TextModifier.SPECIAL_HEADQUARTERS);
    BY_LETTER.put("AD", TextModifier.PLATFORM_TYPE);
    BY_LETTER.put("AE", TextModifier.EQUIPMENT_TEARDOWN_TIME);
    BY_LETTER.put("AF", TextModifier.COMMON_IDENTIFIER);
    BY_LETTER.put("AG", TextModifier.AUXILIARY_EQUIPMENT_INDICATOR);
    BY_LETTER.put("AO", TextModifier.ENGAGEMENT_BAR);
  }

  private UnitModifiers() {}

  /** The letters (ATAK's {@code unitmodifier/@code}) in the order of the brief's table. */
  static Map<String, TextModifier> letters() {
    return BY_LETTER;
  }

  /** The letter of a modifier, or {@code null} if the table has none. */
  static @Nullable String letterOf(TextModifier modifier) {
    for (Map.Entry<String, TextModifier> e : BY_LETTER.entrySet()) {
      if (e.getValue() == modifier) {
        return e.getKey();
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- in

  /** What {@code detail} (the raw content of {@code <detail>}) says about the symbol, or {@code null} if it names no code. */
  static @Nullable Read read(@Nullable String detail) {
    if (detail == null || !(detail.contains("__milsym") || detail.contains("__milicon") || detail.contains("mil2525c"))) {
      return null;
    }
    Element root;
    try {
      var builder = CotXml.hardenedFactory().newDocumentBuilder();
      builder.setEntityResolver((publicId, systemId) -> {
        throw new org.xml.sax.SAXException("external entities are not allowed");
      });
      builder.setErrorHandler(null);
      root = builder.parse(new org.xml.sax.InputSource(new java.io.StringReader("<detail>" + detail + "</detail>"))).getDocumentElement();
    } catch (Exception e) {
      return null; // it was well-formed when received; if it is not now, the type gives the symbol
    }
    Element milsym = child(root, "__milsym");
    Element milicon = child(root, "__milicon");
    Element mil2525c = child(root, "mil2525c");
    String code = firstNonEmpty(milsym == null ? null : milsym.getAttribute("id"), milicon == null ? null : milicon.getAttribute("id"),
        mil2525c == null ? null : mil2525c.getAttribute("SIDC"));
    if (code == null) {
      return null;
    }
    var amplifiers = new LinkedHashMap<TextModifier, String>();
    Element amp = child(root, "amp");
    if (amp != null) {
      amp(amp, amplifiers);
    }
    Element carrier = milsym != null && hasChildren(milsym, "unitmodifier") ? milsym : milicon;
    if (carrier != null) {
      unitModifiers(carrier, amplifiers); // ATAK's win over WinTAK's
    }
    return new Read(code.strip().toUpperCase(Locale.ROOT), amplifiers);
  }

  private static void unitModifiers(Element carrier, Map<TextModifier, String> into) {
    for (Node n = carrier.getFirstChild(); n != null; n = n.getNextSibling()) {
      if (n instanceof Element e && e.getTagName().equals("unitmodifier")) {
        TextModifier modifier = BY_LETTER.get(e.getAttribute("code"));
        String value = e.getTextContent() == null ? "" : e.getTextContent().strip();
        if (modifier != null && !value.isEmpty() && value.length() <= TextModifier.MAX_LENGTH) {
          into.put(modifier, value);
        }
      }
    }
  }

  /** WinTAK's {@code <amp>}: an attribute whose camelCase name is one of the table's modifiers; {@code status} is the combat effectiveness. */
  private static void amp(Element amp, Map<TextModifier, String> into) {
    var attributes = amp.getAttributes();
    for (int i = 0; i < attributes.getLength(); i++) {
      Node a = attributes.item(i);
      String name = a.getNodeName();
      TextModifier modifier = name.equals("status") ? TextModifier.COMBAT_EFFECTIVENESS : byCamelName(camel(name));
      String value = a.getNodeValue() == null ? "" : a.getNodeValue().strip();
      if (modifier != null && !value.isEmpty() && value.length() <= TextModifier.MAX_LENGTH) {
        into.put(modifier, value);
      }
    }
  }

  private static @Nullable TextModifier byCamelName(String name) {
    for (TextModifier m : BY_LETTER.values()) {
      if (m.json().equals(name)) {
        return m;
      }
    }
    return null;
  }

  /** {@code unique_designation} to {@code uniqueDesignation}. */
  static String camel(String snake) {
    var out = new StringBuilder();
    boolean up = false;
    for (char c : snake.toCharArray()) {
      if (c == '_') {
        up = true;
      } else {
        out.append(up ? Character.toUpperCase(c) : c);
        up = false;
      }
    }
    return out.toString();
  }

  private static @Nullable String firstNonEmpty(@Nullable String... values) {
    for (String v : values) {
      if (v != null && !v.isBlank()) {
        return v;
      }
    }
    return null;
  }

  private static @Nullable Element child(Element parent, String name) {
    for (Node n = parent.getFirstChild(); n != null; n = n.getNextSibling()) {
      if (n instanceof Element e && e.getTagName().equals(name)) {
        return e;
      }
    }
    return null;
  }

  private static boolean hasChildren(Element parent, String name) {
    return child(parent, name) != null;
  }

  // ---------------------------------------------------------------- out

  /** The text modifiers of {@code values} that the table has, as (letter, value) in the table's order. */
  static List<Map.Entry<String, String>> out(java.util.function.Function<TextModifier, @Nullable String> values) {
    var list = new ArrayList<Map.Entry<String, String>>();
    for (Map.Entry<String, TextModifier> e : BY_LETTER.entrySet()) {
      String value = values.apply(e.getValue());
      if (value != null && !value.isEmpty()) {
        list.add(Map.entry(e.getKey(), value));
      }
    }
    return list;
  }
}
