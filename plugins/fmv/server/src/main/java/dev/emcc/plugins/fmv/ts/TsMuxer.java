package dev.emcc.plugins.fmv.ts;

import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * The output link's transport stream (brief section 10.6 point 18; ST 1402; after spike S10's
 * {@code LiveSender.java}):
 *
 * <ul>
 *   <li>one program: the PAT; the PMT on PID {@link #PMT_PID}; H.264 (stream type {@code 0x1B}) on
 *       {@link #VIDEO_PID}, which carries the PCR; KLV on {@link #KLV_PID}, stream type {@code 0x06}
 *       with a {@code KLVA} registration descriptor (asynchronous);
 *   <li>the PAT and PMT before every third picture, padded with {@code 0xFF}, never with an
 *       adaptation field (S10's "what went wrong" 2);
 *   <li>each access unit in one H.264 PES with a PTS from the picture's time (90 kHz), its first
 *       packet with a PCR {@link #PCR_LEAD_90KHZ} before the PTS (PCR = PTS − 9 000 ticks) and, on a keyframe, the random access
 *       indicator; the access unit as the encoder gives it, nothing added (S10's "what went wrong" 1);
 *   <li>a KLV PES with the same PTS for the pictures that carry a set;
 *   <li>datagrams of {@link #PACKETS_PER_DATAGRAM} packets; the last one of a picture is filled with
 *       null packets, so that every datagram is 7 × 188 bytes and no picture waits for the next.
 * </ul>
 *
 * One muxer per stream, owned by the compute task: it keeps the continuity counters and the picture
 * count. Pure code: no I/O, no threads.
 */
public final class TsMuxer {

  public static final int PMT_PID = 0x0100;
  public static final int VIDEO_PID = 0x0101;
  public static final int KLV_PID = 0x0102;
  public static final int NULL_PID = 0x1FFF;
  public static final int PROGRAM = 1;
  public static final int PACKETS_PER_DATAGRAM = 7;
  public static final int DATAGRAM = PACKETS_PER_DATAGRAM * TsReader.PACKET;

  /** The PCR's lead: the PTS is 100 ms after it (section 10.6 point 18). */
  public static final long PCR_LEAD_90KHZ = 9_000;

  /** The PAT and PMT go before every third picture. */
  public static final int TABLES_EVERY = 3;

  private static final long PTS_WRAP = 1L << 33;

  private final int[] continuity = new int[0x2000];
  private final ByteArrayOutputStream pending = new ByteArrayOutputStream();
  private long pictures;

  /**
   * Muxes one encoded picture and, if it carries one, its KLV item.
   *
   * @param time the picture's time (its pose's); the PTS follows it
   * @param keyframe whether the access unit is an IDR: the random access indicator goes on its first packet
   * @param accessUnit one H.264 access unit, Annex B
   * @param klv the KLV item(s) for this picture, or {@code null}
   * @return the datagrams, each {@link #DATAGRAM} bytes
   */
  public List<byte[]> picture(Instant time, boolean keyframe, byte[] accessUnit, byte @Nullable [] klv) {
    long pts = pts(time);
    if (pictures % TABLES_EVERY == 0) {
      packet(0, true, null, psi(0x00, 1, pat()));
      packet(PMT_PID, true, null, psi(0x02, PROGRAM, pmt()));
    }
    pictures++;
    long pcr = Math.floorMod(pts - PCR_LEAD_90KHZ, PTS_WRAP) * 300;
    pes(VIDEO_PID, 0xE0, pts, accessUnit, pcr, false, keyframe);
    if (klv != null) {
      pes(KLV_PID, 0xBD, pts, klv, -1, true, false);
    }
    return datagrams();
  }

  /** The 90 kHz PTS of a time, modulo 2³³. */
  static long pts(Instant time) {
    long ticks = Math.multiplyExact(time.getEpochSecond(), 90_000L) + (time.getNano() / 1000L) * 9 / 100;
    return Math.floorMod(ticks, PTS_WRAP);
  }

  private static byte[] pat() {
    return new byte[] {0x00, (byte) PROGRAM, (byte) (0xE0 | PMT_PID >> 8), (byte) PMT_PID};
  }

  private static byte[] pmt() {
    byte[] registration = {0x05, 0x04, 'K', 'L', 'V', 'A'};
    ByteArrayOutputStream p = new ByteArrayOutputStream();
    p.writeBytes(new byte[] {(byte) (0xE0 | VIDEO_PID >> 8), (byte) VIDEO_PID, (byte) 0xF0, 0x00});
    p.writeBytes(new byte[] {0x1B, (byte) (0xE0 | VIDEO_PID >> 8), (byte) VIDEO_PID, (byte) 0xF0, 0x00});
    p.writeBytes(new byte[] {0x06, (byte) (0xE0 | KLV_PID >> 8), (byte) KLV_PID, (byte) 0xF0, (byte) registration.length});
    p.writeBytes(registration);
    return p.toByteArray();
  }

  /** A section after a pointer field, then {@code 0xFF} to the packet's end: one packet's payload. */
  private static byte[] psi(int tableId, int extension, byte[] payload) {
    int length = 5 + payload.length + 4;
    byte[] section = new byte[3 + length];
    section[0] = (byte) tableId;
    section[1] = (byte) (0xB0 | length >> 8);
    section[2] = (byte) length;
    section[3] = (byte) (extension >> 8);
    section[4] = (byte) extension;
    section[5] = (byte) 0xC1;
    section[6] = 0;
    section[7] = 0;
    System.arraycopy(payload, 0, section, 8, payload.length);
    int crc = TsReader.crc32(section, 0, section.length - 4);
    section[section.length - 4] = (byte) (crc >> 24);
    section[section.length - 3] = (byte) (crc >> 16);
    section[section.length - 2] = (byte) (crc >> 8);
    section[section.length - 1] = (byte) crc;
    byte[] out = new byte[TsReader.PACKET - 4];
    Arrays.fill(out, (byte) 0xFF);
    out[0] = 0;
    System.arraycopy(section, 0, out, 1, section.length);
    return out;
  }

  private void pes(int pid, int streamId, long pts, byte[] data, long pcr, boolean bounded, boolean keyframe) {
    int length = bounded ? 3 + 5 + data.length : 0;
    if (length > 0xFFFF) {
      throw new IllegalArgumentException("a bounded PES holds at most 65 527 bytes: " + data.length);
    }
    byte[] all = new byte[9 + 5 + data.length];
    all[0] = 0;
    all[1] = 0;
    all[2] = 1;
    all[3] = (byte) streamId;
    all[4] = (byte) (length >> 8);
    all[5] = (byte) length;
    all[6] = (byte) 0x80;
    all[7] = (byte) 0x80;
    all[8] = 5;
    all[9] = (byte) (0x21 | ((pts >> 29) & 0x0E));
    all[10] = (byte) (pts >> 22);
    all[11] = (byte) (0x01 | ((pts >> 14) & 0xFE));
    all[12] = (byte) (pts >> 7);
    all[13] = (byte) (0x01 | ((pts << 1) & 0xFE));
    System.arraycopy(data, 0, all, 14, data.length);
    int at = 0;
    boolean first = true;
    while (at < all.length) {
      byte[] field = first && pcr >= 0 ? pcrField(pcr, keyframe) : null;
      int room = TsReader.PACKET - 4 - (field == null ? 0 : field.length);
      int take = Math.min(room, all.length - at);
      packet(pid, first, field, Arrays.copyOfRange(all, at, at + take));
      at += take;
      first = false;
    }
  }

  private static byte[] pcrField(long pcr, boolean keyframe) {
    long base = pcr / 300;
    long ext = pcr % 300;
    return new byte[] {7, (byte) (keyframe ? 0x50 : 0x10), (byte) (base >> 25), (byte) (base >> 17), (byte) (base >> 9), (byte) (base >> 1),
        (byte) (((base & 1) << 7) | 0x7E | (ext >> 8)), (byte) ext};
  }

  /** One packet with a payload; an adaptation field (the given one, or stuffing) fills what the payload leaves. */
  private void packet(int pid, boolean start, byte @Nullable [] field, byte[] payload) {
    byte[] p = new byte[TsReader.PACKET];
    Arrays.fill(p, (byte) 0xFF);
    p[0] = 0x47;
    p[1] = (byte) ((start ? 0x40 : 0) | (pid >> 8));
    p[2] = (byte) pid;
    int need = TsReader.PACKET - 4 - payload.length;
    byte[] af = field;
    if (af == null && need > 0) {
      af = new byte[need];
      af[0] = (byte) (need - 1);
      if (need > 1) {
        af[1] = 0;
        Arrays.fill(af, 2, need, (byte) 0xFF);
      }
    } else if (af != null && af.length < need) {
      byte[] grown = Arrays.copyOf(af, need);
      grown[0] = (byte) (need - 1);
      Arrays.fill(grown, af.length, need, (byte) 0xFF);
      af = grown;
    }
    p[3] = (byte) ((af != null ? 0x30 : 0x10) | (continuity[pid] & 0xF));
    continuity[pid] = (continuity[pid] + 1) & 0xF;
    int at = 4;
    if (af != null) {
      System.arraycopy(af, 0, p, at, af.length);
      at += af.length;
    }
    System.arraycopy(payload, 0, p, at, payload.length);
    pending.writeBytes(p);
  }

  /** The pending packets as whole datagrams, the last filled with null packets. */
  private List<byte[]> datagrams() {
    while (pending.size() % DATAGRAM != 0) {
      byte[] n = new byte[TsReader.PACKET];
      Arrays.fill(n, (byte) 0xFF);
      n[0] = 0x47;
      n[1] = (byte) (NULL_PID >> 8);
      n[2] = (byte) NULL_PID;
      n[3] = 0x10;
      pending.writeBytes(n);
    }
    byte[] all = pending.toByteArray();
    pending.reset();
    List<byte[]> out = new ArrayList<>(all.length / DATAGRAM);
    for (int at = 0; at < all.length; at += DATAGRAM) {
      out.add(Arrays.copyOfRange(all, at, at + DATAGRAM));
    }
    return out;
  }
}
