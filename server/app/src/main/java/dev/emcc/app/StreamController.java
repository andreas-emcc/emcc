package dev.emcc.app;

import dev.emcc.ecore.plugin.StreamHub;
import dev.emcc.ecore.plugin.StreamSink;
import jakarta.servlet.AsyncContext;
import jakarta.servlet.AsyncEvent;
import jakarta.servlet.AsyncListener;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

/**
 * A plugin's streams to its web part (SDK 1.8.0, CR-0044 E1; ADR-0057 point 5): {@code GET
 * /api/plugins/{pluginId}/stream/{name}}, an endless binary response per viewer, served by ECore's
 * {@link StreamHub} without a worker round trip. More specific than {@link PluginController}'s
 * {@code /{pluginId}/**}, so a stream never reaches the plugin's endpoints; ECore's dispatch answers
 * {@code 404} for any other path under {@code /stream}.
 *
 * <p>{@code 401} without a login, {@code 405} with {@code Allow: GET} for any other method, {@code
 * 404} for a stream that is not open, {@code 403} without its permission, {@code 503} with {@code
 * Retry-After: 5} past the viewer limits. Else {@code 200} at once, with the stream's {@code
 * Content-Type}, {@code Cache-Control: no-store} and {@code X-Content-Type-Options: nosniff},
 * chunked: the request goes asynchronous without a timeout, and the viewer's own thread in ECore
 * writes to it. {@code OriginCheckFilter} has refused a cross-site request before it gets here. The
 * response ends with the login session too ({@link LoginSessions}).
 */
@RestController
@RequestMapping("/api/plugins")
class StreamController {

  private static final Logger LOG = LoggerFactory.getLogger(StreamController.class);

  private final ECoreLifecycle ecore;
  private final CurrentUser currentUser;
  private final LoginSessions loginSessions;

  StreamController(ECoreLifecycle ecore, CurrentUser currentUser, LoginSessions loginSessions) {
    this.ecore = ecore;
    this.currentUser = currentUser;
    this.loginSessions = loginSessions;
  }

  // Every method named, as PluginController names them: for HEAD, Spring compares the methods before the paths
  @RequestMapping(value = "/{pluginId}/stream/{name}", method = {
      RequestMethod.GET, RequestMethod.HEAD, RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE})
  void stream(@PathVariable("pluginId") String pluginId, @PathVariable("name") String name, HttpServletRequest request,
      HttpServletResponse response) throws IOException {
    if (!request.getMethod().equals("GET")) {
      response.setHeader("Allow", "GET");
      text(response, 405, "a stream is read with GET");
      return;
    }
    User user = currentUser.of(request);
    if (user == null) {
      text(response, 401, "not logged in");
      return;
    }
    StreamHub.Join join = ecore.core().plugins().streams().join(pluginId, name, PluginController.sdkUser(user, currentUser.mode()));
    switch (join) {
      case StreamHub.Join.NotFound n -> text(response, 404, "no stream " + name + " in plugin " + pluginId);
      case StreamHub.Join.Forbidden f -> text(response, 403, "no permission to view this stream");
      case StreamHub.Join.Busy b -> {
        response.setHeader("Retry-After", "5");
        text(response, 503, b.why());
      }
      case StreamHub.Join.Joined j -> serve(j.viewer(), request, response);
    }
  }

  private void serve(StreamHub.Viewer viewer, HttpServletRequest request, HttpServletResponse response) {
    AsyncContext async;
    ServletOutputStream out;
    try {
      response.setStatus(200);
      response.setContentType(viewer.mediaType());
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      out = response.getOutputStream();
      response.flushBuffer(); // 200 at once, chunked: no length is set
      async = request.startAsync();
      async.setTimeout(0); // endless; it ends when the viewer does
    } catch (IOException | RuntimeException e) {
      viewer.cancel();
      LOG.debug("A stream response could not start", e);
      return;
    }
    Sink sink = new Sink(viewer, async, out);
    HttpSession session = request.getSession(false);
    String sessionId = session == null ? null : session.getId();
    Runnable end = () -> viewer.end("the login session ended");
    sink.onEnd = () -> {
      if (sessionId != null) {
        loginSessions.closedStream(sessionId, end);
      }
    };
    async.addListener(sink);
    if (session != null) {
      loginSessions.openedStream(session, end); // ends with the login session
    }
    viewer.start(sink);
  }

  private static void text(HttpServletResponse response, int status, String text) throws IOException {
    response.setStatus(status);
    response.setContentType("text/plain;charset=UTF-8");
    response.getOutputStream().write(text.getBytes(StandardCharsets.UTF_8));
  }

  /** The viewer's endless response. ECore's viewer thread writes; the login session's end or a stall aborts it. */
  static final class Sink implements StreamSink, AsyncListener {
    private final StreamHub.Viewer viewer;
    private final AsyncContext async;
    private final ServletOutputStream out;
    private final AtomicBoolean done = new AtomicBoolean();
    volatile @Nullable Runnable onEnd;

    Sink(StreamHub.Viewer viewer, AsyncContext async, ServletOutputStream out) {
      this.viewer = viewer;
      this.async = async;
      this.out = out;
    }

    @Override
    public void write(byte[] chunk) throws IOException {
      if (done.get()) {
        throw new IOException("the response has ended");
      }
      out.write(chunk);
    }

    @Override
    public void flush() throws IOException {
      if (done.get()) {
        throw new IOException("the response has ended");
      }
      out.flush();
    }

    @Override
    public void end() {
      finish();
    }

    @Override
    public void abort() {
      finish();
    }

    private void finish() {
      if (!done.compareAndSet(false, true)) {
        return;
      }
      Runnable r = onEnd;
      if (r != null) {
        r.run();
      }
      try {
        async.complete();
      } catch (IllegalStateException e) {
        // completed already, e.g. after the browser went away
      }
    }

    @Override
    public void onComplete(AsyncEvent event) {
      viewer.end("its response ended"); // no effect if it had ended already: the first reason stays
    }

    @Override
    public void onTimeout(AsyncEvent event) {
      viewer.end("its response timed out");
    }

    @Override
    public void onError(AsyncEvent event) {
      viewer.end("the browser went away");
    }

    @Override
    public void onStartAsync(AsyncEvent event) {
      // not restarted
    }
  }
}
