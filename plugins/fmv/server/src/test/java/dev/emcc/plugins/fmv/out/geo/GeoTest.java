package dev.emcc.plugins.fmv.out.geo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Position;
import org.junit.jupiter.api.Test;

/** WGS84, the local frame and SWEREF 99 TM (brief section 10.5). Points with latitude ≠ longitude. */
class GeoTest {

  @Test
  void ecefRoundTripsAndKnowsItsAxes() {
    double[] e = new double[3];
    double[] g = new double[3];
    Wgs84.toEcef(0, 0, 0, e);
    assertThat(e[0]).isCloseTo(Wgs84.A, within(1e-6));
    Wgs84.toEcef(90, 0, 0, e);
    assertThat(e[1]).isCloseTo(Wgs84.A, within(1e-6));
    for (double[] p : new double[][] {{17.3069, 62.3908, 700}, {-70.65, -33.45, 520}, {151.2, -33.87, -30}, {17.0, 88.5, 12_000}}) {
      Wgs84.toEcef(p[0], p[1], p[2], e);
      Wgs84.fromEcef(e[0], e[1], e[2], g);
      assertThat(g[0]).isCloseTo(p[0], within(1e-9));
      assertThat(g[1]).isCloseTo(p[1], within(1e-9));
      assertThat(g[2]).isCloseTo(p[2], within(1e-4));
    }
  }

  @Test
  void theLocalFrameAgreesWithTheSdksGeodesicAndRoundTrips() {
    LocalFrame f = new LocalFrame(17.3069, 62.3908, 700);
    double[] enu = new double[3];
    double[] g = new double[3];
    // 10 km at 60° on the ground: the geodesic's end, seen from the frame, lies at that bearing and distance
    Position end = Geodesy.direct(Position.of(17.3069, 62.3908), 60, 10_000);
    f.toEnu(end.longitude(), end.latitude(), 700, enu);
    double bearing = Math.toDegrees(Math.atan2(enu[0], enu[1]));
    assertThat(bearing).isCloseTo(60, within(0.02));
    assertThat(Math.hypot(enu[0], enu[1])).isCloseTo(10_000, within(2.0));
    // the curvature: a point 10 km away at the same height lies about d²/2R below the frame
    assertThat(enu[2]).isCloseTo(-10_000.0 * 10_000 / (2 * 6_381_000), within(0.2));
    assertThat(f.upOfHeight(700, enu[0] * enu[0] + enu[1] * enu[1])).isCloseTo(enu[2], within(0.1));
    // exact round trip
    f.toGeodetic(enu[0], enu[1], enu[2], g);
    assertThat(g[0]).isCloseTo(end.longitude(), within(1e-9));
    assertThat(g[1]).isCloseTo(end.latitude(), within(1e-9));
    assertThat(g[2]).isCloseTo(700, within(1e-4));
    // the first-order forms stay within 20 m at 10 km
    double dLon = (f.lonAt(enu[0]) - end.longitude()) * Math.toRadians(1) * 6_381_000 * Math.cos(Math.toRadians(62.39));
    double dLat = (f.latAt(enu[1]) - end.latitude()) * Math.toRadians(1) * 6_381_000;
    assertThat(Math.hypot(dLon, dLat)).isLessThan(20);
  }

  @Test
  void swerefOnItsCentralMeridianIsTheScaledMeridianArc() {
    // the meridian arc of GRS 80 to 62°, integrated numerically (Simpson), as an independent check
    double a = 6378137.0;
    double f = 1 / 298.257222101;
    double e2 = f * (2 - f);
    double phi = Math.toRadians(62);
    int n = 20_000;
    double sum = 0;
    for (int i = 0; i <= n; i++) {
      double p = phi * i / n;
      double s = Math.sin(p);
      double m = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5);
      sum += (i == 0 || i == n ? 1 : i % 2 == 1 ? 4 : 2) * m;
    }
    double arc = sum * phi / n / 3;
    double[] en = new double[2];
    Sweref99Tm.forward(15, 62, en);
    assertThat(en[0]).isCloseTo(500_000, within(1e-6));
    assertThat(en[1]).isCloseTo(0.9996 * arc, within(0.001));
  }

  @Test
  void swerefRoundTripsAndPutsStoraTorgetInS10sBox() {
    double[] en = new double[2];
    double[] back = new double[2];
    for (double[] p : new double[][] {{17.3069, 62.3908}, {11.97, 57.71}, {24.1, 65.8}, {13.0, 55.6}}) {
      Sweref99Tm.forward(p[0], p[1], en);
      Sweref99Tm.inverse(en[0], en[1], back);
      assertThat(back[0]).isCloseTo(p[0], within(1e-9));
      assertThat(back[1]).isCloseTo(p[1], within(1e-9));
    }
    // S10: the orthophotos cover 5 × 5 km round Stora torget, E 616 760–621 760, N 6 917 345–6 922 345
    Sweref99Tm.forward(17.3069, 62.3908, en);
    assertThat(en[0]).isCloseTo(619_260, within(150.0));
    assertThat(en[1]).isCloseTo(6_919_845, within(150.0));
  }
}
