package dev.emcc.app;

import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * The release's user manual at {@code /manual/} (M9 RC2, owner ACQ): static files from the release's {@code manual/}
 * folder ({@link ReleaseInfo}), GET and HEAD only, open without login ({@link SecurityConfiguration}), under the same
 * headers and CSP as the shell, revalidated on every load. Without the folder (a developer run) {@code /manual/} answers
 * 404, and {@code GET /api/health}'s {@code manual} is false.
 */
@Configuration
class ManualConfiguration implements WebMvcConfigurer {

  static final String PATH = "/manual/";

  private final ReleaseInfo release;

  ManualConfiguration(ReleaseInfo release) {
    this.release = release;
  }

  @Override
  public void addResourceHandlers(ResourceHandlerRegistry registry) {
    String location = release.manualFolder().toUri().toString();
    registry.addResourceHandler(PATH + "**").addResourceLocations(location.endsWith("/") ? location : location + "/")
        .setCacheControl(CacheControl.noCache());
  }

  @Override
  public void addViewControllers(ViewControllerRegistry registry) {
    registry.addViewController(PATH).setViewName("forward:" + PATH + "index.html");
    registry.addRedirectViewController("/manual", PATH);
  }
}
