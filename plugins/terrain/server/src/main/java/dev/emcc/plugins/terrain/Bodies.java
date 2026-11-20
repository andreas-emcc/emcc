package dev.emcc.plugins.terrain;

import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.util.Map;

/** Reading a request's body and writing the answers, with the checks the brief asks of every value (400 with the reason). */
final class Bodies {

  private Bodies() {}

  static JsonObject object(EndpointRequest request) {
    if (request.body() instanceof JsonObject body) {
      return body;
    }
    throw new BadRequest("the body is a JSON object");
  }

  /**
   * A position {@code [longitude, latitude]}: two finite numbers, longitude -180 to 180 and
   * latitude -90 to 90, in that order (ADR-0007).
   */
  static double[] position(JsonObject body, String name) {
    JsonValue value = body.get(name);
    if (!(value instanceof JsonArray array) || array.size() != 2 || !(array.get(0) instanceof JsonNumber lonNumber) || !(array.get(1) instanceof JsonNumber latNumber)) {
      throw new BadRequest("\"" + name + "\" is a position [longitude, latitude].");
    }
    double lon = lonNumber.doubleValue();
    double lat = latNumber.doubleValue();
    if (!(lon >= -180 && lon <= 180)) {
      throw new BadRequest("\"" + name + "\": the longitude is -180 to 180 (the order is longitude, latitude): " + lonNumber.text());
    }
    if (!(lat >= -90 && lat <= 90)) {
      throw new BadRequest("\"" + name + "\": the latitude is -90 to 90 (the order is longitude, latitude): " + latNumber.text());
    }
    return new double[] {lon, lat};
  }

  /** A finite number within {@code min} to {@code max}. */
  static double number(JsonObject body, String name, double min, double max, String unit) {
    JsonValue value = body.get(name);
    if (!(value instanceof JsonNumber number)) {
      throw new BadRequest("\"" + name + "\" is a number.");
    }
    double v = number.doubleValue();
    if (!(v >= min && v <= max)) {
      throw new BadRequest("\"" + name + "\" is " + plain(min) + " to " + plain(max) + " " + unit + ": " + number.text());
    }
    return v;
  }

  static HttpReply error(int status, String message) {
    return HttpReply.json(status, JsonObject.of(Map.of("error", JsonString.of(message))));
  }

  static String plain(double v) {
    return v == Math.rint(v) ? Long.toString((long) v) : Double.toString(v);
  }
}
