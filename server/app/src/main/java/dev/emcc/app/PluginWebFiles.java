package dev.emcc.app;

import dev.emcc.ecore.plugin.PluginHost;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import org.jspecify.annotations.Nullable;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.resource.AbstractResourceResolver;
import org.springframework.web.servlet.resource.ResourceResolverChain;

/**
 * Finds the files of plugin web parts (overview 4.1, installed layout): {@code /plugins/<id>/web/<file>}
 * is {@code <file>} in the {@code web/} folder of plugin {@code <id>}.
 *
 * <p>Only active plugins that declare a web part are served, and only their {@code web/} folder:
 * never a manifest, a jar or a disabled plugin's files. Paths that leave the folder are refused by
 * the resolver after this one ({@code PathResourceResolver}), and files that only seem to be in it
 * (a symbolic link to elsewhere) by this one.
 */
final class PluginWebFiles extends AbstractResourceResolver {

  /** The URL prefix of plugin web parts. */
  static final String PREFIX = "/plugins/";

  private final ECoreLifecycle ecore;

  PluginWebFiles(ECoreLifecycle ecore) {
    this.ecore = ecore;
  }

  @Override
  protected @Nullable Resource resolveResourceInternal(@Nullable HttpServletRequest request, String requestPath,
      List<? extends Resource> locations, ResourceResolverChain chain) {
    int slash = requestPath.indexOf('/');
    if (slash <= 0 || !requestPath.startsWith("web/", slash + 1)) {
      return null;
    }
    String id = requestPath.substring(0, slash);
    for (PluginHost.PluginInfo plugin : ecore.core().plugins().plugins()) {
      if (plugin.id().equals(id) && plugin.active() && plugin.manifest() != null && plugin.manifest().web() != null) {
        Path web = plugin.directory().resolve("web").toAbsolutePath();
        Resource found = chain.resolveResource(request, requestPath.substring(slash + "/web/".length()),
            List.of(new FileSystemResource(web + "/")));
        return found != null && inside(found, web) ? found : null;
      }
    }
    return null;
  }

  /**
   * True if the file really lies in the web folder: a symbolic link in it that leads elsewhere is
   * not served (the resolver after this one compares paths, not where links lead; T-014 review (4)).
   */
  static boolean inside(Resource found, Path web) {
    try {
      return found.getFile().toPath().toRealPath().startsWith(web.toRealPath());
    } catch (IOException e) {
      return false;
    }
  }

  @Override
  protected @Nullable String resolveUrlPathInternal(String resourceUrlPath, List<? extends Resource> locations,
      ResourceResolverChain chain) {
    return null; // only serves files; no URLs are generated for them
  }
}
