package dev.emcc.plugins.terrain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Bytes;
import java.util.List;
import java.util.function.IntBinaryOperator;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * Criterion 3: DTED cells of levels 0, 1 and 2 written for the test, at 59° N (the longitude interval
 * twice the latitude's), 72° N (three times), 85° S (six times) and south of 50° (equal), each read
 * from its header (the ACA's T1), with their heights at known points; and a bad checksum, a header
 * that does not match the name, intervals that do not match the zone and a void as the brief's
 * function 6 says. Every cell is at a longitude different from its latitude.
 */
class DtedCellTest {

  /** Heights that differ between columns and rows, and are negative in places (sign and magnitude). */
  private static final IntBinaryOperator SLOPES = (column, row) -> (column % 97) * 5 + (row % 53) * 3 - 200;

  static Stream<Arguments> zones() {
    // lon, lat (south-west corner), the zone's factor
    return Stream.of(Arguments.of(18, 59, 2), Arguments.of(-33, 72, 3), Arguments.of(151, -85, 6), Arguments.of(11, -34, 1), Arguments.of(7, 10, 1), Arguments.of(-77, 79, 4));
  }

  @ParameterizedTest(name = "level {0}")
  @MethodSource("levelsOnly")
  void aCellOfEachLevelAtSixtyNorthReadsFromItsHeader(int level) {
    DtedCell cell = DtedFiles.parsed(level, 18, 59, SLOPES);
    assertThat(cell.latIntervalTenths()).isEqualTo(DtedFiles.latInterval(level));
    assertThat(cell.lonIntervalTenths()).isEqualTo(2 * DtedFiles.latInterval(level));
    assertThat(cell.latCount()).isEqualTo(36_000 / DtedFiles.latInterval(level) + 1);
    assertThat(cell.lonCount()).isEqualTo(36_000 / (2 * DtedFiles.latInterval(level)) + 1);
    assertThat(cell.lonCount()).as("not square").isNotEqualTo(cell.latCount());
  }

  static Stream<Integer> levelsOnly() {
    return Stream.of(0, 1, 2);
  }

  @ParameterizedTest(name = "lon {0}, lat {1}: x{2}")
  @MethodSource("zones")
  void theIntervalsFollowTheLatitudeZoneAtEveryLevel(int lon, int lat, int factor) {
    for (int level = 0; level <= 2; level++) {
      if (level == 2 && Math.abs(lat) >= 75) {
        continue; // keeps the test's own data small; the zone rule is the same code
      }
      DtedCell cell = DtedFiles.parsed(level, lon, lat, SLOPES);
      assertThat(cell.lonIntervalTenths()).as("level %d lon interval", level).isEqualTo(factor * cell.latIntervalTenths());
      assertThat(cell.id().zoneFactor()).isEqualTo(factor);
      // heights at known grid points: lat != lon, column != row, a negative one
      for (int[] at : new int[][] {{0, 0}, {cell.lonCount() - 1, cell.latCount() - 1}, {cell.lonCount() / 3, cell.latCount() / 5}, {5, 7}}) {
        assertThat(cell.raw(at[0], at[1])).as("level %d column %d row %d", level, at[0], at[1]).isEqualTo(SLOPES.applyAsInt(at[0], at[1]));
      }
    }
  }

  @Test
  void theZoneTableHasItsEdgesWhereTheStandardPutsThem() {
    assertThat(List.of(0, 49, 50, 69, 70, 74, 75, 79, 80, 89).stream().map(lat -> new CellId(0, 0, lat).zoneFactor()).toList()).containsExactly(1, 1, 2, 2, 3, 3, 4, 4, 6, 6);
    // south: a cell is named by its south-west corner, so s50 reaches 49 to 50 degrees south
    assertThat(List.of(-1, -50, -51, -70, -71, -75, -76, -80, -81, -90).stream().map(lat -> new CellId(0, 0, lat).zoneFactor()).toList()).containsExactly(1, 1, 2, 2, 3, 3, 4, 4, 6, 6);
  }

  @Test
  void aVoidIsNoData() {
    DtedCell cell = DtedFiles.parsed(0, 18, 59, (c, r) -> c == 3 && r == 4 ? DtedFiles.VOID : 10 + c);
    assertThat(cell.raw(3, 4)).isEqualTo(DtedCell.VOID);
    assertThat(cell.raw(3, 5)).isEqualTo(13);
    CellField field = new CellField(List.of(cell));
    double step = 1.0 / (cell.lonCount() - 1);
    double latStep = 1.0 / (cell.latCount() - 1);
    // a position between the void and its neighbours has no height; one far from it has
    assertThat(field.height(18 + 3.5 * step, 59 + 4.5 * latStep)).isNaN();
    assertThat(field.height(18 + 10.5 * step, 59 + 10.5 * latStep)).isCloseTo(20.5, org.assertj.core.data.Offset.offset(1e-6));
  }

  @Test
  void aBadChecksumIsRefused() {
    byte[] bytes = DtedFiles.cell(0, 18, 59, SLOPES);
    int record = 12 + 2 * 121;
    bytes[DtedCell.HEADER_BYTES + 5 * record + 20] ^= 0x01; // one bit of an elevation in record 5
    assertThatThrownBy(() -> DtedCell.parse(new CellId(0, 18, 59), Bytes.of(bytes)))
        .isInstanceOf(DtedException.class)
        .hasMessageContaining("record 5")
        .hasMessageContaining("checksum");
  }

  @Test
  void aHeaderThatDoesNotMatchTheNameIsRefused() {
    byte[] bytes = DtedFiles.cell(0, 18, 59, SLOPES);
    // the file says n59 e018, the name says n60 e017 and e019
    assertThatThrownBy(() -> DtedCell.parse(new CellId(0, 18, 60), Bytes.of(bytes))).isInstanceOf(DtedException.class).hasMessageContaining("origin");
    assertThatThrownBy(() -> DtedCell.parse(new CellId(0, 19, 59), Bytes.of(bytes))).isInstanceOf(DtedException.class).hasMessageContaining("origin");
    // the file is level 1's but the name says level 0
    byte[] levelOne = DtedFiles.cell(1, 18, 59, SLOPES);
    assertThatThrownBy(() -> DtedCell.parse(new CellId(0, 18, 59), Bytes.of(levelOne))).isInstanceOf(DtedException.class).hasMessageContaining("level 0");
  }

  @Test
  void intervalsThatDoNotMatchTheZoneAreRefused() {
    // a square cell at 59 degrees north: the longitude interval equals the latitude interval
    byte[] square = DtedFiles.cell(0, 18, 59, 1, SLOPES);
    assertThatThrownBy(() -> DtedCell.parse(new CellId(0, 18, 59), Bytes.of(square)))
        .isInstanceOf(DtedException.class)
        .hasMessageContaining("2 times");
    // three times the latitude interval at 59 degrees north
    byte[] triple = DtedFiles.cell(0, 18, 59, 3, SLOPES);
    assertThatThrownBy(() -> DtedCell.parse(new CellId(0, 18, 59), Bytes.of(triple))).isInstanceOf(DtedException.class);
    // twice at 34 degrees south, where it must be equal
    byte[] double34 = DtedFiles.cell(0, 11, -34, 2, SLOPES);
    assertThatThrownBy(() -> DtedCell.parse(new CellId(0, 11, -34), Bytes.of(double34))).isInstanceOf(DtedException.class);
  }

  @Test
  void countsThatDoNotCoverTheCellAreRefused() {
    byte[] shortCell = DtedFiles.cell(0, 18, 59, 600, 300, 40, 121, (c, r) -> 1);
    assertThatThrownBy(() -> DtedCell.parse(new CellId(0, 18, 59), Bytes.of(shortCell))).isInstanceOf(DtedException.class).hasMessageContaining("do not cover");
  }

  @Test
  void aTruncatedFileIsRefused() {
    byte[] bytes = DtedFiles.cell(0, 18, 59, SLOPES);
    byte[] cut = java.util.Arrays.copyOf(bytes, bytes.length - 10);
    assertThatThrownBy(() -> DtedCell.parse(new CellId(0, 18, 59), Bytes.of(cut))).isInstanceOf(DtedException.class).hasMessageContaining("bytes");
    assertThatThrownBy(() -> DtedCell.parseHeader(new CellId(0, 18, 59), Bytes.of(java.util.Arrays.copyOf(bytes, 100)), bytes.length)).isInstanceOf(DtedException.class);
  }

  @Test
  void namesAreReadInAnyCaseAndWithWestAndSouth() {
    assertThat(CellId.parse("e017", "n59.dt2")).isEqualTo(new CellId(2, 17, 59));
    assertThat(CellId.parse("W075", "S34.DT1")).isEqualTo(new CellId(1, -75, -34));
    assertThat(CellId.parse("w180", "s90.dt0")).isEqualTo(new CellId(0, -180, -90));
    assertThat(CellId.parse("e180", "n59.dt0")).isNull();
    assertThat(CellId.parse("e017", "n90.dt0")).isNull();
    assertThat(CellId.parse("e017", "n59.dt3")).isNull();
    assertThat(CellId.parse("e17", "n59.dt2")).isNull();
    assertThat(CellId.parse("e017", "n59.tif")).isNull();
    assertThat(new CellId(2, -33, 72).displayName()).isEqualTo("w033/n72.dt2");
  }

  @Test
  void heightsBetweenTheSamplesAreBilinearAtAPointWhereLatitudeDiffersFromLongitude() {
    // a plane: height = 3 * column + 11 * row
    DtedCell cell = DtedFiles.parsed(1, 18, 59, (c, r) -> 3 * c + 11 * r);
    CellField field = new CellField(List.of(cell));
    double lonStep = 1.0 / (cell.lonCount() - 1);
    double latStep = 1.0 / (cell.latCount() - 1);
    // column 40.25, row 100.5: the plane's value there
    assertThat(field.height(18 + 40.25 * lonStep, 59 + 100.5 * latStep)).isCloseTo(3 * 40.25 + 11 * 100.5, org.assertj.core.data.Offset.offset(1e-6));
    // the same numbers swapped would be a different place: 100.5 columns, 40.25 rows
    assertThat(field.height(18 + 100.5 * lonStep, 59 + 40.25 * latStep)).isCloseTo(3 * 100.5 + 11 * 40.25, org.assertj.core.data.Offset.offset(1e-6));
    assertThat(field.height(19.5, 59.5)).as("no cell there").isNaN();
  }

  @Test
  void aPositionOnACellsEdgeIsReadFromTheNeighbourWhenTheCellItselfIsMissing() {
    DtedCell west = DtedFiles.parsed(0, 17, 59, (c, r) -> 7);
    CellField field = new CellField(List.of(west));
    assertThat(field.height(18.0, 59.5)).as("the east edge of e017").isEqualTo(7);
    assertThat(field.height(18.0001, 59.5)).isNaN();
  }
}
