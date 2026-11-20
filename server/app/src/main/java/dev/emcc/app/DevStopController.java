package dev.emcc.app;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code POST /api/dev/stop}: a clean stop for development and the integration tests, because a
 * server on Windows cannot be sent Ctrl+C by a script (owner decision 2026-10-07).
 *
 * <p>Exists only in the no-login profile {@value LoginConfiguration#DEV_PROFILE} (otherwise 404), and
 * answers only callers on this machine. It also refuses requests that carry an {@code Origin}
 * header: browsers send one, so a web page cannot stop a local server; scripts and test tools do
 * not. The answer ({@code 202}) is sent before the stop starts.
 */
@RestController
@Profile(LoginConfiguration.DEV_PROFILE)
class DevStopController {

  static final String PATH = "/api/dev/stop";

  private final ServerStopper stopper;

  DevStopController(ServerStopper stopper) {
    this.stopper = stopper;
  }

  @PostMapping(PATH)
  void stop(HttpServletRequest request, HttpServletResponse response) throws IOException {
    if (!isLoopback(request.getRemoteAddr())) {
      answer(response, HttpStatus.FORBIDDEN, "{\"error\":\"only callers on this machine may stop the server\"}");
      return;
    }
    if (request.getHeader(HttpHeaders.ORIGIN) != null) {
      answer(response, HttpStatus.FORBIDDEN, "{\"error\":\"not from a web page\"}");
      return;
    }
    answer(response, HttpStatus.ACCEPTED, "{\"status\":\"STOPPING\"}");
    response.flushBuffer(); // the caller has the answer before the stop starts
    stopper.stopLater(PATH + " from " + request.getRemoteAddr());
  }

  private static void answer(HttpServletResponse response, HttpStatus status, String json) throws IOException {
    response.setStatus(status.value());
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    response.setCharacterEncoding(StandardCharsets.UTF_8.name());
    response.getWriter().write(json);
  }

  /** The remote address is an IP literal, so this never looks up a name. */
  private static boolean isLoopback(String address) {
    if (address.isBlank()) {
      return false; // getByName("") would answer with the loopback address
    }
    try {
      return InetAddress.getByName(address).isLoopbackAddress();
    } catch (UnknownHostException e) {
      return false;
    }
  }
}
