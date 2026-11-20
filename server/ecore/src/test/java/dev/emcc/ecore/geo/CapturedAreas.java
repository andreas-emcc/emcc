package dev.emcc.ecore.geo;

import dev.emcc.sdk.model.Position;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/** Areas captured from a real browser, for the tests and measurements. */
public final class CapturedAreas {

  private CapturedAreas() {}

  /**
   * The area map-view-2d sent at its widest zoom (criterion 22; `criterion22-area.txt`): 216
   * positions round the world between 13 S and 84 N, inside (15, 62), margin share 0.5.
   */
  public static GeoArea criterion22View() {
    List<Position> ring = new ArrayList<>();
    try (BufferedReader in = new BufferedReader(new InputStreamReader(
        Objects.requireNonNull(CapturedAreas.class.getResourceAsStream("criterion22-area.txt")), StandardCharsets.UTF_8))) {
      for (String line = in.readLine(); line != null; line = in.readLine()) {
        if (!line.isBlank() && !line.startsWith("#")) {
          String[] lonLat = line.trim().split(" ");
          ring.add(Position.of(Double.parseDouble(lonLat[0]), Double.parseDouble(lonLat[1])));
        }
      }
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
    return new GeoArea(ring, Position.of(15, 62), 0, 0.5);
  }
}
