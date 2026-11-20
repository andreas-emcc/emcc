package dev.emcc.ecore.plugin;

import dev.emcc.sdk.stream.Streams;
import java.util.Arrays;

/**
 * Reads a converter's output, an MPEG transport stream, as untrusted bytes (SDK 1.8.0 part E,
 * CR-0044 E2; T-211, owner C5): it finds the 188-byte packets (a lost sync is found again at the
 * next {@code 0x47} that the packet after it confirms), keeps the latest PAT and PMT as the stream's
 * header, and cuts the packets into chunks of at most {@link Streams#MAX_CHUNK}, a new one beginning
 * at each packet of the video PID that carries the random access indicator, which is a start point.
 * Not thread-safe: one reader thread feeds it.
 */
final class TsOutput {

  /** Where the packets go. */
  interface Sink {
    /** The PAT and PMT packets, when they changed. */
    void header(byte[] header);

    /** A run of whole packets; {@code startPoint} when it begins at a video random access point. */
    void chunk(byte[] data, boolean startPoint);
  }

  static final int PACKET = 188;
  private static final int SYNC = 0x47;
  /** The most packets in a chunk: under {@link Streams#MAX_CHUNK}. */
  private static final int CHUNK_PACKETS = Streams.MAX_CHUNK / PACKET;
  /** Video stream types in a PMT: MPEG-2, H.264, H.265. */
  private static final int[] VIDEO_TYPES = {0x02, 0x1b, 0x24};

  private final Sink sink;
  private final byte[] pending = new byte[Streams.MAX_CHUNK + PACKET * 2];
  private int pendingLength;
  private final byte[] chunk = new byte[CHUNK_PACKETS * PACKET];
  private int chunkLength;
  private boolean chunkStart;
  private int pmtPid = -1;
  private int videoPid = -1;
  private byte[] pat = new byte[0];
  private byte[] pmt = new byte[0];
  private byte[] header = new byte[0];
  private long lostSyncs;

  TsOutput(Sink sink) {
    this.sink = sink;
  }

  /** How often the sync was lost and found again (the monitor's detail). */
  long lostSyncs() {
    return lostSyncs;
  }

  /** The next {@code length} bytes of {@code data}; whole packets go on, the rest waits for more. */
  void accept(byte[] data, int length) {
    int at = 0;
    while (at < length) {
      int take = Math.min(pending.length - pendingLength, length - at);
      System.arraycopy(data, at, pending, pendingLength, take);
      pendingLength += take;
      at += take;
      pendingLength = drain(pending, pendingLength);
    }
    flush();
  }

  /**
   * Takes the whole packets at the front of {@code buf}, each confirmed by the sync byte of the packet
   * after it (the last one waits for its follower); returns how many bytes are left at its front.
   */
  private int drain(byte[] buf, int length) {
    int at = 0;
    while (length - at >= PACKET * 2) {
      if (buf[at] == SYNC && buf[at + PACKET] == SYNC) {
        packet(buf, at);
        at += PACKET;
      } else {
        lostSyncs++;
        at = nextSync(buf, at + 1, length);
      }
    }
    int left = length - at;
    System.arraycopy(buf, at, buf, 0, left);
    return left;
  }

  private static int nextSync(byte[] data, int from, int length) {
    for (int i = from; i < length; i++) {
      if (data[i] == SYNC) {
        return i;
      }
    }
    return length;
  }

  private void packet(byte[] data, int at) {
    int pid = ((data[at + 1] & 0x1f) << 8) | (data[at + 2] & 0xff);
    boolean start = (data[at + 1] & 0x40) != 0;
    int control = (data[at + 3] >> 4) & 3;
    int payload = at + 4;
    boolean randomAccess = false;
    if ((control & 2) != 0) {
      int adaptation = data[at + 4] & 0xff;
      if (adaptation > 183) {
        return; // malformed: dropped
      }
      randomAccess = adaptation > 0 && (data[at + 5] & 0x40) != 0;
      payload += 1 + adaptation;
    }
    if (pid == 0 && start && (control & 1) != 0) {
      readPat(data, at, payload);
    } else if (pid == pmtPid && start && (control & 1) != 0) {
      readPmt(data, at, payload);
    }
    if (pid == videoPid && randomAccess && chunkLength > 0) {
      flush();
    }
    if (chunkLength == 0) {
      chunkStart = pid == videoPid && randomAccess;
    }
    System.arraycopy(data, at, chunk, chunkLength, PACKET);
    chunkLength += PACKET;
    if (chunkLength == chunk.length) {
      flush();
    }
  }

  private void readPat(byte[] data, int at, int payload) {
    int p = section(data, at, payload);
    if (p < 0 || p + 12 > at + PACKET) {
      return;
    }
    int sectionLength = ((data[p + 1] & 0x0f) << 8) | (data[p + 2] & 0xff);
    int end = Math.min(p + 3 + sectionLength - 4, at + PACKET);
    int found = -1;
    for (int q = p + 8; q + 4 <= end; q += 4) { // the first program that is not 0 (0 names the NIT)
      int program = ((data[q] & 0xff) << 8) | (data[q + 1] & 0xff);
      if (program != 0) {
        found = ((data[q + 2] & 0x1f) << 8) | (data[q + 3] & 0xff);
        break;
      }
    }
    if (found < 0) {
      return;
    }
    if (found != pmtPid) { // another PMT: the old one and its video PID no longer hold
      pmtPid = found;
      pmt = new byte[0];
      videoPid = -1;
    }
    pat = Arrays.copyOfRange(data, at, at + PACKET);
    newHeader();
  }

  private void readPmt(byte[] data, int at, int payload) {
    int p = section(data, at, payload);
    if (p < 0 || p + 12 > at + PACKET) {
      return;
    }
    int sectionLength = ((data[p + 1] & 0x0f) << 8) | (data[p + 2] & 0xff);
    int programInfo = ((data[p + 10] & 0x0f) << 8) | (data[p + 11] & 0xff);
    int end = Math.min(p + 3 + sectionLength - 4, at + PACKET);
    int found = -1;
    for (int q = p + 12 + programInfo; q + 5 <= end; ) {
      int type = data[q] & 0xff;
      int pid = ((data[q + 1] & 0x1f) << 8) | (data[q + 2] & 0xff);
      int info = ((data[q + 3] & 0x0f) << 8) | (data[q + 4] & 0xff);
      if (Arrays.stream(VIDEO_TYPES).anyMatch(t -> t == type)) {
        found = pid;
        break;
      }
      q += 5 + info;
    }
    videoPid = found; // this PMT's, or none: no start points without video
    if (found < 0) {
      return; // no header without a video stream to start from
    }
    pmt = Arrays.copyOfRange(data, at, at + PACKET);
    newHeader();
  }

  /** Where a section begins after its pointer field, or -1. */
  private static int section(byte[] data, int at, int payload) {
    if (payload >= at + PACKET) {
      return -1;
    }
    int p = payload + 1 + (data[payload] & 0xff);
    return p < at + PACKET ? p : -1;
  }

  private void newHeader() {
    if (pat.length == 0 || pmt.length == 0) {
      return;
    }
    byte[] next = new byte[pat.length + pmt.length];
    System.arraycopy(pat, 0, next, 0, pat.length);
    System.arraycopy(pmt, 0, next, pat.length, pmt.length);
    if (!Arrays.equals(withoutCounters(next), withoutCounters(header))) {
      header = next;
      sink.header(next.clone());
    }
  }

  /** The packets without their continuity counters, which change from one repetition to the next. */
  private static byte[] withoutCounters(byte[] packets) {
    byte[] copy = packets.clone();
    for (int i = 0; i + 3 < copy.length; i += PACKET) {
      copy[i + 3] &= (byte) 0xf0;
    }
    return copy;
  }

  private void flush() {
    if (chunkLength == 0) {
      return;
    }
    sink.chunk(Arrays.copyOf(chunk, chunkLength), chunkStart);
    chunkLength = 0;
    chunkStart = false;
  }
}
