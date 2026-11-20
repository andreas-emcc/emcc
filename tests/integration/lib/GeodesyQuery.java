// Geodesics for the ITA's checks (lib/geodesy.mjs; owner, 2026-10-29, Q5): the Java SDK's own
// Geodesy, so a test compares the simulator with the SDK it is built on, not with a second formula.
// Run with the JDK's single-file launcher, with the SDK's and GeographicLib's jars on the class
// path: java --class-path <sdk.jar><sep><geographiclib.jar> GeodesyQuery.java
// Reads one query a line from standard input and prints one answer a line, in the same order:
//   inverse <lon1> <lat1> <lon2> <lat2>   ->  <distance m> <initial azimuth> <final azimuth>
//   direct <lon> <lat> <azimuth> <metres> ->  <lon> <lat>
//   at <metres> <lon1> <lat1> <lon2> <lat2> [...]  ->  <lon> <lat> <azimuth> <leg> <fraction>
// Positions are longitude, latitude (ADR-0007). A query it cannot read ends it with exit code 1.
import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.geo.PathPoint;
import dev.emcc.sdk.model.Position;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class GeodesyQuery {
  public static void main(String[] args) throws Exception {
    var in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    var out = new StringBuilder();
    for (String line = in.readLine(); line != null; line = in.readLine()) {
      if (line.isBlank()) continue;
      String[] p = line.trim().split("\\s+");
      double[] n = new double[p.length - 1];
      for (int i = 1; i < p.length; i++) n[i - 1] = Double.parseDouble(p[i]);
      switch (p[0]) {
        case "inverse" -> {
          GeodesicLeg leg = Geodesy.inverse(Position.of(n[0], n[1]), Position.of(n[2], n[3]));
          out.append(String.format(Locale.ROOT, "%.6f %.9f %.9f%n", leg.distanceMetres(), leg.initialAzimuth(), leg.finalAzimuth()));
        }
        case "direct" -> {
          Position to = Geodesy.direct(Position.of(n[0], n[1]), n[2], n[3]);
          out.append(String.format(Locale.ROOT, "%.12f %.12f%n", to.longitude(), to.latitude()));
        }
        case "at" -> {
          List<Position> points = new ArrayList<>();
          for (int i = 1; i + 1 < n.length; i += 2) points.add(Position.of(n[i], n[i + 1]));
          PathPoint at = Geodesy.path(points).at(n[0]);
          out.append(String.format(Locale.ROOT, "%.12f %.12f %.9f %d %.12f%n", at.position().longitude(), at.position().latitude(), at.azimuth(), at.leg(), at.fraction()));
        }
        default -> {
          System.err.println("not a query: " + line);
          System.exit(1);
        }
      }
    }
    System.out.print(out);
  }
}
