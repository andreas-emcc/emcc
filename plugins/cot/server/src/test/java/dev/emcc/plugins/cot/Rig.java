package dev.emcc.plugins.cot;

import dev.emcc.sdk.DataType;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.testkit.FakeConnections;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.LogEntry;
import dev.emcc.sdk.testkit.TestJson;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The plugin started the way the plugin host starts it, on the test kit's fake context, with the
 * data type its manifest declares. Its links are TCP links to {@link TcpPeer}s on loopback: the
 * fake connection tasks run for real, so the plugin's own task connects, reads and restarts.
 * Time is virtual (restarts, timers); the sockets are real.
 */
final class Rig implements AutoCloseable {

  private static final List<Rig> OPEN = new ArrayList<>();

  final FakePluginContext ctx;
  final CotPlugin plugin;
  /** The plugin's clock: it moves with {@link #advance}, together with the test kit's virtual time. */
  final TestClock clock = new TestClock(java.time.Instant.parse("2026-10-26T12:00:00Z"));
  private final Map<String, TcpPeer> peers = new LinkedHashMap<>();

  /** Starts with TCP links of these names, each to a peer of its own, and no presence event. */
  Rig(String... linkNames) {
    this(false, linkNames);
  }

  Rig(boolean sendPresence, String... linkNames) {
    this(sendPresence, builder -> {}, linkNames);
  }

  /** As {@link #Rig(boolean, String...)}, with a say in how the fake context is built (TLS credentials). */
  Rig(boolean sendPresence, java.util.function.Consumer<FakePluginContext.Builder> customise, String... linkNames) {
    this(sendPresence, customise, context -> {}, linkNames);
  }

  /** As {@link #Rig(boolean, java.util.function.Consumer, String...)}, and {@code seed} fills the store and the documents before the plugin starts. */
  Rig(boolean sendPresence, java.util.function.Consumer<FakePluginContext.Builder> customise, java.util.function.Consumer<FakePluginContext> seed,
      String... linkNames) {
    this(LinkOutput.Caps.DEFAULT, null, sendPresence, customise, seed, linkNames);
  }

  /** A rig with no links, and the bounds of the channel memory a test wants. */
  static Rig withCaps(LinkOutput.Caps caps) {
    return new Rig(caps, null, false, builder -> {}, context -> {});
  }

  /** A rig with no links whose TCP links open their sockets with {@code opener}, and send the presence event if {@code sendPresence}. */
  static Rig withOpener(boolean sendPresence, TcpLinkTask.Opener opener) {
    return new Rig(LinkOutput.Caps.DEFAULT, opener, sendPresence, builder -> {}, context -> {});
  }

  private Rig(LinkOutput.Caps caps, TcpLinkTask.Opener opener, boolean sendPresence, java.util.function.Consumer<FakePluginContext.Builder> customise,
      java.util.function.Consumer<FakePluginContext> seed, String... linkNames) {
    var links = new String[linkNames.length];
    for (int i = 0; i < linkNames.length; i++) {
      TcpPeer peer = new TcpPeer();
      peers.put(linkNames[i], peer);
      links[i] = tcp(linkNames[i], peer.port());
    }
    var builder = FakePluginContext.builder(Manifest.id())
        .settings(settings(sendPresence, links))
        .dataTypes(Manifest.dataType())
        .declaredFields(Manifest.declaredFields().toArray(dev.emcc.sdk.DeclaredField[]::new))
        .fieldSets(Manifest.fieldSets().toArray(dev.emcc.sdk.FieldSet[]::new));
    customise.accept(builder);
    ctx = builder.build();
    seed.accept(ctx);
    plugin = new CotPlugin(clock, caps, opener);
    plugin.init(ctx);
    plugin.start();
    OPEN.add(this);
    ctx.runUntilIdle();
    for (String name : linkNames) {
      awaitUp(name);
    }
  }

  /** Closes every rig of the test: its tasks and its peers. */
  static void closeAll() {
    for (Rig rig : List.copyOf(OPEN)) {
      rig.close();
    }
    OPEN.clear();
  }

  @Override
  public void close() {
    try {
      plugin.stop();
    } finally {
      ctx.connections().stopAll();
      peers.values().forEach(TcpPeer::close);
    }
  }

  // ---------------------------------------------------------------- settings

  /** A TCP link to a peer on loopback. */
  static String tcp(String name, int port) {
    return tcp(name, port, "in");
  }

  static String tcp(String name, int port, String direction) {
    return "{\"name\":\"" + name + "\",\"direction\":\"" + direction + "\",\"transport\":\"tcp\",\"host\":\"127.0.0.1\",\"port\":" + port + "}";
  }

  /**
   * Adds a TCP link (an {@code in} link, or an {@code out} or {@code both} link that sends these layers) to no peer at all, for a rig
   * whose sockets come from an {@link TcpLinkTask.Opener}, and waits until the plugin says it is connected.
   */
  void addLinkWithoutPeer(String name, String direction, java.util.List<Layer> layers) {
    String link = tcp(name, 9, direction);
    if (!direction.equals("in")) {
      var sources = new StringBuilder("\"sourceLayers\":[");
      for (int i = 0; i < layers.size(); i++) {
        sources.append(i > 0 ? "," : "").append("{\"id\":\"").append(layers.get(i).id()).append("\",\"name\":\"").append(layers.get(i).content().name()).append("\"}");
      }
      link = link.substring(0, link.length() - 1) + "," + sources.append(']') + "}";
    }
    JsonValue[] current = ((JsonArray) ctx.settings().get("links")).values().toArray(new JsonValue[0]);
    var all = new JsonValue[current.length + 1];
    System.arraycopy(current, 0, all, 0, current.length);
    all[current.length] = TestJson.parse(link);
    ctx.changeSettings(ctx.settings().with("links", JsonArray.of(all)));
    ctx.runUntilIdle();
    TcpPeer.waitUntil(() -> {
      ctx.runUntilIdle();
      return part(name).startsWith(name + ": connected since");
    }, "link " + name + " to be connected (status: " + status() + ")");
  }

  /** The manifest's defaults with these links and the presence switch. */
  static JsonObject settings(boolean sendPresence, String... links) {
    var list = new JsonValue[links.length];
    for (int i = 0; i < links.length; i++) {
      list[i] = TestJson.parse(links[i]);
    }
    return Manifest.settingDefaults().with("links", JsonArray.of(list)).with("sendPresence", TestJson.parse(Boolean.toString(sendPresence)));
  }

  /** The same settings as now but with a changed list of links. */
  JsonObject withLinks(String... links) {
    var list = new JsonValue[links.length];
    for (int i = 0; i < links.length; i++) {
      list[i] = TestJson.parse(links[i]);
    }
    return ctx.settings().with("links", JsonArray.of(list));
  }

  /**
   * Adds a TCP link to a new peer, with more members of the link given as JSON text (e.g. {@code "targetLayer":{"name":"Tracks"}}),
   * applies the settings and waits until the link is up.
   */
  TcpPeer addLink(String name, String extraMembers) {
    return addLink(name, addPeer(name), "tcp", extraMembers);
  }

  /** As {@link #addLink(String, String)}, to a peer that exists already, with a transport ({@code tcp} or {@code tls}). */
  TcpPeer addLink(String name, TcpPeer peer, String transport, String extraMembers) {
    peers.put(name, peer);
    String link = tcp(name, peer.port()).replace("\"transport\":\"tcp\"", "\"transport\":\"" + transport + "\"");
    if (!extraMembers.isEmpty()) {
      link = link.substring(0, link.length() - 1) + "," + extraMembers + "}";
    }
    JsonValue[] current = ((JsonArray) ctx.settings().get("links")).values().toArray(new JsonValue[0]);
    var all = new JsonValue[current.length + 1];
    System.arraycopy(current, 0, all, 0, current.length);
    all[current.length] = TestJson.parse(link);
    ctx.changeSettings(ctx.settings().with("links", JsonArray.of(all)));
    ctx.runUntilIdle();
    awaitUp(name);
    return peer;
  }

  /**
   * Adds an {@code out} or {@code both} TCP link that sends the objects of these layers, with more members of the link as JSON text,
   * applies the settings and waits until the link is up.
   */
  TcpPeer addOutLink(String name, String direction, java.util.List<dev.emcc.sdk.model.Layer> layers, String extraMembers) {
    var sources = new StringBuilder("\"sourceLayers\":[");
    for (int i = 0; i < layers.size(); i++) {
      sources.append(i > 0 ? "," : "").append("{\"id\":\"").append(layers.get(i).id()).append("\",\"name\":\"").append(layers.get(i).content().name()).append("\"}");
    }
    sources.append(']');
    TcpPeer peer = addPeer(name);
    String link = tcp(name, peer.port(), direction);
    link = link.substring(0, link.length() - 1) + "," + sources + (extraMembers.isEmpty() ? "" : "," + extraMembers) + "}";
    JsonValue[] current = ((JsonArray) ctx.settings().get("links")).values().toArray(new JsonValue[0]);
    var all = new JsonValue[current.length + 1];
    System.arraycopy(current, 0, all, 0, current.length);
    all[current.length] = TestJson.parse(link);
    ctx.changeSettings(ctx.settings().with("links", JsonArray.of(all)));
    ctx.runUntilIdle();
    peer.conn();
    TcpPeer.waitUntil(() -> {
      ctx.runUntilIdle();
      return part(name).startsWith(name + ": connected since");
    }, "link " + name + " to be up (status: " + status() + ")");
    ctx.runUntilIdle();
    return peer;
  }

  /** The events a link's peer has received so far (the presence event excluded), in order. */
  java.util.List<dev.emcc.plugins.cot.codec.CotEvent> sent(String link) {
    return events(peer(link).conn().received());
  }

  static java.util.List<dev.emcc.plugins.cot.codec.CotEvent> events(String text) {
    var xml = new dev.emcc.plugins.cot.codec.CotXml();
    var list = new java.util.ArrayList<dev.emcc.plugins.cot.codec.CotEvent>();
    java.util.regex.Matcher m = java.util.regex.Pattern.compile("<event .*?</event>", java.util.regex.Pattern.DOTALL).matcher(text);
    while (m.find()) {
      try {
        var event = xml.parse(m.group());
        if (!event.type().equals("t-x-c-t")) {
          list.add(event);
        }
      } catch (dev.emcc.plugins.cot.codec.CotParseException e) {
        throw new AssertionError("the plugin wrote a bad event: " + e.getMessage() + ": " + m.group(), e);
      }
    }
    return list;
  }

  /** Waits until the link's peer has received at least {@code count} events, and returns them all. */
  java.util.List<dev.emcc.plugins.cot.codec.CotEvent> awaitSent(String link, int count) {
    try {
      TcpPeer.waitUntil(() -> {
        ctx.runUntilIdle();
        return sent(link).size() >= count;
      }, count + " events at the peer of " + link);
    } catch (AssertionError e) {
      // the state at the timeout: the text of the wait itself is made before it starts
      var seen = sent(link);
      throw new AssertionError(e.getMessage() + " (got " + seen.size() + ": " + describe(seen) + "; status: " + status() + ")", e);
    }
    return sent(link);
  }

  /**
   * Waits until the link's peer has received an event of the callsign, and returns all the events it has by then. The events of one
   * link come over one stream in the order the task wrote them, so what was posted before the one waited for is in the list.
   */
  java.util.List<dev.emcc.plugins.cot.codec.CotEvent> awaitSentUpTo(String link, String callsign) {
    try {
      TcpPeer.waitUntil(() -> {
        ctx.runUntilIdle();
        return sent(link).stream().anyMatch(e -> callsign.equals(e.callsign()));
      }, "an event of " + callsign + " at the peer of " + link);
    } catch (AssertionError e) {
      var seen = sent(link);
      throw new AssertionError(e.getMessage() + " (got " + seen.size() + ": " + describe(seen) + "; status: " + status() + ")", e);
    }
    var all = sent(link);
    int last = 0;
    for (int i = 0; i < all.size(); i++) {
      if (callsign.equals(all.get(i).callsign())) {
        last = i;
      }
    }
    return all.subList(0, last + 1);
  }

  /** The events in a line each: the callsign and whether the event is stale at once, for a failure message. */
  private static String describe(java.util.List<dev.emcc.plugins.cot.codec.CotEvent> events) {
    return events.stream().map(e -> e.callsign() + (e.stale().equals(e.time()) ? " (stale)" : " (live)")).collect(java.util.stream.Collectors.joining(", "));
  }

  /** The TCP link of a peer this rig made. */
  String link(String name) {
    return tcp(name, peer(name).port());
  }

  /** Makes a peer for a link that is added later. */
  TcpPeer addPeer(String name) {
    TcpPeer peer = new TcpPeer();
    peers.put(name, peer);
    return peer;
  }

  TcpPeer peer(String link) {
    TcpPeer peer = peers.get(link);
    if (peer == null) {
      throw new AssertionError("no peer for link " + link);
    }
    return peer;
  }

  /** The current connection of a link's peer (see {@link TcpPeer#liveConn()}). */
  TcpPeer.Conn conn(String link) {
    return peer(link).liveConn();
  }

  /** The events a link has read: its task's count, and its reader's when the link also sends. */
  long eventsIn(String link) {
    long total = ctx.connectionTask(link).counter("events in");
    try {
      total += ctx.connectionTask(link + "/reader").counter("events in");
    } catch (IllegalArgumentException e) {
      // a link that only receives has no reader
    }
    return total;
  }

  FakeConnections.FakeTask<?> task(String link) {
    return ctx.connectionTask(link);
  }

  // ---------------------------------------------------------------- driving

  /** Waits until the link's peer has a connection and the worker knows the link is up. */
  void awaitUp(String link) {
    peer(link).liveConn();
    TcpPeer.waitUntil(() -> {
      ctx.runUntilIdle();
      return part(link).startsWith(link + ": connected since") && part(link).contains("127.0.0.1:" + peer(link).port() + "]");
    }, "link " + link + " to be up");
  }

  /** Sends text from the link's peer and lets everything run until the plugin has read as many events as the text holds. */
  void feed(String link, String text) {
    feed(link, text, occurrences(text, "<event"));
  }

  /** As {@link #feed(String, String)}, for text the framer cuts into {@code documents} documents. */
  void feed(String link, String text, int documents) {
    long target = eventsIn(link) + documents;
    conn(link).send(text);
    settle(link, target);
  }

  /**
   * As {@link #feed(String, String, int)}, but the worker sees nothing until the plugin has read all of it: the whole burst is in its
   * mailbox at once, as a fast peer would put it there.
   */
  void feedAtOnce(String link, String text, int documents) {
    long target = eventsIn(link) + documents;
    conn(link).send(text);
    TcpPeer.waitUntil(() -> eventsIn(link) >= target, "the plugin to read " + target + " events on " + link);
    ctx.runUntilIdle();
  }

  /** Sends {@code text} on a link and waits until the plugin has read {@code documents} more events on it, but does not let the worker run. */
  void sendAndHold(String link, String text, int documents) {
    long target = eventsIn(link) + documents;
    conn(link).send(text);
    TcpPeer.waitUntil(() -> eventsIn(link) >= target, "the plugin to read " + target + " events on " + link);
  }

  /** Lets the plugin read until the link's counter of events read is {@code target}, then lets the worker finish. */
  void settle(String link, long target) {
    TcpPeer.waitUntil(() -> {
      ctx.runUntilIdle();
      return eventsIn(link) >= target;
    }, "the plugin to read " + target + " events on " + link + " (read " + eventsIn(link) + ")");
    ctx.runUntilIdle();
  }

  private static int occurrences(String text, String what) {
    int count = 0;
    for (int at = text.indexOf(what); at >= 0; at = text.indexOf(what, at + what.length())) {
      count++;
    }
    return count;
  }

  /** An atom observed {@code seconds} from the rig's now, stale five minutes later: an event from TAK that is not already expired. */
  String freshAtom(String uid, int seconds, double lat, double lon) {
    java.time.Instant at = clock.instant().plusSeconds(seconds);
    var format = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(java.time.ZoneOffset.UTC);
    return dev.emcc.plugins.cot.codec.Samples.atom(uid, "a-f-G-U-C-I", lat, lon, format.format(at), format.format(at.plusSeconds(300)));
  }

  void advance(Duration duration) {
    // second by second, so that the timer ticks and the clock go together
    long seconds = duration.toSeconds();
    Duration rest = duration.minusSeconds(seconds);
    for (long i = 0; i < seconds; i++) {
      clock.advance(Duration.ofSeconds(1));
      ctx.advance(Duration.ofSeconds(1));
    }
    if (!rest.isZero()) {
      clock.advance(rest);
      ctx.advance(rest);
    }
    ctx.runUntilIdle();
  }

  // ---------------------------------------------------------------- looking

  List<MapObject> objects() {
    return ctx.store().objects();
  }

  /** The one object whose external identity is {@code uid}, or fails. */
  MapObject object(String uid) {
    return objects().stream()
        .filter(o -> o.meta().externalRef() != null && o.meta().externalRef().id().equals(uid))
        .reduce((a, b) -> {
          throw new AssertionError("two objects for uid " + uid);
        })
        .orElseThrow(() -> new AssertionError("no object for uid " + uid));
  }

  Layer layerOf(MapObject object) {
    UUID id = object.content().layerId();
    return ctx.store().layers().stream().filter(l -> l.id().equals(id)).findFirst().orElseThrow();
  }

  long requests(Operation operation) {
    return ctx.store().requests().stream().filter(r -> r.operation() == operation).count();
  }

  List<LogEntry> warnings() {
    return ctx.logEntries().stream().filter(e -> e.level() == LogEntry.Level.WARN).toList();
  }

  /** How many events the link's part of the status says it has sent, or 0 (the status is refreshed at each tick). */
  long sentCount(String link) {
    String part = part(link);
    int at = part.indexOf(" sent");
    if (at < 0) {
      return 0;
    }
    String number = part.substring(part.lastIndexOf(' ', at - 1) + 1, at);
    return !number.isEmpty() && number.chars().allMatch(Character::isDigit) ? Long.parseLong(number) : 0;
  }

  /**
   * Waits until the newest connection of {@code peer} has had {@code count} events, advancing a tick (a second, which posts 5 000 more
   * events) only once the peer has what the earlier ticks posted. A tick posts at most 5 000 events to the link's inbox, which holds
   * 20 000 and drops the oldest; a real tick is a second apart, far more than the task needs to write them, but virtual ticks are not,
   * so a busy machine could make them outrun the task.
   *
   * <p>The test kit still runs a connection task on a virtual thread, and on Windows its writer can then miss a wake-up while its reader
   * waits (JDK-8334574; CR-0027 moves the task to a platform thread). If nothing arrives for 3 seconds of real time, virtual time goes on
   * by 65 seconds, as it would in real life, and the plugin's write-stall check closes that connection and makes another, and the newest one then has
   * every event. Without the bug none of this is needed.
   */
  void awaitEvents(TcpPeer peer, int count, int seconds) {
    int[] ticks = {0};
    int[] last = {-1};
    TcpPeer.Conn[] current = {null};
    long[] progressAt = {System.nanoTime()};
    try {
      TcpPeer.waitUntil(() -> {
        ctx.runUntilIdle();
        TcpPeer.Conn newest = peer.conn();
        int now = newest.eventCount();
        if (newest != current[0]) {
          current[0] = newest;
          ticks[0] = 0; // a new connection starts again with the first 5 000
          last[0] = -1;
        }
        if (now != last[0]) {
          last[0] = now;
          progressAt[0] = System.nanoTime();
        }
        if (now >= Math.min(count, 5_000 * ticks[0])) {
          advance(Duration.ofSeconds(1));
          ticks[0]++;
        } else if (System.nanoTime() - progressAt[0] > 3_000_000_000L) {
          advance(Duration.ofSeconds(65)); // the write-stall limit (60 seconds) and a little more
          progressAt[0] = System.nanoTime();
        }
        return now >= count;
      }, "all " + count + " events on the newest connection", seconds);
    } catch (AssertionError e) {
      throw new AssertionError(e.getMessage() + " (got " + last[0] + " after " + ticks[0] + " ticks; connections " + peer.accepted() + "; status: " + status() + ")", e);
    }
  }

  /** One link's part of the status detail (the parts are separated by "; "), or an empty text. */
  String part(String link) {
    for (String part : status().split("; ")) {
      if (part.startsWith(link + ": ")) {
        return part;
      }
    }
    return "";
  }

  String status() {
    return ctx.effectiveStatus().detail();
  }
}
