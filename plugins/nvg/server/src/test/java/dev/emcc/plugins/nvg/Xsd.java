package dev.emcc.plugins.nvg;

import dev.emcc.sdk.Bytes;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import javax.xml.XMLConstants;
import javax.xml.transform.Source;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.Schema;
import javax.xml.validation.SchemaFactory;
import org.xml.sax.SAXException;

/**
 * The TIDE NVG 2.0 schemas of the test resources ({@code nvg20/SOURCE.md}), with STANAG 4774 and
 * 4778, for validating what the plugin writes (brief, section 2; ADR-0055 point 8). Tests only.
 */
public final class Xsd {

  private Xsd() {}

  private static Schema schema(String... resources) {
    try {
      SchemaFactory f = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
      Source[] sources = new Source[resources.length];
      for (int i = 0; i < resources.length; i++) {
        URL url = Objects.requireNonNull(Xsd.class.getResource(resources[i]), resources[i]);
        sources[i] = new StreamSource(url.toExternalForm());
      }
      return f.newSchema(sources);
    } catch (SAXException e) {
      throw new IllegalStateException(e);
    }
  }

  /** NVG, its filter and capabilities, with the label schemas so that labels inside metadata are checked too. */
  public static Schema nvg() {
    return schema(
        "/nvg20/nato/common/stanag4774/confidentialitymetadatalabel.xsd",
        "/nvg20/nato/common/stanag4778/bindinginformation.xsd",
        "/nvg20/nato/common/nvg20/nvg.2.0.xsd");
  }

  /** Validates a document; throws with the schema's message when it is not valid. */
  public static void validate(Bytes document) {
    try {
      nvg().newValidator().validate(new StreamSource(document.asInputStream()));
    } catch (SAXException e) {
      throw new AssertionError("not valid NVG 2.0: " + e.getMessage() + "\n" + head(document), e);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static String head(Bytes document) {
    String text = new String(document.toArray(), StandardCharsets.UTF_8);
    return text.length() > 4000 ? text.substring(0, 4000) + "…" : text;
  }
}
