package dev.emcc.plugins.fmv.ts;

/**
 * The program a link plays: the first in the PAT whose PMT has video (ADR-0057 point 1).
 *
 * @param programNumber the PAT's program number
 * @param pmtPid where its PMT is
 * @param videoPid the first video stream's PID
 * @param video its format
 * @param klvPid the first KLV stream's PID, or {@code -1} when the PMT has none
 */
public record Program(int programNumber, int pmtPid, int videoPid, VideoFormat video, int klvPid) {

  /** Whether the video is the same one: the same PID and type. Another one closes the stream and opens it again. */
  public boolean sameVideoAs(Program other) {
    return videoPid == other.videoPid && video.equals(other.video);
  }
}
