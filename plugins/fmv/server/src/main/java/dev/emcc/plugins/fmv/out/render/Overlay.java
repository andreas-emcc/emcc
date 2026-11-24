package dev.emcc.plugins.fmv.out.render;

import dev.emcc.plugins.fmv.out.Pose;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import org.jspecify.annotations.Nullable;

/**
 * The data overlay burned into a frame (CR-0055; the fmv brief's function 27): the camera's data as
 * text in four places, drawn into the I420 picture after the renderer and before the encoder.
 *
 * <ul>
 *   <li>top centre: the classification, always while the overlay is on (CR-0055 point 6);
 *   <li>top left: the frame's time (UTC), the platform's name and the mission;
 *   <li>bottom left: the camera's position with its hemispheres, its height (m HAE) and the
 *       platform's heading;
 *   <li>bottom right: the azimuth relative to the heading and as a true bearing, the depression, the
 *       field of view, and the frame centre with the slant range, or "no frame centre".
 * </ul>
 *
 * White glyphs ({@link Glyphs}, fmv's own) with a one-pixel black outline on the luma plane, the
 * chroma neutral under each character, a fixed margin; scaled by whole pixels, 1 at 640 × 360, 2 at
 * 1280 × 720, 3 at 1920 × 1080. The texts repeat what ST 0601 and ST 0102 say; the metadata does not
 * change. Pure code: no I/O, no threads.
 */
public final class Overlay {

  /** The glyphs' luma, and the outline's: BT.709 limited range white and black. */
  static final byte WHITE = (byte) 235;
  static final byte BLACK = (byte) 16;

  /** The margin from the frame's edges, font pixels. */
  static final int MARGIN = 6;

  /** A line's height, font pixels: the glyph and two rows of space. */
  static final int LINE = Glyphs.HEIGHT + 3;

  private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.S'Z'", Locale.ROOT).withZone(ZoneOffset.UTC);

  /** The texts of one frame, by place, each a list of lines from the top down. */
  public record Texts(String topCentre, List<String> topLeft, List<String> bottomLeft, List<String> bottomRight) {
    public Texts {
      topLeft = List.copyOf(topLeft);
      bottomLeft = List.copyOf(bottomLeft);
      bottomRight = List.copyOf(bottomRight);
    }
  }

  private Overlay() {}

  /**
   * The texts for a frame.
   *
   * @param classification the classification's name, as ST 0102's tag 1 gets it ({@code classificationNames})
   * @param platformName the platform's name as ST 0601's tag 10 gets it
   * @param centre where the centre ray meets the ground, or {@code null}
   */
  public static Texts texts(Pose pose, String classification, String platformName, Renderer.@Nullable FrameCentre centre) {
    Pose.Platform p = pose.platform();
    List<String> topLeft = new ArrayList<>();
    topLeft.add(TIME.format(pose.time()));
    topLeft.add(cut(platformName));
    String mission = pose.mission();
    if (mission != null) {
      topLeft.add(cut(mission));
    }
    List<String> bottomLeft = List.of(
        position(p.lon(), p.lat()),
        String.format(Locale.ROOT, "HGT %.0f m HAE", p.height()),
        String.format(Locale.ROOT, "HDG %05.1f°", p.heading()));
    double azimuth = pose.pointing().azimuth();
    List<String> bottomRight = new ArrayList<>();
    bottomRight.add(String.format(Locale.ROOT, "AZ %05.1f° REL / %05.1f° TRUE", azimuth, trueBearing(p.heading(), azimuth)));
    bottomRight.add(String.format(Locale.ROOT, "DEP %.1f°", pose.pointing().depression()));
    bottomRight.add(String.format(Locale.ROOT, "FOV %.1f°×%.1f°", pose.horizontalFov(), pose.verticalFov()));
    if (centre == null) {
      bottomRight.add("no frame centre");
    } else {
      bottomRight.add("CTR " + position(centre.lon(), centre.lat()));
      bottomRight.add(String.format(Locale.ROOT, "SLANT %.0f m", centre.slantRange()));
    }
    return new Texts(classification, topLeft, bottomLeft, bottomRight);
  }

  /** The most characters of a name or mission on the top left, so that it keeps clear of the classification. */
  static final int MOST_CHARACTERS = 32;

  private static String cut(String text) {
    return text.length() <= MOST_CHARACTERS ? text : text.substring(0, MOST_CHARACTERS - 1) + "…";
  }

  /** The heading plus the azimuth, wrapped to 0 to below 360. */
  static double trueBearing(double heading, double azimuth) {
    double b = (heading + azimuth) % 360;
    if (b < 0) {
      b += 360;
    }
    return b >= 359.95 ? 0 : b; // so that it never prints as 360.0
  }

  /** A position as people read it: latitude, then longitude, each with its hemisphere. */
  static String position(double lon, double lat) {
    return String.format(Locale.ROOT, "%.5f %s %.5f %s", Math.abs(lat), lat < 0 ? "S" : "N", Math.abs(lon), lon < 0 ? "W" : "E");
  }

  /** How many picture pixels a font pixel takes in a frame of this height: 1, 2 or 3. */
  static int scale(int height) {
    return Math.max(1, height / 360);
  }

  /**
   * Where each line of the texts goes, {x, y, characters} in picture pixels of its first glyph's top
   * left corner; the boxes {@link #draw} changes are these lines' glyph boxes, with a pixel round them.
   */
  static List<int[]> layout(Texts texts, int width, int height) {
    int s = scale(height);
    int margin = MARGIN * s;
    int line = LINE * s;
    List<int[]> out = new ArrayList<>();
    int centreX = (width - textWidth(texts.topCentre(), s)) / 2;
    out.add(new int[] {centreX, margin, texts.topCentre().length()});
    int widest = texts.topLeft().stream().mapToInt(t -> textWidth(t, s)).max().orElse(0);
    // a long classification name is never cut: the lines on the top left go below it instead
    int y = margin + (texts.topLeft().isEmpty() || margin + widest + Glyphs.ADVANCE * s <= centreX ? 0 : line);
    for (String t : texts.topLeft()) {
      out.add(new int[] {margin, y, t.length()});
      y += line;
    }
    y = height - margin - texts.bottomLeft().size() * line + (line - Glyphs.HEIGHT * s);
    for (String t : texts.bottomLeft()) {
      out.add(new int[] {margin, y, t.length()});
      y += line;
    }
    y = height - margin - texts.bottomRight().size() * line + (line - Glyphs.HEIGHT * s);
    for (String t : texts.bottomRight()) {
      out.add(new int[] {width - margin - textWidth(t, s), y, t.length()});
      y += line;
    }
    return out;
  }

  private static int textWidth(String text, int s) {
    return Math.max(0, text.length() * Glyphs.ADVANCE - 1) * s;
  }

  /** Every line of the texts in their layout's order. */
  static List<String> lines(Texts texts) {
    List<String> out = new ArrayList<>();
    out.add(texts.topCentre());
    out.addAll(texts.topLeft());
    out.addAll(texts.bottomLeft());
    out.addAll(texts.bottomRight());
    return out;
  }

  /** Draws the texts into an I420 picture of this size. */
  public static void draw(byte[] picture, int width, int height, Texts texts) {
    int s = scale(height);
    List<int[]> at = layout(texts, width, height);
    List<String> lines = lines(texts);
    for (int i = 0; i < lines.size(); i++) {
      String text = lines.get(i);
      int x = at.get(i)[0];
      int y = at.get(i)[1];
      neutral(picture, width, height, x - 1, y - 1, textWidth(text, s) + 2, Glyphs.HEIGHT * s + 2);
      // the outline first, then the glyphs over it
      for (int pass = 0; pass < 2; pass++) {
        for (int c = 0; c < text.length(); c++) {
          char ch = text.charAt(c);
          int gx = x + c * Glyphs.ADVANCE * s;
          for (int r = 0; r < Glyphs.HEIGHT; r++) {
            int row = Glyphs.row(ch, r);
            if (row == 0) {
              continue;
            }
            for (int col = 0; col < Glyphs.WIDTH; col++) {
              if ((row & (1 << (Glyphs.WIDTH - 1 - col))) != 0) {
                int px = gx + col * s;
                int py = y + r * s;
                if (pass == 0) {
                  fill(picture, width, height, px - 1, py - 1, s + 2, s + 2, BLACK);
                } else {
                  fill(picture, width, height, px, py, s, s, WHITE);
                }
              }
            }
          }
        }
      }
    }
  }

  private static void fill(byte[] picture, int width, int height, int x0, int y0, int w, int h, byte v) {
    int x1 = Math.min(width, x0 + w);
    int y1 = Math.min(height, y0 + h);
    int x = Math.max(0, x0);
    if (x >= x1) {
      return;
    }
    for (int y = Math.max(0, y0); y < y1; y++) {
      Arrays.fill(picture, y * width + x, y * width + x1, v);
    }
  }

  /** The chroma under a box neutral, so that the glyphs are white and the outline black. */
  private static void neutral(byte[] picture, int width, int height, int x0, int y0, int w, int h) {
    int cw = width / 2;
    int ch = height / 2;
    int cb = width * height;
    int cr = cb + cw * ch;
    int cx0 = Math.max(0, x0 / 2);
    int cx1 = Math.min(cw, (x0 + w + 1) / 2);
    if (cx0 >= cx1) {
      return;
    }
    for (int cy = Math.max(0, y0 / 2); cy < Math.min(ch, (y0 + h + 1) / 2); cy++) {
      Arrays.fill(picture, cb + cy * cw + cx0, cb + cy * cw + cx1, (byte) 128);
      Arrays.fill(picture, cr + cy * cw + cx0, cr + cy * cw + cx1, (byte) 128);
    }
  }
}
