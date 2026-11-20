package dev.emcc.plugins.fmv.out.imagery;

import java.awt.image.BufferedImage;
import java.awt.image.Raster;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Iterator;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.MemoryCacheImageInputStream;
import org.jspecify.annotations.Nullable;

/**
 * One decoded tile, ready for the renderer: its luma at full size and, for a colour tile, its
 * chroma at half size (as the I420 picture it goes into), all as BT.709 limited range (Y 16 to 235,
 * Cb and Cr 16 to 240). A tile with no colour keeps one plane (spike S10: one band would do).
 * Owned by the compute task that decoded it.
 *
 * <p>Decoding uses the JDK's ImageIO (owner, Q2) from memory only: a {@link
 * MemoryCacheImageInputStream}, never a cache file, and no global ImageIO setting changed. The
 * JDK's JPEG reader starts one daemon thread of its own ("Java2D Disposer") the first time it is
 * used; the release runtime needs {@code java.desktop} (G20).
 */
public final class TilePicture {

  private final int width;
  private final int height;
  private final byte[] luma;
  private final byte @Nullable [] cb;
  private final byte @Nullable [] cr;

  TilePicture(int width, int height, byte[] luma, byte @Nullable [] cb, byte @Nullable [] cr) {
    this.width = width;
    this.height = height;
    this.luma = luma;
    this.cb = cb;
    this.cr = cr;
  }

  /** A file that is not a picture ImageIO reads, or not of its stated size. */
  public static final class PictureException extends Exception {
    private static final long serialVersionUID = 1L;

    PictureException(String message) {
      super(message);
    }
  }

  public int width() {
    return width;
  }

  public int height() {
    return height;
  }

  /** Whether the tile has colour (chroma planes). */
  public boolean colour() {
    return cb != null;
  }

  /** The luma plane, row by row; the renderer reads it and never writes it. */
  byte[] luma() {
    return luma;
  }

  /** The Cb plane at half size ({@code (width + 1) / 2} by {@code (height + 1) / 2}); {@code null} without colour. */
  byte @Nullable [] cb() {
    return cb;
  }

  byte @Nullable [] cr() {
    return cr;
  }

  /** Luma of an 8-bit grey value, limited range. */
  static int lumaOfGrey(int g) {
    return 16 + (219 * g + 127) / 255;
  }

  /**
   * Decodes a JPEG or PNG file's bytes.
   *
   * @param width the size the set states; a picture of another size is refused
   * @param height the size the set states
   */
  public static TilePicture decode(byte[] file, int width, int height) throws PictureException {
    BufferedImage image;
    try (ImageInputStream in = new MemoryCacheImageInputStream(new ByteArrayInputStream(file))) {
      Iterator<ImageReader> readers = ImageIO.getImageReaders(in);
      if (!readers.hasNext()) {
        throw new PictureException("not a picture ImageIO reads");
      }
      ImageReader reader = readers.next();
      try {
        reader.setInput(in, true, true);
        int w = reader.getWidth(0);
        int h = reader.getHeight(0);
        if (w != width || h != height) {
          throw new PictureException("the picture is " + w + " × " + h + ", the set says " + width + " × " + height);
        }
        image = reader.read(0);
      } finally {
        reader.dispose();
      }
    } catch (IOException | RuntimeException e) {
      throw new PictureException("cannot decode: " + e.getMessage());
    }
    return of(image);
  }

  /** Converts a decoded picture. */
  static TilePicture of(BufferedImage image) {
    int w = image.getWidth();
    int h = image.getHeight();
    byte[] luma = new byte[w * h];
    Raster raster = image.getRaster();
    boolean grey = raster.getNumBands() == 1 && image.getColorModel().getColorSpace().getType() == java.awt.color.ColorSpace.TYPE_GRAY
        && image.getColorModel().getComponentSize(0) == 8;
    if (grey) {
      int[] row = new int[w];
      for (int y = 0; y < h; y++) {
        raster.getSamples(0, y, w, 1, 0, row);
        for (int x = 0; x < w; x++) {
          luma[y * w + x] = (byte) lumaOfGrey(row[x]);
        }
      }
      return new TilePicture(w, h, luma, null, null);
    }
    int cw = (w + 1) / 2;
    int ch = (h + 1) / 2;
    int[] sumCb = new int[cw * ch];
    int[] sumCr = new int[cw * ch];
    int[] count = new int[cw * ch];
    int[] row = new int[w];
    boolean anyColour = false;
    for (int y = 0; y < h; y++) {
      image.getRGB(0, y, w, 1, row, 0, w);
      for (int x = 0; x < w; x++) {
        int rgb = row[x];
        int r = (rgb >> 16) & 0xFF;
        int g = (rgb >> 8) & 0xFF;
        int b = rgb & 0xFF;
        luma[y * w + x] = (byte) (16 + Math.round(219 * (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255));
        int c = (y / 2) * cw + x / 2;
        sumCb[c] += (int) Math.round(224 * (-0.114572 * r - 0.385428 * g + 0.5 * b) / 255 * 16);
        sumCr[c] += (int) Math.round(224 * (0.5 * r - 0.454153 * g - 0.045847 * b) / 255 * 16);
        count[c]++;
        anyColour |= r != g || g != b;
      }
    }
    if (!anyColour) {
      return new TilePicture(w, h, luma, null, null);
    }
    byte[] cb = new byte[cw * ch];
    byte[] cr = new byte[cw * ch];
    for (int i = 0; i < cb.length; i++) {
      cb[i] = (byte) (128 + Math.round(sumCb[i] / (16.0 * count[i])));
      cr[i] = (byte) (128 + Math.round(sumCr[i] / (16.0 * count[i])));
    }
    return new TilePicture(w, h, luma, cb, cr);
  }
}
