package dev.emcc.plugins.gmti.in;

import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import java.util.ArrayList;
import java.util.List;

/**
 * The fades in steps (brief section 5, from M7 RC2; T-192, CR-0042 option A): the top-level settings
 * {@code detectionFade} and {@code dwellAreaFade}, which {@code gmti.detection}'s and {@code
 * gmti.dwell-area}'s {@code fadeSetting} point to. The map view draws them; {@code gmti} writes nothing
 * for them. The schema checks their form but cannot say that {@code invisibleAtSeconds} is above
 * {@code fromSeconds} (model rule 22): such a value gives no fade in steps, so the plugin names it in
 * its status, where an admin sees it.
 */
public final class Fades {

  /** The settings, in the order the status names them. */
  static final List<String> SETTINGS = List.of("detectionFade", "dwellAreaFade");

  private Fades() {}

  /** One problem an admin can act on for each fade that is on but ends at or before it starts. */
  public static List<String> problems(JsonObject settings) {
    var problems = new ArrayList<String>();
    for (String key : SETTINGS) {
      if (settings.get(key) instanceof JsonObject o && o.get("on") instanceof JsonBoolean on && on.value()
          && o.get("fromSeconds") instanceof JsonNumber from && o.get("invisibleAtSeconds") instanceof JsonNumber invisible
          && invisible.bigDecimalValue().compareTo(from.bigDecimalValue()) <= 0) {
        problems.add(key + ": invisibleAtSeconds " + invisible.text() + " is not above fromSeconds " + from.text() + ", so there is no fade in steps");
      }
    }
    return problems;
  }
}
