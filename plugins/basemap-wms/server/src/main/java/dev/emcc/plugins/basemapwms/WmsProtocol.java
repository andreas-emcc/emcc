package dev.emcc.plugins.basemapwms;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.http.HttpCall;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * WMS 1.1.1 and 1.3.0. The map request is checked parameter by parameter against the saved background; the request to the
 * server is built from the saved server's address and the checked values, always in the same order (ADR-0035
 * consequences). Parameter names, and the values of {@code SERVICE}, {@code REQUEST} and {@code TRANSPARENT}, are matched
 * ignoring case, as WMS asks.
 */
final class WmsProtocol implements ServerProtocol {

  static final WmsProtocol INSTANCE = new WmsProtocol();

  /** The largest image side the map view asks for (the {@code WmsSource} contract). */
  static final int MAX_SIDE = 4_096;

  private static final Pattern NUMBER = Pattern.compile("[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d{1,3})?");
  private static final Pattern SIZE = Pattern.compile("[1-9][0-9]{0,3}");

  private WmsProtocol() {}

  @Override
  public HttpCall capabilitiesCall(WmsSettings.Server server) {
    return get(WmsUrl.build(server.url(), List.of(
        new WmsUrl.Param("SERVICE", "WMS"),
        new WmsUrl.Param("VERSION", server.version()),
        new WmsUrl.Param("REQUEST", "GetCapabilities"))));
  }

  @Override
  public List<LayerInfo> readCapabilities(Bytes body) throws CapabilitiesParser.Unreadable {
    return CapabilitiesParser.parse(body);
  }

  @Override
  public HttpCall mapCall(WmsSettings.Server server, WmsSettings.Background background, List<String> offered, Map<String, List<String>> query)
      throws BadMapRequest {
    Map<String, List<String>> params = new LinkedHashMap<>();
    for (Map.Entry<String, List<String>> e : query.entrySet()) {
      params.computeIfAbsent(e.getKey().toUpperCase(Locale.ROOT), k -> new ArrayList<>()).addAll(e.getValue());
    }
    boolean latest = server.version().equals("1.3.0");
    String projectionName = latest ? "CRS" : "SRS";
    if (!require(one(params, "SERVICE"), "SERVICE").equalsIgnoreCase("WMS")) {
      throw new BadMapRequest("SERVICE must be WMS");
    }
    if (!require(one(params, "REQUEST"), "REQUEST").equalsIgnoreCase("GetMap")) {
      throw new BadMapRequest("REQUEST must be GetMap");
    }
    if (!require(one(params, "VERSION"), "VERSION").equals(server.version())) {
      throw new BadMapRequest("VERSION must be " + server.version());
    }
    if (!require(one(params, "LAYERS"), "LAYERS").equals(String.join(",", background.layers()))) {
      throw new BadMapRequest("LAYERS must be the background's layers, in their order");
    }
    String styles = one(params, "STYLES");
    if (styles != null && !styles.isEmpty()) {
      throw new BadMapRequest("STYLES must be empty");
    }
    if (!require(one(params, "FORMAT"), "FORMAT").equalsIgnoreCase(background.format())) {
      throw new BadMapRequest("FORMAT must be " + background.format());
    }
    String transparent = require(one(params, "TRANSPARENT"), "TRANSPARENT");
    if (!transparent.equalsIgnoreCase(background.transparent() ? "TRUE" : "FALSE")) {
      throw new BadMapRequest("TRANSPARENT must be " + (background.transparent() ? "TRUE" : "FALSE"));
    }
    String requested = require(one(params, projectionName), projectionName).toUpperCase(Locale.ROOT);
    if (!offered.contains(requested)) {
      throw new BadMapRequest(projectionName + " is not one of the background's projections");
    }
    String box = bbox(require(one(params, "BBOX"), "BBOX"));
    String width = size(require(one(params, "WIDTH"), "WIDTH"), "WIDTH");
    String height = size(require(one(params, "HEIGHT"), "HEIGHT"), "HEIGHT");
    // Every other parameter the browser sent is dropped: the request is the plugin's own.
    return get(WmsUrl.build(server.url(), List.of(
        new WmsUrl.Param("SERVICE", "WMS"),
        new WmsUrl.Param("VERSION", server.version()),
        new WmsUrl.Param("REQUEST", "GetMap"),
        new WmsUrl.Param("LAYERS", String.join(",", background.layers())),
        new WmsUrl.Param("STYLES", ""),
        new WmsUrl.Param("FORMAT", background.format()),
        new WmsUrl.Param("TRANSPARENT", background.transparent() ? "TRUE" : "FALSE"),
        new WmsUrl.Param(projectionName, requested),
        new WmsUrl.Param("BBOX", box),
        new WmsUrl.Param("WIDTH", width),
        new WmsUrl.Param("HEIGHT", height))));
  }

  /** The only value of a parameter, or {@code null} if it is absent; a name given twice (also in another case) is refused. */
  private static @Nullable String one(Map<String, List<String>> params, String name) throws BadMapRequest {
    List<String> values = params.get(name);
    if (values == null || values.isEmpty()) {
      return null;
    }
    if (values.size() > 1) {
      throw new BadMapRequest(name + " appears twice");
    }
    return values.getFirst();
  }

  private static String require(@Nullable String value, String name) throws BadMapRequest {
    if (value == null) {
      throw new BadMapRequest(name + " is missing");
    }
    return value;
  }

  /** Four finite numbers, each minimum below its maximum, in plain decimal notation. In EPSG:4326 of WMS 1.3.0 the pairs are latitude first; the order is not changed. */
  private static String bbox(String value) throws BadMapRequest {
    String[] parts = value.split(",", -1);
    if (parts.length != 4) {
      throw new BadMapRequest("BBOX needs four numbers");
    }
    BigDecimal[] n = new BigDecimal[4];
    for (int i = 0; i < 4; i++) {
      String text = parts[i].strip();
      if (text.length() > 40 || !NUMBER.matcher(text).matches() || !Double.isFinite(Double.parseDouble(text))) {
        throw new BadMapRequest("BBOX holds a value that is not a finite number");
      }
      n[i] = new BigDecimal(text);
    }
    if (n[0].compareTo(n[2]) >= 0 || n[1].compareTo(n[3]) >= 0) {
      throw new BadMapRequest("BBOX needs each minimum below its maximum");
    }
    List<String> plain = new ArrayList<>();
    for (BigDecimal d : n) {
      plain.add(d.toPlainString());
    }
    return String.join(",", plain);
  }

  private static String size(String value, String name) throws BadMapRequest {
    if (!SIZE.matcher(value).matches() || Integer.parseInt(value) > MAX_SIDE) {
      throw new BadMapRequest(name + " must be a whole number from 1 to " + MAX_SIDE);
    }
    return value;
  }

  private static HttpCall get(java.net.URI uri) {
    return HttpCall.get(uri).header("User-Agent", BasemapWmsPlugin.USER_AGENT);
  }
}
