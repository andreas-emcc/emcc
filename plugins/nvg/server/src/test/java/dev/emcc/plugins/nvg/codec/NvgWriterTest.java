package dev.emcc.plugins.nvg.codec;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.nvg.Samples;
import dev.emcc.plugins.nvg.Xsd;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.model.SecurityLabel;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The writer: NVG 2.0.2, valid against the TIDE schemas, and read back to the same items. */
class NvgWriterTest {

  private static final Instant NOW = Instant.parse("2026-11-12T10:00:00Z");

  @Test
  void criterion1_aWrittenDocumentIs2_0_2AndValidatesAgainstTheTideSchemas() {
    NvgDocument sample = NvgReader.read(Samples.everyElement(), Limits.DEFAULT).document();
    Bytes written = NvgWriter.write(sample.label(), NOW, List.of(new NvgWriter.Group("urn:uuid:layer", "Layer", sample.items())));
    assertThat(written.toUtf8()).contains("version=\"2.0.2\"");
    Xsd.validate(written);
  }

  @Test
  void theSampleItselfIsValid() {
    Xsd.validate(Samples.everyElement());
  }

  @Test
  void whatIsWrittenReadsBackAsTheSameItemsInOneGroup() {
    NvgDocument sample = NvgReader.read(Samples.everyElement(), Limits.DEFAULT).document();
    Bytes written = NvgWriter.write(sample.label(), NOW, List.of(new NvgWriter.Group("urn:uuid:layer", "Layer", sample.items())));
    NvgDocument back = NvgReader.read(written, Limits.DEFAULT).document();
    assertThat(back.version()).isEqualTo("2.0.2");
    assertThat(back.items()).hasSameSizeAs(sample.items());
    for (int i = 0; i < sample.items().size(); i++) {
      Item before = sample.items().get(i);
      Item after = back.items().get(i);
      assertThat(after.kind()).isEqualTo(before.kind());
      assertThat(after.uri()).isEqualTo(before.uri());
      assertThat(after.attributes()).isEqualTo(before.attributes());
      assertThat(after.content()).isEqualTo(before.content());
      assertThat(after.textInfo()).isEqualTo(before.textInfo());
      assertThat(after.timeStamp()).isEqualTo(before.timeStamp());
      assertThat(after.timeBegin()).isEqualTo(before.timeBegin());
      assertThat(after.timeEnd()).isEqualTo(before.timeEnd());
      assertThat(after.excludes()).isEqualTo(before.excludes());
      assertThat(after.groupPath()).containsExactly("Layer");
      assertThat(after.label().classification()).isEqualTo(before.label().classification());
      assertThat(after.label().categories()).isEqualTo(before.label().categories());
      if (before.extendedData() != null) {
        assertThat(after.extendedData()).contains("strength").contains("120");
      }
    }
  }

  @Test
  void criterion11_eachItemAndTheDocumentCarryTheirLabel() {
    Item item = Item.builder(Kind.POINT, "urn:x").attribute("x", "15.2").attribute("y", "58.4")
        .label(new SecurityLabel(new SecurityLabel.Policy("NATO", null), "RESTRICTED",
            List.of(new SecurityLabel.Category("Releasable to", SecurityLabel.CategoryType.PERMISSIVE, null, List.of("SWE"))), null, null))
        .build();
    Bytes written = NvgWriter.write(SecurityLabel.of("NATO", "SECRET"), NOW, List.of(new NvgWriter.Group("urn:uuid:l", "L", List.of(item))));
    Xsd.validate(written);
    NvgDocument back = NvgReader.read(written, Limits.DEFAULT).document();
    assertThat(back.label()).isEqualTo(new SecurityLabel(new SecurityLabel.Policy("NATO", null), "SECRET", List.of(), NOW, null));
    assertThat(back.items().getFirst().label().classification()).isEqualTo("RESTRICTED");
    assertThat(back.items().getFirst().label().categories()).hasSize(1);
    assertThat(written.toUtf8()).contains("<mb:DataReference URI=\"urn:x\"");
  }

  @Test
  void keptXmlComesBackInsideExtension() {
    NvgDocument doc = NvgReader.read(Samples.doc("<point uri=\"u\" x=\"1\" y=\"2\"><x:note xmlns:x=\"urn:other\" x:level=\"3\">inside</x:note>"
        + "<extension><y:z xmlns:y=\"urn:y\">kept</y:z></extension></point>"), Limits.DEFAULT).document();
    Bytes written = NvgWriter.write(null, NOW, List.of(new NvgWriter.Group("urn:g", "G", doc.items())));
    Xsd.validate(written);
    Item back = NvgReader.read(written, Limits.DEFAULT).document().items().getFirst();
    assertThat(back.extension()).contains("urn:y").contains("kept").contains("urn:other").contains("inside");
  }
}
