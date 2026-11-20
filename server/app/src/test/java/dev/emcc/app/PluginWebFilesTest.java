package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.FileSystemResource;

/** Which files really lie in a plugin's web folder (T-047 review F4); the cases with links run where links can be made. */
class PluginWebFilesTest {

  @TempDir Path root;

  private Path folders() throws IOException {
    Path web = Files.createDirectories(root.resolve("plugin/web/assets"));
    Files.writeString(web.getParent().resolve("index.js"), "export default {};");
    Files.writeString(web.resolve("icon.svg"), "<svg/>");
    Files.writeString(root.resolve("secret.txt"), "not for browsers");
    return web.getParent();
  }

  @Test
  void aFileInTheFolderOrBelowIsInsideOneOutsideIsNot() throws IOException {
    Path web = folders();
    assertThat(PluginWebFiles.inside(new FileSystemResource(web.resolve("index.js")), web)).isTrue();
    assertThat(PluginWebFiles.inside(new FileSystemResource(web.resolve("assets/icon.svg")), web)).isTrue();
    assertThat(PluginWebFiles.inside(new FileSystemResource(root.resolve("secret.txt")), web)).isFalse();
    assertThat(PluginWebFiles.inside(new FileSystemResource(web.resolve("../../secret.txt")), web)).as("climbing").isFalse();
    assertThat(PluginWebFiles.inside(new FileSystemResource(web.resolve("missing.js")), web)).as("no such file").isFalse();
  }

  @Test
  void linksCountWhereTheyLead() throws IOException {
    Path web = folders();
    Path out = web.resolve("out.txt");
    Path in = web.resolve("in.js");
    Path linkedWeb = root.resolve("linked-web");
    try {
      Files.createSymbolicLink(out, root.resolve("secret.txt"));
      Files.createSymbolicLink(in, web.resolve("index.js"));
      Files.createSymbolicLink(linkedWeb, web);
    } catch (IOException | UnsupportedOperationException e) {
      Assumptions.abort("symbolic links cannot be made here: " + e);
    }
    assertThat(PluginWebFiles.inside(new FileSystemResource(out), web)).as("a link out of the folder").isFalse();
    assertThat(PluginWebFiles.inside(new FileSystemResource(in), web)).as("a link to a file in it").isTrue();
    assertThat(PluginWebFiles.inside(new FileSystemResource(linkedWeb.resolve("index.js")), linkedWeb))
        .as("a web folder that is itself a link").isTrue();
  }
}
