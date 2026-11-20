package dev.emcc.plugins.terrain;

import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.WorkerContext;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Range and bearing between two points (ADR-0049 point 2): the geodesic distance on WGS84, the
 * initial bearing at the first point, the final bearing at the second and the back bearing (the
 * final one plus 180 degrees, normalised), all from true north, by the SDK's geodesy. It needs no
 * height data, so it works while the folder is not set.
 */
final class RangeWorker implements Handler<RangeMsg> {

  @Override
  public void handle(RangeMsg message, WorkerContext<RangeMsg> context) {
    switch (message) {
      case RangeMsg.Range range -> answer(range.request());
    }
  }

  private static void answer(EndpointRequest request) {
    double[] from;
    double[] to;
    try {
      JsonObject body = Bodies.object(request);
      from = Bodies.position(body, "from");
      to = Bodies.position(body, "to");
    } catch (BadRequest e) {
      request.response().respond(Bodies.error(400, e.getMessage()));
      return;
    }
    GeodesicLeg leg = Geodesy.inverse(Position.of(from[0], from[1]), Position.of(to[0], to[1]));
    Map<String, JsonValue> members = new LinkedHashMap<>();
    members.put("distance", JsonNumber.of(leg.distanceMetres()));
    members.put("initialBearing", JsonNumber.of(leg.initialAzimuth()));
    members.put("finalBearing", JsonNumber.of(leg.finalAzimuth()));
    members.put("backBearing", JsonNumber.of(backBearing(leg.finalAzimuth())));
    // half way along the geodesic, where the browser puts the label (the web SDK has no geodesy)
    Position middle = Geodesy.direct(Position.of(from[0], from[1]), leg.initialAzimuth(), leg.distanceMetres() / 2);
    members.put("midpoint", Areas.position(middle.longitude(), middle.latitude()));
    request.response().respond(HttpReply.json(200, JsonObject.of(members)));
  }

  /** The final bearing plus 180 degrees, normalised to 0 up to below 360. */
  static double backBearing(double finalBearing) {
    double back = (finalBearing + 180) % 360;
    if (back < 0) {
      back += 360;
    }
    return back >= 360 ? 0 : back + 0.0;
  }
}
