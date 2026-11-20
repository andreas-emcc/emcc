package dev.emcc.plugins.uavsimulation.pose;

import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * One frame's pose (brief function 4). Its field names, types and JSON on the channel are brief
 * section 4's, with the PDA's D8; this record is the content.
 *
 * @param cameraId the camera's id ({@code fmv} keeps the newest pose per camera)
 * @param time the frame's time, UTC, on ECore's clock
 * @param position the camera's position: the platform's, extrapolated to {@code time}, its altitude the
 *     camera's height (metres HAE)
 * @param heading the platform's heading, degrees from true north
 * @param pitch the platform's pitch: 0, the simulator flies level
 * @param roll the platform's roll: 0
 * @param aim the camera's azimuth relative to the heading and its depression
 * @param cameraRoll the camera's roll: 0
 * @param horizontalFov the horizontal field of view, degrees
 * @param verticalFov the vertical field of view, degrees, from the frame
 * @param frame the frame's size and rate
 * @param platformName the platform's name, or {@code null}
 * @param mission the camera's Mission, empty for none
 * @param label the platform's security label, as stored
 */
public record Pose(
    String cameraId,
    Instant time,
    Position position,
    double heading,
    double pitch,
    double roll,
    Aim aim,
    double cameraRoll,
    double horizontalFov,
    double verticalFov,
    Frame frame,
    @Nullable String platformName,
    String mission,
    SecurityLabel label) {

  public Pose {
    Objects.requireNonNull(cameraId, "cameraId");
    Objects.requireNonNull(time, "time");
    Objects.requireNonNull(position.altitude(), "the pose's position needs the camera's height");
    Objects.requireNonNull(aim, "aim");
    Objects.requireNonNull(frame, "frame");
    Objects.requireNonNull(mission, "mission");
    Objects.requireNonNull(label, "label");
  }

  /**
   * A camera's settings as far as the pose needs them (brief section 5).
   *
   * @param pointing the pointing mode with its values
   * @param horizontalFov the horizontal field of view, degrees
   * @param frame the frame's size and rate
   * @param height the camera's height where the platform has no altitude, metres HAE
   * @param mission the Mission, empty for none
   */
  public record Setup(Pointing pointing, double horizontalFov, Frame frame, double height, String mission) {
    public Setup {
      Objects.requireNonNull(pointing, "pointing");
      Objects.requireNonNull(frame, "frame");
      Objects.requireNonNull(mission, "mission");
      FieldOfView.vertical(horizontalFov, frame); // refuses a field of view the geometry cannot use
      if (!Double.isFinite(height)) {
        throw new IllegalArgumentException("height must be finite: " + height);
      }
    }
  }

  /**
   * The pose of one frame, with what the status and the panel need to know about it.
   *
   * @param pose the pose
   * @param held whether the platform's extrapolation stopped at {@link Fix#MAX_EXTRAPOLATION}
   * @param targetGone whether Track an object's target is gone and the last aim was kept (U7)
   */
  public record Computed(Pose pose, boolean held, boolean targetGone) {}

  /**
   * The pose at {@code time} (brief functions 3 to 6).
   *
   * @param cameraId the camera's id
   * @param setup the camera's settings
   * @param platform the platform's last update, name and label
   * @param target Track an object: the target's last update, or {@code null} when it is gone; else ignored
   * @param time the frame time
   * @param sinceStart the time since the camera started (the sweep's phase)
   * @param last the previous frame's aim, or {@code null}
   */
  public static Computed at(String cameraId, Setup setup, Platform platform, @Nullable Fix target, Instant time, Duration sinceStart, @Nullable Aim last) {
    Fix.Extrapolated moved = platform.fix().at(time);
    Position p = moved.position();
    double height = p.altitude() != null ? p.altitude() : setup.height();
    Position camera = Position.of(p.longitude(), p.latitude(), height);
    double heading = platform.fix().heading();
    Gimbal.Pointed pointed = Gimbal.point(setup.pointing(), camera, heading, time, sinceStart, target, last);
    Pose pose = new Pose(cameraId, time, camera, heading, 0, 0, pointed.aim(), 0, setup.horizontalFov(),
        FieldOfView.vertical(setup.horizontalFov(), setup.frame()), setup.frame(), platform.name(), setup.mission(), platform.label());
    return new Computed(pose, moved.held(), pointed.targetGone());
  }
}
