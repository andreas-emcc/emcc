package dev.emcc.ecore.persistence;

import static org.junit.jupiter.api.Assumptions.assumeFalse;

import java.io.IOException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;

/**
 * Makes a data directory read-only as far as the platform allows: the journal file read-only on
 * every platform (Windows ignores the read-only flag of a directory), and the directory too where
 * POSIX permissions exist. Close it to make everything writable again, so the test can clean up.
 */
public final class ReadOnlyDirectory implements AutoCloseable {

  private final Path directory;
  private final boolean posix = FileSystems.getDefault().supportedFileAttributeViews().contains("posix");

  public ReadOnlyDirectory(Path directory) throws IOException {
    this.directory = directory;
    Path journal = journal();
    if (!Files.exists(journal)) {
      Files.createFile(journal);
    }
    journal.toFile().setReadOnly();
    if (posix) {
      Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("r-xr-xr-x"));
    }
    if (Files.isWritable(journal)) {
      close();
      assumeFalse(true, "the files can still be written (running as root?)");
    }
  }

  private Path journal() {
    return directory.resolve(FileStore.JOURNAL);
  }

  @Override
  public void close() throws IOException {
    if (posix) {
      Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwx------"));
    }
    journal().toFile().setWritable(true);
  }
}
