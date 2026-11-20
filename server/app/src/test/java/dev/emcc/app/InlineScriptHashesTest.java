package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class InlineScriptHashesTest {

  // Expected values computed independently (Python hashlib, base64 of the SHA-256 of the UTF-8 text).
  private static final String MAP = "{\"imports\":{\"a\":\"/assets/app.js\"}}";
  private static final String MAP_HASH = "'sha256-2P5Kx3Ug543S84JLZBb4pEh2uDAvlcfgYRIm+cuFLSk='";
  private static final String EMPTY_MAP = "{\"imports\":{}}";
  private static final String EMPTY_MAP_HASH = "'sha256-URrTy+Il/Nz0lHojVUx275hWqAWhkSF0VsHbUM4/6Hw='";

  @Test
  void hashesTheExactTextOfEachImportMap() {
    assertThat(InlineScriptHashes.sourcesOf("<head><script type=\"importmap\">" + MAP + "</script></head>"))
        .containsExactly(MAP_HASH);
    assertThat(InlineScriptHashes.sourcesOf("<SCRIPT TYPE='importmap' data-x>" + EMPTY_MAP + "</script >"
        + "<script type=importmap>" + MAP + "</script>"))
        .as("any case and quoting, in page order").containsExactly(EMPTY_MAP_HASH, MAP_HASH);
  }

  @Test
  void otherInlineScriptsGetNoHash() {
    assertThat(InlineScriptHashes.sourcesOf("<script>" + MAP + "</script><script type=\"module\">x()</script>"
        + "<script type=\"module\" src=\"/assets/index.js\"></script>")).isEmpty();
  }

  @Test
  void readsTheWebRootsIndexAgainWhenItChanges(@TempDir Path webRoot) throws IOException {
    InlineScriptHashes hashes = new InlineScriptHashes(webRoot.toString());
    assertThat(hashes.sources()).as("no index.html yet").isEmpty();

    Path index = webRoot.resolve("index.html");
    Files.writeString(index, "<script type=\"importmap\">" + MAP + "</script>");
    Files.setLastModifiedTime(index, FileTime.from(Instant.parse("2026-10-08T10:00:00Z")));
    assertThat(hashes.sources()).containsExactly(MAP_HASH);

    Files.writeString(index, "<script type=\"importmap\">" + EMPTY_MAP + "</script>");
    Files.setLastModifiedTime(index, FileTime.from(Instant.parse("2026-10-08T10:00:05Z")));
    assertThat(hashes.sources()).as("a new build").containsExactly(EMPTY_MAP_HASH);
  }
}
