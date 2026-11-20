package dev.emcc.sdk.folder;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;
import java.util.function.Function;

/**
 * SDK 1.4.0 (CR-0030 part 6, ADR-0049 point 4): one local folder the manifest declares, read by
 * ECore for the plugin, without blocking a worker. ECore performs the I/O on its own threads and
 * delivers exactly one {@link FolderResult} later to {@code target}, converted by {@code
 * toMessage} (plugin code: pure, non-blocking, run inside the target worker), as {@code
 * OutboundHttp} does. It is always delivered, whatever the mailbox's overflow policy.
 *
 * <p><b>The folder:</b> its absolute path is the value of the settings string that the manifest's
 * {@code setting} points to, which only an admin sets; never a path from a request, a message or
 * an object (ADR-0030, ADR-0049 point 4). A changed setting changes the folder at once, for calls
 * made after it. While the setting is empty, every call answers {@link FolderResult.Reason#NOT_SET};
 * while the folder does not exist or cannot be read, {@link FolderResult.Reason#MISSING}.
 *
 * <p><b>The setting's value</b> (SDK 1.6.0, CR-0041 part H; T-157, the ACA's note on ADR-0049):
 * <ul>
 *   <li>an absolute path, as before, e.g. shared storage that other apps use too;
 *   <li>or a value that starts with {@link #EMCC_PREFIX} ({@code %emcc%/}, or {@code %emcc%\}):
 *       ECore replaces the prefix with the emcc folder, the folder the server was started in ({@code
 *       start.bat} sets it), and resolves the rest below it. {@code %emcc%} is emcc's own marker,
 *       not an environment variable, the same on Windows and Linux. A result whose real path, links
 *       included, lies outside the emcc folder answers {@link FolderResult.Reason#MISSING} with the
 *       message "outside the emcc folder";
 *   <li>anything else, a relative path without the prefix or {@code %emcc%} elsewhere in the
 *       value, answers {@link FolderResult.Reason#MISSING}, as before.
 * </ul>
 * The plugin never resolves the value itself: ECore does, and the Monitor shows the setting as
 * typed and the folder it resolves to. E.g. {@code terrain}'s default {@code %emcc%/settings/terrain}.
 *
 * <p><b>Paths</b> are relative to the folder, with {@code /} between names, on Windows too; {@code
 * ""} is the folder itself. ECore resolves every path, symbolic links included, and answers {@link
 * FolderResult.Reason#OUTSIDE} for one that lies outside the folder. An absolute path, a drive
 * letter, a backslash or a NUL character is {@link FolderResult.Reason#INVALID_PATH}. ECore never
 * writes, creates or deletes anything there.
 *
 * <p><b>Limits:</b> a read of at most {@link #MAX_READ_BYTES}; a listing of at most {@link
 * #MAX_ENTRIES}; at most {@link #MAX_CONCURRENT_CALLS} calls of the plugin at a time, over all its
 * folders. A call beyond a limit answers at once with its reason. Each call has its timeout.
 */
public interface LocalFolder {

  /** The most bytes one read returns: 64 MiB, so a DTED level 2 cell (about 26 MB) reads whole. */
  int MAX_READ_BYTES = 64 * 1024 * 1024;

  /** The most entries one listing returns; a larger directory answers {@link FolderResult.Reason#TOO_LARGE}. */
  int MAX_ENTRIES = 10_000;

  /** The most calls of one plugin in progress at a time, over all its folders. */
  int MAX_CONCURRENT_CALLS = 8;

  /**
   * SDK 1.6.0 (CR-0041 part H): the marker of a folder setting relative to the emcc folder, e.g.
   * {@code %emcc%/settings/terrain}. {@code %emcc%\} is accepted too. ECore resolves it.
   */
  String EMCC_PREFIX = "%emcc%/";

  /** The folder's id in the manifest. */
  String id();

  /**
   * Whether {@code path} is written as a relative path should be, before any resolving: not
   * absolute, no drive letter, no backslash, no NUL, no empty name between two {@code /}. ECore and
   * the test kit answer {@link FolderResult.Reason#INVALID_PATH} when it is not; {@code ..} is
   * allowed here and checked by resolving ({@link FolderResult.Reason#OUTSIDE}).
   */
  static boolean isWellFormed(String path) {
    if (path.isEmpty()) {
      return true;
    }
    if (path.startsWith("/") || path.endsWith("/") || path.contains("//") || path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0) {
      return false;
    }
    return !(path.length() >= 2 && path.charAt(1) == ':');
  }

  /**
   * Lists one directory of the folder, not its subdirectories: a {@link FolderResult.Listing}, its
   * entries sorted by name. A link is listed as what it points to; a broken link, or an entry that
   * cannot be read, is left out instead of failing the whole listing (owner, LG, 2026-11-08).
   *
   * @param relativeDir the directory, relative to the folder; {@code ""} for the folder itself
   * @param timeout positive; {@link FolderResult.Reason#TIMEOUT} after it
   */
  <M extends Message> void list(String relativeDir, Duration timeout, WorkerRef<M> target, Function<FolderResult, ? extends M> toMessage);

  /**
   * Reads up to {@code length} bytes of one file from {@code offset}: a {@link FolderResult.Read}
   * with fewer bytes at the file's end, and none from an offset at or past it.
   *
   * @param relativePath the file, relative to the folder
   * @param offset at least 0
   * @param length 1 to {@link #MAX_READ_BYTES}; more answers {@link FolderResult.Reason#TOO_LARGE}
   * @param timeout positive; {@link FolderResult.Reason#TIMEOUT} after it
   */
  <M extends Message> void read(
      String relativePath, long offset, int length, Duration timeout, WorkerRef<M> target, Function<FolderResult, ? extends M> toMessage);
}
