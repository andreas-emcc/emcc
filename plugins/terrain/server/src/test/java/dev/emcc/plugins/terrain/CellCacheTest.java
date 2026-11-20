package dev.emcc.plugins.terrain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.function.IntBinaryOperator;
import org.junit.jupiter.api.Test;

/** Criterion 10, the cache's part: it never holds more than {@code cacheMegabytes}, and the least recently used go first. */
class CellCacheTest {

  private static final IntBinaryOperator FLAT = (c, r) -> 3;

  private static DtedCell cell(int lon, int lat) {
    return DtedFiles.parsed(0, lon, lat, FLAT);
  }

  @Test
  void itNeverHoldsMoreThanItsLimitAndTheLeastRecentlyUsedGoFirst() {
    long size = cell(10, 50).data().size();
    CellCache cache = new CellCache(size * 2 + size / 2); // room for two cells and a half
    DtedCell a = cell(10, 50);
    DtedCell b = cell(11, 50);
    DtedCell c = cell(12, 50);
    cache.put(a);
    cache.put(b);
    assertThat(cache.get(a.id().key())).as("a becomes the most recently used").isSameAs(a);
    cache.put(c);
    assertThat(cache.bytes()).isLessThanOrEqualTo(size * 2 + size / 2);
    assertThat(cache.get(b.id().key())).as("b was the least recently used").isNull();
    assertThat(cache.get(a.id().key())).isSameAs(a);
    assertThat(cache.get(c.id().key())).isSameAs(c);
    assertThat(cache.size()).isEqualTo(2);
  }

  @Test
  void aLowerLimitEvictsAtOnceAndACellLargerThanTheLimitIsNotKept() {
    CellCache cache = new CellCache(10_000_000);
    for (int lon = 0; lon < 5; lon++) {
      cache.put(cell(lon, 40));
    }
    long size = cell(0, 40).data().size();
    assertThat(cache.size()).isEqualTo(5);
    cache.setLimit(size * 2);
    assertThat(cache.size()).isEqualTo(2);
    assertThat(cache.bytes()).isLessThanOrEqualTo(size * 2);
    cache.setLimit(size / 2);
    cache.put(cell(9, 40));
    assertThat(cache.size()).isZero();
    assertThat(cache.bytes()).isZero();
    cache.clear();
    assertThat(cache.size()).isZero();
  }

  @Test
  void aCellPutTwiceIsHeldOnce() {
    CellCache cache = new CellCache(10_000_000);
    cache.put(cell(10, 50));
    long once = cache.bytes();
    cache.put(cell(10, 50));
    assertThat(cache.bytes()).isEqualTo(once);
    assertThat(cache.size()).isEqualTo(1);
  }
}
