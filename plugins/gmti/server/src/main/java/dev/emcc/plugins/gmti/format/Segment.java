package dev.emcc.plugins.gmti.format;

import dev.emcc.sdk.Message;

/**
 * One segment of a packet, in the order received (AEDP 3.2). The segments this plugin reads have a
 * record each; every other type is {@link Skipped}.
 *
 * <p>It extends {@link Message} only so that a {@link Packet} may travel inside a message: rule C3
 * allows the plugin's own sealed message interfaces as components.
 */
public sealed interface Segment extends Message permits Mission, Dwell, JobDefinition, PlatformLocation, FreeText, Skipped {

  /** {@code S1}, the segment type (Table 3-6). */
  int type();

  /** Mission. */
  int MISSION = 1;
  /** Dwell. */
  int DWELL = 2;
  /** Job definition. */
  int JOB_DEFINITION = 5;
  /** Free text. */
  int FREE_TEXT = 6;
  /** Platform location. */
  int PLATFORM_LOCATION = 13;
}
