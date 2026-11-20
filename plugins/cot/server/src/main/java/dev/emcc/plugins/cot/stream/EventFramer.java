package dev.emcc.plugins.cot.stream;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Cuts a TAK Server's CoT stream (protocol version 0: XML events one after another, without a
 * separator) into documents. It knows tags, comments, CDATA, processing instructions and a
 * DOCTYPE, so a {@code >} inside a quoted value, a comment or a DTD does not end a document early.
 * It does not parse: each document, including a prolog or a DOCTYPE that comes with it, goes to the
 * {@link Sink} as the bytes it was, and the parser decides (it refuses a DOCTYPE).
 *
 * <p><b>Malformed input does not swallow the events after it.</b> A document ends when its root
 * element closes. The framer also ends one, and reports it (the parser will refuse it), when:
 * an end tag does not match the open element; a new {@code <event} begins inside a tag; an {@code <event>}
 * starts inside any open element (CoT events do not nest, so the earlier document was cut off); or
 * text that is not XML at all runs to the end of a line. Then it starts again with the next document.
 *
 * <p>A document larger than the limit is not kept: the framer goes on counting until the document
 * ends, then reports {@link Sink#tooLarge}, and the stream continues. A document larger than
 * {@link #HARD_LIMIT} ends the stream with an {@link IOException}: it is not one a TAK system sends,
 * and a document that never ends would otherwise swallow the stream for good.
 *
 * <p>Not thread-safe: one framer per connection, used by one link's connection task.
 *
 * <pre>{@code
 * var framer = new EventFramer(65_536);
 * framer.feed(chunk, 0, n, sink);   // sink.event(...) once per document
 * }</pre>
 */
public final class EventFramer {

  /** The most bytes of one document the framer reads (and discards) before it gives up on the stream. */
  public static final long HARD_LIMIT = 16L * 1024 * 1024;

  /** The deepest nesting the framer follows; CoT is shallow, and a deeper document is reported as it is. */
  private static final int MAX_DEPTH = 128;

  private static final String EVENT = "event";

  /** Receives the documents. The bytes are valid only during the call. */
  public interface Sink {
    /** A document of {@code length} bytes at the start of {@code data}. */
    void event(byte[] data, int length);

    /** A document that was larger than the limit, and has been thrown away; {@code length} is its size. */
    void tooLarge(long length);
  }

  private enum State { OUTSIDE, JUNK, TEXT, LT, START_TAG, END_TAG, BANG, COMMENT, CDATA, PI, DECL }

  private final int maxEvent;
  private byte[] buf = new byte[1024];
  private int size;
  private long total;
  private boolean discarding;

  private State state = State.OUTSIDE;
  private State afterComment = State.TEXT;
  private final List<String> open = new ArrayList<>();
  private final StringBuilder name = new StringBuilder();
  private boolean nameDone;
  private int tagStart;
  private int quote;
  private int last;
  private int brackets;
  private long window; // the last eight bytes
  private final byte[] bang = new byte[7];
  private int bangLength;
  private int suspect = -1;
  private int suspectMatched;

  /** @param maxEventBytes the largest document that is kept */
  public EventFramer(int maxEventBytes) {
    if (maxEventBytes < 1) {
      throw new IllegalArgumentException("maxEventBytes must be positive");
    }
    this.maxEvent = maxEventBytes;
  }

  /**
   * Reads {@code length} bytes and reports every document they complete.
   *
   * @throws IOException if a document grows past {@link #HARD_LIMIT}
   */
  public void feed(byte[] data, int offset, int length, Sink sink) throws IOException {
    for (int i = offset; i < offset + length; i++) {
      accept(data[i] & 0xff, sink);
    }
  }

  private void accept(int c, Sink sink) throws IOException {
    if (state == State.OUTSIDE) {
      if (c == '<') {
        begin(c);
        state = State.LT;
      } else if (c > ' ' && c != 0xEF && c != 0xBB && c != 0xBF) { // a byte order mark is no junk
        begin(c);
        state = State.JUNK; // not XML: a run of text up to the end of the line or the next tag
      }
      return;
    }
    if (state == State.START_TAG && quote == 0 && c == '<' && !discarding) {
      suspect = size; // a '<' inside a tag: a new <event> if "event" and a delimiter follow, otherwise part of the broken tag
      suspectMatched = 0;
    }
    if (c == '<' && (state == State.JUNK || state == State.LT || state == State.END_TAG)) {
      report(sink); // the tag or text so far is broken; this byte starts the next document
      begin(c);
      state = State.LT;
      return;
    }
    if (state == State.JUNK && (c == '\n' || c == '\r')) {
      report(sink);
      reset();
      return;
    }
    append(c);
    window = (window << 8) | c;
    switch (state) {
      case JUNK, TEXT -> {
        if (state == State.TEXT && c == '<') {
          state = State.LT;
          tagStart = size - 1;
        }
      }
      case LT -> lt(c, sink);
      case START_TAG -> startTag(c, sink);
      case END_TAG -> endTag(c, sink);
      case BANG -> bang(c);
      case COMMENT -> {
        if ((window & 0xffffff) == 0x2d2d3e) { // -->
          state = afterComment;
        }
      }
      case CDATA -> {
        if ((window & 0xffffff) == 0x5d5d3e) { // ]]>
          state = State.TEXT;
        }
      }
      case PI -> {
        if ((window & 0xffff) == 0x3f3e) { // ?>
          state = State.TEXT;
        }
      }
      case DECL -> decl(c);
      case OUTSIDE -> throw new IllegalStateException();
    }
  }

  /** The byte after {@code <}. */
  private void lt(int c, Sink sink) throws IOException {
    switch (c) {
      case '/' -> {
        state = State.END_TAG;
        name.setLength(0);
        nameDone = false;
      }
      case '!' -> {
        state = State.BANG;
        bangLength = 0;
      }
      case '?' -> state = State.PI;
      default -> {
        state = State.START_TAG;
        quote = 0;
        last = 0;
        name.setLength(0);
        nameDone = false;
        startTag(c, sink);
      }
    }
  }

  private void startTag(int c, Sink sink) throws IOException {
    if (suspect >= 0 && c != '<') {
      if (suspectMatched < EVENT.length()) {
        if (c == EVENT.charAt(suspectMatched)) {
          suspectMatched++;
        } else {
          suspect = -1;
        }
      } else if (c <= ' ' || c == '>' || c == '/') {
        restartAtSuspect(sink);
        return;
      } else {
        suspect = -1;
      }
    }
    if (quote != 0) {
      if (c == quote) {
        quote = 0;
      }
    } else if (c == '"' || c == '\'') {
      quote = c;
    } else if (c == '>') {
      boolean selfClosing = last == '/';
      String tag = name.toString();
      state = State.TEXT;
      if (tag.equals("event") && !open.isEmpty() && !discarding) {
        cutOffEvent(sink, selfClosing);
        return;
      }
      if (selfClosing) {
        if (open.isEmpty()) {
          complete(sink);
        }
      } else if (open.size() >= MAX_DEPTH) {
        complete(sink);
      } else {
        open.add(tag);
      }
      return;
    }
    if (quote == 0) {
      if (!nameDone) {
        if (c <= ' ' || c == '/' || c == '>') {
          nameDone = true;
        } else if (name.length() < 64) {
          name.append((char) c);
        }
      }
      last = c;
    }
  }

  /**
   * An {@code <event>} began inside an open element: the document before it was cut off. The bytes before the
   * new tag are a document of their own; the new tag starts the next.
   */
  private void cutOffEvent(Sink sink, boolean selfClosing) throws IOException {
    byte[] tag = Arrays.copyOfRange(buf, tagStart, size);
    size = tagStart;
    total = tagStart;
    report(sink);
    begin(tag[0] & 0xff);
    for (int i = 1; i < tag.length; i++) {
      append(tag[i] & 0xff);
    }
    state = State.TEXT;
    if (selfClosing) {
      complete(sink);
    } else {
      open.add("event");
    }
  }

  private void endTag(int c, Sink sink) {
    if (c == '>') {
      boolean matches = !open.isEmpty() && open.getLast().equals(name.toString().trim());
      if (matches) {
        open.removeLast();
      }
      if (!matches || open.isEmpty()) {
        complete(sink); // the root closed, or an end tag that closes nothing: either way the document is over
      } else {
        state = State.TEXT;
      }
    } else if (!nameDone) {
      if (c <= ' ') {
        nameDone = true;
      } else if (name.length() < 64) {
        name.append((char) c);
      }
    }
  }

  /** After {@code <!}: a comment, a CDATA section, or a declaration such as a DOCTYPE. */
  private void bang(int c) {
    bang[bangLength++] = (byte) c;
    if (bang[0] == '-') {
      if (bangLength == 2) {
        if (c == '-') {
          state = State.COMMENT;
          afterComment = State.TEXT;
          window = 0;
        } else {
          startDecl();
          decl(c);
        }
      }
    } else if (bang[0] == '[') {
      if (bangLength == bang.length) {
        if (new String(bang, StandardCharsets.ISO_8859_1).equals("[CDATA[")) {
          state = State.CDATA;
          window = 0;
        } else {
          startDecl();
          decl(c);
        }
      }
    } else {
      startDecl();
      decl(c);
    }
  }

  private void startDecl() {
    state = State.DECL;
    quote = 0;
    brackets = 0;
  }

  /** A declaration (DOCTYPE with an internal subset in square brackets) ends at the first {@code >} outside quotes and brackets. */
  private void decl(int c) {
    if (quote != 0) {
      if (c == quote) {
        quote = 0;
      }
    } else if (c == '"' || c == '\'') {
      quote = c;
    } else if (c == '[') {
      brackets++;
    } else if (c == ']') {
      brackets--;
    } else if (c == '>' && brackets <= 0) {
      state = State.TEXT;
    } else if (c == '-' && (window & 0xffffffffL) == 0x3c212d2dL && brackets > 0) { // <!-- inside the subset
      state = State.COMMENT;
      afterComment = State.DECL;
      window = 0;
    }
  }

  /** Starts a document with {@code c}, its first byte. */
  private void begin(int c) {
    reset();
    window = c;
    tagStart = 0;
    try {
      append(c);
    } catch (IOException e) {
      throw new IllegalStateException(e); // one byte cannot pass the hard limit
    }
  }

  private void append(int c) throws IOException {
    total++;
    if (total > HARD_LIMIT) {
      throw new IOException("a CoT document is larger than " + HARD_LIMIT + " bytes and has not ended");
    }
    if (discarding) {
      return;
    }
    if (total > maxEvent) {
      discarding = true;
      size = 0;
      return;
    }
    if (size == buf.length) {
      buf = Arrays.copyOf(buf, (int) Math.min(maxEvent, Math.max(1024L, buf.length * 2L)));
    }
    buf[size++] = (byte) c;
  }

  private void report(Sink sink) {
    if (discarding) {
      sink.tooLarge(total);
    } else {
      sink.event(buf, size);
    }
  }

  private void complete(Sink sink) {
    report(sink);
    reset();
  }

  /** The broken tag ends where the new {@code <event} began: the bytes before are a document of their own, the rest is read again. */
  private void restartAtSuspect(Sink sink) throws IOException {
    byte[] tail = Arrays.copyOfRange(buf, suspect, size);
    size = suspect;
    total = suspect;
    report(sink);
    reset();
    for (byte b : tail) {
      accept(b & 0xff, sink);
    }
  }

  private void reset() {
    suspect = -1;
    state = State.OUTSIDE;
    open.clear();
    size = 0;
    total = 0;
    discarding = false;
  }
}
