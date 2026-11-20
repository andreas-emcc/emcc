package dev.emcc.plugins.cot.codec;

import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * The team and role of a TAK unit: the {@code __group} child of an event's {@code <detail>}, read
 * from the parsed document (brief function 16). They are the declared fields {@code team} and {@code role} of the plugin's
 * manifest, whose choices are TAK's own strings; a value outside the choices is not taken over (it
 * stays in the raw {@code detail}).
 *
 * @param name {@code @name}: the team colour, or {@code null}
 * @param role {@code @role}: the role in the team, or {@code null}
 */
public record CotGroup(@Nullable String name, @Nullable String role) {

  /** TAK's team colours, as the manifest's {@code team} field lists them. */
  public static final List<String> TEAMS = List.of("White", "Yellow", "Orange", "Magenta", "Red", "Maroon", "Purple", "Dark Blue", "Blue",
      "Cyan", "Teal", "Green", "Dark Green", "Brown");

  /** TAK's roles, as the manifest's {@code role} field lists them. */
  public static final List<String> ROLES = List.of("Team Member", "Team Lead", "HQ", "Sniper", "Medic", "Forward Observer", "RTO", "K9");

  /**
   * The group of an event whose {@code detail/__group} has these attributes: each only if it is one
   * of TAK's own values; {@code null} if neither is. The parser has resolved the attributes (an
   * entity in a value gives a text that is not one of the choices).
   */
  public static @Nullable CotGroup of(@Nullable String name, @Nullable String role) {
    String team = name != null && TEAMS.contains(name) ? name : null;
    String member = role != null && ROLES.contains(role) ? role : null;
    return team == null && member == null ? null : new CotGroup(team, member);
  }
}
