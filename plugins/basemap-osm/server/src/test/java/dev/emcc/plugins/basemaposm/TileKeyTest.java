package dev.emcc.plugins.basemaposm;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class TileKeyTest {

  @Test
  void keepsZoomColumnAndRowApart() {
    // column 17 and row 9 differ, so a swap would show
    assertThat(TileKey.parse("5", "17", "9", 19)).isEqualTo(new TileKey(5, 17, 9));
  }

  @Test
  void acceptsTheFirstAndLastTileOfEveryZoomAndNothingBeyond() {
    for (int z = 0; z <= 19; z++) {
      int last = (1 << z) - 1;
      assertThat(TileKey.parse(Integer.toString(z), "0", "0", 19)).isNotNull();
      assertThat(TileKey.parse(Integer.toString(z), Integer.toString(last), Integer.toString(last), 19)).isNotNull();
      assertThat(TileKey.parse(Integer.toString(z), Integer.toString(last + 1), "0", 19)).isNull();
      assertThat(TileKey.parse(Integer.toString(z), "0", Integer.toString(last + 1), 19)).isNull();
    }
  }

  @Test
  void rejectsWhatIsNotAnAsciiNumber() {
    assertThat(TileKey.parse(null, "0", "0", 19)).isNull();
    assertThat(TileKey.parse("0", null, "0", 19)).isNull();
    assertThat(TileKey.parse("0", "0", null, 19)).isNull();
    assertThat(TileKey.parse("", "0", "0", 19)).isNull();
    assertThat(TileKey.parse("1", "-0", "0", 19)).isNull();
    assertThat(TileKey.parse("1", " 0", "0", 19)).isNull();
    assertThat(TileKey.parse("1", "١", "0", 19)).isNull(); // an Arabic-Indic digit
    assertThat(TileKey.parse("123", "0", "0", 19)).isNull();
    assertThat(TileKey.parse("5", "123456789", "0", 19)).isNull();
  }

  @Test
  void respectsAMaxZoomBelow19() {
    assertThat(TileKey.parse("5", "0", "0", 5)).isNotNull();
    assertThat(TileKey.parse("6", "0", "0", 5)).isNull();
  }
}
