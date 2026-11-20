package dev.emcc.sdk.store;

import dev.emcc.sdk.model.Position;
import java.util.List;
import java.util.Objects;

/**
 * An area of interest (spike S3, recommendation 1), the same shape as the web SDK's viewport
 * area: a closed lon/lat ring with geodesic edges, a position on its inside, and a margin the
 * server adds around it. It is never a lon/lat box, so it works at the poles and across the
 * antimeridian. An object matches when its bound reaches into the ring grown by the margin.
 *
 * <pre>{@code
 * Area area = Area.of(ring, centre).withMargin(new Area.Margin.Share(0.5));
 * store.query(ObjectQuery.all().within(area), Duration.ofSeconds(10), self, Found::new);
 * }</pre>
 *
 * @param ring at least 4 positions, the first equal to the last; edges are the shorter geodesic (model rule 10)
 * @param inside a position inside the ring; it decides which side of the ring is meant (around a pole, both sides are closed regions)
 * @param margin how far around the ring the area reaches
 */
public record Area(List<Position> ring, Position inside, Margin margin) {

  public Area {
    ring = List.copyOf(ring);
    Objects.requireNonNull(inside, "inside");
    Objects.requireNonNull(margin, "margin");
    if (ring.size() < 4) {
      throw new IllegalArgumentException("a ring has at least 4 positions: " + ring.size());
    }
    if (!ring.getFirst().equals(ring.getLast())) {
      throw new IllegalArgumentException("a ring is closed: the first and last positions are equal (model rule 1)");
    }
  }

  /** An area without a margin. */
  public static Area of(List<Position> ring, Position inside) {
    return new Area(ring, inside, new Margin.None());
  }

  public Area withMargin(Margin value) {
    return new Area(ring, inside, value);
  }

  /**
   * The margin around the ring, added by the server.
   *
   * <pre>{@code
   * new Area.Margin.Metres(5_000)   // 5 km
   * new Area.Margin.Share(0.5)      // half the greatest distance from inside to the ring (S3: half the screen's half diagonal)
   * }</pre>
   */
  public sealed interface Margin permits Margin.None, Margin.Metres, Margin.Share {

    /** No margin. */
    record None() implements Margin {}

    /** A distance in geodesic metres, 0 to 20 000 km. */
    record Metres(double value) implements Margin {
      public Metres {
        if (!(value >= 0 && value <= 20_000_000)) {
          throw new IllegalArgumentException("margin must be 0..20 000 km: " + value);
        }
      }
    }

    /** A share of the greatest distance from {@code inside} to the ring, 0 to 10. */
    record Share(double value) implements Margin {
      public Share {
        if (!(value >= 0 && value <= 10)) {
          throw new IllegalArgumentException("margin share must be 0..10: " + value);
        }
      }
    }
  }
}
