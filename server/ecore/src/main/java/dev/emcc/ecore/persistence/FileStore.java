package dev.emcc.ecore.persistence;

import dev.emcc.ecore.json.InvalidDocumentException;
import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.json.ModelSchemas.Document;
import dev.emcc.ecore.store.PictureSnapshot;
import dev.emcc.ecore.store.PictureState;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.io.UncheckedIOException;
import java.io.Writer;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.core.JsonGenerator;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.JsonNode;

/**
 * The file store of M0 (overview 4.8): two files in the data directory.
 *
 * <ul>
 *   <li>{@code snapshot.json}: the picture at one sequence number, {@code {"format":
 *       "emc2-picture/1", "dataModel": "1.9.0", "sequenceNo": n, "layers": [...], "objects":
 *       [...]}}. Replaced atomically: written to a temporary file, then renamed over the old one.
 *       {@code dataModel} is the data model of the snapshot and the journal; M0 wrote none (0.1.0).
 *       A new data directory gets an empty snapshot at once, so a journal without a snapshot is
 *       always M0's.
 *   <li>{@code journal.jsonl}: one change event per line (LF), appended after the snapshot.
 *       Emptied after a new snapshot is in place; events the snapshot already contains are skipped
 *       on load, so a crash between the two steps loses nothing. Updates that were not saved
 *       (ADR-0041) are not in it; lines declare them instead ({@value #NOT_SAVED}: a run of
 *       sequence numbers; {@value #NOT_SAVED_VERSION}: the version a moved object reached, before
 *       its next saved event), so that a gap or a version jump is accepted only where declared. A
 *       journal with such lines is applied while loading and written as a new snapshot.
 * </ul>
 *
 * Every document is validated against the model's schemas on load. A half-written last journal
 * line (a crash while writing; it has no LF) is cut off with a warning, so the next event starts on
 * a fresh line; any other damage stops the start, so nothing is silently lost. Load also fails if
 * the data directory cannot be written.
 *
 * <p><b>Data model versions</b> (model README, "Migration"): 0.1.0 data is migrated once, at the
 * first start: the journal is folded into the snapshot as at any start, the result is migrated
 * ({@link Migration}) and written as a new snapshot of the current model ({@link ModelJson#DATA_MODEL})
 * with an empty journal, after a copy of the
 * 0.1.0 files is kept in {@value #KEPT_0_1_0}. Data of an older minor version (1.0.0) is read as it
 * is. Data of a newer major version is refused, never rewritten.
 */
public final class FileStore implements PictureStore {

  public static final String SNAPSHOT = "snapshot.json";
  public static final String JOURNAL = "journal.jsonl";
  static final String FORMAT = "emc2-picture/1";
  /** A journal line declaring a run of updates that were not saved (ADR-0041). */
  static final String NOT_SAVED = "notSaved";
  /** A journal line declaring the version an object reached through updates that were not saved (ADR-0041). */
  static final String NOT_SAVED_VERSION = "notSavedVersion";
  /** Where the 0.1.0 files are kept when they are migrated. */
  public static final String KEPT_0_1_0 = "data-model-0.1.0";
  private static final byte[] LF = {'\n'};

  private static final Logger LOG = LoggerFactory.getLogger(FileStore.class);

  private final Path directory;
  private final ModelJson json;
  private @Nullable FileOutputStream journalFile;
  private @Nullable Writer journal;

  public FileStore(Path directory, ModelJson json) {
    this.directory = directory.toAbsolutePath().normalize();
    this.json = json;
    try {
      Files.createDirectories(this.directory);
    } catch (IOException e) {
      throw new UncheckedIOException("cannot create the data directory " + this.directory, e);
    }
  }

  public Path directory() {
    return directory;
  }

  @Override
  public Stored load() {
    Path snapshotFile = directory.resolve(SNAPSHOT);
    Path journalFile = directory.resolve(JOURNAL);
    boolean hasSnapshot = Files.exists(snapshotFile);
    Snapshot read = hasSnapshot
        ? readSnapshot(snapshotFile)
        : new Snapshot(hasEvents(journalFile) ? Migration.FROM : ModelJson.DATA_MODEL, PictureSnapshot.empty());
    boolean migrate = major(read.dataModel()) < major(ModelJson.DATA_MODEL);
    PictureSnapshot snapshot = read.snapshot();
    List<JournalEntry> entries = readJournal(journalFile, snapshot.sequenceNo(), migrate);
    checkWritable();
    if (migrate) {
      return migrate(read.dataModel(), snapshot, entries);
    }
    if (!hasSnapshot) {
      replaceWith(snapshot); // records the data model before the first change
    }
    LOG.info("Loaded the live picture from {}: {} layers, {} objects at sequence {}, {} journal entries",
        directory, snapshot.layers().size(), snapshot.objects().size(), snapshot.sequenceNo(), entries.size());
    Stored stored = JournalEntry.stored(snapshot, entries);
    if (entries.stream().anyMatch(e -> !(e instanceof JournalEntry.Event))) {
      // Declarations were applied while loading: written as a new snapshot with an empty journal, so the
      // journal's length and the compaction count that starts from it agree, and the next start does not
      // replay these lines again.
      replaceWith(stored.snapshot());
      LOG.info("Wrote the loaded picture as a new snapshot at sequence {}: its journal declared updates that were not saved",
          stored.snapshot().sequenceNo());
    }
    return stored;
  }

  /**
   * Migrates what was read (already as migrated documents, see {@link #readJournal}): folds the
   * journal into the snapshot, keeps a copy of the old files, then writes the new snapshot and
   * empties the journal. A crash before the new snapshot is in place leaves the old files, and the
   * next start migrates again.
   */
  private Stored migrate(String from, PictureSnapshot snapshot, List<JournalEntry> events) {
    PictureState picture = PictureState.of(snapshot);
    JournalEntry.apply(picture, events);
    PictureSnapshot migrated = picture.snapshot();
    Path kept = keepCopy();
    replaceWith(migrated);
    LOG.warn("Migrated the stored live picture from data model {} to {}: {} objects got the data type {} and the "
            + "data source {}, {} layers unchanged, at sequence {} ({} journal events folded in). The {} files are kept in {}",
        from, ModelJson.DATA_MODEL, migrated.objects().size(), MapObjectContent.GENERAL, MapObjectContent.MANUAL,
        migrated.layers().size(), migrated.sequenceNo(), events.size(), from, kept);
    return new Stored(migrated, List.of());
  }

  /** Copies the snapshot and the journal into {@value #KEPT_0_1_0}, unless an earlier attempt did. */
  private Path keepCopy() {
    Path kept = directory.resolve(KEPT_0_1_0);
    if (Files.isDirectory(kept)) {
      LOG.warn("{} exists already (an earlier migration did not finish); keeping it as it is", kept);
      return kept;
    }
    Path temporary = directory.resolve(KEPT_0_1_0 + ".tmp");
    try {
      if (Files.isDirectory(temporary)) {
        try (var files = Files.list(temporary)) {
          for (Path f : files.toList()) {
            Files.delete(f);
          }
        }
      }
      Files.createDirectories(temporary);
      for (String name : List.of(SNAPSHOT, JOURNAL)) {
        Path file = directory.resolve(name);
        if (Files.exists(file)) {
          Files.copy(file, temporary.resolve(name), StandardCopyOption.COPY_ATTRIBUTES);
        }
      }
      move(temporary, kept);
    } catch (IOException e) {
      throw new UncheckedIOException("cannot keep a copy of the stored data in " + kept + "; nothing was migrated", e);
    }
    return kept;
  }

  /** What a snapshot file holds: the data model it names (0.1.0 if none) and the picture. */
  private record Snapshot(String dataModel, PictureSnapshot snapshot) {}

  private Snapshot readSnapshot(Path file) {
    long sequenceNo = -1;
    String format = null;
    String dataModel = null;
    List<Layer> layers = new ArrayList<>();
    List<MapObject> objects = new ArrayList<>();
    try (InputStream in = Files.newInputStream(file); JsonParser parser = json.parser(in)) {
      expect(parser.nextToken(), JsonToken.START_OBJECT, file);
      while (parser.nextToken() == JsonToken.PROPERTY_NAME) {
        String name = parser.currentName();
        JsonToken value = parser.nextToken();
        switch (name) {
          case "format" -> format = parser.getString();
          case "dataModel" -> {
            if (!layers.isEmpty() || !objects.isEmpty()) {
              throw new IllegalStateException(file + ": dataModel must come before the layers and objects");
            }
            dataModel = checkDataModel(parser.getString(), file);
          }
          case "sequenceNo" -> sequenceNo = parser.getLongValue();
          case "layers" -> {
            expect(value, JsonToken.START_ARRAY, file);
            while (parser.nextToken() == JsonToken.START_OBJECT) {
              layers.add((Layer) json.fromTree(Document.LAYER, json.readTree(parser)));
            }
          }
          case "objects" -> {
            expect(value, JsonToken.START_ARRAY, file);
            boolean migrate = dataModel == null || major(dataModel) < major(ModelJson.DATA_MODEL);
            while (parser.nextToken() == JsonToken.START_OBJECT) {
              JsonNode tree = json.readTree(parser);
              objects.add((MapObject) json.fromTree(Document.MAP_OBJECT, migrate ? Migration.object(tree) : tree));
            }
          }
          default -> parser.skipChildren();
        }
      }
    } catch (IOException e) {
      throw new UncheckedIOException("cannot read " + file, e);
    } catch (InvalidDocumentException e) {
      throw new IllegalStateException(file + " contains an invalid document: " + e.getMessage(), e);
    }
    if (!FORMAT.equals(format) || sequenceNo < 0) {
      throw new IllegalStateException(file + " is not an emc2 picture (format " + FORMAT + ")");
    }
    return new Snapshot(dataModel == null ? Migration.FROM : dataModel, new PictureSnapshot(sequenceNo, layers, objects));
  }

  /** Refuses data of a newer major version than this server knows: it is never rewritten. */
  private static String checkDataModel(String dataModel, Path file) {
    if (major(dataModel) > major(ModelJson.DATA_MODEL)) {
      throw new IllegalStateException(file + " holds data model " + dataModel + ", newer than this server's "
          + ModelJson.DATA_MODEL + ": it is not read and not rewritten; use a newer server");
    }
    return dataModel;
  }

  private static int major(String version) {
    int dot = version.indexOf('.');
    try {
      return Integer.parseInt(dot < 0 ? version : version.substring(0, dot));
    } catch (NumberFormatException e) {
      throw new IllegalStateException("not a data model version: " + version, e);
    }
  }

  /** True if the journal has any line that is not blank. */
  private static boolean hasEvents(Path file) {
    if (!Files.exists(file)) {
      return false;
    }
    try (var lines = Files.lines(file, StandardCharsets.UTF_8)) {
      return lines.anyMatch(line -> !line.isBlank());
    } catch (IOException | UncheckedIOException e) {
      throw new IllegalStateException("cannot read " + file + ": " + e, e);
    }
  }

  private static void expect(@Nullable JsonToken actual, JsonToken expected, Path file) {
    if (actual != expected) {
      throw new IllegalStateException(file + ": expected " + expected + " but found " + actual);
    }
  }

  /**
   * Reads the journal events after {@code afterSequenceNo} and repairs its end, so that the next
   * append starts on a fresh line. Every line the store wrote ends with LF; only the text after the
   * last LF can be cut short by a crash. If that text is a valid change event, it is kept and gets
   * its LF; otherwise it is cut off. A damaged line that ends with LF is real damage and stops the
   * start.
   *
   * <p>Events the snapshot already holds are skipped before they are validated: after a crash
   * between writing a migrated snapshot and emptying the journal, those are still 0.1.0 events.
   * With {@code migrate}, the others are 0.1.0 events and are read as migrated ones.
   */
  private List<JournalEntry> readJournal(Path file, long afterSequenceNo, boolean migrate) {
    if (!Files.exists(file)) {
      return List.of();
    }
    byte[] bytes;
    try {
      bytes = Files.readAllBytes(file);
    } catch (IOException e) {
      throw new UncheckedIOException("cannot read " + file, e);
    }
    Chain events = new Chain(afterSequenceNo, file);
    int start = 0;
    for (int lineNo = 1; start < bytes.length; lineNo++) {
      int end = indexOfLf(bytes, start);
      boolean terminated = end < bytes.length;
      String line = new String(bytes, start, end - start, StandardCharsets.UTF_8);
      if (!terminated) {
        repairTail(file, bytes.length, start, line, lineNo, afterSequenceNo, migrate, events);
        break;
      }
      if (!line.isBlank()) {
        JournalEntry entry;
        try {
          entry = entry(line, afterSequenceNo, migrate);
        } catch (InvalidDocumentException e) {
          throw new IllegalStateException(file + " line " + lineNo + " is damaged: " + e.getMessage(), e);
        }
        if (entry != null) {
          events.accept(entry, lineNo);
        }
      }
      start = end + 1;
    }
    return events.entries;
  }

  /**
   * One journal line: a change event, or a declaration about updates that were not saved
   * (ADR-0041); null if the snapshot holds it already. A declaration is skipped with the events
   * it stands for: a run of sequence numbers by its last one, a version by the event it precedes.
   */
  private @Nullable JournalEntry entry(String line, long afterSequenceNo, boolean migrate) {
    JsonNode tree = json.parse(line);
    JsonNode notSaved = tree.get(NOT_SAVED);
    if (notSaved != null) {
      long from = number(notSaved, "from");
      long to = number(notSaved, "to");
      if (to < from) {
        throw new InvalidDocumentException("a declaration of updates not saved needs from <= to, not " + from + " to " + to, List.of());
      }
      return to <= afterSequenceNo ? null : new JournalEntry.NotSaved(Math.max(from, afterSequenceNo + 1), to);
    }
    JsonNode version = tree.get(NOT_SAVED_VERSION);
    if (version != null) {
      long before = number(version, "before");
      return before <= afterSequenceNo ? null : new JournalEntry.NotSavedVersion(id(version), number(version, "version"), before);
    }
    JsonNode sequenceNo = tree.get("sequenceNo");
    if (sequenceNo != null && sequenceNo.isIntegralNumber() && sequenceNo.longValue() <= afterSequenceNo) {
      return null;
    }
    return new JournalEntry.Event((ChangeEvent) json.fromTree(Document.CHANGE_EVENT, migrate ? Migration.event(tree) : tree));
  }

  private static long number(JsonNode declaration, String name) {
    JsonNode value = declaration.get(name);
    if (value == null || !value.isIntegralNumber() || value.longValue() < 1) {
      throw new InvalidDocumentException("a declaration of updates not saved needs a positive whole " + name, List.of());
    }
    return value.longValue();
  }

  private static UUID id(JsonNode declaration) {
    JsonNode id = declaration.get("id");
    try {
      if (id != null && id.isString()) {
        return UUID.fromString(id.stringValue());
      }
    } catch (IllegalArgumentException e) {
      // falls through
    }
    throw new InvalidDocumentException("a declaration of a version not saved needs the object's id", List.of());
  }

  /** The text after the last LF ({@code tail}, starting at byte {@code start}): see {@link #readJournal}. */
  private void repairTail(Path file, int length, int start, String tail, int lineNo, long afterSequenceNo,
      boolean migrate, Chain events) {
    boolean complete = false;
    if (!tail.isBlank()) {
      try {
        JournalEntry entry = entry(tail, afterSequenceNo, migrate);
        if (entry != null) {
          events.accept(entry, lineNo);
        }
        complete = true; // only its LF was not written
      } catch (InvalidDocumentException e) {
        LOG.warn("Cutting off the incomplete last line {} of {} ({} bytes, written when the server stopped): {}",
            lineNo, file, length - start, e.getMessage());
      }
    }
    try (FileChannel channel = FileChannel.open(file, StandardOpenOption.WRITE)) {
      if (complete) {
        channel.write(ByteBuffer.wrap(LF), length);
        LOG.warn("The last line {} of {} had no line end; added it", lineNo, file);
      } else {
        channel.truncate(start);
      }
      channel.force(true);
    } catch (IOException e) {
      throw new UncheckedIOException("cannot repair the end of " + file, e);
    }
  }

  /**
   * The journal's entries after the snapshot, checked as a chain: each event has the next sequence
   * number, a declared run of updates not saved starts at it, and a declared version stands just
   * before its event. Anything else is a gap, and stops the start.
   */
  private static final class Chain {
    private final List<JournalEntry> entries = new ArrayList<>();
    private final Path file;
    private long expected;

    Chain(long afterSequenceNo, Path file) {
      this.expected = afterSequenceNo + 1;
      this.file = file;
    }

    void accept(JournalEntry entry, int lineNo) {
      long found = switch (entry) {
        case JournalEntry.Event e -> e.event().sequenceNo();
        case JournalEntry.NotSaved n -> n.from();
        case JournalEntry.NotSavedVersion v -> v.before();
      };
      if (found != expected) {
        throw new IllegalStateException(file + " line " + lineNo + ": expected change event " + expected + ", found "
            + (entry instanceof JournalEntry.Event ? "" : "a declaration at ") + found);
      }
      expected = switch (entry) {
        case JournalEntry.Event e -> found + 1;
        case JournalEntry.NotSaved n -> n.to() + 1;
        case JournalEntry.NotSavedVersion v -> found; // its event comes next
      };
      entries.add(entry);
    }
  }

  /** The index of the next LF at or after {@code from}, or {@code bytes.length}. */
  private static int indexOfLf(byte[] bytes, int from) {
    for (int i = from; i < bytes.length; i++) {
      if (bytes[i] == '\n') {
        return i;
      }
    }
    return bytes.length;
  }

  /** Fails the start now, not at the first change, if the data directory cannot be written. */
  private void checkWritable() {
    try {
      FileChannel.open(directory.resolve(JOURNAL), StandardOpenOption.CREATE, StandardOpenOption.APPEND).close();
      Files.delete(Files.createTempFile(directory, "write-check", ".tmp"));
    } catch (IOException e) {
      throw new IllegalStateException("the data directory " + directory + " is not writable: " + e, e);
    }
  }

  @Override
  public void append(ChangeEvent event) {
    try {
      journal().write(json.write(event));
      journal().write('\n'); // LF on every platform
    } catch (IOException e) {
      throw new UncheckedIOException("cannot append to " + directory.resolve(JOURNAL), e);
    }
  }

  @Override
  public void appendNotSaved(long from, long to) {
    appendLine("{\"" + NOT_SAVED + "\":{\"from\":" + from + ",\"to\":" + to + "}}");
  }

  @Override
  public void appendNotSavedVersion(UUID id, long version, long before) {
    appendLine("{\"" + NOT_SAVED_VERSION + "\":{\"id\":\"" + id + "\",\"version\":" + version + ",\"before\":" + before + "}}");
  }

  private void appendLine(String line) {
    try {
      journal().write(line);
      journal().write('\n'); // LF on every platform
    } catch (IOException e) {
      throw new UncheckedIOException("cannot append to " + directory.resolve(JOURNAL), e);
    }
  }

  @Override
  public void flush() {
    if (journal == null || journalFile == null) {
      return;
    }
    try {
      journal.flush();
      journalFile.getChannel().force(false);
    } catch (IOException e) {
      throw new UncheckedIOException("cannot flush " + directory.resolve(JOURNAL), e);
    }
  }

  @Override
  public void replaceWith(PictureSnapshot snapshot) {
    Path target = directory.resolve(SNAPSHOT);
    Path temporary = directory.resolve(SNAPSHOT + ".tmp");
    try {
      try (FileOutputStream out = new FileOutputStream(temporary.toFile())) {
        JsonGenerator generator = json.generator(out);
        writeSnapshot(snapshot, generator);
        generator.flush();
        out.getChannel().force(true); // durable before it replaces the old snapshot
        generator.close(); // also closes out
      }
      move(temporary, target);
      // A failure from here on is safe: a load skips the journal's lines that the snapshot holds.
      closeJournal();
      Files.newOutputStream(directory.resolve(JOURNAL)).close(); // truncate: the snapshot holds it all
    } catch (IOException e) {
      throw new UncheckedIOException("cannot write " + target, e);
    }
    LOG.debug("Snapshot at sequence {} written to {}", snapshot.sequenceNo(), target);
  }

  private void writeSnapshot(PictureSnapshot snapshot, JsonGenerator generator) {
    {
      generator.writeStartObject();
      generator.writeStringProperty("format", FORMAT);
      generator.writeStringProperty("dataModel", ModelJson.DATA_MODEL);
      generator.writeNumberProperty("sequenceNo", snapshot.sequenceNo());
      generator.writeName("layers");
      generator.writeStartArray();
      for (Layer layer : snapshot.layers()) {
        generator.writeTree(json.toTree(layer));
      }
      generator.writeEndArray();
      generator.writeName("objects");
      generator.writeStartArray();
      for (MapObject object : snapshot.objects()) {
        generator.writeTree(json.toTree(object));
      }
      generator.writeEndArray();
      generator.writeEndObject();
    }
  }

  private static void move(Path from, Path to) throws IOException {
    try {
      Files.move(from, to, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    } catch (AtomicMoveNotSupportedException e) {
      Files.move(from, to, StandardCopyOption.REPLACE_EXISTING);
    }
  }

  private Writer journal() throws IOException {
    if (journal == null) {
      journalFile = new FileOutputStream(directory.resolve(JOURNAL).toFile(), true);
      journal = new OutputStreamWriter(journalFile, StandardCharsets.UTF_8);
    }
    return journal;
  }

  private void closeJournal() throws IOException {
    if (journal != null) {
      journal.close(); // also closes journalFile
    }
    journal = null;
    journalFile = null;
  }

  @Override
  public void close() {
    try {
      flush();
      closeJournal();
    } catch (IOException e) {
      throw new UncheckedIOException("cannot close " + directory.resolve(JOURNAL), e);
    }
  }
}
