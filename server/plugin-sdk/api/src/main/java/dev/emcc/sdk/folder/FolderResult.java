package dev.emcc.sdk.folder;

import dev.emcc.sdk.Bytes;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;

/**
 * SDK 1.4.0: the outcome of a {@link LocalFolder} call, delivered to the worker as a message.
 * Exactly one arrives per call.
 *
 * <pre>{@code
 * switch (read.result()) {
 *   case FolderResult.Read r -> cells.put(r.path(), DtedCell.parse(r.data()));
 *   case FolderResult.Failed f -> answer(503, f.reason() + ": " + f.message());
 *   case FolderResult.Listing l -> {}
 * }
 * }</pre>
 */
public sealed interface FolderResult permits FolderResult.Listing, FolderResult.Read, FolderResult.Failed {

  /** The relative path the call named. */
  String path();

  /**
   * One directory's entries, sorted by name.
   *
   * @param path the directory, as the call named it
   * @param entries at most {@link LocalFolder#MAX_ENTRIES}
   */
  record Listing(String path, List<Entry> entries) implements FolderResult {
    public Listing {
      Objects.requireNonNull(path, "path");
      entries = entries.stream().sorted(Comparator.comparing(Entry::name)).toList();
      if (entries.size() > LocalFolder.MAX_ENTRIES) {
        throw new IllegalArgumentException("at most " + LocalFolder.MAX_ENTRIES + " entries: " + entries.size());
      }
    }
  }

  /**
   * One entry of a directory.
   *
   * @param name the name within its directory, without a path
   * @param directory true for a directory; false for a file
   * @param size the file's size in bytes; 0 for a directory
   * @param modified when it was last modified
   */
  record Entry(String name, boolean directory, long size, Instant modified) {
    public Entry {
      Objects.requireNonNull(name, "name");
      Objects.requireNonNull(modified, "modified");
      if (name.isEmpty() || name.contains("/")) {
        throw new IllegalArgumentException("an entry's name is one name, not a path: \"" + name + "\"");
      }
      if (size < 0) {
        throw new IllegalArgumentException("size is not negative: " + size);
      }
    }
  }

  /**
   * Bytes of one file.
   *
   * @param path the file, as the call named it
   * @param offset where they start in the file
   * @param data the bytes read: the length asked for, fewer at the file's end, none past it
   * @param fileSize the file's whole size, so that the plugin knows what is left
   */
  record Read(String path, long offset, Bytes data, long fileSize) implements FolderResult {
    public Read {
      Objects.requireNonNull(path, "path");
      Objects.requireNonNull(data, "data");
      if (offset < 0 || fileSize < 0) {
        throw new IllegalArgumentException("offset and fileSize are not negative");
      }
    }
  }

  /**
   * No result, with its reason.
   *
   * @param path the path the call named
   * @param reason why
   * @param message a text for the log or the user; it may name the relative path, never the folder's absolute one
   */
  record Failed(String path, Reason reason, String message) implements FolderResult {
    public Failed {
      Objects.requireNonNull(path, "path");
      Objects.requireNonNull(reason, "reason");
      Objects.requireNonNull(message, "message");
    }
  }

  /** Why a call gave no result. */
  enum Reason {
    /** The folder's setting is empty. */
    NOT_SET,
    /** The folder does not exist or cannot be read. */
    MISSING,
    /** An absolute path, a drive letter, a backslash or a NUL character. */
    INVALID_PATH,
    /** The path, resolved with its links, lies outside the folder. */
    OUTSIDE,
    /** Nothing at the path. */
    NOT_FOUND,
    /** A file where a directory was asked for, or the other way round. */
    WRONG_KIND,
    /** A read over {@link LocalFolder#MAX_READ_BYTES}, or a directory over {@link LocalFolder#MAX_ENTRIES}. */
    TOO_LARGE,
    /** {@link LocalFolder#MAX_CONCURRENT_CALLS} calls are in progress. */
    BUSY,
    /** No result within the call's timeout. */
    TIMEOUT,
    /** The read failed. */
    IO
  }
}
