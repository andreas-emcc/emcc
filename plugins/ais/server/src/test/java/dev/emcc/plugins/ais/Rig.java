package dev.emcc.plugins.ais;

import dev.emcc.plugins.ais.codec.Ais;
import dev.emcc.plugins.ais.codec.AisDecoder;
import dev.emcc.plugins.ais.codec.AisMessage;
import dev.emcc.plugins.ais.transport.TransportMsg;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

/**
 * A plugin on the test kit's fake context, with links that are switched off (so that no socket is
 * opened) and messages put straight into its worker, as the connection tasks do.
 */
final class Rig {

  final FakePluginContext ctx;
  final AisPlugin plugin;

  Rig(String... links) {
    this(context -> {}, links);
  }

  /** {@code seed} fills the store and the documents before the plugin starts: a server run that already has content. */
  Rig(java.util.function.Consumer<FakePluginContext> seed, String... links) {
    ctx = FakePluginContext.builder("ais").settings(settings(links))
        .dataTypes(Manifest.dataTypes())
        .declaredFields(Manifest.declaredFields()).fieldSets(Manifest.fieldSets()).build();
    seed.accept(ctx);
    plugin = new AisPlugin(new Clock() {
      @Override
      public ZoneOffset getZone() {
        return ZoneOffset.UTC;
      }

      @Override
      public Clock withZone(java.time.ZoneId zone) {
        return this;
      }

      @Override
      public Instant instant() {
        return ctx.clock();
      }
    });
    plugin.init(ctx);
    plugin.start();
    ctx.runUntilIdle();
  }

  /** A link entry that is switched off; {@code extra} is more members, e.g. {@code "label":{...}}. */
  static String link(String name, String extra) {
    return "{\"name\":\"" + name + "\",\"mode\":\"tcp-client\",\"host\":\"127.0.0.1\",\"port\":9,\"enabled\":false" + (extra.isEmpty() ? "" : "," + extra) + "}";
  }

  static JsonObject settings(String... links) {
    return (JsonObject) TestJson.parse("{\"links\":[" + String.join(",", links) + "]}");
  }

  void useLinks(String... links) {
    ctx.changeSettings(settings(links));
    ctx.runUntilIdle();
  }

  @SuppressWarnings("unchecked")
  private WorkerRef<TransportMsg> worker() {
    return (WorkerRef<TransportMsg>) ctx.worker("links");
  }

  /** The worker receives a decoded message from the link, as its task would send it. */
  void receive(String link, Ais.Msg message) {
    send(link, message);
    ctx.runUntilIdle();
  }

  void send(String link, Ais.Msg message) {
    AisMessage decoded = AisDecoder.decode(message.payload(), message.fill()).message();
    if (decoded instanceof AisMessage.Position p) {
      worker().send(new TransportMsg.ReceivedPosition(link, UUID.randomUUID(), p));
    } else {
      worker().send(new TransportMsg.ReceivedStatic(link, UUID.randomUUID(), (AisMessage.StaticReport) decoded));
    }
  }

  void advance(Duration d) {
    ctx.advance(d);
    ctx.runUntilIdle();
  }

  List<MapObject> ships() {
    return ctx.store().objects();
  }

  MapObject ship(int mmsi) {
    return ctx.store().objects().stream()
        .filter(o -> o.meta().externalRef() != null && o.meta().externalRef().id().equals(ShipMapper.mmsiText(mmsi)))
        .findFirst().orElseThrow(() -> new AssertionError("no ship " + mmsi));
  }

  static dev.emcc.sdk.model.Position at(MapObject ship) {
    return ((Geometry.Point) ship.content().geometry()).coordinates();
  }

  long requests(Operation operation) {
    return ctx.store().requests().stream().filter(r -> r.operation() == operation).count();
  }

  long requests(Operation operation, dev.emcc.sdk.model.EntityType type) {
    return ctx.store().requests().stream().filter(r -> r.operation() == operation && r.entityType() == type).count();
  }
}
