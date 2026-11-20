// Makes the ground texture for the marketing FMV picture (fmv.jpg): a grey, thermal-looking image of
// the land round Sundsvall, drawn only from public-domain height data (SRTM, the release's Sundsvall
// demo DTED cell e017/n62, level 2). Hillshade and height give the relief, water (height 0, as the
// demo zip sets it) is dark, and seeded value noise gives the ground a texture. No imagery is used.
//
//   java FmvTexture.java <n62.dt2> <out-folder>
//
// It writes <out-folder>/imagery.json and its PNG tiles in the form that spike S10's renderer reads
// (spikes/s10-uav-fmv/java/RenderBench.java: a SWEREF 99 TM box, tile size, one entry per tile).
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import javax.imageio.ImageIO;

public class FmvTexture {
  // The box in SWEREF 99 TM (metres), round Sundsvall's centre (62.3908 N, 17.3069 E), and the pixel size.
  static final double MIN_E = 609000, MIN_N = 6910000, MAX_E = 630000, MAX_N = 6931000, PX = 4;
  static final int TILE = 1750;

  public static void main(String[] a) throws IOException {
    Dted dem = new Dted(Path.of(a[0]));
    Path out = Path.of(a[1]);
    Files.createDirectories(out);
    int w = (int) Math.round((MAX_E - MIN_E) / PX), h = (int) Math.round((MAX_N - MIN_N) / PX);
    // Geographic corners of the box by inverting SWEREF 99 TM, then bilinear across it (the error over
    // 21 km is far below a pixel).
    double[][] corner = {inverse(MIN_E, MAX_N), inverse(MAX_E, MAX_N), inverse(MIN_E, MIN_N), inverse(MAX_E, MIN_N)};
    double maxH = 1;
    double[] heights = new double[w * h];
    for (int y = 0; y < h; y++) {
      for (int x = 0; x < w; x++) {
        double[] ll = at(corner, (x + 0.5) / w, (y + 0.5) / h);
        double v = dem.height(ll[0], ll[1]);
        heights[y * w + x] = v;
        maxH = Math.max(maxH, v);
      }
    }
    // Smooth the heights (three box passes of 14 pixels, about a 60 m Gaussian): the cell's whole-metre
    // steps on its 30 m grid would show as terraces once the relief is exaggerated, and its coast steps
    // go; the relief stays.
    for (int pass = 0; pass < 3; pass++) heights = blur(heights, w, h, 14);
    // The sun from the north-west, 40 degrees up; slopes measured over 3 pixels (12 m), the relief
    // exaggerated three times so that the gentle hills read.
    double az = Math.toRadians(315), el = Math.toRadians(40);
    double sx = Math.sin(az) * Math.cos(el), sy = Math.cos(az) * Math.cos(el), sz = Math.sin(el);
    byte[] grey = new byte[w * h];
    for (int y = 0; y < h; y++) {
      for (int x = 0; x < w; x++) {
        double v = heights[y * w + x];
        int x0 = Math.max(0, x - 3), x1 = Math.min(w - 1, x + 3), y0 = Math.max(0, y - 3), y1 = Math.min(h - 1, y + 3);
        double dzdx = 3 * (heights[y * w + x1] - heights[y * w + x0]) / ((x1 - x0) * PX);
        double dzdy = 3 * (heights[y0 * w + x] - heights[y1 * w + x]) / ((y1 - y0) * PX); // north is up
        double nl = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
        double shade = Math.max(0, (-dzdx * sx - dzdy * sy + sz) / nl);
        double fine = noise(x * PX / 9.0, y * PX / 9.0, 1) * 0.6 + noise(x * PX / 41.0, y * PX / 41.0, 2) * 0.4;
        double patch = 0.45 * noise(x * PX / 240.0, y * PX / 240.0, 4) + 0.25 * noise(x * PX / 110.0, y * PX / 110.0, 5)
            + 0.18 * noise(x * PX / 47.0, y * PX / 47.0, 7) + 0.12 * noise(x * PX / 19.0, y * PX / 19.0, 8);
        double g;
        if (v <= 1.5) {
          g = 0.17 + 0.03 * noise(x * PX / 60.0, y * PX / 60.0, 3); // water: cool and smooth
        } else {
          // Land cover from thresholded noise, with edges 8 m wide: lighter, smoother clearings, and
          // darker, grainier forest.
          double open = Math.max(0, Math.min(1, (patch - 0.60) / 0.015));
          double grain = noise(x * PX / 5.0, y * PX / 5.0, 6);
          g = 0.50 + 1.3 * (shade - sz) + 0.14 * (v / maxH)
              + open * (0.05 + 0.05 * (fine - 0.5))
              + (1 - open) * (-0.02 + 0.12 * (grain - 0.5) + 0.08 * (fine - 0.5));
          if (v < 6) g = g * 0.85 + 0.12; // a lighter shore
        }
        grey[y * w + x] = (byte) Math.max(0, Math.min(255, Math.round(g * 255)));
      }
    }
    StringBuilder tiles = new StringBuilder();
    for (int ty = 0; ty * TILE < h; ty++) {
      for (int tx = 0; tx * TILE < w; tx++) {
        BufferedImage im = new BufferedImage(TILE, TILE, BufferedImage.TYPE_BYTE_GRAY);
        byte[] row = new byte[TILE];
        for (int y = 0; y < TILE; y++) {
          int gy = ty * TILE + y;
          for (int x = 0; x < TILE; x++) {
            int gx = tx * TILE + x;
            row[x] = gx < w && gy < h ? grey[gy * w + gx] : 0;
          }
          im.getRaster().setDataElements(0, y, TILE, 1, row);
        }
        String name = String.format(Locale.ROOT, "tile-%d-%d.png", tx, ty);
        ImageIO.write(im, "png", out.resolve(name).toFile());
        if (tiles.length() > 0) tiles.append(",\n");
        tiles.append(String.format(Locale.ROOT, "    {\"file\": \"%s\", \"col\": %d, \"row\": %d}", name, tx, ty));
      }
    }
    // The renderer's box is the tiles' whole extent, which may reach past the box above.
    int cols = (w + TILE - 1) / TILE, rows = (h + TILE - 1) / TILE;
    double maxE = MIN_E + cols * TILE * PX, minN = MAX_N - rows * TILE * PX;
    Files.writeString(out.resolve("imagery.json"), String.format(Locale.ROOT,
        "{\n  \"source\": \"FmvTexture.java: SRTM heights (public domain), no imagery\",\n  \"bbox\": [%.1f, %.1f, %.1f, %.1f],\n  \"tileWidth\": %d,\n  \"tileHeight\": %d,\n  \"tiles\": [\n%s\n  ]\n}\n",
        MIN_E, minN, maxE, MAX_N, TILE, TILE, tiles));
    System.out.printf(Locale.ROOT, "%d x %d px, %d tiles, highest %.0f m%n", w, h, cols * rows, maxH);
  }

  static double[] blur(double[] src, int w, int h, int r) {
    double[] tmp = new double[src.length], out = new double[src.length];
    for (int y = 0; y < h; y++) {
      double sum = 0;
      for (int x = -r; x <= r; x++) sum += src[y * w + Math.max(0, Math.min(w - 1, x))];
      for (int x = 0; x < w; x++) {
        tmp[y * w + x] = sum / (2 * r + 1);
        sum += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
      }
    }
    for (int x = 0; x < w; x++) {
      double sum = 0;
      for (int y = -r; y <= r; y++) sum += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
      for (int y = 0; y < h; y++) {
        out[y * w + x] = sum / (2 * r + 1);
        sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  static double[] at(double[][] c, double fx, double fy) {
    double lat = (c[0][0] * (1 - fx) + c[1][0] * fx) * (1 - fy) + (c[2][0] * (1 - fx) + c[3][0] * fx) * fy;
    double lon = (c[0][1] * (1 - fx) + c[1][1] * fx) * (1 - fy) + (c[2][1] * (1 - fx) + c[3][1] * fx) * fy;
    return new double[] {lat, lon};
  }

  // ------------------------------------------------------------ value noise, seeded
  static double noise(double x, double y, int seed) {
    int xi = (int) Math.floor(x), yi = (int) Math.floor(y);
    double fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    double a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  static double hash(int x, int y, int seed) {
    long h = x * 374761393L + y * 668265263L + seed * 2147483647L;
    h = (h ^ (h >>> 13)) * 1274126177L;
    return ((h ^ (h >>> 16)) & 0xffffff) / (double) 0xffffff;
  }

  // ------------------------------------------------------------ SWEREF 99 TM (as RenderBench.sweref), inverted by Newton steps
  static final double A_ = 6378137.0, F_ = 1 / 298.257222101, K0 = 0.9996, LON0 = Math.toRadians(15), FE = 500000;

  static double[] forward(double latDeg, double lonDeg) {
    double e2 = F_ * (2 - F_), n = F_ / (2 - F_);
    double ah = A_ / (1 + n) * (1 + n * n / 4 + Math.pow(n, 4) / 64);
    double ca = e2, cb = (5 * e2 * e2 - Math.pow(e2, 3)) / 6, cc = (104 * Math.pow(e2, 3) - 45 * Math.pow(e2, 4)) / 120,
        cd = 1237 * Math.pow(e2, 4) / 1260;
    double b1 = n / 2 - 2 * n * n / 3 + 5 * Math.pow(n, 3) / 16 + 41 * Math.pow(n, 4) / 180,
        b2 = 13 * n * n / 48 - 3 * Math.pow(n, 3) / 5 + 557 * Math.pow(n, 4) / 1440,
        b3 = 61 * Math.pow(n, 3) / 240 - 103 * Math.pow(n, 4) / 140, b4 = 49561 * Math.pow(n, 4) / 161280;
    double phi = Math.toRadians(latDeg), dl = Math.toRadians(lonDeg) - LON0;
    double s = Math.sin(phi);
    double phiStar = phi - s * Math.cos(phi) * (ca + cb * s * s + cc * Math.pow(s, 4) + cd * Math.pow(s, 6));
    double xi = Math.atan(Math.tan(phiStar) / Math.cos(dl));
    double eta = atanh(Math.cos(phiStar) * Math.sin(dl));
    double x = K0 * ah * (xi + b1 * Math.sin(2 * xi) * Math.cosh(2 * eta) + b2 * Math.sin(4 * xi) * Math.cosh(4 * eta)
        + b3 * Math.sin(6 * xi) * Math.cosh(6 * eta) + b4 * Math.sin(8 * xi) * Math.cosh(8 * eta));
    double y = K0 * ah * (eta + b1 * Math.cos(2 * xi) * Math.sinh(2 * eta) + b2 * Math.cos(4 * xi) * Math.sinh(4 * eta)
        + b3 * Math.cos(6 * xi) * Math.sinh(6 * eta) + b4 * Math.cos(8 * xi) * Math.sinh(8 * eta)) + FE;
    return new double[] {y, x}; // easting, northing
  }

  static double atanh(double x) { return 0.5 * Math.log((1 + x) / (1 - x)); }

  static double[] inverse(double e, double n) {
    double lat = 62.4, lon = 17.3;
    for (int i = 0; i < 20; i++) {
      double[] p = forward(lat, lon), pl = forward(lat + 1e-5, lon), po = forward(lat, lon + 1e-5);
      double a = (pl[0] - p[0]) / 1e-5, b = (po[0] - p[0]) / 1e-5, c = (pl[1] - p[1]) / 1e-5, d = (po[1] - p[1]) / 1e-5;
      double re = e - p[0], rn = n - p[1], det = a * d - b * c;
      lat += (d * re - b * rn) / det;
      lon += (a * rn - c * re) / det;
    }
    return new double[] {lat, lon};
  }

  // ------------------------------------------------------------ DTED (MIL-PRF-89020B), one cell
  static final class Dted {
    final double lon0, lat0, dLon, dLat;
    final int nLon, nLat;
    final short[] h;

    Dted(Path p) throws IOException {
      byte[] b = Files.readAllBytes(p);
      String uhl = new String(b, 0, 80, java.nio.charset.StandardCharsets.US_ASCII);
      lon0 = dms(uhl.substring(4, 12));
      lat0 = dms(uhl.substring(12, 20));
      dLon = Integer.parseInt(uhl.substring(20, 24).trim()) / 36000.0;
      dLat = Integer.parseInt(uhl.substring(24, 28).trim()) / 36000.0;
      nLon = Integer.parseInt(uhl.substring(47, 51).trim());
      nLat = Integer.parseInt(uhl.substring(51, 55).trim());
      h = new short[nLon * nLat];
      int rec = 8 + 2 * nLat + 4, at = 3428;
      for (int i = 0; i < nLon; i++, at += rec) {
        for (int j = 0; j < nLat; j++) {
          int v = ((b[at + 8 + 2 * j] & 0xff) << 8) | (b[at + 9 + 2 * j] & 0xff);
          int m = (v & 0x8000) != 0 ? -(v & 0x7fff) : v; // signed magnitude
          h[i * nLat + j] = (short) (m < -12000 ? 0 : m);
        }
      }
    }

    static double dms(String s) {
      double d = Integer.parseInt(s.substring(0, 3)) + Integer.parseInt(s.substring(3, 5)) / 60.0 + Integer.parseInt(s.substring(5, 7)) / 3600.0;
      return s.charAt(7) == 'S' || s.charAt(7) == 'W' ? -d : d;
    }

    double height(double lat, double lon) {
      double fi = (lon - lon0) / dLon, fj = (lat - lat0) / dLat;
      int i = (int) Math.floor(fi), j = (int) Math.floor(fj);
      if (i < 0 || j < 0 || i >= nLon - 1 || j >= nLat - 1) return 0;
      double u = fi - i, v = fj - j;
      double a = h[i * nLat + j], bb = h[(i + 1) * nLat + j], c = h[i * nLat + j + 1], d = h[(i + 1) * nLat + j + 1];
      return (a * (1 - u) + bb * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    }
  }
}
