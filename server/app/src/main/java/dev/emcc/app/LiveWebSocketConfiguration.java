package dev.emcc.app;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * The live picture's WebSocket: plain JSON over standard WebSocket, no sub-protocol (ADR-0006).
 * Only pages from the emc2 server itself may connect (Spring's default origin check: same origin;
 * clients that send no {@code Origin}, such as test tools, are not browsers and are let in).
 * The {@code Host} header must name this server ({@link HostCheckInterceptor}, against DNS
 * rebinding), and only a logged-in user may connect ({@link LoginHandshakeInterceptor}). The
 * largest message a browser may send (1 MiB) is checked by {@link LiveWebSocketHandler}, which
 * reads messages in parts of {@code application.properties}' Tomcat buffer size.
 */
@Configuration
@EnableWebSocket
class LiveWebSocketConfiguration implements WebSocketConfigurer {

  private final LiveWebSocketHandler handler;
  private final HostCheckInterceptor hostCheck;
  private final LoginHandshakeInterceptor login;

  LiveWebSocketConfiguration(LiveWebSocketHandler handler, HostCheckInterceptor hostCheck, LoginHandshakeInterceptor login) {
    this.handler = handler;
    this.hostCheck = hostCheck;
    this.login = login;
  }

  @Override
  public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
    registry.addHandler(handler, LiveWebSocketHandler.PATH).addInterceptors(hostCheck, login);
  }
}
