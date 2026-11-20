package dev.emcc.plugins.fmv.ts;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

/** Builds transport stream packets for the tests: the data is made here, since the public sample has no licence. */
public final class Ts {

  private Ts() {}

  /** One elementary stream of a PMT. */
  public record Es(int type, int pid, byte[] descriptors) {
    public Es(int type, int pid) {
      this(type, pid, new byte[0]);
    }
  }

  /** The registration descriptor {@code KLVA} of asynchronous KLV. */
  public static byte[] klva() {
    return new byte[] {5, 4, 'K', 'L', 'V', 'A'};
  }

  /**
   * One packet. With {@code flags >= 0} it has an adaptation field with those flags (0x40: random
   * access); a short payload is padded by the field's stuffing.
   */
  public static byte[] packet(int pid, boolean pusi, int cc, int flags, byte[] payload) {
    if (payload.length > 184) {
      throw new IllegalArgumentException("payload");
    }
    byte[] p = new byte[188];
    java.util.Arrays.fill(p, (byte) 0xFF);
    p[0] = 0x47;
    p[1] = (byte) ((pusi ? 0x40 : 0) | (pid >> 8));
    p[2] = (byte) pid;
    int room = 184 - payload.length;
    boolean af = flags >= 0 || room > 0;
    if (af && room == 0) {
      throw new IllegalArgumentException("no room for the adaptation field");
    }
    p[3] = (byte) ((af ? 0x30 : 0x10) | (cc & 0x0F));
    int at = 4;
    if (af) {
      p[at++] = (byte) (room - 1);
      if (room > 1) {
        p[at++] = (byte) Math.max(flags, 0);
      }
      at = 188 - payload.length;
    }
    System.arraycopy(payload, 0, p, at, payload.length);
    return p;
  }

  /** A PSI packet as senders make them: the payload first, then 0xFF stuffing, no adaptation field. */
  private static byte[] psi(int pid, int cc, byte[] payload) {
    byte[] p = new byte[188];
    java.util.Arrays.fill(p, (byte) 0xFF);
    p[0] = 0x47;
    p[1] = (byte) (0x40 | (pid >> 8));
    p[2] = (byte) pid;
    p[3] = (byte) (0x10 | (cc & 0x0F));
    System.arraycopy(payload, 0, p, 4, payload.length);
    return p;
  }

  private static byte[] section(int table, int idExt, byte[] body) {
    var s = new ByteArrayOutputStream();
    int length = 5 + body.length + 4;
    s.write(table);
    s.write(0xB0 | (length >> 8));
    s.write(length);
    s.write(idExt >> 8);
    s.write(idExt);
    s.write(0xC1); // version 0, current
    s.write(0);
    s.write(0);
    s.writeBytes(body);
    byte[] so = s.toByteArray();
    int crc = TsReader.crc32(so, 0, so.length);
    s.write(crc >>> 24);
    s.write(crc >>> 16);
    s.write(crc >>> 8);
    s.write(crc);
    return s.toByteArray();
  }

  private static byte[] withPointer(byte[] section) {
    byte[] out = new byte[section.length + 1];
    System.arraycopy(section, 0, out, 1, section.length);
    return out;
  }

  /** A PAT with the given (program, PMT PID) pairs. */
  public static byte[] pat(int cc, int... programAndPmt) {
    var body = new ByteArrayOutputStream();
    for (int i = 0; i < programAndPmt.length; i += 2) {
      body.write(programAndPmt[i] >> 8);
      body.write(programAndPmt[i]);
      body.write(0xE0 | (programAndPmt[i + 1] >> 8));
      body.write(programAndPmt[i + 1]);
    }
    return psi(0, cc, withPointer(section(0, 1, body.toByteArray())));
  }

  /** A PAT with a flipped bit in its CRC. */
  public static byte[] badPat(int cc, int program, int pmtPid) {
    byte[] p = pat(cc, program, pmtPid);
    p[4 + 1 + 12 + 3] ^= 0x01;
    return p;
  }

  /** A PMT for {@code program} on {@code pmtPid}. */
  public static byte[] pmt(int cc, int program, int pmtPid, Es... streams) {
    var body = new ByteArrayOutputStream();
    body.write(0xE1); // PCR PID 0x1FFF is fine for a test; 0x1000 keeps it simple
    body.write(0x00);
    body.write(0xF0);
    body.write(0x00); // no program descriptors
    for (Es es : streams) {
      body.write(es.type());
      body.write(0xE0 | (es.pid() >> 8));
      body.write(es.pid());
      body.write(0xF0 | (es.descriptors().length >> 8));
      body.write(es.descriptors().length);
      body.writeBytes(es.descriptors());
    }
    return psi(pmtPid, cc, withPointer(section(2, program, body.toByteArray())));
  }

  /** The packets of one KLV PES (stream id 0xBD, no PTS) carrying {@code klv}, with counters from {@code cc}. */
  public static List<byte[]> klvPes(int pid, int cc, byte[] klv) {
    var pes = new ByteArrayOutputStream();
    int length = 3 + klv.length;
    pes.writeBytes(new byte[] {0, 0, 1, (byte) 0xBD, (byte) (length >> 8), (byte) length, (byte) 0x80, 0, 0});
    pes.writeBytes(klv);
    return split(pid, cc, pes.toByteArray());
  }

  /** A PES of unstated length (0), as a video or loose KLV PES may be. */
  public static List<byte[]> klvPesUnbounded(int pid, int cc, byte[] klv) {
    var pes = new ByteArrayOutputStream();
    pes.writeBytes(new byte[] {0, 0, 1, (byte) 0xBD, 0, 0, (byte) 0x80, 0, 0});
    pes.writeBytes(klv);
    return split(pid, cc, pes.toByteArray());
  }

  /** PES bytes cut into packets; the first has the start indicator. The last one is padded with stuffing. */
  public static List<byte[]> split(int pid, int cc, byte[] pes) {
    List<byte[]> out = new ArrayList<>();
    for (int at = 0, n = 0; at < pes.length; n++) {
      int take = Math.min(184, pes.length - at);
      if (take == 183 && at + take < pes.length) {
        take = 182;
      }
      byte[] chunk = java.util.Arrays.copyOfRange(pes, at, at + take);
      out.add(packet(pid, n == 0, cc + n, take < 184 ? 0 : -1, chunk));
      at += take;
    }
    return out;
  }

  /** The start of a video unit: a packet with the start indicator and, if {@code randomAccess}, that flag. */
  public static byte[] videoStart(int pid, int cc, boolean randomAccess, byte[] payload) {
    return packet(pid, true, cc, randomAccess ? 0x40 : (payload.length < 184 ? 0 : -1), payload);
  }

  /** A packet in the middle of a video unit. */
  public static byte[] videoMiddle(int pid, int cc, boolean randomAccess, byte[] payload) {
    return packet(pid, false, cc, randomAccess ? 0x40 : (payload.length < 184 ? 0 : -1), payload);
  }

  /** Joins packets into one datagram. */
  public static byte[] datagram(byte[]... packets) {
    var out = new ByteArrayOutputStream();
    for (byte[] p : packets) {
      out.writeBytes(p);
    }
    return out.toByteArray();
  }

  /** An MPEG-2 sequence header for the size, inside a PES start. */
  public static byte[] mpeg2Header(int width, int height) {
    return new byte[] {0, 0, 1, (byte) 0xE0, 0, 0, (byte) 0x80, 0, 0, 0, 0, 1, (byte) 0xB3, (byte) (width >> 4),
        (byte) (((width & 0xF) << 4) | (height >> 8)), (byte) height, 0x13, 0, 0, 0};
  }

  /** An H.264 SPS NAL unit with its start code, for a size, with this profile and the frame cropping. */
  public static byte[] h264Sps(int profile, int widthMbs, int heightMbs, int cropRight, int cropBottom) {
    var w = new BitWriter();
    w.bits(profile, 8);
    w.bits(0, 8);
    w.bits(31, 8);
    w.ue(0);
    if (profile == 100) {
      w.ue(1); // 4:2:0
      w.ue(0);
      w.ue(0);
      w.bits(0, 1);
      w.bits(0, 1);
    }
    w.ue(0); // log2 max frame num - 4
    w.ue(2); // poc type 2
    w.ue(1); // reference frames
    w.bits(0, 1);
    w.ue(widthMbs - 1);
    w.ue(heightMbs - 1);
    w.bits(1, 1); // frame mbs only
    w.bits(1, 1); // direct 8x8
    boolean crop = cropRight > 0 || cropBottom > 0;
    w.bits(crop ? 1 : 0, 1);
    if (crop) {
      w.ue(0);
      w.ue(cropRight);
      w.ue(0);
      w.ue(cropBottom);
    }
    w.bits(0, 1); // no VUI
    w.bits(1, 1); // stop bit
    byte[] rbsp = w.bytes();
    var out = new ByteArrayOutputStream();
    out.writeBytes(new byte[] {0, 0, 0, 1, 0x67});
    int zeros = 0;
    for (byte b : rbsp) { // emulation prevention
      if (zeros >= 2 && (b & 0xFF) <= 3) {
        out.write(3);
        zeros = 0;
      }
      out.write(b);
      zeros = b == 0 ? zeros + 1 : 0;
    }
    return out.toByteArray();
  }

  /** A bit writer for the SPS. */
  private static final class BitWriter {
    private final ByteArrayOutputStream out = new ByteArrayOutputStream();
    private int cur;
    private int n;

    void bits(long value, int count) {
      for (int i = count - 1; i >= 0; i--) {
        cur = (cur << 1) | (int) ((value >> i) & 1);
        if (++n == 8) {
          out.write(cur);
          cur = 0;
          n = 0;
        }
      }
    }

    void ue(int v) {
      long x = (long) v + 1;
      int len = 64 - Long.numberOfLeadingZeros(x);
      bits(0, len - 1);
      bits(x, len);
    }

    byte[] bytes() {
      while (n != 0) {
        bits(0, 1);
      }
      return out.toByteArray();
    }
  }
}
