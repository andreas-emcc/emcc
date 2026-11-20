package dev.emcc.plugins.terrain;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.json.JsonArray;
import java.util.List;

/**
 * A compute worker's answer to {@link ComputeMsg.RunMap}.
 *
 * @param requestId the request it answers
 * @param outcome how it ended
 * @param bands per band, from the lowest, its areas as JSON (see {@code Areas.fitBands}); one band for a flat circle, empty unless {@code DONE}
 * @param lowest the lowest ground inside the circle, metres
 * @param highest the highest ground inside the circle, metres
 * @param highestPosition where the highest ground is, {@code [lon, lat]}
 * @param simplified how many times the tolerance was doubled to fit the overlay's caps
 * @param leftOut how many of the smallest areas were left out to fit
 * @param partlyWithoutData whether some ground inside the circle had no height data
 * @param positions the positions in all rings
 */
record MapComputed(long requestId, Outcome outcome, List<JsonArray> bands, double lowest, double highest, JsonArray highestPosition, int simplified, int leftOut, boolean partlyWithoutData,
    int positions) implements Message {

  MapComputed {
    bands = List.copyOf(bands); // a message is immutable: the plugin test kit refuses a mutable list
  }

  /** How a computation ended. */
  enum Outcome {
    DONE,
    TIMED_OUT,
    /** No ground inside the circle has height data. */
    NO_DATA
  }

  /** An answer without a result. */
  static MapComputed of(long requestId, Outcome outcome) {
    return new MapComputed(requestId, outcome, List.of(), 0, 0, new JsonArray(List.of()), 0, 0, false, 0);
  }
}
