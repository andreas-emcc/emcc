package dev.emcc.app;

import java.nio.file.Files;
import java.time.Duration;
import java.nio.file.Path;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Serves the built web client from a folder on disk ({@code emc2.web.root}).
 *
 * <p>The web client is built separately (npm, {@code web/shell/dist}), so it is served from the
 * file system rather than packed into the jar. A relative path is resolved against the working
 * directory.
 *
 * <p>Also serves the web parts of the active plugins under {@code /plugins/<id>/web/} from the
 * plugins folder ({@link PluginWebFiles}).
 *
 * <p>Caching: {@code assets/} (content-hashed by Vite, including the shared libraries in {@code
 * assets/vendor/}) for a year, everything else revalidated on every load.
 */
@Configuration
class WebClientConfiguration implements WebMvcConfigurer {

  private static final Logger LOG = LoggerFactory.getLogger(WebClientConfiguration.class);

  private final Path webRoot;
  private final ECoreLifecycle ecore;

  WebClientConfiguration(@Value("${emc2.web.root}") String webRoot, ECoreLifecycle ecore) {
    this.webRoot = Path.of(webRoot).toAbsolutePath().normalize();
    this.ecore = ecore;
    if (Files.isRegularFile(this.webRoot.resolve("index.html"))) {
      LOG.info("Serving the web client from {}", this.webRoot);
    } else {
      LOG.warn(
          "No index.html in {}. Build the web client first (node tools/build.mjs) "
              + "or set emc2.web.root.",
          this.webRoot);
    }
  }

  @Override
  public void addResourceHandlers(ResourceHandlerRegistry registry) {
    String location = webRoot.toUri().toString();
    if (!location.endsWith("/")) {
      location += "/";
    }
    // Vite names the files in assets/ by their content hash: a changed file gets a new name.
    registry.addResourceHandler("/assets/**").addResourceLocations(location + "assets/")
        .setCacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable());
    // Plugin web parts keep their names (index.js) from build to build: revalidated on every load.
    // Never found in the web root: a request under /plugins/ that names no plugin file is a 404.
    registry.addResourceHandler(PluginWebFiles.PREFIX + "**").addResourceLocations(location)
        .setCacheControl(CacheControl.noCache())
        .resourceChain(false).addResolver(new PluginWebFiles(ecore));
    // Everything else, index.html above all, is checked on every load, so a new build shows at once.
    registry.addResourceHandler("/**").addResourceLocations(location).setCacheControl(CacheControl.noCache());
  }

  @Override
  public void addViewControllers(ViewControllerRegistry registry) {
    registry.addViewController("/").setViewName("forward:/index.html");
  }
}
