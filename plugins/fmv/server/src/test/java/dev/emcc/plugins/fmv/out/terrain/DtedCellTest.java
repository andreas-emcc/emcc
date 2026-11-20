package dev.emcc.plugins.fmv.out.terrain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import org.junit.jupiter.api.Test;

/** The DTED reader (brief section 10.5 point 16): headers, heights, voids and refusals. */
class DtedCellTest {

  /** A plane rising 1 m per post eastwards and 2 m per post northwards, from 100 m. */
  private static int plane(int i, int j) {
    return 100 + i + 2 * j;
  }

  @Test
  void readsACellAndInterpolatesBetweenPosts() throws Exception {
    DtedCell cell = DtedCell.parse(DtedFiles.cell(17, 62, 121, DtedCellTest::plane));
    assertThat(cell.key()).isEqualTo(new CellKey(17, 62));
    assertThat(cell.lonLines()).isEqualTo(121);
    // a post: 30 posts east (17.25°), 60 north (62.5°)
    assertThat(cell.height(17.25, 62.5)).isCloseTo(100 + 30 + 120, within(1e-6));
    // half way between posts, bilinear: a plane stays a plane
    double lon = 17 + 30.5 / 120;
    double lat = 62 + 60.25 / 120;
    assertThat(cell.height(lon, lat)).isCloseTo(100 + 30.5 + 2 * 60.25, within(1e-6));
    // the edges are inside, the outside is not
    assertThat(cell.height(18, 63)).isCloseTo(100 + 120 + 240, within(1e-6));
    assertThat(cell.height(16.999, 62.5)).isNaN();
    assertThat(cell.height(17.5, 63.001)).isNaN();
  }

  @Test
  void aVoidLeavesItsSurroundingsWithoutAHeight() throws Exception {
    DtedCell cell = DtedCell.parse(DtedFiles.cell(-71, -34, 121, (i, j) -> i == 10 && j == 10 ? -32767 : -5));
    assertThat(cell.key()).isEqualTo(new CellKey(-71, -34));
    assertThat(cell.height(-71 + 10.5 / 120, -34 + 10.5 / 120)).isNaN();
    assertThat(cell.height(-71 + 20.5 / 120, -34 + 20.5 / 120)).isCloseTo(-5, within(1e-9));
  }

  @Test
  void refusesWhatIsNotACell() {
    byte[] good = DtedFiles.cell(17, 62, 121, DtedCellTest::plane);
    byte[] badSum = good.clone();
    badSum[DtedCell.HEADER + 8 + 40] ^= 1; // one height changed, its record's checksum not
    assertThatThrownBy(() -> DtedCell.parse(badSum)).hasMessageContaining("checksum");
    byte[] shortFile = java.util.Arrays.copyOf(good, good.length - 1);
    assertThatThrownBy(() -> DtedCell.parse(shortFile)).hasMessageContaining("length");
    byte[] noUhl = good.clone();
    noUhl[0] = 'X';
    assertThatThrownBy(() -> DtedCell.parse(noUhl)).hasMessageContaining("UHL");
    assertThatThrownBy(() -> DtedCell.parse(new byte[100])).hasMessageContaining("shorter");
  }

  @Test
  void terrainFindsTheCellOfAPointAndHasNoHeightElsewhere() throws Exception {
    Terrain t = new Terrain();
    t.put(DtedCell.parse(DtedFiles.cell(17, 62, 121, DtedCellTest::plane)));
    assertThat(t.height(17.25, 62.5)).isCloseTo(250, within(1e-6));
    assertThat(t.height(18.25, 62.5)).isNaN();
    assertThat(t.height(17.25, 62.5)).isCloseTo(250, within(1e-6)); // back to the cached cell
    t.remove(new CellKey(17, 62));
    assertThat(t.height(17.25, 62.5)).isNaN();
  }

  @Test
  void cellPathsFollowTheFoldersLayout() {
    assertThat(new CellKey(17, 62).path(2)).isEqualTo("e017/n62.dt2");
    assertThat(new CellKey(-71, -34).path(0)).isEqualTo("w071/s34.dt0");
    assertThat(CellKey.containing(17.9, 62.1)).isEqualTo(new CellKey(17, 62));
    assertThat(CellKey.containing(-70.1, -33.9)).isEqualTo(new CellKey(-71, -34));
  }
}
