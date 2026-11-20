package dev.emcc.plugins.fmv.out;

import java.time.Instant;
import java.util.Objects;
import java.util.Set;
import org.jspecify.annotations.Nullable;

/**
 * One simulated camera's pose for one frame: the payload of the channel kind {@code
 * fmv.camera-pose} (brief section 10.1; the {@code uav-simulation} brief's section 4). ECore checks
 * each pose against the kind's schema at {@code send} (PQ2 A); this record checks the same ranges
 * again, so that a pose made in a test cannot be one the schema refuses.
 *
 * @param camera the camera's id (a UUID)
 * @param time the frame's time
 * @param platform where the platform is and how it lies
 * @param pointing where the camera looks, relative to the platform
 * @param horizontalFov the horizontal field of view, 0.1° to 120°
 * @param verticalFov the vertical field of view, above 0° to 120°
 * @param width the frame's width: 640, 1280 or 1920
 * @param height the frame's height: 360, 720 or 1080, with its width
 * @param rate frames a second, 1 to 30
 * @param mission the mission's name, 1 to 64 characters, or {@code null}
 */
public record Pose(
    String camera,
    Instant time,
    Platform platform,
    Pointing pointing,
    double horizontalFov,
    double verticalFov,
    int width,
    int height,
    int rate,
    @Nullable String mission) {

  private static final Set<String> SIZES = Set.of("640x360", "1280x720", "1920x1080");

  /**
   * @param lon the platform's longitude, −180 to 180
   * @param lat its latitude, −90 to 90
   * @param height its height, −1 000 to 20 000 m HAE
   * @param heading 0 to below 360, clockwise from true north
   * @param pitch −90 to 90, positive nose up
   * @param roll −180 to 180, positive right wing down
   * @param name the platform's name, 1 to 256 characters, or {@code null}
   */
  public record Platform(double lon, double lat, double height, double heading, double pitch, double roll, @Nullable String name) {
    public Platform {
      check(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90, "the position");
      check(height >= -1000 && height <= 20_000, "platform.position's height");
      check(heading >= 0 && heading < 360, "platform.heading");
      check(pitch >= -90 && pitch <= 90, "platform.pitch");
      check(roll >= -180 && roll <= 180, "platform.roll");
      check(name == null || (!name.isEmpty() && name.length() <= 256), "platform.name");
    }
  }

  /**
   * @param azimuth 0 to below 360, relative to the platform's heading, clockwise
   * @param depression −90 to 90, positive down (ST 0601's tag 19 is −depression, section 10.1 point 2)
   * @param roll −180 to 180
   */
  public record Pointing(double azimuth, double depression, double roll) {
    public Pointing {
      check(azimuth >= 0 && azimuth < 360, "pointing.azimuth");
      check(depression >= -90 && depression <= 90, "pointing.depression");
      check(roll >= -180 && roll <= 180, "pointing.roll");
    }
  }

  public Pose {
    Objects.requireNonNull(camera, "camera");
    Objects.requireNonNull(time, "time");
    Objects.requireNonNull(platform, "platform");
    Objects.requireNonNull(pointing, "pointing");
    check(horizontalFov >= 0.1 && horizontalFov <= 120, "fieldOfView.horizontal");
    check(verticalFov > 0 && verticalFov <= 120, "fieldOfView.vertical");
    check(SIZES.contains(width + "x" + height), "frame's width and height");
    check(rate >= 1 && rate <= 30, "frame.rate");
    check(mission == null || (!mission.isEmpty() && mission.length() <= 64), "mission");
  }

  private static void check(boolean ok, String what) {
    if (!ok) {
      throw new IllegalArgumentException("a pose's " + what + " is out of range");
    }
  }
}
