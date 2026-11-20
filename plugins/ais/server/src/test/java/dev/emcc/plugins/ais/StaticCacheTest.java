package dev.emcc.plugins.ais;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.ais.codec.AisClass;
import dev.emcc.plugins.ais.codec.AisStatic;
import org.junit.jupiter.api.Test;

class StaticCacheTest {

  private static AisStatic name(String name) {
    return new AisStatic(name, null, null, null, null, null, null, null, null);
  }

  private static AisStatic type(int shipType) {
    return new AisStatic(null, null, null, shipType, null, null, null, null, AisClass.B);
  }

  @Test
  void whatShipsSayIsMergedByMmsi() {
    var cache = new StaticCache();
    assertThat(cache.put(1, name("ONE"), 0).added()).isTrue();
    assertThat(cache.put(1, type(70), 10).added()).isFalse();
    AisStatic one = cache.get(1);
    assertThat(one.name()).isEqualTo("ONE");
    assertThat(one.shipType()).isEqualTo(70);
    assertThat(one.cls()).isEqualTo(AisClass.B);
    assertThat(cache.get(2)).isNull();
  }

  @Test
  void aShipIsForgottenAnHourAfterItsLastMessage() {
    var cache = new StaticCache();
    cache.put(1, name("OLD"), 0);
    cache.put(2, name("NEW"), 1_000);
    cache.put(1, name("OLD"), 2_000); // heard again: now the newest
    assertThat(cache.expire(StaticCache.KEEP_MILLIS + 1_000)).isEqualTo(1); // ship 2
    assertThat(cache.get(2)).isNull();
    assertThat(cache.get(1)).isNotNull();
    assertThat(cache.expire(StaticCache.KEEP_MILLIS + 2_000)).isEqualTo(1);
    assertThat(cache.size()).isZero();
  }

  @Test
  void whenFullTheShipSilentLongestGoesFirst() {
    var cache = new StaticCache();
    for (int i = 1; i <= StaticCache.MAX_SHIPS; i++) {
      cache.put(i, name("S" + i), i);
    }
    cache.put(1, name("S1"), 100_000); // ship 1 is now the newest; ship 2 the oldest
    StaticCache.Put put = cache.put(StaticCache.MAX_SHIPS + 1, name("NEW"), 100_001);
    assertThat(put.added()).isTrue();
    assertThat(put.forgotten()).isEqualTo(1);
    assertThat(cache.size()).isEqualTo(StaticCache.MAX_SHIPS);
    assertThat(cache.get(2)).isNull();
    assertThat(cache.get(1)).isNotNull();
  }
}
