package dev.emcc.plugins.fmv.ts;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * Reads a transport stream a datagram at a time, as far as the plugin needs (ADR-0057 point 2): the
 * PAT and PMT, which choose the program; the KLV stream, assembled from its PES packets; the video's
 * random access points; and the video's size. It never changes the bytes: the task passes the
 * datagrams on as they came. Received data is untrusted: a section with a wrong CRC, a packet with
 * the error indicator and an adaptation field that does not fit are skipped, never an exception.
 *
 * <p>One reader per run of a link: it holds the tables, the PIDs, the KLV being assembled and the
 * latest header. It does no I/O and starts no thread.
 */
public final class TsReader {

  /** The size of a transport stream packet. */
  public static final int PACKET = 188;

  /** The largest KLV PES (brief section 4); a longer one is dropped. */
  public static final int MAX_KLV = 64 * 1024;

  /** The largest header (CR-0044: {@code Streams.MAX_HEADER}). */
  static final int MAX_HEADER = 4096;

  /** The bytes of a video unit searched for the picture's size. */
  private static final int SNIFF_BYTES = 4096;

  /** What the reader found. Called from {@link #feed}, in the caller's thread. */
  public interface Sink {
    /** The chosen program changed: the first one, or another video PID or type, or a KLV stream that came or went. */
    void program(Program program);

    /** The latest PAT and the chosen program's PMT as transport stream packets, at most 4 KiB: what a new viewer gets first. */
    void header(byte[] packets);

    /** One KLV PES' payload: the KLV items, as ST 336 has them. */
    void klv(byte[] payload);

    /** A KLV PES was dropped: {@code continuity gap}, {@code KLV too long} or {@code KLV truncated}. */
    void dropped(String reason);

    /** The video's width and height, once read for this program. */
    void size(VideoSize size);
  }

  private final Map<Integer, Integer> pat = new LinkedHashMap<>();
  private final Map<Integer, Pmt> pmts = new HashMap<>();
  private final Map<Integer, Section> sections = new HashMap<>();
  private byte[] patSection = new byte[0];
  private List<byte[]> patPackets = List.of();
  private byte[] lastHeader = new byte[0];
  private @Nullable Program program;

  // The video of the chosen program.
  private boolean sizeKnown;
  private final ByteArrayOutputStream sniff = new ByteArrayOutputStream();
  private boolean sniffing;

  // The KLV PES being assembled.
  private final ByteArrayOutputStream pes = new ByteArrayOutputStream();
  private boolean assembling;
  /** The PES's stated length, or -1 until its header is in. */
  private int declared = -1;
  private int klvCc = -1;

  /** One PMT: the video and KLV streams it lists, and its raw packets. */
  private record Pmt(byte[] section, List<byte[]> packets, int video, int videoPid, int klvPid) {}

  /** A section being assembled from the payloads of one PID. */
  private static final class Section {
    final ByteArrayOutputStream data = new ByteArrayOutputStream();
    final List<byte[]> packets = new ArrayList<>();
  }

  /** Whether tables came but none lists video: the status says "No video in the stream". */
  public boolean noVideo() {
    return program == null && !pmts.isEmpty();
  }

  /** The chosen program, or {@code null} before a PAT and a PMT with video have come. */
  public @Nullable Program program() {
    return program;
  }

  /**
   * Whether a datagram is a transport stream: a whole number of 188-byte packets, each starting with
   * {@code 0x47} (brief section 4). Anything else is dropped whole.
   */
  public static boolean isTransportStream(byte[] d, int off, int len) {
    if (len <= 0 || len % PACKET != 0) {
      return false;
    }
    for (int p = off; p < off + len; p += PACKET) {
      if (d[p] != 0x47) {
        return false;
      }
    }
    return true;
  }

  /**
   * Reads a datagram that {@link #isTransportStream} accepted.
   *
   * @return whether it holds the start of a video unit with the random access indicator: a place
   *     where a new viewer may start
   */
  public boolean feed(byte[] d, int off, int len, Sink sink) {
    boolean startPoint = false;
    for (int p = off; p + PACKET <= off + len; p += PACKET) {
      startPoint |= packet(d, p, sink);
    }
    VideoSize found = pendingSize;
    if (found != null) {
      pendingSize = null;
      sink.size(found);
    }
    return startPoint;
  }

  private boolean packet(byte[] d, int p, Sink sink) {
    if ((d[p + 1] & 0x80) != 0) {
      return false; // transport error indicator
    }
    int pid = ((d[p + 1] & 0x1F) << 8) | (d[p + 2] & 0xFF);
    boolean pusi = (d[p + 1] & 0x40) != 0;
    int afc = (d[p + 3] >> 4) & 3;
    int cc = d[p + 3] & 0x0F;
    int off = p + 4;
    boolean randomAccess = false;
    if (afc == 2 || afc == 3) {
      int afl = d[off] & 0xFF;
      if (afl > 183) {
        return false;
      }
      randomAccess = afl > 0 && (d[off + 1] & 0x40) != 0;
      off += 1 + afl;
    }
    int end = p + PACKET;
    boolean hasPayload = (afc == 1 || afc == 3) && off < end;

    if (pid == 0 || pat.containsKey(pid)) {
      if (hasPayload) {
        section(pid, d, p, off, end, pusi, sink);
      }
      return false;
    }
    Program chosen = program;
    if (chosen == null) {
      return false;
    }
    if (pid == chosen.videoPid()) {
      if (hasPayload) {
        sniff(chosen, d, off, end, pusi);
      }
      return pusi && randomAccess;
    }
    if (pid == chosen.klvPid() && hasPayload) {
      klv(d, off, end, pusi, cc, sink);
    }
    return false;
  }

  // ---------------------------------------------------------------- PAT and PMT

  private void section(int pid, byte[] d, int packetStart, int off, int end, boolean pusi, Sink sink) {
    Section s = sections.computeIfAbsent(pid, k -> new Section());
    byte[] raw = Arrays.copyOfRange(d, packetStart, end);
    int from = off;
    if (pusi) {
      int pointer = d[off] & 0xFF;
      int next = off + 1 + pointer;
      if (next > end) {
        s.data.reset();
        s.packets.clear();
        return;
      }
      if (s.data.size() > 0) { // the tail of the section in progress
        s.data.write(d, off + 1, pointer);
        s.packets.add(raw);
        complete(pid, s, sink);
      }
      s.data.reset();
      s.packets.clear();
      from = next;
    } else if (s.data.size() == 0) {
      return; // the middle of a section whose start we did not see
    }
    while (from < end) {
      if ((d[from] & 0xFF) == 0xFF && s.data.size() == 0) {
        break; // stuffing
      }
      int length = end - from;
      s.data.write(d, from, length);
      if (s.packets.isEmpty() || s.packets.get(s.packets.size() - 1) != raw) {
        s.packets.add(raw);
      }
      from = end;
      byte[] have = s.data.toByteArray();
      if (have.length >= 3) {
        int total = 3 + (((have[1] & 0x0F) << 8) | (have[2] & 0xFF));
        if (total > 1024 + 3) {
          s.data.reset();
          s.packets.clear();
          return;
        }
        if (have.length >= total) {
          byte[] one = Arrays.copyOf(have, total);
          List<byte[]> packets = List.copyOf(s.packets);
          s.data.reset();
          s.packets.clear();
          handle(pid, one, packets, sink);
          if (have.length > total && (have[total] & 0xFF) != 0xFF) { // another section in this packet
            s.data.write(have, total, have.length - total);
            s.packets.add(raw);
            complete(pid, s, sink);
          }
        }
      }
    }
  }

  /** After a tail was added: hands over the section if it is whole. */
  private void complete(int pid, Section s, Sink sink) {
    byte[] have = s.data.toByteArray();
    if (have.length < 3) {
      return;
    }
    int total = 3 + (((have[1] & 0x0F) << 8) | (have[2] & 0xFF));
    if (total <= 1024 + 3 && have.length >= total) {
      handle(pid, Arrays.copyOf(have, total), List.copyOf(s.packets), sink);
    }
  }

  private void handle(int pid, byte[] section, List<byte[]> packets, Sink sink) {
    if (section.length < 12 || crc32(section, 0, section.length) != 0 || (section[5] & 1) == 0) {
      return; // a wrong checksum, or a table for later
    }
    int table = section[0] & 0xFF;
    if (pid == 0 && table == 0) {
      pat(section, packets);
    } else if (pid != 0 && table == 2) {
      pmt(pid, section, packets);
    } else {
      return;
    }
    choose(sink);
  }

  private void pat(byte[] s, List<byte[]> packets) {
    if (Arrays.equals(s, patSection)) {
      return;
    }
    Map<Integer, Integer> now = new LinkedHashMap<>();
    for (int i = 8; i + 4 <= s.length - 4; i += 4) {
      int number = ((s[i] & 0xFF) << 8) | (s[i + 1] & 0xFF);
      int pmtPid = ((s[i + 2] & 0x1F) << 8) | (s[i + 3] & 0xFF);
      if (number != 0) {
        now.put(pmtPid, number);
      }
    }
    patSection = s;
    patPackets = packets;
    pat.clear();
    pat.putAll(now);
    pmts.keySet().retainAll(now.keySet());
  }

  private void pmt(int pid, byte[] s, List<byte[]> packets) {
    Pmt old = pmts.get(pid);
    if (old != null && Arrays.equals(old.section(), s)) {
      return;
    }
    int infoLength = ((s[10] & 0x0F) << 8) | (s[11] & 0xFF);
    int i = 12 + infoLength;
    int videoType = -1;
    int videoPid = -1;
    int klvPid = -1;
    int end = s.length - 4;
    while (i + 5 <= end) {
      int type = s[i] & 0xFF;
      int esPid = ((s[i + 1] & 0x1F) << 8) | (s[i + 2] & 0xFF);
      int esInfo = ((s[i + 3] & 0x0F) << 8) | (s[i + 4] & 0xFF);
      int dEnd = Math.min(end, i + 5 + esInfo);
      if (videoPid < 0 && VideoFormat.isVideo(type)) {
        videoType = type;
        videoPid = esPid;
      } else if (klvPid < 0 && (type == 0x15 || (type == 0x06 && hasKlvaDescriptor(s, i + 5, dEnd)))) {
        klvPid = esPid;
      }
      i = dEnd;
    }
    pmts.put(pid, new Pmt(s, packets, videoType, videoPid, klvPid));
  }

  /** A registration descriptor (tag 5) with the format identifier {@code KLVA} (ST 1402: asynchronous KLV). */
  private static boolean hasKlvaDescriptor(byte[] s, int from, int to) {
    for (int i = from; i + 2 <= to; ) {
      int tag = s[i] & 0xFF;
      int length = s[i + 1] & 0xFF;
      if (tag == 5 && length >= 4 && i + 6 <= to && s[i + 2] == 'K' && s[i + 3] == 'L' && s[i + 4] == 'V' && s[i + 5] == 'A') {
        return true;
      }
      i += 2 + length;
    }
    return false;
  }

  /** The first program in the PAT whose PMT has video; tells the sink when that changes or its header does. */
  private void choose(Sink sink) {
    Program now = null;
    Pmt chosenPmt = null;
    for (var entry : pat.entrySet()) {
      Pmt m = pmts.get(entry.getKey());
      if (m != null && m.videoPid() >= 0) {
        now = new Program(entry.getValue(), entry.getKey(), m.videoPid(), new VideoFormat(m.video()), m.klvPid());
        chosenPmt = m;
        break;
      }
    }
    if (now != null && !now.equals(program)) {
      Program before = program;
      program = now;
      if (before == null || !before.sameVideoAs(now)) {
        sizeKnown = false;
        sniffing = false;
      }
      if (before == null || before.klvPid() != now.klvPid()) {
        assembling = false;
        klvCc = -1;
        pes.reset();
      }
      sink.program(now);
    }
    if (chosenPmt != null) {
      var out = new ByteArrayOutputStream();
      patPackets.forEach(out::writeBytes);
      chosenPmt.packets().forEach(out::writeBytes);
      byte[] header = out.toByteArray();
      if (header.length <= MAX_HEADER && !Arrays.equals(header, lastHeader)) {
        lastHeader = header;
        sink.header(header);
      }
    }
  }

  /** The MPEG-2 CRC-32 of a section; over the whole section, with its own CRC, it is 0. */
  static int crc32(byte[] d, int from, int to) {
    int crc = 0xFFFFFFFF;
    for (int i = from; i < to; i++) {
      crc ^= (d[i] & 0xFF) << 24;
      for (int b = 0; b < 8; b++) {
        crc = (crc & 0x80000000) != 0 ? (crc << 1) ^ 0x04C11DB7 : crc << 1;
      }
    }
    return crc;
  }

  // ---------------------------------------------------------------- video

  /** Collects the start of each video unit until the size is known, then stops looking. */
  private void sniff(Program chosen, byte[] d, int off, int end, boolean pusi) {
    if (sizeKnown || chosen.video().kind() == VideoFormat.Kind.OTHER || chosen.video().kind() == VideoFormat.Kind.H265) {
      return;
    }
    if (pusi) {
      sniff.reset();
      sniffing = true;
    }
    if (!sniffing) {
      return;
    }
    sniff.write(d, off, end - off);
    byte[] data = sniff.toByteArray();
    VideoSize size = VideoSize.find(chosen.video().kind(), data, data.length);
    if (size != null) {
      sizeKnown = true;
      sniffing = false;
      pendingSize = size;
    } else if (data.length >= SNIFF_BYTES) {
      sniffing = false;
    }
  }

  private @Nullable VideoSize pendingSize;

  // ---------------------------------------------------------------- KLV

  private void klv(byte[] d, int off, int end, boolean pusi, int cc, Sink sink) {
    if (klvCc >= 0) {
      if (cc == klvCc) {
        return; // a repeated packet
      }
      if (cc != ((klvCc + 1) & 0x0F) && assembling) {
        assembling = false;
        pes.reset();
        sink.dropped("continuity gap");
      }
    }
    klvCc = cc;
    if (pusi) {
      if (assembling) {
        finish(true, sink);
      }
      pes.reset();
      declared = -1;
      assembling = true;
    } else if (!assembling) {
      return;
    }
    pes.write(d, off, end - off);
    int have = pes.size();
    if (declared < 0 && have >= 6) {
      byte[] head = pes.toByteArray();
      declared = ((head[4] & 0xFF) << 8) | (head[5] & 0xFF);
    }
    if (have > MAX_KLV + 64) {
      assembling = false;
      pes.reset();
      sink.dropped("KLV too long");
    } else if (declared > 0 && have >= 6 + declared) {
      finish(false, sink);
    }
  }

  /** Hands over the PES; {@code atBoundary}: the next one began, so a PES of unstated length ends here. */
  private void finish(boolean atBoundary, Sink sink) {
    byte[] b = pes.toByteArray();
    assembling = false;
    pes.reset();
    if (b.length < 9 || b[0] != 0 || b[1] != 0 || b[2] != 1) {
      sink.dropped("KLV truncated");
      return;
    }
    int declared = ((b[4] & 0xFF) << 8) | (b[5] & 0xFF);
    int length = b.length;
    if (declared > 0) {
      if (b.length < 6 + declared) {
        sink.dropped("KLV truncated");
        return;
      }
      length = 6 + declared;
    } else if (!atBoundary) {
      return;
    }
    int start = 9 + (b[8] & 0xFF);
    if (start > length) {
      sink.dropped("KLV truncated");
      return;
    }
    if (start == length) {
      return; // an empty PES: a sender with no metadata to give (S9's sample has 198 of them)
    }
    sink.klv(Arrays.copyOfRange(b, start, length));
  }
}
