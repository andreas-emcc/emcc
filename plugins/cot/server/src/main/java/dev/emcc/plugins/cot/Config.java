package dev.emcc.plugins.cot;

import dev.emcc.sdk.ClassificationLimit;
import dev.emcc.sdk.LayerChoice;
import dev.emcc.sdk.connection.ListenAddress;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.SecurityLabel;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * The plugin's settings, read from the JSON ECore delivers (already checked against the manifest's
 * schema, and checked again here: a bad value is reported, not trusted). A link is a list entry
 * with named fields. Hosts, ports, addresses, groups and interfaces come from here and nowhere
 * else (ADR-0030, ADR-0036 point 3).
 *
 * @param links the valid links, in the order of the settings; one with a {@link LinkConfig#problem}
 *     is kept so that its status can say why it does not run
 * @param globals what all links share
 * @param problems what was wrong with entries that were left out, in English
 * @param storedStreams the names of {@code streams} entries of earlier versions, which are no
 *     longer read (the owner, 2026-10-26: no migration)
 * @param writeStall how long one write (one event, or the presence event) to the peer of an {@code out} or {@code both} TCP link may take before the link is
 *     closed and connected again (the owner, 2026-10-28, Z1). Only the worker reads it, so a change does not reconnect the links.
 */
record Config(List<LinkConfig> links, Globals globals, List<String> problems, List<String> storedStreams, Duration writeStall) {

  static final Duration DEFAULT_WRITE_STALL = Duration.ofSeconds(60);

  static final Config EMPTY = new Config(List.of(), new Globals(Duration.ofMinutes(5), 65_536, true, "emcc"), List.of(), List.of(), DEFAULT_WRITE_STALL);

  static final int DEFAULT_STALE_SECONDS = 60;
  static final int DEFAULT_REFRESH_SECONDS = 30;

  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  /** How a link reaches its peer (brief function 12). */
  enum Transport {
    TCP, TLS, UDP, MULTICAST;

    boolean isTcp() {
      return this == TCP || this == TLS;
    }

    String json() {
      return name().toLowerCase(java.util.Locale.ROOT);
    }
  }

  /** What a link does: receives CoT, sends it, or both over one connection. */
  enum Direction {
    IN, OUT, BOTH;

    boolean receives() {
      return this != OUT;
    }

    boolean sends() {
      return this != IN;
    }

    String json() {
      return name().toLowerCase(java.util.Locale.ROOT);
    }
  }

  /**
   * One link: a connection to one TAK system or one place on the local network.
   *
   * @param name the data source of what it receives, the key of its TLS credentials, and its task's name
   * @param host the peer of a TCP or TLS link; {@code null} otherwise
   * @param port the peer's port (TCP, TLS), or the port received on (UDP, multicast)
   * @param listen where a UDP or multicast link receives; {@code null} for TCP and TLS, and for a link with a {@code problem}
   * @param target the picked target layer, or {@code null}: a new layer named like the link
   * @param label the label of its layer and objects, or {@code null} for the server's default
   * @param problem why the link cannot run, or {@code null}; it stays in the status and is not started
   * @param where the peer, or the address it listens on, as the status shows it
   * @param sourceLayers the existing layers whose objects an {@code out} or {@code both} link sends (brief function 14)
   * @param limit the setting {@code highestClassification}, or {@code null}: the server's default label's classification (function 20)
   * @param staleSeconds the stale time of what is sent when neither the object nor its expiry gives one (function 18)
   * @param refreshSeconds how long an unchanged object waits before it is sent again; 0: only changes go out (function 18)
   * @param tlsCredential the name of the TLS credential a {@code tls} link uses: the picked one, else the link's name (function 33); {@code null}
   *     for the other transports, which ignore the setting
   */
  record LinkConfig(
      String name,
      Direction direction,
      Transport transport,
      @Nullable String host,
      int port,
      @Nullable ListenAddress listen,
      @Nullable LayerChoice target,
      @Nullable SecurityLabel label,
      boolean enabled,
      @Nullable String problem,
      String where,
      List<LayerChoice> sourceLayers,
      @Nullable JsonValue limit,
      int staleSeconds,
      int refreshSeconds,
      @Nullable String tlsCredential) {

    /** Whether the same connection serves {@code other}: a change in the rest needs no reconnect. */
    boolean sameConnection(LinkConfig other) {
      return direction == other.direction && transport == other.transport && Objects.equals(host, other.host) && port == other.port
          && Objects.equals(listen, other.listen) && Objects.equals(problem, other.problem) && Objects.equals(tlsCredential, other.tlsCredential);
    }

    /** The name of the layer this link makes when its target is absent, has no id, or is gone: the name the form saved, else the link's. */
    String newLayerName() {
      return target != null ? target.name() : name;
    }
  }

  /** The settings that apply to every link. */
  record Globals(Duration idle, int maxEventBytes, boolean sendPresence, String presenceCallsign) {}

  static Config parse(JsonObject settings) {
    var problems = new ArrayList<String>();
    var links = new ArrayList<LinkConfig>();
    var names = new HashSet<String>();
    if (settings.get("links") instanceof JsonArray list) {
      for (int i = 0; i < list.size(); i++) {
        if (list.get(i) instanceof JsonObject entry) {
          LinkConfig link = link(entry, i, names, problems);
          if (link != null) {
            links.add(link);
          }
        } else {
          problems.add("link " + (i + 1) + " is not an object");
        }
      }
    } else if (settings.get("links") != null) {
      problems.add("links is not a list");
    }
    Globals globals = globals(settings, problems);
    Duration writeStall = writeStall(settings, problems);
    return new Config(List.copyOf(links), globals, List.copyOf(problems), storedStreams(settings), writeStall);
  }

  private static Duration writeStall(JsonObject settings, List<String> problems) {
    int seconds = integer(settings.get("writeStallSeconds"), (int) DEFAULT_WRITE_STALL.toSeconds());
    if (seconds < 5 || seconds > 3600) {
      problems.add("writeStallSeconds must be 5 to 3600; using " + DEFAULT_WRITE_STALL.toSeconds());
      return DEFAULT_WRITE_STALL;
    }
    return Duration.ofSeconds(seconds);
  }

  /** The names of the entries of the old {@code streams} setting, which is no longer read. */
  private static List<String> storedStreams(JsonObject settings) {
    if (!(settings.get("streams") instanceof JsonArray list) || list.size() == 0) {
      return List.of();
    }
    var names = new ArrayList<String>();
    for (int i = 0; i < list.size(); i++) {
      names.add(list.get(i) instanceof JsonObject o && o.get("name") instanceof JsonString n && n.value().length() <= 64 ? cleaned(n.value()) : "?");
    }
    return List.copyOf(names);
  }

  /** A name from a stored setting, shown in the status: no control characters. */
  private static String cleaned(String text) {
    return Text.clean(text);
  }

  private static @Nullable LinkConfig link(JsonObject entry, int index, Set<String> names, List<String> problems) {
    String who = entry.get("name") instanceof JsonString n ? "link '" + cleaned(n.value()) + "'" : "link " + (index + 1);
    if (!(entry.get("name") instanceof JsonString name) || !NAME.matcher(name.value()).matches() || name.value().length() > 64) {
      problems.add(who + ": the name must be lowercase words separated by hyphens, at most 64 characters");
      return null;
    }
    if (name.value().equals("manual")) {
      problems.add(who + ": 'manual' is reserved for drawn objects");
      return null;
    }
    if (!names.add(name.value())) {
      problems.add(who + ": the name is used twice");
      return null;
    }
    Direction direction = Direction.IN;
    if (entry.get("direction") instanceof JsonString d) {
      direction = switch (d.value()) {
        case "in" -> Direction.IN;
        case "out" -> Direction.OUT;
        case "both" -> Direction.BOTH;
        default -> null;
      };
      if (direction == null) {
        problems.add(who + ": the direction must be in, out or both");
        return null;
      }
    }
    Transport transport = Transport.TCP;
    if (entry.get("transport") instanceof JsonString t) {
      transport = switch (t.value()) {
        case "tcp" -> Transport.TCP;
        case "tls" -> Transport.TLS;
        case "udp" -> Transport.UDP;
        case "multicast" -> Transport.MULTICAST;
        default -> null;
      };
      if (transport == null) {
        problems.add(who + ": the transport must be tcp, tls, udp or multicast");
        return null;
      }
    }
    SecurityLabel securityLabel = null;
    if (entry.get("label") instanceof JsonObject l) {
      if (l.get("policy") instanceof JsonString policy && l.get("classification") instanceof JsonString classification
          && !policy.value().isEmpty() && !classification.value().isEmpty() && classification.value().length() <= 64) {
        securityLabel = SecurityLabel.of(policy.value(), classification.value());
      } else {
        problems.add(who + ": the label needs a policy and a classification");
        return null;
      }
    }
    LayerChoice target = null;
    try {
      target = LayerChoice.from(entry.get("targetLayer"));
    } catch (IllegalArgumentException e) {
      problems.add(who + ": targetLayer: " + e.getMessage());
      return null;
    }
    boolean enabled = !(entry.get("enabled") instanceof JsonBoolean b) || b.value();

    List<LayerChoice> sourceLayers;
    try {
      sourceLayers = LayerChoice.list(entry.get("sourceLayers"));
    } catch (IllegalArgumentException e) {
      problems.add(who + ": sourceLayers: " + e.getMessage());
      return null;
    }
    if (!direction.sends()) {
      sourceLayers = List.of(); // greyed in the form, and kept there from an earlier "both": valid, and ignored (brief, "M4: greyed link fields")
    }
    JsonValue limit = entry.get("highestClassification");
    try {
      ClassificationLimit.from(limit, SecurityLabel.of("NATO", "UNCLASSIFIED")); // only its shape
    } catch (IllegalArgumentException e) {
      problems.add(who + ": highestClassification: " + e.getMessage());
      return null;
    }
    int stale = integer(entry.get("staleSeconds"), DEFAULT_STALE_SECONDS);
    if (stale < 1 || stale > 86_400) {
      problems.add(who + ": staleSeconds must be 1 to 86400; using " + DEFAULT_STALE_SECONDS);
      stale = DEFAULT_STALE_SECONDS;
    }
    int refresh = integer(entry.get("refreshSeconds"), DEFAULT_REFRESH_SECONDS);
    if (refresh < 0 || refresh > 86_400) {
      problems.add(who + ": refreshSeconds must be 0 to 86400; using " + DEFAULT_REFRESH_SECONDS);
      refresh = DEFAULT_REFRESH_SECONDS;
    }

    String host = null;
    int port = integer(entry.get("port"), -1);
    ListenAddress listen = null;
    String problem = null;
    boolean needsPeer = transport.isTcp() || (transport == Transport.UDP && direction.sends());
    boolean needsListen = !transport.isTcp() && (transport == Transport.MULTICAST || direction.receives());
    if (needsPeer) {
      if (!(entry.get("host") instanceof JsonString h) || h.value().isBlank() || h.value().length() > 253) {
        problem = "the host is missing";
      } else {
        host = h.value().trim();
      }
      if (port < 1 || port > 65_535) {
        problem = problem == null ? "the port must be 1 to 65535" : problem + " and the port must be 1 to 65535";
      }
    }
    if (needsListen) {
      try {
        listen = transport == Transport.MULTICAST ? ListenAddress.multicast(entry) : ListenAddress.from(entry);
        port = listen.port();
      } catch (IllegalArgumentException e) {
        problem = problem == null ? e.getMessage() : problem + "; " + e.getMessage();
      }
    }
    if (problem == null && !sourceLayers.isEmpty() && sourceLayers.stream().anyMatch(l -> l.id() == null)) {
      problem = "a source layer must be an existing layer: pick one from the list";
    }
    if (problem != null) {
      problems.add(who + ": " + problem);
    }
    return new LinkConfig(name.value(), direction, transport, host, Math.max(port, 0), listen, target, securityLabel, enabled, problem,
        where(transport, direction, host, port, listen, entry), sourceLayers, limit, stale, refresh,
        transport == Transport.TLS ? tlsCredential(entry, name.value()) : null);
  }

  /** The TLS credential a link picked (function 33), else the link's name, as before M9. ECore says whether the name exists; a missing one fails the task's start. */
  private static String tlsCredential(JsonObject entry, String linkName) {
    return entry.get("tlsCredential") instanceof JsonString s && !s.value().isBlank() ? s.value().trim() : linkName;
  }

  /** Where the status says the link is: the peer, or the address it listens on (also for a link that cannot run). */
  private static String where(Transport transport, Direction direction, @Nullable String host, int port, @Nullable ListenAddress listen, JsonObject entry) {
    if (transport.isTcp()) {
      return (host == null ? "?" : host) + ":" + (port > 0 ? port : "?");
    }
    if (transport == Transport.UDP && direction == Direction.OUT) {
      return "to " + (host == null ? "?" : host) + ":" + (port > 0 ? port : "?");
    }
    String address = listen != null ? listen.address() : entry.get("address") instanceof JsonString a ? cleaned(a.value()) : (transport == Transport.UDP ? ListenAddress.LOOPBACK : "?");
    String shown = address + ":" + (port > 0 ? port : "?");
    String via = listen != null ? listen.networkInterface() : entry.get("interface") instanceof JsonString i ? cleaned(i.value()) : null;
    String where = via == null ? shown : shown + " on " + via;
    return transport == Transport.UDP && direction == Direction.BOTH ? where + " and to " + (host == null ? "?" : host) + ":" + (port > 0 ? port : "?") : where;
  }

  private static Globals globals(JsonObject settings, List<String> problems) {
    Globals defaults = EMPTY.globals();
    int idle = integer(settings.get("idleTimeoutSeconds"), (int) defaults.idle().toSeconds());
    if (idle < 1 || idle > 3600) {
      problems.add("idleTimeoutSeconds must be 1 to 3600; using " + defaults.idle().toSeconds());
      idle = (int) defaults.idle().toSeconds();
    }
    int max = integer(settings.get("maxEventBytes"), defaults.maxEventBytes());
    if (max < 1024 || max > 1_048_576) {
      problems.add("maxEventBytes must be 1024 to 1048576; using " + defaults.maxEventBytes());
      max = defaults.maxEventBytes();
    }
    boolean presence = !(settings.get("sendPresence") instanceof JsonBoolean b) || b.value();
    String callsign = settings.get("presenceCallsign") instanceof JsonString s && !s.value().isBlank() && s.value().length() <= 64
        ? s.value() : defaults.presenceCallsign();
    return new Globals(Duration.ofSeconds(idle), max, presence, callsign);
  }

  private static int integer(@Nullable JsonValue value, int fallback) {
    if (value instanceof JsonNumber n) {
      try {
        long v = n.bigDecimalValue().longValueExact();
        return v < Integer.MIN_VALUE || v > Integer.MAX_VALUE ? -1 : (int) v;
      } catch (ArithmeticException e) {
        return -1;
      }
    }
    return fallback;
  }
}
