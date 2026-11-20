package dev.emcc.plugins.fmv.out.imagery;

import dev.emcc.sdk.folder.LocalFolder;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

/**
 * One imagery set's {@code imagery.json} (brief section 10.5 point 16, O4; the owner's A1):
 *
 * <pre>{@code
 * { "name": "Sundsvall 2001", "source": "Lantmäteriet, historical orthophotos", "licence": "CC0 1.0",
 *   "crs": "EPSG:3006",
 *   "tiles": [ { "file": "t-0-0.jpg", "min": [616760, 6917345], "max": [621760, 6922345],
 *                "width": 5000, "height": 5000 } ] }
 * }</pre>
 *
 * {@code min} and {@code max} are the tile's outer corners, longitude and latitude for {@code
 * EPSG:4326}, easting and northing for {@code EPSG:3006}. A set without a source or a licence is
 * refused (ADR-0058 point 4), and so is one whose tiles' files are not JPEG or PNG paths inside the
 * set's folder.
 *
 * @param folder the set's directory in the imagery folder, e.g. {@code sundsvall-2001}
 */
public record ImagerySet(String folder, String name, String source, String licence, Crs crs, List<TileSpec> tiles) {

  /** The most tiles a set may list. */
  public static final int MAX_TILES = 10_000;

  /** The widest and tallest tile, in pixels. */
  public static final int MAX_TILE_PIXELS = 8192;

  /** The CRSs a set may be in. */
  public enum Crs {
    EPSG_4326("EPSG:4326", 4326),
    EPSG_3006("EPSG:3006", 3006);

    private final String text;
    private final int code;

    Crs(String text, int code) {
      this.text = text;
      this.code = code;
    }

    public String text() {
      return text;
    }

    /** The EPSG code, e.g. for the cache's keys (section 10.5 point 17). */
    public int code() {
      return code;
    }
  }

  /** One tile: its file, relative to the set's folder, its outer corners and its size in pixels. */
  public record TileSpec(String file, double minX, double minY, double maxX, double maxY, int width, int height) {}

  /** A set that cannot be used, and why: named in the Monitor. */
  public static final class SetException extends Exception {
    private static final long serialVersionUID = 1L;

    SetException(String message) {
      super(message);
    }
  }

  public ImagerySet {
    Objects.requireNonNull(folder, "folder");
    tiles = List.copyOf(tiles);
  }

  /** The folder-relative path of a tile's file, e.g. {@code sundsvall-2001/t-0-0.jpg}. */
  public String path(TileSpec tile) {
    return folder + "/" + tile.file();
  }

  /** Reads a set from its {@code imagery.json}. */
  public static ImagerySet parse(String folder, String json) throws SetException {
    JsonValue root;
    try {
      root = JsonText.parse(json);
    } catch (JsonText.JsonException e) {
      throw new SetException("imagery.json is not JSON: " + e.getMessage());
    }
    if (!(root instanceof JsonObject o)) {
      throw new SetException("imagery.json is not an object");
    }
    String name = text(o, "name", 128);
    String source = text(o, "source", 512);
    String licence = text(o, "licence", 512);
    String crsText = text(o, "crs", 16);
    Crs crs = null;
    for (Crs c : Crs.values()) {
      if (c.text().equalsIgnoreCase(crsText)) {
        crs = c;
      }
    }
    if (crs == null) {
      throw new SetException("crs is EPSG:4326 or EPSG:3006, not " + crsText);
    }
    if (!(o.members().get("tiles") instanceof JsonArray tiles) || tiles.size() == 0 || tiles.size() > MAX_TILES) {
      throw new SetException("tiles is an array of 1 to " + MAX_TILES + " tiles");
    }
    List<TileSpec> specs = new ArrayList<>();
    for (int i = 0; i < tiles.size(); i++) {
      specs.add(tile(tiles.get(i), i, crs));
    }
    return new ImagerySet(folder, name, source, licence, crs, specs);
  }

  private static TileSpec tile(JsonValue v, int i, Crs crs) throws SetException {
    String where = "tile " + (i + 1);
    if (!(v instanceof JsonObject t)) {
      throw new SetException(where + " is not an object");
    }
    String file = text(t, "file", 256);
    String lower = file.toLowerCase(Locale.ROOT);
    if (!LocalFolder.isWellFormed(file) || file.isEmpty() || ("/" + file + "/").contains("/../") || ("/" + file + "/").contains("/./")
        || !(lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png"))) {
      throw new SetException(where + ": file is a .jpg, .jpeg or .png path inside the set's folder: " + file);
    }
    double[] min = pair(t, "min", where);
    double[] max = pair(t, "max", where);
    if (!(min[0] < max[0] && min[1] < max[1])) {
      throw new SetException(where + ": min lies west and south of max");
    }
    if (crs == Crs.EPSG_4326 && (min[0] < -180 || max[0] > 180 || min[1] < -90 || max[1] > 90)) {
      throw new SetException(where + ": longitude −180 to 180 and latitude −90 to 90");
    }
    int width = whole(t, "width", where);
    int height = whole(t, "height", where);
    return new TileSpec(file, min[0], min[1], max[0], max[1], width, height);
  }

  private static String text(JsonObject o, String name, int max) throws SetException {
    if (!(o.members().get(name) instanceof JsonString s) || s.value().isBlank()) {
      throw new SetException(name + " is required");
    }
    if (s.value().length() > max) {
      throw new SetException(name + " is at most " + max + " characters");
    }
    return s.value().strip();
  }

  private static double[] pair(JsonObject t, String name, String where) throws SetException {
    if (t.members().get(name) instanceof JsonArray a && a.size() == 2 && a.get(0) instanceof JsonNumber x && a.get(1) instanceof JsonNumber y
        && Double.isFinite(x.doubleValue()) && Double.isFinite(y.doubleValue())) {
      return new double[] {x.doubleValue(), y.doubleValue()};
    }
    throw new SetException(where + ": " + name + " is [x, y]");
  }

  private static int whole(JsonObject t, String name, String where) throws SetException {
    if (t.members().get(name) instanceof JsonNumber n) {
      double d = n.doubleValue();
      if (d == Math.rint(d) && d >= 1 && d <= MAX_TILE_PIXELS) {
        return (int) d;
      }
    }
    throw new SetException(where + ": " + name + " is a whole number of pixels, 1 to " + MAX_TILE_PIXELS);
  }
}
