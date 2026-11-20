package dev.emcc.plugins.basemapwms;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.http.HttpCall;
import java.util.List;
import java.util.Map;

/**
 * What the plugin needs of a map server's protocol: the request for its capabilities, the reading of them, and the
 * checking and building of a map request. Only the WMS implementation exists in M4 (ADR-0035 point 5); WMTS would be a
 * second one, chosen by a server's {@code protocol} setting.
 */
interface ServerProtocol {

  /** The protocol of a server's {@code protocol} setting; {@code wms} is the only one. */
  static ServerProtocol forName(String name) {
    if (name.equals("wms")) {
      return WmsProtocol.INSTANCE;
    }
    throw new IllegalArgumentException("unknown protocol " + name);
  }

  /** The request for the server's capabilities. */
  HttpCall capabilitiesCall(WmsSettings.Server server);

  /** @throws CapabilitiesParser.Unreadable if the answer is not usable capabilities */
  List<LayerInfo> readCapabilities(Bytes body) throws CapabilitiesParser.Unreadable;

  /**
   * Checks a browser's map request without contacting the server, and builds the plugin's own request from the saved
   * server and background and the checked values. The browser's query is never forwarded.
   *
   * @param offered the projections the background is offered in
   * @param query the browser's query, names case-sensitive as the endpoint gives them
   * @throws BadMapRequest naming the first thing wrong
   */
  HttpCall mapCall(WmsSettings.Server server, WmsSettings.Background background, List<String> offered, Map<String, List<String>> query)
      throws BadMapRequest;

  /** A map request that is refused with {@code 400}. */
  final class BadMapRequest extends Exception {
    private static final long serialVersionUID = 1L;

    BadMapRequest(String message) {
      super(message);
    }
  }
}
