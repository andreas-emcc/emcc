package dev.emcc.plugins.fmv.out.imagery;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.fmv.out.geo.Sweref99Tm;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

/** The JSON reader, {@code imagery.json} (A1), decoding (Q2) and sampling (brief section 10.5). */
class ImageryTest {

  private static final String SET = """
      { "name": "Sundsvall 2001", "source": "Lantmäteriet, historical orthophotos", "licence": "CC0 1.0",
        "crs": "EPSG:3006",
        "tiles": [ { "file": "t-0-0.png", "min": [616760, 6917345], "max": [617760, 6918345], "width": 4, "height": 2 },
                   { "file": "t-1-0.png", "min": [617760, 6917345], "max": [618760, 6918345], "width": 4, "height": 2 } ] }
      """;

  @Test
  void theJsonReaderReadsJsonAndRefusesTheRest() throws Exception {
    var v = JsonText.parse("{\"a\": [1, -2.5e3, true, false, null, \"x\\u00e5\\n\"], \"b\": {}}");
    assertThat(v).isInstanceOf(JsonObject.class);
    JsonArray a = (JsonArray) ((JsonObject) v).members().get("a");
    assertThat(((JsonNumber) a.get(1)).doubleValue()).isEqualTo(-2500);
    assertThat(((JsonString) a.get(5)).value()).isEqualTo("xå\n");
    for (String bad : new String[] {"{\"a\": 1, \"a\": 2}", "[1,]", "{a: 1}", "01", "[1] x", "\"\t\"", "[" .repeat(40) + "]".repeat(40), "", "nul"}) {
      assertThatThrownBy(() -> JsonText.parse(bad)).as(bad).isInstanceOf(JsonText.JsonException.class);
    }
  }

  @Test
  void anImagerySetNeedsItsSourceAndLicenceAndSafePaths() throws Exception {
    ImagerySet set = ImagerySet.parse("sundsvall-2001", SET);
    assertThat(set.crs()).isEqualTo(ImagerySet.Crs.EPSG_3006);
    assertThat(set.tiles()).hasSize(2);
    assertThat(set.path(set.tiles().get(1))).isEqualTo("sundsvall-2001/t-1-0.png");
    assertThatThrownBy(() -> ImagerySet.parse("x", SET.replace("\"licence\": \"CC0 1.0\",", ""))).hasMessageContaining("licence");
    assertThatThrownBy(() -> ImagerySet.parse("x", SET.replace("\"source\": \"Lantmäteriet, historical orthophotos\",", "")))
        .hasMessageContaining("source");
    assertThatThrownBy(() -> ImagerySet.parse("x", SET.replace("t-0-0.png", "../t-0-0.png"))).hasMessageContaining("inside");
    assertThatThrownBy(() -> ImagerySet.parse("x", SET.replace("t-0-0.png", "C:/t.png"))).hasMessageContaining("inside");
    assertThatThrownBy(() -> ImagerySet.parse("x", SET.replace("t-0-0.png", "t.tif"))).hasMessageContaining(".png");
    assertThatThrownBy(() -> ImagerySet.parse("x", SET.replace("EPSG:3006", "EPSG:3857"))).hasMessageContaining("crs");
    assertThatThrownBy(() -> ImagerySet.parse("x", SET.replace("[617760, 6918345]", "[616000, 6918345]"))).hasMessageContaining("west");
  }

  private static byte[] encode(BufferedImage im, String format) throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    ImageIO.write(im, format, out);
    return out.toByteArray();
  }

  @Test
  void aGreyJpegKeepsOnePlaneAndAColourPngGetsChroma() throws Exception {
    BufferedImage grey = new BufferedImage(16, 8, BufferedImage.TYPE_BYTE_GRAY);
    for (int y = 0; y < 8; y++) {
      for (int x = 0; x < 16; x++) {
        grey.getRaster().setSample(x, y, 0, 128);
      }
    }
    TilePicture g = TilePicture.decode(encode(grey, "jpg"), 16, 8);
    assertThat(g.colour()).isFalse();
    assertThat(g.luma()[5] & 0xFF).isCloseTo(TilePicture.lumaOfGrey(128), within(2));

    BufferedImage red = new BufferedImage(4, 2, BufferedImage.TYPE_INT_RGB);
    for (int y = 0; y < 2; y++) {
      for (int x = 0; x < 4; x++) {
        red.setRGB(x, y, 0xFF0000);
      }
    }
    TilePicture r = TilePicture.decode(encode(red, "png"), 4, 2);
    assertThat(r.colour()).isTrue();
    assertThat(r.cb()).hasSize(2);
    assertThat(r.cr()[0] & 0xFF).isEqualTo(240); // pure red in BT.709 limited range
    assertThat(r.luma()[0] & 0xFF).isEqualTo(63);

    assertThatThrownBy(() -> TilePicture.decode(encode(red, "png"), 5, 2)).hasMessageContaining("4 × 2");
    assertThatThrownBy(() -> TilePicture.decode(new byte[] {1, 2, 3}, 4, 2)).isInstanceOf(TilePicture.PictureException.class);
  }

  @Test
  void samplingFindsTheRightTileInSwerefAndGreyOutside() throws Exception {
    ImagerySet set = ImagerySet.parse("sundsvall-2001", SET);
    Imagery im = new Imagery(set);
    // tile 0 dark (grey 0), tile 1 light (grey 255); 4 × 2 pixels of 250 m each
    for (int t = 0; t < 2; t++) {
      BufferedImage b = new BufferedImage(4, 2, BufferedImage.TYPE_BYTE_GRAY);
      for (int y = 0; y < 2; y++) {
        for (int x = 0; x < 4; x++) {
          b.getRaster().setSample(x, y, 0, t == 0 ? 0 : 255);
        }
      }
      im.add(set.tiles().get(t), TilePicture.decode(encode(b, "png"), 4, 2));
    }
    double[] xy = new double[2];
    double[] ll = new double[2];
    Sweref99Tm.inverse(617_000, 6_917_800, ll); // in tile 0
    im.project(ll[0], ll[1], xy);
    assertThat(xy[0]).isCloseTo(617_000, within(1e-3));
    assertThat(im.sample(xy[0], xy[1], true, true)).isTrue();
    assertThat(im.luma()).isEqualTo(16);
    assertThat(im.sample(618_500, 6_917_800, false, false)).isTrue();
    assertThat(im.luma()).isEqualTo(235);
    assertThat(im.sample(620_000, 6_917_800, true, false)).isFalse();
    assertThat(im.luma()).isEqualTo(Imagery.GREY_LUMA);
    // bilinear across a pixel's centres: half way between 250 m pixels of 16 and 16 is 16, and the
    // edge pixel at the tiles' seam keeps its own tile's value
    assertThat(im.sample(617_755, 6_917_800, true, false)).isTrue();
    assertThat(im.luma()).isEqualTo(16);
  }
}
