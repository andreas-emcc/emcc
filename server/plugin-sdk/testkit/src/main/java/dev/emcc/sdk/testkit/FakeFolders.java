package dev.emcc.sdk.testkit;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.folder.FolderResult;
import dev.emcc.sdk.folder.LocalFolder;
import dev.emcc.sdk.folder.LocalFolders;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.SeekableByteChannel;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
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
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.4.0: the local folders of {@link FakePluginContext} ({@code ctx.folders()}; CR-0030 part
 * 6), over real test directories, with ECore's checks: paths resolved with their links and refused
 * outside the folder, reads over {@link LocalFolder#MAX_READ_BYTES} and listings over {@link
 * LocalFolder#MAX_ENTRIES} refused, at most {@link LocalFolder#MAX_CONCURRENT_CALLS} calls at a
 * time, and nothing ever written. Each result arrives at the next {@code ctx.runUntilIdle()}.
 *
 * <pre>{@code
 * var ctx = FakePluginContext.builder("terrain").folder("heights", tempDir).build();
 * ctx.folders().folder("heights").read("n59.dt2", 0, 3428, Duration.ofSeconds(5), worker, TerrainMsg.Read::new);
 * ctx.runUntilIdle();
 *
 * ctx.folders().setPath("heights", null);   // the admin empties the setting: NOT_SET from now on
 * ctx.folders().hold();                     // calls stay in progress: test BUSY and TIMEOUT
 * ctx.advance(Duration.ofSeconds(6));
 * }</pre>
 */
public final class FakeFolders implements LocalFolders {

  /** One call the plugin made, in order. */
  public record Call(String folder, String operation, String path) {}

  private final FakePluginContext ctx;
  private final Map<String, @Nullable Path> paths;
  private final List<Call> calls = new ArrayList<>();
  private final List<Runnable> held = new ArrayList<>();
  private boolean holding;
  private int inFlight;

  FakeFolders(FakePluginContext ctx, Map<String, @Nullable Path> declared) {
    this.ctx = ctx;
    this.paths = new LinkedHashMap<>(declared);
  }

  @Override
  public LocalFolder folder(String id) {
    if (!paths.containsKey(id)) {
      throw new IllegalArgumentException("no folder \"" + id + "\" is declared; declared: " + paths.keySet());
    }
    return new Folder(id);
  }

  @Override
  public List<String> ids() {
    return List.copyOf(paths.keySet());
  }

  /** As an admin changing the folder's setting: {@code null} empties it. Applies to calls made after it. */
  public void setPath(String id, @Nullable Path path) {
    folder(id);
    paths.put(id, path);
  }

  /** From now on calls stay in progress until {@link #release()} or their timeout. */
  public void hold() {
    holding = true;
  }

  /** Completes the held calls and stops holding. */
  public void release() {
    holding = false;
    List<Runnable> waiting = List.copyOf(held);
    held.clear();
    waiting.forEach(Runnable::run);
  }

  /** The calls the plugin made, in order. */
  public List<Call> calls() {
    return List.copyOf(calls);
  }

  /** The calls in progress now. */
  public int inFlight() {
    return inFlight;
  }

  private final class Folder implements LocalFolder {
    private final String id;

    Folder(String id) {
      this.id = id;
    }

    @Override
    public String id() {
      return id;
    }

    @Override
    public <M extends Message> void list(String relativeDir, Duration timeout, WorkerRef<M> target, Function<FolderResult, ? extends M> toMessage) {
      Objects.requireNonNull(relativeDir, "relativeDir");
      call(new Call(id, "list", relativeDir), timeout, target, toMessage, () -> doList(id, relativeDir));
    }

    @Override
    public <M extends Message> void read(
        String relativePath, long offset, int length, Duration timeout, WorkerRef<M> target, Function<FolderResult, ? extends M> toMessage) {
      Objects.requireNonNull(relativePath, "relativePath");
      if (offset < 0 || length < 1) {
        throw new IllegalArgumentException("offset is at least 0 and length at least 1: " + offset + ", " + length);
      }
      call(new Call(id, "read", relativePath), timeout, target, toMessage, () -> doRead(id, relativePath, offset, length));
    }
  }

  private <M extends Message> void call(Call call, Duration timeout, WorkerRef<M> target, Function<FolderResult, ? extends M> toMessage, Supplier<FolderResult> work) {
    Objects.requireNonNull(target, "target");
    Objects.requireNonNull(toMessage, "toMessage");
    if (timeout.compareTo(Duration.ofMillis(1)) < 0 || timeout.compareTo(Duration.ofMinutes(10)) > 0) {
      throw new IllegalArgumentException("a folder call's timeout is 1 ms..10 min: " + timeout);
    }
    calls.add(call);
    if (inFlight >= LocalFolder.MAX_CONCURRENT_CALLS) {
      FolderResult busy = new FolderResult.Failed(call.path(), FolderResult.Reason.BUSY, LocalFolder.MAX_CONCURRENT_CALLS + " calls are in progress");
      ctx.deliverAlways(target, () -> toMessage.apply(busy));
      return;
    }
    inFlight++;
    boolean[] done = new boolean[1];
    Consumer<FolderResult> finish = result -> {
      if (!done[0]) {
        done[0] = true;
        inFlight--;
        ctx.deliverAlways(target, () -> toMessage.apply(result));
      }
    };
    ctx.after(timeout, () -> finish.accept(new FolderResult.Failed(call.path(), FolderResult.Reason.TIMEOUT, "no result within " + timeout)));
    Runnable run = () -> finish.accept(work.get());
    if (holding) {
      held.add(run);
    } else {
      run.run();
    }
  }

  /** The resolved real path inside the folder, or the failure. */
  private sealed interface Resolved permits Inside, Refused {}

  private record Inside(Path path) implements Resolved {}

  private record Refused(FolderResult.Failed failure) implements Resolved {}

  private Resolved resolve(String id, String relative) {
    if (!LocalFolder.isWellFormed(relative)) {
      return refused(relative, FolderResult.Reason.INVALID_PATH, "not a relative path with / between names");
    }
    Path root = paths.get(id);
    if (root == null) {
      return refused(relative, FolderResult.Reason.NOT_SET, "the folder \"" + id + "\" is not set");
    }
    Path realRoot;
    try {
      if (!Files.isDirectory(root) || !Files.isReadable(root)) {
        return refused(relative, FolderResult.Reason.MISSING, "the folder \"" + id + "\" does not exist or cannot be read");
      }
      realRoot = root.toRealPath();
    } catch (IOException e) {
      return refused(relative, FolderResult.Reason.MISSING, "the folder \"" + id + "\" cannot be read");
    }
    Path lexical = relative.isEmpty() ? realRoot : realRoot.resolve(relative).normalize();
    if (!lexical.startsWith(realRoot)) {
      return refused(relative, FolderResult.Reason.OUTSIDE, "the path lies outside the folder");
    }
    if (!Files.exists(lexical, LinkOption.NOFOLLOW_LINKS)) {
      return refused(relative, FolderResult.Reason.NOT_FOUND, "nothing at " + relative);
    }
    try {
      Path real = lexical.toRealPath();
      if (!real.startsWith(realRoot)) {
        return refused(relative, FolderResult.Reason.OUTSIDE, "the path's link leads outside the folder");
      }
      return new Inside(real);
    } catch (NoSuchFileException e) {
      return refused(relative, FolderResult.Reason.NOT_FOUND, "nothing at " + relative + " (a broken link)");
    } catch (IOException e) {
      return refused(relative, FolderResult.Reason.IO, "cannot resolve " + relative);
    }
  }

  private static Refused refused(String path, FolderResult.Reason reason, String message) {
    return new Refused(new FolderResult.Failed(path, reason, message));
  }

  private FolderResult doList(String id, String relativeDir) {
    switch (resolve(id, relativeDir)) {
      case Refused r -> {
        return r.failure();
      }
      case Inside in -> {
        if (!Files.isDirectory(in.path())) {
          return new FolderResult.Failed(relativeDir, FolderResult.Reason.WRONG_KIND, relativeDir + " is a file, not a directory");
        }
        var entries = new ArrayList<FolderResult.Entry>();
        try (DirectoryStream<Path> dir = Files.newDirectoryStream(in.path())) {
          for (Path p : dir) {
            if (entries.size() == LocalFolder.MAX_ENTRIES) {
              return new FolderResult.Failed(relativeDir, FolderResult.Reason.TOO_LARGE, "more than " + LocalFolder.MAX_ENTRIES + " entries");
            }
            BasicFileAttributes a;
            try {
              a = Files.readAttributes(p, BasicFileAttributes.class); // a link as its target
            } catch (IOException | SecurityException e) {
              continue; // a broken link or an entry that cannot be read is left out, as ECore does (owner, LG)
            }
            boolean directory = a.isDirectory();
            entries.add(new FolderResult.Entry(p.getFileName().toString(), directory, directory ? 0 : a.size(), a.lastModifiedTime().toInstant()));
          }
        } catch (IOException e) {
          return new FolderResult.Failed(relativeDir, FolderResult.Reason.IO, "cannot list " + relativeDir);
        }
        return new FolderResult.Listing(relativeDir, entries);
      }
    }
  }

  private FolderResult doRead(String id, String relativePath, long offset, int length) {
    if (length > LocalFolder.MAX_READ_BYTES) {
      return new FolderResult.Failed(relativePath, FolderResult.Reason.TOO_LARGE, "a read is at most " + LocalFolder.MAX_READ_BYTES + " bytes: " + length);
    }
    switch (resolve(id, relativePath)) {
      case Refused r -> {
        return r.failure();
      }
      case Inside in -> {
        if (Files.isDirectory(in.path())) {
          return new FolderResult.Failed(relativePath, FolderResult.Reason.WRONG_KIND, relativePath + " is a directory, not a file");
        }
        try (SeekableByteChannel ch = Files.newByteChannel(in.path(), StandardOpenOption.READ)) {
          long size = ch.size();
          if (offset >= size) {
            return new FolderResult.Read(relativePath, offset, Bytes.empty(), size);
          }
          var buffer = ByteBuffer.allocate((int) Math.min(length, size - offset));
          ch.position(offset);
          while (buffer.hasRemaining() && ch.read(buffer) >= 0) {
            // read until full or at the end
          }
          byte[] data = new byte[buffer.position()];
          buffer.flip().get(data);
          return new FolderResult.Read(relativePath, offset, Bytes.of(data), size);
        } catch (IOException e) {
          return new FolderResult.Failed(relativePath, FolderResult.Reason.IO, "cannot read " + relativePath);
        }
      }
    }
  }
}
