package dev.emcc.plugins.basemapwms;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpCall;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import java.time.Duration;
import java.util.List;

/** Starts the plugin like the plugin host does, against the fake context, with small capabilities documents written for the tests. */
final class WmsTestSupport {

  static final String ROOT = "http://wms.test/ows";
  static final String CAPS_130 = ROOT + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities";
  static final String CAPS_111 = ROOT + "?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities";
  static final byte[] PNG_SIGNATURE = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};

  private WmsTestSupport() {}

  static String server(String id, String url, String version) {
    return "{\"id\":\"" + id + "\",\"name\":\"Server " + id + "\",\"url\":\"" + url + "\",\"protocol\":\"wms\",\"version\":\"" + version
        + "\",\"timeoutSeconds\":8}";
  }

  /** {@code layers} as a JSON array text, e.g. {@code "\"land\",\"sea\""}. */
  static String background(String id, String server, String layers, String format, boolean transparent) {
    return "{\"id\":\"" + id + "\",\"name\":\"Background " + id + "\",\"server\":\"" + server + "\",\"layers\":[" + layers
        + "],\"mode\":\"tiles\",\"format\":\"" + format + "\",\"transparent\":" + transparent + ",\"attribution\":{\"text\":\"(c) test\"}}";
  }

  static JsonObject settings(List<String> servers, List<String> backgrounds) {
    return (JsonObject) TestJson.parse("{\"servers\":[" + String.join(",", servers) + "],\"backgrounds\":[" + String.join(",", backgrounds) + "]}");
  }

  /** One server {@code geo} (WMS 1.3.0) and the background {@code topo} of the layers land and sea. */
  static JsonObject standardSettings() {
    return settings(List.of(server("geo", ROOT, "1.3.0")), List.of(background("topo", "geo", "\"land\",\"sea\"", "image/png", false)));
  }

  /** A 1.3.0 capabilities document: the root layer lists EPSG:4326 and EPSG:3857; land adds EPSG:3413, a group adds EPSG:3031. */
  static Bytes capabilities130() {
    return Bytes.utf8("""
        <?xml version="1.0" encoding="UTF-8"?>
        <WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
          <Service><Name>WMS</Name><Title>Test</Title></Service>
          <Capability>
            <Layer>
              <Title>Root</Title>
              <CRS>EPSG:4326</CRS><CRS>EPSG:3857</CRS>
              <Layer><Name>land</Name><Title>Land</Title><CRS>EPSG:3413</CRS></Layer>
              <Layer><Name>sea</Name><Title>Sea</Title><CRS>EPSG:3413</CRS></Layer>
              <Layer><Name>group</Name><Title>A group</Title><CRS>EPSG:3031</CRS>
                <Layer><Name>child</Name><Title>A child</Title></Layer>
              </Layer>
              <Layer><Title>Without a name</Title><Layer><Name>nested</Name></Layer></Layer>
            </Layer>
          </Capability>
        </WMS_Capabilities>
        """);
  }

  /** A 1.3.0 document in which the layers list only EPSG:4326 and EPSG:3857. */
  static Bytes capabilitiesWithoutPolar() {
    return Bytes.utf8("""
        <WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms"><Capability><Layer>
          <CRS>EPSG:4326</CRS><CRS>EPSG:3857</CRS>
          <Layer><Name>land</Name></Layer><Layer><Name>sea</Name></Layer>
        </Layer></Capability></WMS_Capabilities>
        """);
  }

  /** A 1.1.1 document (no DOCTYPE: the plugin refuses DTDs); the SRS element may hold several codes. */
  static Bytes capabilities111() {
    return Bytes.utf8("""
        <?xml version="1.0"?>
        <WMT_MS_Capabilities version="1.1.1">
          <Service><Name>OGC:WMS</Name><Title>Test</Title></Service>
          <Capability>
            <Layer>
              <Title>Root</Title>
              <SRS>EPSG:4326 EPSG:3857</SRS>
              <Layer><Name>land</Name><Title>Land</Title><SRS>EPSG:3413</SRS></Layer>
              <Layer><Name>sea</Name><Title>Sea</Title><SRS>EPSG:3413</SRS></Layer>
            </Layer>
          </Capability>
        </WMT_MS_Capabilities>
        """);
  }

  static Headers xml() {
    return Headers.of("Content-Type", "text/xml");
  }

  static Headers png() {
    return Headers.of("Content-Type", "image/png");
  }

  static Bytes image(int marker) {
    byte[] data = new byte[PNG_SIGNATURE.length + 1];
    System.arraycopy(PNG_SIGNATURE, 0, data, 0, PNG_SIGNATURE.length);
    data[PNG_SIGNATURE.length] = (byte) marker;
    return Bytes.of(data);
  }

  static Plugin newPlugin() throws Exception {
    return (Plugin) Class.forName(Manifest.entryClass()).getConstructor().newInstance();
  }

  /** The plugin initialised and started like the plugin host does it, with the capabilities of 1.3.0 scripted but nothing run yet. */
  static FakePluginContext start(JsonObject settings) throws Exception {
    FakePluginContext context = FakePluginContext.builder(Manifest.id()).settings(settings).build();
    context.upstream().respond(CAPS_130, 200, xml(), capabilities130());
    context.upstream().respond(CAPS_111, 200, xml(), capabilities111());
    Plugin plugin = newPlugin();
    plugin.init(context);
    plugin.start();
    return context;
  }

  /** Started, and the first capabilities read done. */
  static FakePluginContext started(JsonObject settings) throws Exception {
    FakePluginContext context = start(settings);
    context.runUntilIdle();
    return context;
  }

  /** The browser's query for one image of the standard background, as {@code wmsGetMapUrl} writes it, with the box of a 1.3.0 EPSG:3857 request. */
  static String query(String crsName, String crs, String bbox, String size) {
    return "SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=land%2Csea&STYLES=&FORMAT=image%2Fpng&TRANSPARENT=FALSE&" + crsName + "="
        + crs.replace(":", "%3A") + "&BBOX=" + bbox.replace(",", "%2C") + "&WIDTH=" + size + "&HEIGHT=" + size;
  }

  static String webMercatorQuery() {
    return query("CRS", "EPSG:3857", "-100,-50,100,50", "256");
  }

  /** What the plugin must send upstream for {@link #webMercatorQuery()}. */
  static String webMercatorUpstream() {
    return ROOT + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=land,sea&STYLES=&FORMAT=image/png&TRANSPARENT=FALSE&CRS=EPSG:3857"
        + "&BBOX=-100,-50,100,50&WIDTH=256&HEIGHT=256";
  }

  static List<String> calledUris(FakePluginContext context) {
    return context.httpCalls().stream().map(HttpCall::uri).map(Object::toString).toList();
  }

  /** How many calls went to {@code uri}. */
  static long callsTo(FakePluginContext context, String uri) {
    return calledUris(context).stream().filter(uri::equals).count();
  }

  static Duration seconds(long n) {
    return Duration.ofSeconds(n);
  }
}
