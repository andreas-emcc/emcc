package dev.emcc.plugins.cot.codec;

/** CoT events as text, for the tests. Latitude and longitude always differ. */
public final class Samples {

  /** An ATAK unit near Stockholm: lat 59.3507, lon 18.1012 (the example in model/examples). */
  public static final String UNIT = """
      <event version="2.0" uid="ANDROID-358240051111110" type="a-f-G-U-C-I" how="m-g" \
      time="2026-10-03T08:20:00.000Z" start="2026-10-03T08:20:00.000Z" stale="2026-10-03T08:25:00.000Z">\
      <point lat="59.3507" lon="18.1012" hae="45.2" ce="9999999.0" le="9999999.0"/>\
      <detail><contact callsign="VIPER 2" endpoint="*:-1:stcp"/><__group name="Cyan" role="Team Member"/>\
      <track course="270.0" speed="4.2"/><remarks>On patrol</remarks>\
      <priv:plugin xmlns:priv="urn:example:private" note="a &gt; b, kept"><!-- </detail> in a comment --></priv:plugin></detail></event>""";

  private Samples() {}

  /** A minimal atom. */
  public static String atom(String uid, String type, double lat, double lon, String time, String stale) {
    return "<event version=\"2.0\" uid=\"" + uid + "\" type=\"" + type + "\" how=\"m-g\" time=\"" + time + "\" start=\"" + time
        + "\" stale=\"" + stale + "\"><point lat=\"" + lat + "\" lon=\"" + lon + "\" hae=\"9999999.0\" ce=\"9999999.0\" le=\"9999999.0\"/><detail/></event>";
  }

  /** An atom at {@code time} (08:00:00 plus {@code seconds}) that is stale five minutes later. */
  public static String at(String uid, int seconds, double lat, double lon) {
    return atom(uid, "a-f-G-U-C-I", lat, lon, clock(seconds), clock(seconds + 300));
  }

  /** {@code 2026-10-12T08:00:00.000Z} plus {@code seconds}. */
  public static String clock(int seconds) {
    int h = 8 + seconds / 3600;
    int m = seconds % 3600 / 60;
    int s = seconds % 60;
    return String.format("2026-10-12T%02d:%02d:%02d.000Z", h, m, s);
  }
}
