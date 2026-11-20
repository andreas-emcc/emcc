package dev.emcc.plugins.terrain;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.json.JsonArray;

/**
 * A compute worker's answer to {@link ComputeMsg.Run}.
 *
 * @param requestId the request it answers
 * @param outcome how it ended
 * @param areas the areas as JSON (see {@code Areas.Fitted}), empty unless {@code DONE}
 * @param simplified how many times the tolerance was doubled to fit the overlay's caps
 * @param leftOut how many of the smallest areas were left out to fit
 * @param partlyWithoutData whether some ground within the range had no height data
 * @param positions the positions in all rings
 */
record Computed(long requestId, Outcome outcome, JsonArray areas, int simplified, int leftOut, boolean partlyWithoutData, int positions) implements Message {

  /** How a computation ended. */
  enum Outcome {
    DONE,
    TIMED_OUT,
    NO_OBSERVER_DATA
  }
}
