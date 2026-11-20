package dev.emcc.plugins.basemapwms;

import static dev.emcc.plugins.basemapwms.WmsTestSupport.ROOT;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.calledUris;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.callsTo;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.image;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.png;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.query;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.standardSettings;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.started;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.webMercatorQuery;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.webMercatorUpstream;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import dev.emcc.sdk.testkit.FakePluginContext;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Brief function 2 and criteria 4, 9, 10, 11, 14, 16 and 17: the map pass-through. */
class MapRequestTest {

  private static FakeHttpExchange map(FakePluginContext context, String query) {
    FakeHttpExchange call = context.call("/map/topo?" + query);
    context.runUntilIdle();
    return call;
  }

  private static int mapCalls(FakePluginContext context) {
    return (int) calledUris(context).stream().filter(u -> u.contains("REQUEST=GetMap")).count();
  }

  @Test
  void aCheckedRequestIsPassedOnAsThePluginsOwnAndTheImageComesBack() throws Exception {
    FakePluginContext context = started(standardSettings());
    context.upstream().respond(webMercatorUpstream(), 200, png(), image(7));

    HttpReply reply = map(context, webMercatorQuery()).reply();

    assertThat(reply.status()).isEqualTo(200);
    assertThat(reply.body()).isEqualTo(image(7));
    assertThat(reply.headers().first("Content-Type")).isEqualTo("image/png");
    assertThat(reply.headers().first("Cache-Control")).isEqualTo("private, max-age=3600");
    assertThat(callsTo(context, webMercatorUpstream())).isEqualTo(1);
    assertThat(context.httpCalls().getLast().headers().first("User-Agent")).contains("emc2").contains("basemap-wms");
  }

  @Test
  void namesAndSomeValuesAreMatchedIgnoringCaseAndTheBoxIsWrittenInPlainNotation() throws Exception {
    FakePluginContext context = started(standardSettings());
    String upstream = ROOT + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=land,sea&STYLES=&FORMAT=image/png&TRANSPARENT=FALSE&CRS=EPSG:3857"
        + "&BBOX=0,0,10000000,20000000&WIDTH=256&HEIGHT=512";
    context.upstream().respond(upstream, 200, png(), image(1));

    String browser = "service=wms&request=getmap&version=1.3.0&layers=land%2Csea&styles=&format=image%2Fpng&transparent=false&crs=epsg%3A3857"
        + "&bbox=0%2C0%2C1e7%2C2e7&width=256&height=512";
    FakeHttpExchange call = map(context, browser);

    assertThat(call.reply().status()).isEqualTo(200);
    assertThat(callsTo(context, upstream)).isEqualTo(1);
  }

  @Test
  void refusedRequestsAnswer400AndTheServerGetsNoCall() throws Exception {
    FakePluginContext context = started(standardSettings());
    int callsBefore = context.httpCalls().size();
    String ok = webMercatorQuery();
    List<String> refused = new ArrayList<>(List.of(
        ok.replace("LAYERS=land%2Csea", "LAYERS=sea%2Cland"), // reordered
        ok.replace("LAYERS=land%2Csea", "LAYERS=land"), // other layers
        ok.replace("LAYERS=land%2Csea", "LAYERS=land%2Csea%2Cgroup"),
        query("CRS", "EPSG:3031", "-100,-50,100,50", "256"), // a projection the background is not offered in
        query("CRS", "EPSG:9999", "-100,-50,100,50", "256"),
        ok.replace("WIDTH=256", "WIDTH=4097"),
        ok.replace("HEIGHT=256", "HEIGHT=0"),
        ok.replace("WIDTH=256", "WIDTH=abc"),
        ok.replace("WIDTH=256", "WIDTH=2%2E5"),
        ok.replace("BBOX=-100%2C-50%2C100%2C50", "BBOX=100%2C-50%2C-100%2C50"), // minimum above maximum
        ok.replace("BBOX=-100%2C-50%2C100%2C50", "BBOX=-100%2C-50%2C100"), // three numbers
        ok.replace("BBOX=-100%2C-50%2C100%2C50", "BBOX=-100%2C-50%2CNaN%2C50"),
        ok.replace("BBOX=-100%2C-50%2C100%2C50", "BBOX=-100%2C-50%2C1e999%2C50"),
        ok.replace("BBOX=-100%2C-50%2C100%2C50", "BBOX=-100%2C-50%2C0x10%2C50"),
        ok.replace("FORMAT=image%2Fpng", "FORMAT=image%2Fjpeg"), // another format
        ok.replace("REQUEST=GetMap", "REQUEST=GetFeatureInfo"),
        ok.replace("SERVICE=WMS", "SERVICE=WFS"),
        ok.replace("VERSION=1.3.0", "VERSION=1.1.1"),
        ok.replace("TRANSPARENT=FALSE", "TRANSPARENT=TRUE"),
        ok.replace("STYLES=", "STYLES=dark"),
        ok.replace("&CRS=EPSG%3A3857", ""), // missing
        ok.replace("CRS=", "SRS="), // the other version's name
        ok + "&WIDTH=256", // twice
        ok + "&width=256", // twice in another case
        ok + "&Layers=land%2Csea"));
    for (String query : refused) {
      assertThat(map(context, query).reply().status()).as(query).isEqualTo(400);
    }

    assertThat(context.httpCalls()).hasSize(callsBefore);
    assertThat(mapCalls(context)).isZero();
  }

  @Test
  void anUnknownBackgroundIsRefused() throws Exception {
    FakePluginContext context = started(standardSettings());
    int callsBefore = context.httpCalls().size();

    FakeHttpExchange call = context.call("/map/nothing?" + webMercatorQuery());
    context.runUntilIdle();

    assertThat(call.reply().status()).isEqualTo(400);
    assertThat(context.httpCalls()).hasSize(callsBefore);
  }

  @Test
  void nothingTheBrowserAddsReachesTheServer() throws Exception {
    FakePluginContext context = started(standardSettings());
    context.upstream().respond(webMercatorUpstream(), 200, png(), image(1));

    FakeHttpExchange call = map(context, webMercatorQuery() + "&url=http%3A%2F%2Fother%2F&MAP=%2Fetc%2Fpasswd&EXCEPTIONS=XML");

    assertThat(call.reply().status()).isEqualTo(200);
    // the only call after the capabilities read is the plugin's own request, to the saved server's address
    assertThat(calledUris(context)).containsExactly(WmsTestSupport.CAPS_130, webMercatorUpstream());
  }

  @Test
  void onlyTheConfiguredServersAreCalled() throws Exception {
    FakePluginContext context = started(standardSettings());
    context.upstream().respond(webMercatorUpstream(), 200, png(), image(1));

    map(context, webMercatorQuery() + "&url=http%3A%2F%2Fother.example%2Fows");
    context.call("/backgrounds");
    context.runUntilIdle();

    assertThat(context.httpCalls()).allSatisfy(call -> assertThat(call.uri().getHost()).isEqualTo("wms.test"));
  }

  @Test
  void aServerAddressWithAQueryKeepsItAndReplacesTheOwnParameters() throws Exception {
    String address = "http://wms.test/cgi?map=/data/world.map&service=other&LAYERS=x";
    var settings = WmsTestSupport.settings(
        List.of(WmsTestSupport.server("geo", address, "1.3.0")),
        List.of(WmsTestSupport.background("topo", "geo", "\"land\",\"sea\"", "image/png", false)));
    FakePluginContext context = WmsTestSupport.start(settings);
    String caps = "http://wms.test/cgi?map=/data/world.map&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities";
    context.upstream().respond(caps, 200, WmsTestSupport.xml(), WmsTestSupport.capabilities130());
    context.runUntilIdle();
    String upstream = webMercatorUpstream().replace(ROOT + "?", "http://wms.test/cgi?map=/data/world.map&");
    context.upstream().respond(upstream, 200, png(), image(2));

    assertThat(map(context, webMercatorQuery()).reply().status()).isEqualTo(200);
    assertThat(calledUris(context)).contains(caps, upstream);
  }

  @Test
  void axisOrderIsPassedOnUnchangedInVersion130() throws Exception {
    // 10 E to 20 E, 55 N to 65 N: WMS 1.3.0 wants latitude first in EPSG:4326, and the map view sends it so
    FakePluginContext context = started(standardSettings());
    String upstream = ROOT + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=land,sea&STYLES=&FORMAT=image/png&TRANSPARENT=FALSE&CRS=EPSG:4326"
        + "&BBOX=55,10,65,20&WIDTH=256&HEIGHT=256";
    context.upstream().respond(upstream, 200, png(), image(3));

    FakeHttpExchange call = map(context, query("CRS", "EPSG:4326", "55,10,65,20", "256"));

    assertThat(call.reply().status()).isEqualTo(200);
    assertThat(callsTo(context, upstream)).isEqualTo(1);
  }

  @Test
  void version111UsesSrsAndLongitudeFirst() throws Exception {
    var settings = WmsTestSupport.settings(
        List.of(WmsTestSupport.server("geo", ROOT, "1.1.1")),
        List.of(WmsTestSupport.background("topo", "geo", "\"land\",\"sea\"", "image/png", false)));
    FakePluginContext context = started(settings);
    String upstream = ROOT + "?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=land,sea&STYLES=&FORMAT=image/png&TRANSPARENT=FALSE&SRS=EPSG:4326"
        + "&BBOX=10,55,20,65&WIDTH=256&HEIGHT=256";
    context.upstream().respond(upstream, 200, png(), image(4));

    String browser = query("SRS", "EPSG:4326", "10,55,20,65", "256").replace("VERSION=1.3.0", "VERSION=1.1.1");
    FakeHttpExchange call = map(context, browser);

    assertThat(call.reply().status()).isEqualTo(200);
    assertThat(callsTo(context, upstream)).isEqualTo(1);
    // version 1.1.1 does not take CRS
    assertThat(map(context, query("CRS", "EPSG:4326", "10,55,20,65", "256").replace("VERSION=1.3.0", "VERSION=1.1.1")).reply().status()).isEqualTo(400);
  }

  @Test
  void aServiceExceptionAnotherStatusAndAFailureAreAll502() throws Exception {
    FakePluginContext context = started(standardSettings());
    Headers xml = Headers.of("Content-Type", "text/xml");
    Bytes exception = Bytes.utf8("<ServiceExceptionReport><ServiceException>layer missing</ServiceException></ServiceExceptionReport>");

    context.upstream().respond(webMercatorUpstream(), 200, xml, exception);
    HttpReply xmlWithStatus200 = map(context, webMercatorQuery()).reply();
    context.upstream().respond(webMercatorUpstream(), 500, png(), image(1));
    HttpReply status500 = map(context, webMercatorQuery()).reply();
    context.upstream().respond(webMercatorUpstream(), 404, xml, exception);
    HttpReply status404 = map(context, webMercatorQuery()).reply();
    context.upstream().fail(webMercatorUpstream(), "connection refused");
    HttpReply failed = map(context, webMercatorQuery()).reply();
    context.upstream().never(webMercatorUpstream());
    FakeHttpExchange hanging = context.call("/map/topo?" + webMercatorQuery());
    context.advance(Duration.ofSeconds(9));

    for (HttpReply reply : List.of(xmlWithStatus200, status500, status404, failed, hanging.reply())) {
      assertThat(reply.status()).isEqualTo(502);
      assertThat(reply.body().isEmpty()).as("no image and no error text for the browser").isTrue();
    }
  }

  @Test
  void anImageOfAnotherTypeThanTheBackgroundsFormatIsNotPassedOn() throws Exception {
    FakePluginContext context = started(standardSettings());
    context.upstream().respond(webMercatorUpstream(), 200, Headers.of("Content-Type", "image/jpeg"), image(1));

    assertThat(map(context, webMercatorQuery()).reply().status()).isEqualTo(502);
  }

  @Test
  void aTransparentPngBackgroundAsksForTransparencyAndAJpegBackgroundForJpeg() throws Exception {
    var settings = WmsTestSupport.settings(
        List.of(WmsTestSupport.server("geo", ROOT, "1.3.0")),
        List.of(
            WmsTestSupport.background("overlay", "geo", "\"land\"", "image/png", true),
            WmsTestSupport.background("photo", "geo", "\"sea\"", "image/jpeg", false)));
    FakePluginContext context = started(settings);
    String overlay = ROOT + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=land&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:3857"
        + "&BBOX=-100,-50,100,50&WIDTH=256&HEIGHT=256";
    String photo = ROOT + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=sea&STYLES=&FORMAT=image/jpeg&TRANSPARENT=FALSE&CRS=EPSG:3857"
        + "&BBOX=-100,-50,100,50&WIDTH=256&HEIGHT=256";
    context.upstream().respond(overlay, 200, png(), image(5));
    context.upstream().respond(photo, 200, Headers.of("Content-Type", "image/jpeg; charset=binary"), image(6));

    FakeHttpExchange first = context.call("/map/overlay?" + webMercatorQuery().replace("LAYERS=land%2Csea", "LAYERS=land").replace("TRANSPARENT=FALSE", "TRANSPARENT=true"));
    FakeHttpExchange second = context.call(
        "/map/photo?" + webMercatorQuery().replace("LAYERS=land%2Csea", "LAYERS=sea").replace("image%2Fpng", "image%2Fjpeg"));
    context.runUntilIdle();

    assertThat(first.reply().status()).isEqualTo(200);
    assertThat(second.reply().status()).isEqualTo(200);
    assertThat(second.reply().headers().first("Content-Type")).isEqualTo("image/jpeg");
  }

  // ---------------------------------------------------------------- criteria 16 and 17

  private static String bboxQuery(int n) {
    return query("CRS", "EPSG:3857", "0,0," + (n + 1) + ",1", "256");
  }

  private static String bboxUpstream(int n) {
    return ROOT + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=land,sea&STYLES=&FORMAT=image/png&TRANSPARENT=FALSE&CRS=EPSG:3857&BBOX=0,0,"
        + (n + 1) + ",1&WIDTH=256&HEIGHT=256";
  }

  @Test
  void sixteenCallsRunAtOnceAndFurtherRequestsWaitInOrder() throws Exception {
    FakePluginContext context = started(standardSettings());
    int total = 20;
    List<FakeHttpExchange> calls = new ArrayList<>();
    for (int n = 0; n < total; n++) {
      context.upstream().respondAfter(Duration.ofSeconds(2), bboxUpstream(n), 200, png(), image(n));
      calls.add(context.call("/map/topo?" + bboxQuery(n)));
    }
    context.runUntilIdle();

    // the capabilities read, then exactly 16 map calls
    assertThat(mapCalls(context)).isEqualTo(16);
    assertThat(calls.get(0).isAnswered()).isFalse();

    context.advance(Duration.ofSeconds(5));

    List<String> order = calledUris(context).stream().filter(u -> u.contains("REQUEST=GetMap")).toList();
    assertThat(order).hasSize(total);
    for (int n = 0; n < total; n++) {
      assertThat(order.get(n)).isEqualTo(bboxUpstream(n));
      assertThat(calls.get(n).reply().status()).isEqualTo(200);
      assertThat(calls.get(n).reply().body()).isEqualTo(image(n));
    }
  }

  @Test
  void theTwoHundredAndFirstWaitingRequestGets503() throws Exception {
    FakePluginContext context = started(standardSettings());
    List<FakeHttpExchange> calls = new ArrayList<>();
    for (int n = 0; n < 16 + WmsService.MAX_WAITING + 1; n++) {
      context.upstream().never(bboxUpstream(n));
      calls.add(context.call("/map/topo?" + bboxQuery(n)));
    }
    context.runUntilIdle();

    assertThat(mapCalls(context)).isEqualTo(16);
    assertThat(calls.get(16 + WmsService.MAX_WAITING).reply().status()).isEqualTo(503);
    assertThat(calls.get(16 + WmsService.MAX_WAITING - 1).isAnswered()).isFalse();
    assertThat(calls.stream().filter(FakeHttpExchange::isAnswered)).hasSize(1);
  }

  @Test
  void aRequestThatWaitedThirtySecondsIsDroppedWithoutACall() throws Exception {
    var settings = WmsTestSupport.settings(
        List.of(WmsTestSupport.server("geo", ROOT, "1.3.0").replace("\"timeoutSeconds\":8", "\"timeoutSeconds\":20")),
        List.of(WmsTestSupport.background("topo", "geo", "\"land\",\"sea\"", "image/png", false)));
    FakePluginContext context = started(settings);
    for (int n = 0; n < 33; n++) {
      context.upstream().respondAfter(Duration.ofSeconds(19), bboxUpstream(n), 200, png(), image(n));
      context.call("/map/topo?" + bboxQuery(n));
    }

    context.advance(Duration.ofSeconds(60));

    // two waves of 16 ran; the 33rd waited 30 s for a slot, was dropped and never called
    assertThat(mapCalls(context)).isEqualTo(32);
    assertThat(callsTo(context, bboxUpstream(32))).isZero();
  }

  @Test
  void noHandlerWaitsForAServerThatAnswersAfterTenSeconds() throws Exception {
    var settings = WmsTestSupport.settings(
        List.of(WmsTestSupport.server("geo", ROOT, "1.3.0").replace("\"timeoutSeconds\":8", "\"timeoutSeconds\":20")),
        List.of(WmsTestSupport.background("topo", "geo", "\"land\",\"sea\"", "image/png", false)));
    FakePluginContext context = started(settings);
    context.upstream().respondAfter(Duration.ofSeconds(10), webMercatorUpstream(), 200, png(), image(1));
    FakeHttpExchange slow = context.call("/map/topo?" + webMercatorQuery());
    context.runUntilIdle();

    FakeHttpExchange other = context.call("/backgrounds");
    context.advance(Duration.ofSeconds(1));

    assertThat(slow.isAnswered()).isFalse();
    assertThat(other.reply().status()).isEqualTo(200);
    assertThat(context.effectiveStatus().state()).as("ECore marks a worker that blocks as hung and degrades the plugin").isEqualTo(PluginState.OK);
    context.advance(Duration.ofSeconds(10));
    assertThat(slow.reply().status()).isEqualTo(200);
    assertThat(context.handlerErrors()).isEmpty();
  }
}
