package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;

/** The live picture over a real WebSocket (overview 4.5, server/live-picture-protocol.md). */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles(LoginConfiguration.DEV_PROFILE)
@DirtiesContext // closes this class's server before its temporary folder is deleted
class LiveWebSocketTest {

  /** Deleted by JUnit after the class, once {@code @DirtiesContext} has closed the server that uses it. */
  @TempDir static Path folder;

  private static final ModelJson JSON = new ModelJson();
  private static final HttpClient HTTP = HttpClient.newHttpClient();

  @Autowired private Environment environment;
  private WebSocket socket;

  @DynamicPropertySource
  static void dataDirectory(DynamicPropertyRegistry registry) {
    registry.add("emc2.data.directory", () -> folder.toString());
  }

  @AfterEach
  void close() {
    if (socket != null) {
      socket.abort();
    }
  }

  /** Collects whole text messages. */
  static final class Received implements WebSocket.Listener {
    final LinkedBlockingQueue<JsonNode> messages = new LinkedBlockingQueue<>();
    final java.util.concurrent.CompletableFuture<String> closed = new java.util.concurrent.CompletableFuture<>();
    private final StringBuilder partial = new StringBuilder();

    @Override
    public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
      closed.complete(statusCode + " " + reason);
      return null;
    }

    @Override
    public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
      partial.append(data);
      if (last) {
        messages.add(JSON.parse(partial.toString()));
        partial.setLength(0);
      }
      webSocket.request(1);
      return null;
    }

    /** The next message, which must be of this type; the data types and settings sent after welcome are skipped unless asked for. */
    JsonNode next(String type) throws InterruptedException {
      JsonNode message = messages.poll(10, TimeUnit.SECONDS);
      while (message != null && !type.equals(message.get("type").asString())
          && List.of("data-types", "settings").contains(message.get("type").asString())) {
        message = messages.poll(10, TimeUnit.SECONDS);
      }
      assertThat(message).as("a " + type + " message within 10 s").isNotNull();
      assertThat(message.get("type").asString()).as("message " + message).isEqualTo(type);
      return message;
    }
  }

  private URI uri() {
    return URI.create("ws://127.0.0.1:" + environment.getRequiredProperty("local.server.port") + LiveWebSocketHandler.PATH);
  }

  @Test
  void aBrowserGetsTheLivePictureAndItsChangesAndChangesIt() throws Exception {
    Received received = new Received();
    socket = HTTP.newWebSocketBuilder().buildAsync(uri(), received).get(10, TimeUnit.SECONDS);
    assertThat(received.next("welcome").get("protocol").asInt()).isEqualTo(2);

    socket.sendText("{\"type\":\"subscribe\",\"subscription\":\"all\"}", true).get(10, TimeUnit.SECONDS);
    JsonNode begin = received.next("snapshot-begin");
    JsonNode defaultLayer = begin.get("layers").get(0);
    assertThat(defaultLayer.get("name").asString()).isEqualTo("Drawing");
    long sequenceNo = received.next("snapshot-end").get("sequenceNo").asLong();

    UUID requestId = UUID.randomUUID();
    MapObjectContent symbol = new MapObjectContent(MapObjectContent.SYMBOL, MapObjectContent.GENERAL, MapObjectContent.MANUAL, null,
        UUID.fromString(defaultLayer.get("id").asString()),
        new Geometry.Point(Position.of(15.6, 60.1)), new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null), null,
        null, SecurityLabel.of("NATO", "UNCLASSIFIED"), Extensions.empty());
    ChangeRequest request = ChangeRequest.create(requestId, UUID.randomUUID(), symbol, new Actor("draw-symbols", "someone", null));
    socket.sendText("{\"type\":\"change-request\",\"request\":" + JSON.write(request) + "}", true).get(10, TimeUnit.SECONDS);

    JsonNode outcome = received.next("change-outcome");
    assertThat(outcome.get("requestId").asString()).isEqualTo(requestId.toString());
    assertThat(outcome.get("outcome").asString()).as(outcome.toString()).isEqualTo("applied");
    assertThat(outcome.get("event").get("by").get("user").asString()).as("the session's user, not the browser's").isEqualTo("local");
    JsonNode changes = received.next("changes");
    assertThat(changes.get("events").get(0).get("sequenceNo").asLong()).isEqualTo(sequenceNo + 1);
  }

  /** A message of exactly {@code length} characters that the server answers with an error. */
  private static String messageOfLength(int length) {
    String head = "{\"type\":\"dance\",\"padding\":\"";
    String tail = "\"}";
    return head + "x".repeat(length - head.length() - tail.length()) + tail;
  }

  private Received connected() throws Exception {
    Received received = new Received();
    socket = HTTP.newWebSocketBuilder().buildAsync(uri(), received).get(10, TimeUnit.SECONDS);
    received.next("welcome");
    return received;
  }

  @Test
  void aMessageOfExactly1MiBIsTakenOneCharacterMoreClosesTheConnection() throws Exception {
    Received received = connected();
    socket.sendText(messageOfLength(1024 * 1024), true).get(10, TimeUnit.SECONDS);
    assertThat(received.next("error").get("message").asString()).contains("unknown message type");

    socket.sendText(messageOfLength(1024 * 1024 + 1), true).get(10, TimeUnit.SECONDS);
    assertThat(received.closed.get(10, TimeUnit.SECONDS)).startsWith("1009");
  }

  @Test
  void aMessageInFramesIsTakenWholeAndTooLargeOneIsReadToItsEndThenClosedWith1009() throws Exception {
    // owner VV A (2026-11-14): the edge reads the rest of a too large message before it closes, so the
    // close frame is never lost to a reset of unread bytes (the browser saw 1006 under load)
    Received received = connected();
    String fits = messageOfLength(1024 * 1024);
    socket.sendText(fits.substring(0, 500_000), false).get(10, TimeUnit.SECONDS);
    socket.sendText(fits.substring(500_000), true).get(10, TimeUnit.SECONDS);
    assertThat(received.next("error").get("message").asString()).as("taken whole").contains("unknown message type");

    String part = "x".repeat(400_000);
    for (int i = 0; i < 3; i++) {
      socket.sendText(part, false).get(10, TimeUnit.SECONDS); // 1.2 Mi characters before the end
    }
    socket.sendText("x", true).get(10, TimeUnit.SECONDS);
    assertThat(received.closed.get(10, TimeUnit.SECONDS)).startsWith("1009");
  }

  @Test
  void everyTooLargeMessageClosesWith1009NeverAReset() throws Exception {
    String tooLarge = messageOfLength(1024 * 1024 + 1);
    for (int i = 0; i < 20; i++) {
      Received received = connected();
      socket.sendText(tooLarge, true); // not waited for: the close may come while it is sent
      assertThat(received.closed.get(10, TimeUnit.SECONDS)).as("run " + i).startsWith("1009");
    }
  }

  @Test
  void thePartsOfAMessageAreJoinedAndATooLargeOneClosesAtItsEndOrPastTheDrain() {
    LiveWebSocketHandler.Parts parts = new LiveWebSocketHandler.Parts();
    assertThat(parts.add("ab", false)).isNull();
    assertThat(parts.add("c", true)).isEqualTo("abc");
    assertThat(parts.add("d", true)).isEqualTo("d");
    assertThat(parts.tooBig()).isFalse();

    String big = "x".repeat(LiveWebSocketHandler.MAX_MESSAGE);
    assertThat(parts.add(big, false)).isNull();
    assertThat(parts.add("y", false)).isNull();
    assertThat(parts.tooBig()).as("not before its end").isFalse();
    assertThat(parts.add("z", true)).isNull();
    assertThat(parts.tooBig()).isTrue();
    assertThat(parts.closeOnce()).as("the close is sent once").isTrue();
    assertThat(parts.closeOnce()).isFalse();

    LiveWebSocketHandler.Parts endless = new LiveWebSocketHandler.Parts();
    for (int i = 0; i <= LiveWebSocketHandler.MAX_DRAIN / LiveWebSocketHandler.MAX_MESSAGE; i++) {
      endless.add(big, false);
    }
    assertThat(endless.tooBig()).as("past the drain it closes at once").isTrue();
  }

  @Test
  void aBinaryFrameClosesTheConnection() throws Exception {
    Received received = connected();

    socket.sendBinary(java.nio.ByteBuffer.wrap(new byte[] {1, 2, 3}), true).get(10, TimeUnit.SECONDS);

    assertThat(received.closed.get(10, TimeUnit.SECONDS)).startsWith("1003");
  }

  @Test
  void messagesMuchLargerThanTomcatsDefaultGetThrough() throws Exception {
    Received received = new Received();
    socket = HTTP.newWebSocketBuilder().buildAsync(uri(), received).get(10, TimeUnit.SECONDS);
    received.next("welcome");

    String large = "{\"type\":\"dance\",\"padding\":\"" + "x".repeat(200_000) + "\"}";
    socket.sendText(large, true).get(10, TimeUnit.SECONDS);

    assertThat(received.next("error").get("message").asString()).contains("unknown message type");
  }

  @Test
  void pagesFromOtherOriginsCannotConnect() {
    assertThatThrownBy(() -> HTTP.newWebSocketBuilder().header("Origin", "http://evil.example")
            .buildAsync(uri(), new Received()).get(10, TimeUnit.SECONDS))
        .isInstanceOf(ExecutionException.class)
        .hasStackTraceContaining("403");
  }

  @Test
  void theServersOwnPagesCanConnect() throws Exception {
    String self = "http://127.0.0.1:" + environment.getRequiredProperty("local.server.port");
    Received received = new Received();
    socket = HTTP.newWebSocketBuilder().header("Origin", self).buildAsync(uri(), received).get(10, TimeUnit.SECONDS);

    assertThat(received.next("welcome")).isNotNull();
  }
}
