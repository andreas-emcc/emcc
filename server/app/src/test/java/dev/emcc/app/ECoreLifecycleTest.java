package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.ECore;
import dev.emcc.ecore.runtime.OwnerLimits;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.server.context.WebServerInitializedEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.context.ConfigurableApplicationContext;

class ECoreLifecycleTest {

  /** Records the state of ECore at the moment the web server starts accepting requests. */
  static final class StateAtWebServerStart implements ApplicationListener<WebServerInitializedEvent> {
    final AtomicReference<ECore.State> state = new AtomicReference<>();

    @Override
    public void onApplicationEvent(WebServerInitializedEvent event) {
      state.set(event.getApplicationContext().getBean(ECoreLifecycle.class).core().state());
    }
  }

  /** Deleted by JUnit after each test; every test closes the applications it starts. */
  @TempDir Path dataDirectory;

  private String[] args() {
    return new String[] {
      "--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE, "--server.port=0", "--emc2.data.directory=" + dataDirectory
    };
  }

  private static SpringApplicationBuilder app() {
    return new SpringApplicationBuilder(Emc2Application.class);
  }

  @Test
  void ecoreIsRunningBeforeTheWebServerAcceptsRequests() {
    StateAtWebServerStart listener = new StateAtWebServerStart();

    try (ConfigurableApplicationContext context = app().listeners(listener).run(args())) {
      assertThat(listener.state.get()).isEqualTo(ECore.State.RUNNING);
    }
  }

  @Test
  void thePluginCapsComeFromTheConfiguration() {
    try (ConfigurableApplicationContext context = app().run(args())) {
      assertThat(context.getBean(ECoreLifecycle.class).core().config().pluginLimits()).isEqualTo(new OwnerLimits(10_000, 1_000));
    }
    String[] lower = java.util.stream.Stream.concat(java.util.Arrays.stream(args()),
        java.util.stream.Stream.of("--emc2.plugins.max-outstanding-asks=5", "--emc2.plugins.max-active-timers=3")).toArray(String[]::new);
    try (ConfigurableApplicationContext context = app().run(lower)) {
      assertThat(context.getBean(ECoreLifecycle.class).core().config().pluginLimits()).isEqualTo(new OwnerLimits(5, 3));
    }
  }

  @Test
  void ecoreStopsWhenTheApplicationCloses() {
    ConfigurableApplicationContext context = app().run(args());
    ECore core = context.getBean(ECoreLifecycle.class).core();
    assertThat(core.state()).isEqualTo(ECore.State.RUNNING);

    context.close();

    assertThat(core.state()).isEqualTo(ECore.State.STOPPED);
  }
}
