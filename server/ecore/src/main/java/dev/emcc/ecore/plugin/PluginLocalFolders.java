package dev.emcc.ecore.plugin;

import dev.emcc.ecore.runtime.Cancellable;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.folder.FolderResult;
import dev.emcc.sdk.folder.FolderResult.Reason;
import dev.emcc.sdk.folder.LocalFolder;
import dev.emcc.sdk.folder.LocalFolders;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.ClosedByInterruptException;
import java.nio.channels.SeekableByteChannel;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.LinkOption;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * A plugin's local folders (SDK 1.4.0, CR-0030 part 6, ADR-0049 point 4; model rule 19): ECore reads
 * them for the plugin, read only, on its own I/O threads, never on a worker, and delivers exactly
 * one {@link FolderResult} to the target worker, always (whatever its overflow policy), as {@link
 * PluginHttp} does. The mapper runs inside the target worker.
 *
 * <p><b>The folder's path</b> is the settings string the manifest's {@code setting} points to, read
 * at each call, so a changed setting applies at once to later calls. Only an admin sets it; a path
 * never comes from a request, a message or an object (ADR-0030).
 *
 * <p><b>Confinement</b> (the ACA's R3 on part 6): every path is resolved with its links against the
 * folder's real path, and ECore then opens that resolved real path, never the path as given, with
 * {@link LinkOption#NOFOLLOW_LINKS} where the platform allows it. A path that lies outside, or whose
 * link leads outside, is {@link Reason#OUTSIDE}. Nothing is ever written, created or deleted.
 *
 * <p><b>Relative to emcc</b> (SDK 1.6.0, CR-0041 part H; T-157): a setting that starts with {@code
 * %emcc%/} or {@code %emcc%\} is resolved below the emcc folder, the folder the server was started in
 * (its working directory, which {@code start.bat} sets; owner, 2026-11-12). A result outside it, by
 * {@code ..} or, once read, by a link, is unusable: {@link Reason#MISSING} with "outside the emcc
 * folder". The Monitor shows the setting as typed and the folder it resolves to.
 *
 * <p><b>Texts:</b> a result's message, and every log line, names the folder's id and the relative
 * path, never the absolute path (ADR-0030; the ACA's review of part 6), and never an exception's
 * message, which would name it.
 */
final class PluginLocalFolders implements LocalFolders {

  /** The longest allowed timeout of one call, as for outbound HTTP. */
  static final Duration MAX_TIMEOUT = Duration.ofMinutes(10);

  private static final Logger LOG = LoggerFactory.getLogger(PluginLocalFolders.class);

  private final String pluginId;
  private final Map<String, Folder> folders = new LinkedHashMap<>();
  private final Supplier<JsonObject> settings;
  private final WorkerRuntime runtime;
  private final Executor io;
  private final AtomicInteger inFlight = new AtomicInteger();
  private final AtomicBoolean checking = new AtomicBoolean();
  private volatile List<Status> checked;
  /** SDK 1.6.0: the emcc folder, absolute and normalized, below which a {@code %emcc%/} setting resolves. */
  private final Path emcc;

  /**
   * @param declared the manifest's folders, in its order; rule 19 is checked
   * @param settings the plugin's settings now
   * @param io where the I/O runs: the runtime's I/O executor, or a test's
   */
  PluginLocalFolders(String pluginId, List<PluginManifest.Folder> declared, Supplier<JsonObject> settings, WorkerRuntime runtime,
      Executor io) {
    this(pluginId, declared, settings, runtime, io, Path.of("").toAbsolutePath());
  }

  /** @param emcc SDK 1.6.0: the emcc folder, the server's working directory (a test's folder) */
  PluginLocalFolders(String pluginId, List<PluginManifest.Folder> declared, Supplier<JsonObject> settings, WorkerRuntime runtime,
      Executor io, Path emcc) {
    this.emcc = emcc.toAbsolutePath().normalize();
    this.pluginId = Objects.requireNonNull(pluginId, "pluginId");
    this.settings = Objects.requireNonNull(settings, "settings");
    this.runtime = Objects.requireNonNull(runtime, "runtime");
    this.io = Objects.requireNonNull(io, "io");
    declared.forEach(f -> folders.put(f.id(), new Folder(f)));
    this.checked = check(false);
    refresh(); // so that the Monitor's first look has the answer
  }

  @Override
  public LocalFolder folder(String id) {
    Folder f = folders.get(Objects.requireNonNull(id, "id"));
    if (f == null) {
      throw new IllegalArgumentException("plugin " + pluginId + " declares no folder \"" + id + "\"; declared: " + folders.keySet());
    }
    return f;
  }

  @Override
  public List<String> ids() {
    return List.copyOf(folders.keySet());
  }

  /** How many calls of this plugin are in progress (tests). */
  int inFlight() {
    return inFlight.get();
  }

  /**
   * Each declared folder as the Monitor shows it (ADR-0049 point 4), as last checked, and a new check
   * started on the I/O executor unless one is running. The Monitor never waits for the file system
   * (overview 4.10: a hung share cannot hold it up); it polls, so the next snapshot has the new check.
   */
  List<Status> statuses() {
    refresh();
    return checked;
  }

  private void refresh() {
    if (folders.isEmpty() || !checking.compareAndSet(false, true)) {
      return;
    }
    try {
      io.execute(() -> {
        try {
          checked = check(true);
        } finally {
          checking.set(false);
        }
      });
    } catch (RejectedExecutionException e) { // the runtime is closing
      checking.set(false);
    }
  }

  /** Each folder's path from its setting now, and, with {@code look}, whether it is a readable directory. */
  private List<Status> check(boolean look) {
    List<Status> all = new ArrayList<>();
    for (Folder f : folders.values()) {
      String path = null;
      String resolved = null;
      String state;
      switch (f.root()) {
        case Root.Unset u -> state = "NOT_SET";
        case Root.Unusable u -> {
          path = u.setting();
          state = "MISSING";
        }
        case Root.Outside o -> {
          path = o.setting();
          state = "MISSING";
        }
        case Root.At at -> {
          path = at.setting();
          resolved = at.relative() ? at.path().toString() : null; // SDK 1.6.0: an %emcc% setting's folder
          state = !look ? "CHECKING" : readableDirectory(at.path()) && inEmcc(at) ? "READABLE" : "MISSING";
        }
      }
      all.add(new Status(f.declared.id(), f.declared.reason(), f.declared.setting(), path, resolved, state));
    }
    return List.copyOf(all);
  }

  /**
   * One declared folder for the Monitor.
   *
   * @param setting the JSON Pointer into the settings that holds its path
   * @param path the path its setting holds, as typed, or {@code null} while it is empty
   * @param resolved SDK 1.6.0: for a setting relative to emcc ({@code %emcc%/...}), the folder it
   *     resolves to; {@code null} otherwise
   * @param state {@code READABLE}; {@code NOT_SET}; {@code MISSING} (not there, not a directory, not
   *     readable, not an absolute path, or outside the emcc folder); or {@code CHECKING} until the
   *     first check is done
   */
  record Status(String id, String reason, String setting, @Nullable String path, @Nullable String resolved, String state) {}

  /** Whether a folder relative to emcc lies inside it with its links followed; an absolute setting always does. */
  private boolean inEmcc(Root.At at) {
    if (!at.relative()) {
      return true;
    }
    try {
      return at.path().toRealPath().startsWith(emcc.toRealPath());
    } catch (IOException | SecurityException e) {
      return false;
    }
  }

  private static boolean readableDirectory(Path path) {
    try {
      return Files.isDirectory(path) && Files.isReadable(path);
    } catch (SecurityException e) {
      return false;
    }
  }

  /** The folder's path as its setting holds it now. */
  private sealed interface Root permits Root.Unset, Root.Unusable, Root.Outside, Root.At {
    /** The setting is empty, absent, or not a string. */
    record Unset() implements Root {}

    /** The setting holds a text that is not an absolute path, nor one relative to emcc. */
    record Unusable(String setting) implements Root {}

    /** SDK 1.6.0: the setting is relative to emcc, but leads outside it. */
    record Outside(String setting) implements Root {}

    /** @param relative SDK 1.6.0: the setting was relative to emcc ({@code %emcc%/...}) */
    record At(Path path, String setting, boolean relative) implements Root {}
  }

  private final class Folder implements LocalFolder {
    private final PluginManifest.Folder declared;

    Folder(PluginManifest.Folder declared) {
      this.declared = declared;
    }

    PluginLocalFolders outer() {
      return PluginLocalFolders.this;
    }

    @Override
    public String id() {
      return declared.id();
    }

    Root root() {
      JsonValue value = settings.get();
      for (String name : declared.setting().substring(1).split("/")) {
        value = value instanceof JsonObject o ? o.get(name) : null;
      }
      if (!(value instanceof JsonString s) || s.value().isBlank()) {
        return new Root.Unset();
      }
      String typed = s.value();
      try {
        if (typed.startsWith(LocalFolder.EMCC_PREFIX) || typed.startsWith("%emcc%\\")) { // SDK 1.6.0 (CR-0041 part H)
          String rest = typed.substring(LocalFolder.EMCC_PREFIX.length()).replace('\\', '/');
          Path below = emcc.resolve(rest).normalize();
          return below.startsWith(emcc) ? new Root.At(below, typed, true) : new Root.Outside(typed);
        }
        Path path = Path.of(typed);
        return path.isAbsolute() ? new Root.At(path, typed, false) : new Root.Unusable(typed);
      } catch (InvalidPathException e) {
        return new Root.Unusable(typed);
      }
    }

    @Override
    public <M extends Message> void list(String relativeDir, Duration timeout, WorkerRef<M> target, Function<FolderResult, ? extends M> toMessage) {
      Objects.requireNonNull(relativeDir, "relativeDir");
      call(relativeDir, "list", timeout, target, toMessage, () -> doList(this, relativeDir));
    }

    @Override
    public <M extends Message> void read(
        String relativePath, long offset, int length, Duration timeout, WorkerRef<M> target, Function<FolderResult, ? extends M> toMessage) {
      Objects.requireNonNull(relativePath, "relativePath");
      if (offset < 0 || length < 1) {
        throw new IllegalArgumentException("offset is at least 0 and length at least 1: " + offset + ", " + length);
      }
      call(relativePath, "read", timeout, target, toMessage, () -> doRead(this, relativePath, offset, length));
    }
  }

  private <M extends Message> void call(String path, String operation, Duration timeout, WorkerRef<M> target,
      Function<FolderResult, ? extends M> toMessage, Supplier<FolderResult> work) {
    Objects.requireNonNull(timeout, "timeout");
    Objects.requireNonNull(toMessage, "toMessage");
    WorkerHandle<M> handle = PluginWorkers.handleOf(Objects.requireNonNull(target, "target"));
    if (timeout.compareTo(Duration.ofMillis(1)) < 0 || timeout.compareTo(MAX_TIMEOUT) > 0) {
      throw new IllegalArgumentException("a folder call's timeout is 1 ms to " + MAX_TIMEOUT + ": " + timeout);
    }
    if (WorkerRuntime.onFencedThread()) {
      LOG.warn("Plugin {}: dropped a folder {} made from a fenced thread", pluginId, operation);
      return;
    }
    Result<M> result = new Result<>(handle, toMessage);
    if (inFlight.incrementAndGet() > LocalFolder.MAX_CONCURRENT_CALLS) {
      inFlight.decrementAndGet();
      result.complete(new FolderResult.Failed(path, Reason.BUSY, LocalFolder.MAX_CONCURRENT_CALLS + " calls are in progress"));
      return;
    }
    // From here on the slot is given back once, by the first of the result and the timeout.
    AtomicBoolean released = new AtomicBoolean();
    Runnable release = () -> {
      if (released.compareAndSet(false, true)) {
        inFlight.decrementAndGet();
      }
    };
    AtomicReference<@Nullable Thread> running = new AtomicReference<>();
    Cancellable timer;
    try {
      timer = runtime.schedule(timeout, () -> {
        if (result.complete(new FolderResult.Failed(path, Reason.TIMEOUT, "no result within " + timeout), release)) {
          Thread t = running.get();
          if (t != null) {
            t.interrupt(); // a file channel read gives up on an interrupt (ClosedByInterruptException)
          }
        }
      });
    } catch (RuntimeException e) {
      release.run();
      result.complete(new FolderResult.Failed(path, Reason.IO, "could not start the " + operation));
      return;
    }
    try {
      io.execute(() -> {
        running.set(Thread.currentThread());
        FolderResult outcome;
        try {
          outcome = result.isDone() ? null : work.get();
        } catch (RuntimeException e) {
          LOG.warn("Plugin {}: a folder {} of {} failed: {}", pluginId, operation, path, e.getClass().getSimpleName());
          outcome = new FolderResult.Failed(path, Reason.IO, "the " + operation + " failed");
        } finally {
          running.set(null);
          Thread.interrupted(); // a late interrupt from the timer stays with this task
        }
        timer.cancel();
        if (outcome != null) {
          result.complete(outcome, release);
        }
      });
    } catch (RejectedExecutionException e) { // the runtime is closing
      timer.cancel();
      release.run();
      result.complete(new FolderResult.Failed(path, Reason.IO, "ECore is stopping"));
    }
  }

  /** The resolved real path inside the folder, or the failure. */
  private sealed interface Resolved permits Inside, Refused {}

  private record Inside(Path path, BasicFileAttributes attributes) implements Resolved {}

  private record Refused(FolderResult.Failed failure) implements Resolved {}

  /**
   * Resolves {@code relative} against the folder's real path, links included, and checks that the
   * result lies inside it. The caller opens {@link Inside#path()}, the real path, never the path as
   * given (R3).
   */
  private static Resolved resolve(Folder folder, String relative) {
    if (!LocalFolder.isWellFormed(relative)) {
      return refused(relative, Reason.INVALID_PATH, "not a relative path with / between names");
    }
    String id = folder.id();
    Path root;
    switch (folder.root()) {
      case Root.Unset u -> {
        return refused(relative, Reason.NOT_SET, "the folder \"" + id + "\" is not set");
      }
      case Root.Unusable u -> {
        return refused(relative, Reason.MISSING, "the setting of the folder \"" + id + "\" is not an absolute path");
      }
      case Root.Outside o -> {
        return refused(relative, Reason.MISSING, "the folder \"" + id + "\" is outside the emcc folder");
      }
      case Root.At at -> {
        root = at.path();
        if (!folder.outer().inEmcc(at) && readableDirectory(root)) { // a link out of the emcc folder (SDK 1.6.0)
          return refused(relative, Reason.MISSING, "the folder \"" + id + "\" is outside the emcc folder");
        }
      }
    }
    Path realRoot;
    try {
      if (!readableDirectory(root)) {
        return refused(relative, Reason.MISSING, "the folder \"" + id + "\" does not exist or cannot be read");
      }
      realRoot = root.toRealPath();
    } catch (IOException | SecurityException e) {
      return refused(relative, Reason.MISSING, "the folder \"" + id + "\" cannot be read");
    }
    Path lexical;
    try {
      lexical = relative.isEmpty() ? realRoot : realRoot.resolve(relative).normalize();
    } catch (InvalidPathException e) { // a name the platform cannot hold, e.g. "a:b" or "a*" on Windows
      return refused(relative, Reason.INVALID_PATH, "not a path on this server");
    }
    if (!lexical.startsWith(realRoot)) {
      return refused(relative, Reason.OUTSIDE, "the path lies outside the folder");
    }
    if (!Files.exists(lexical, LinkOption.NOFOLLOW_LINKS)) {
      return refused(relative, Reason.NOT_FOUND, "nothing at " + relative);
    }
    try {
      Path real = lexical.toRealPath();
      if (!real.startsWith(realRoot)) {
        return refused(relative, Reason.OUTSIDE, "the path's link leads outside the folder");
      }
      return new Inside(real, Files.readAttributes(real, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS));
    } catch (NoSuchFileException e) {
      return refused(relative, Reason.NOT_FOUND, "nothing at " + relative + " (a broken link)");
    } catch (IOException | SecurityException e) {
      return refused(relative, Reason.IO, "cannot resolve " + relative);
    }
  }

  private static Refused refused(String path, Reason reason, String message) {
    return new Refused(new FolderResult.Failed(path, reason, message));
  }

  private static FolderResult doList(Folder folder, String relativeDir) {
    switch (resolve(folder, relativeDir)) {
      case Refused r -> {
        return r.failure();
      }
      case Inside in -> {
        if (!in.attributes().isDirectory()) {
          return new FolderResult.Failed(relativeDir, Reason.WRONG_KIND, relativeDir + " is a file, not a directory");
        }
        List<FolderResult.Entry> entries = new ArrayList<>();
        try (DirectoryStream<Path> dir = Files.newDirectoryStream(in.path())) {
          for (Path p : dir) {
            if (entries.size() == LocalFolder.MAX_ENTRIES) {
              return new FolderResult.Failed(relativeDir, Reason.TOO_LARGE, "more than " + LocalFolder.MAX_ENTRIES + " entries");
            }
            BasicFileAttributes a;
            try {
              a = Files.readAttributes(p, BasicFileAttributes.class); // a link as its target, as the test kit lists it
            } catch (IOException | SecurityException e) {
              continue; // a broken link or an entry that cannot be read: left out, not the whole listing failed
            }
            boolean directory = a.isDirectory();
            entries.add(new FolderResult.Entry(p.getFileName().toString(), directory, directory ? 0 : a.size(), a.lastModifiedTime().toInstant()));
          }
        } catch (IOException | SecurityException e) {
          return new FolderResult.Failed(relativeDir, Reason.IO, "cannot list " + relativeDir);
        }
        return new FolderResult.Listing(relativeDir, entries);
      }
    }
  }

  private static FolderResult doRead(Folder folder, String relativePath, long offset, int length) {
    if (length > LocalFolder.MAX_READ_BYTES) {
      return new FolderResult.Failed(relativePath, Reason.TOO_LARGE, "a read is at most " + LocalFolder.MAX_READ_BYTES + " bytes: " + length);
    }
    switch (resolve(folder, relativePath)) {
      case Refused r -> {
        return r.failure();
      }
      case Inside in -> {
        if (in.attributes().isDirectory()) {
          return new FolderResult.Failed(relativePath, Reason.WRONG_KIND, relativePath + " is a directory, not a file");
        }
        // The resolved real path, without following a link that took its place since (R3).
        try (SeekableByteChannel ch = Files.newByteChannel(in.path(), StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
          long size = ch.size();
          if (offset >= size) {
            return new FolderResult.Read(relativePath, offset, Bytes.empty(), size);
          }
          ByteBuffer buffer = ByteBuffer.allocate((int) Math.min(length, size - offset));
          ch.position(offset);
          while (buffer.hasRemaining() && ch.read(buffer) >= 0) {
            // read until full or at the end
          }
          byte[] data = new byte[buffer.position()];
          buffer.flip().get(data);
          return new FolderResult.Read(relativePath, offset, Bytes.of(data), size);
        } catch (ClosedByInterruptException e) {
          return new FolderResult.Failed(relativePath, Reason.TIMEOUT, "the read was stopped");
        } catch (IOException | SecurityException | UnsupportedOperationException e) {
          return new FolderResult.Failed(relativePath, Reason.IO, "cannot read " + relativePath);
        }
      }
    }
  }

  /** Delivers the one result of a call, mapped inside the target worker. */
  private final class Result<M extends Message> {
    private final WorkerHandle<M> target;
    private final Function<FolderResult, ? extends M> toMessage;
    private final AtomicBoolean done = new AtomicBoolean();

    Result(WorkerHandle<M> target, Function<FolderResult, ? extends M> toMessage) {
      this.target = target;
      this.toMessage = toMessage;
    }

    boolean isDone() {
      return done.get();
    }

    /** Returns false if a result was already delivered. */
    boolean complete(FolderResult result) {
      return complete(result, () -> {});
    }

    /**
     * Returns false if a result was already delivered. Otherwise runs {@code beforeDelivery}, which
     * gives the call's slot back, and then delivers, so a plugin that calls again as soon as it has
     * the result finds the slot free.
     */
    boolean complete(FolderResult result, Runnable beforeDelivery) {
      if (!done.compareAndSet(false, true)) {
        return false;
      }
      beforeDelivery.run();
      runtime.deliverAlways(target, () -> toMessage.apply(result));
      return true;
    }
  }
}
