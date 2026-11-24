package dev.emcc.plugins.uavsimulation;

import dev.emcc.plugins.uavsimulation.pose.Pose;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;

/**
 * A pose as the payload of {@code fmv.camera-pose} (brief section 4; CR-0048 point 4). The label goes
 * with the channel item, not in the payload. Until SDK 1.9.0's send exists, it is kept as each camera's
 * latest pose (Q4 A).
 *
 * <p>{@code overlay} goes in every pose, {@code true} or {@code false} (CR-0055 point 2): it is the
 * camera's setting, not the geometry's, so the caller gives it beside the pose.
 */
final class PoseJson {

  /** ISO 8601 UTC with milliseconds, e.g. {@code 2026-11-16T10:15:30.040Z}. */
  private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(java.time.ZoneOffset.UTC);

  private PoseJson() {}

  static JsonObject of(Pose pose, boolean overlay) {
    var platform = JsonObject.builder()
        .put("position", JsonArray.of(
            JsonNumber.of(pose.position().longitude()), JsonNumber.of(pose.position().latitude()), JsonNumber.of(pose.position().altitude())))
        .put("heading", JsonNumber.of(pose.heading()))
        .put("pitch", JsonNumber.of(pose.pitch()))
        .put("roll", JsonNumber.of(pose.roll()));
    if (pose.platformName() != null) {
      platform.put("name", JsonString.of(pose.platformName()));
    }
    var b = JsonObject.builder()
        .put("camera", JsonString.of(pose.cameraId()))
        .put("time", JsonString.of(TIME.format(pose.time().truncatedTo(ChronoUnit.MILLIS))))
        .put("platform", platform.build())
        .put("pointing", JsonObject.builder()
            .put("azimuth", JsonNumber.of(pose.aim().azimuth()))
            .put("depression", JsonNumber.of(pose.aim().depression()))
            .put("roll", JsonNumber.of(pose.cameraRoll()))
            .build())
        .put("fieldOfView", JsonObject.builder()
            .put("horizontal", JsonNumber.of(pose.horizontalFov()))
            .put("vertical", JsonNumber.of(pose.verticalFov()))
            .build())
        .put("frame", JsonObject.builder()
            .put("width", JsonNumber.of(pose.frame().width()))
            .put("height", JsonNumber.of(pose.frame().height()))
            .put("rate", JsonNumber.of(pose.frame().rate()))
            .build());
    if (!pose.mission().isEmpty()) {
      b.put("mission", JsonString.of(pose.mission()));
    }
    b.put("overlay", JsonBoolean.of(overlay));
    return b.build();
  }
}
