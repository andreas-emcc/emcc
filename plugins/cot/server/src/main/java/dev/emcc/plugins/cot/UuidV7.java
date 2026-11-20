package dev.emcc.plugins.cot;

import java.util.UUID;
import java.util.random.RandomGenerator;

/** UUID version 7 (RFC 9562): the time in milliseconds first, then random bits. New objects and layers get one (model rule 3). */
final class UuidV7 {

  private UuidV7() {}

  static UUID next(long epochMillis, RandomGenerator random) {
    long msb = ((epochMillis & 0xFFFF_FFFF_FFFFL) << 16) | 0x7000L | (random.nextLong() & 0x0FFFL);
    long lsb = (random.nextLong() & 0x3FFF_FFFF_FFFF_FFFFL) | 0x8000_0000_0000_0000L;
    return new UUID(msb, lsb);
  }
}
