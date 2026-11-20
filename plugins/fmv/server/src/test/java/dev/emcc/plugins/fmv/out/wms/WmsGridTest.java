package dev.emcc.plugins.fmv.out.wms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.fmv.out.imagery.ImagerySet;
import dev.emcc.sdk.document.Documents;
import java.net.URI;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

/**
 * The WMS tiles' grid (brief section 10.5 point 17): the documents' keys, the tile sizes, and the
 * GetMap request's axis order in WMS 1.3.0 (owner, 2026-11-17), with a point whose latitude is not
 * its longitude (CLAUDE.md section 4).
 */
class WmsGridTest {

  private static final double LON = 17.3;
  private static final double LAT = 62.4;

  @Test
  void aTilesKeyIsTheBriefsAndPassesTheDocumentsRule() {
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 1.0);
    assertThat(grid.key(1234, 5678)).isEqualTo("wms-tile-cache.3006-1.0-1234-5678");
    assertThat(Documents.checkKey(grid.key(1234, 5678))).startsWith(WmsGrid.PREFIX);
    WmsGrid degrees = new WmsGrid(ImagerySet.Crs.EPSG_4326, 512, 0.25);
    double[] xy = new double[2];
    degrees.project(LON, LAT, xy);
    String key = degrees.tile(degrees.column(xy[0]), degrees.row(xy[1])).key();
    assertThat(key).startsWith("wms-tile-cache.4326-0.25-").doesNotContain("--");
    assertThat(Documents.checkKey(key)).hasSizeLessThanOrEqualTo(128);
    assertThat(new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 10).key(0, 0)).isEqualTo("wms-tile-cache.3006-10.0-0-0");
  }

  @Test
  void aTileIsTilePixelsTimesMetresPerPixelAndHoldsItsPoint() {
    assertThat(new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 2.5).size()).isEqualTo(640);
    assertThat(new WmsGrid(ImagerySet.Crs.EPSG_4326, 512, 1).size()).isCloseTo(512 / 111_320.0, within(1e-15));
    for (WmsGrid grid : new WmsGrid[] {new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 1), new WmsGrid(ImagerySet.Crs.EPSG_4326, 256, 1)}) {
      double[] xy = new double[2];
      grid.project(LON, LAT, xy);
      ImagerySet.TileSpec s = grid.tile(grid.column(xy[0]), grid.row(xy[1])).spec();
      assertThat(xy[0]).isBetween(s.minX(), s.maxX());
      assertThat(xy[1]).isBetween(s.minY(), s.maxY());
      assertThat(s.width()).isEqualTo(256);
      assertThat(grid.column(xy[0])).isPositive();
      assertThat(grid.row(xy[1])).isPositive();
    }
  }

  @Test
  void sweref99TmGoesThereAndBack() {
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 1);
    double[] xy = new double[2];
    double[] back = new double[2];
    grid.project(LON, LAT, xy);
    assertThat(xy[0]).isBetween(500_000.0, 700_000.0); // east of 15° E
    assertThat(xy[1]).isBetween(6_900_000.0, 7_000_000.0);
    grid.unproject(xy[0], xy[1], back);
    assertThat(back[0]).isCloseTo(LON, within(1e-8));
    assertThat(back[1]).isCloseTo(LAT, within(1e-8));
  }

  @Test
  void criterion33GetMapIsWms130WithYFirstInTheBboxForBothCrss() {
    WmsGrid degrees = new WmsGrid(ImagerySet.Crs.EPSG_4326, 256, 1);
    double[] xy = new double[2];
    degrees.project(LON, LAT, xy);
    URI uri = degrees.getMap("https://wms.example/ows", "ortho:2020 colour", "image/jpeg", degrees.tile(degrees.column(xy[0]), degrees.row(xy[1])));
    String q = uri.getRawQuery();
    assertThat(uri.getHost()).isEqualTo("wms.example");
    assertThat(q).contains("SERVICE=WMS", "VERSION=1.3.0", "REQUEST=GetMap", "LAYERS=ortho%3A2020%20colour", "STYLES=", "CRS=EPSG:4326",
        "WIDTH=256", "HEIGHT=256", "FORMAT=image%2Fjpeg");
    double[] b = bbox(q);
    // EPSG:4326 in 1.3.0: latitude first
    assertThat(b[0]).isCloseTo(LAT, within(0.01));
    assertThat(b[1]).isCloseTo(LON, within(0.01));
    assertThat(b[0]).isLessThan(b[2]);
    assertThat(b[1]).isLessThan(b[3]);
    assertThat(LAT).isBetween(b[0], b[2]);
    assertThat(LON).isBetween(b[1], b[3]);

    WmsGrid metres = new WmsGrid(ImagerySet.Crs.EPSG_3006, 512, 0.5);
    metres.project(LON, LAT, xy);
    double[] m = bbox(metres.getMap("http://localhost:8080/geoserver/wms", "ortho", "image/png", metres.tile(metres.column(xy[0]), metres.row(xy[1]))).getRawQuery());
    // EPSG:3006 in 1.3.0: northing first
    assertThat(m[0]).isBetween(6_900_000.0, 7_000_000.0);
    assertThat(m[1]).isBetween(500_000.0, 700_000.0);
    assertThat(m[2] - m[0]).isEqualTo(256.0);
    assertThat(m[3] - m[1]).isEqualTo(256.0);
    assertThat(xy[1]).isBetween(m[0], m[2]);
    assertThat(xy[0]).isBetween(m[1], m[3]);
  }

  private static double[] bbox(String query) {
    String b = Arrays.stream(query.split("&")).filter(p -> p.startsWith("BBOX=")).findFirst().orElseThrow().substring(5);
    assertThat(b).doesNotContain("E"); // plain numbers, no exponent
    return Arrays.stream(b.split(",")).mapToDouble(Double::parseDouble).toArray();
  }
}
