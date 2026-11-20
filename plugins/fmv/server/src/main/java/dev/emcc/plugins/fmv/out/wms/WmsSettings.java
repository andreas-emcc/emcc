package dev.emcc.plugins.fmv.out.wms;

import dev.emcc.plugins.fmv.out.imagery.ImagerySet;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * The plugin-wide {@code wms} settings (brief section 10.5 point 17): the WMS an admin names, the
 * tile grid, the imagery's source and licence, and the name of an access token. The host comes only
 * from {@code url} (ADR-0030); the token itself is never a setting (ADR-0060).
 *
 * @param url the server's address without parameters, or {@code null}
 * @param token the name of an HTTP credential in the server's configuration, or {@code null}
 */
public record WmsSettings(
    boolean enabled,
    @Nullable String url,
    @Nullable String layer,
    ImagerySet.Crs crs,
    String format,
    int tilePixels,
    double metresPerPixel,
    @Nullable String source,
    @Nullable String licence,
    @Nullable String token) {

  /** The settings when there are none: off, EPSG:3006, JPEG, 256 pixels at 1 m. */
  public static final WmsSettings OFF = new WmsSettings(false, null, null, ImagerySet.Crs.EPSG_3006, "image/jpeg", 256, 1, null, null, null);

  private static final Pattern URL = Pattern.compile("https?://[^\\s?#@]+");
  private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,63}");

  /**
   * Reads the plugin's settings' {@code wms} object. A value the form would have refused is left
   * out (its default, or none), so a bad entry never fetches from a host it did not name.
   */
  public static WmsSettings from(JsonObject settings) {
    if (!(settings.get("wms") instanceof JsonObject w)) {
      return OFF;
    }
    boolean enabled = w.get("enabled") instanceof JsonBoolean b && b.value();
    String url = url(text(w, "url", 2048));
    ImagerySet.Crs crs = "EPSG:4326".equals(text(w, "crs", 16)) ? ImagerySet.Crs.EPSG_4326 : ImagerySet.Crs.EPSG_3006;
    String format = "image/png".equals(text(w, "format", 16)) ? "image/png" : "image/jpeg";
    int tilePixels = w.get("tilePixels") instanceof JsonNumber n && n.doubleValue() == 512 ? 512 : 256;
    double mpp = w.get("metresPerPixel") instanceof JsonNumber n && n.doubleValue() >= 0.25 && n.doubleValue() <= 10 ? n.doubleValue() : 1;
    String token = text(w, "token", 64);
    if (token != null && !TOKEN.matcher(token).matches()) {
      token = null;
    }
    return new WmsSettings(enabled, url, text(w, "layer", 256), crs, format, tilePixels, mpp, text(w, "source", 256), text(w, "licence", 256), token);
  }

  /** Why nothing is fetched, or {@code null} when tiles are fetched (ADR-0058 point 4: not without a source and a licence). */
  public @Nullable String whyNotFetching() {
    if (!enabled) {
      return "off";
    }
    if (url == null) {
      return "no server";
    }
    if (layer == null) {
      return "no layer";
    }
    if (source == null || licence == null) {
      return "no source or licence";
    }
    return null;
  }

  /** The tile grid these settings give. */
  public WmsGrid grid() {
    return new WmsGrid(crs, tilePixels, metresPerPixel);
  }

  /** The server's host, for the status; empty without a server. */
  public String host() {
    if (url == null) {
      return "";
    }
    String h = URI.create(url).getHost();
    return h == null ? "" : h.toLowerCase(Locale.ROOT);
  }

  /**
   * The url if it is a plain http or https address that {@link URI} takes, with a host and without
   * user information (a password is never a setting; ADR-0060); else {@code null}, so nothing is fetched.
   */
  static @Nullable String url(@Nullable String url) {
    if (url == null || !URL.matcher(url).matches()) {
      return null;
    }
    try {
      URI uri = new URI(url);
      return uri.getHost() == null || uri.getRawUserInfo() != null ? null : url;
    } catch (URISyntaxException e) {
      return null;
    }
  }

  private static @Nullable String text(JsonObject o, String key, int max) {
    if (o.get(key) instanceof JsonString s && !s.value().isBlank() && s.value().length() <= max) {
      return s.value().strip();
    }
    return null;
  }
}
