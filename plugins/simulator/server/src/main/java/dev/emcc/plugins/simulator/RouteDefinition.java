package dev.emcc.plugins.simulator;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * A route's definition: what users typed, kept in the simulator's extension of the route object
 * (brief function 4, open question 16, the ACA's S1). The server part reads it from every route and
 * checks it, since users write it (README, "The route's extension").
 *
 * @param points one entry per point of the route's line
 * @param groups the route's objects, in convoy order
 * @param end what the route does at its last point
 * @param edit the move-or-disconnect choice of the last edit in the route editor, or null
 */
record RouteDefinition(List<Point> points, List<Group> groups, End end, @Nullable EditChoice edit) {

  static final int MAX_POINTS = 1_000;
  static final double MAX_SPEED = 2_000;
  static final double MIN_ALTITUDE = -1_000;
  static final double MAX_ALTITUDE = 30_000;
  static final double MAX_SECONDS = 7 * 24 * 3600;
  static final double MAX_OFFSET = 100_000;

  RouteDefinition {
    points = List.copyOf(points);
    groups = List.copyOf(groups);
  }

  /** How a value changes towards a point: a step at the point, or a ramp over the leg into it (Q11). */
  enum Kind {
    INSTANT,
    RAMP
  }

  /** What a typed time counts from (Q12). */
  enum From {
    PREVIOUS,
    START
  }

  /** What a route does at its last point (A9, Q19). */
  enum End {
    STOP,
    RESTART
  }

  enum GroupKind {
    SINGLE,
    CONVOY,
    FORMATION
  }

  /** What happens to a route's objects when the route is edited while they are on it (Q14). */
  enum Choice {
    MOVE,
    DISCONNECT
  }

  /**
   * A time typed instead of a speed (brief function 6).
   *
   * @param unit the speed unit the user had chosen when typing it, for rounding the speed
   */
  record TypedTime(double seconds, From from, SpeedUnit unit) {}

  /**
   * One point's values.
   *
   * @param speed the typed speed in m/s, or null when a ramp point's time was typed last
   * @param time the typed arrival time, or null
   * @param altitude metres above the ellipsoid, or null: the object keeps its own (open question 7)
   */
  record Point(Kind speedKind, @Nullable Double speed, @Nullable TypedTime time, Kind altitudeKind, @Nullable Double altitude, List<PointEvent> events) {
    Point {
      events = List.copyOf(events);
    }
  }

  /**
   * An event at a point (brief function 13; A13).
   *
   * @param objects the objects it applies to; empty for all the route's objects
   * @param effect what it does to each object as it passes the point
   */
  record PointEvent(String kind, List<UUID> objects, JsonObject definition, Effects.Effect effect) {
    PointEvent {
      objects = List.copyOf(objects);
    }
  }

  /**
   * An object of the route. The offsets are a formation member's, from the group's centre relative
   * to the first leg's direction (Q16); 0 otherwise.
   */
  record Member(UUID id, double forward, double right, double up) {}

  /**
   * A group of the route's objects (brief functions 10 to 12).
   *
   * @param spacing a convoy's spacing in metres along the route; 0 otherwise
   * @param altitude a formation's centre altitude when it was assigned, which it keeps where the
   *     route's altitude is empty (A11); null for other groups, or when no member had an altitude
   */
  record Group(GroupKind kind, double spacing, @Nullable Double altitude, List<Member> members) {
    Group {
      members = List.copyOf(members);
    }

    static Group single(UUID id) {
      return new Group(GroupKind.SINGLE, 0, null, List.of(new Member(id, 0, 0, 0)));
    }

    /** This group without the objects in {@code ids}, or null when none is left. */
    @Nullable Group without(Set<UUID> ids) {
      List<Member> left = members.stream().filter(m -> !ids.contains(m.id())).toList();
      return left.isEmpty() ? null : left.size() == members.size() ? this : new Group(kind, spacing, altitude, left);
    }

    JsonObject toJson() {
      List<JsonValue> objects = new ArrayList<>();
      for (Member m : members) {
        var o = JsonObject.builder().put("id", JsonString.of(m.id().toString()));
        if (kind == GroupKind.FORMATION) {
          o.put("forward", JsonNumber.of(m.forward())).put("right", JsonNumber.of(m.right())).put("up", JsonNumber.of(m.up()));
        }
        objects.add(o.build());
      }
      var out = JsonObject.builder().put("kind", JsonString.of(kind.name().toLowerCase(java.util.Locale.ROOT)));
      if (kind == GroupKind.CONVOY) {
        out.put("spacing", JsonNumber.of(spacing));
      }
      if (kind == GroupKind.FORMATION && altitude != null) {
        out.put("altitude", JsonNumber.of(altitude));
      }
      return out.put("objects", new JsonArray(objects)).build();
    }
  }

  /** @param number raised by the route editor with each edit, so a stored choice is told from a new one (function 9) */
  record EditChoice(long number, Choice objects) {}

  /** A parsed definition, or null when it cannot be read at all, with everything found wrong. */
  record Parsed(@Nullable RouteDefinition definition, List<Problem> problems) {
    Parsed {
      problems = List.copyOf(problems);
    }
  }

  /**
   * The route's extension with its object list replaced by {@code groups}, everything else as it was:
   * the server part's own writes of the list (brief functions 9a and 10).
   */
  static JsonObject withGroups(JsonObject extension, List<Group> groups) {
    List<JsonValue> list = new ArrayList<>();
    groups.forEach(g -> list.add(g.toJson()));
    return extension.with("groups", new JsonArray(list));
  }

  /** Every object on the route, in list order. */
  List<UUID> objectIds() {
    List<UUID> ids = new ArrayList<>();
    for (Group g : groups) {
      for (Member m : g.members()) {
        ids.add(m.id());
      }
    }
    return ids;
  }

  /**
   * Reads and checks the extension of a route with {@code pointCount} points (brief function 4): one
   * entry per point, the owner's limits whatever unit is shown, at most 1 000 points, and events that
   * name objects of the route. How the values combine (times, speeds of 0, ramps next to an empty
   * altitude) is checked by {@link RoutePlan}.
   */
  static Parsed parse(@Nullable JsonObject extension, int pointCount) {
    List<Problem> problems = new ArrayList<>();
    if (extension == null) {
      return new Parsed(null, List.of(Problem.route("the route has no simulator values; edit it in the route editor")));
    }
    if (pointCount > MAX_POINTS) {
      // Read nothing more: a longer line must not cost the engine's tick its geodesics.
      return new Parsed(null, List.of(Problem.route("a route has at most " + MAX_POINTS + " points, this one " + pointCount)));
    }
    var reader = new Reader(problems);
    List<Point> points = new ArrayList<>();
    JsonArray entries = reader.array(extension, "points", Problem.ROUTE);
    if (entries == null) {
      return new Parsed(null, problems);
    }
    if (entries.size() != pointCount) {
      problems.add(Problem.route("the route has " + pointCount + " points but values for " + entries.size()));
    }
    List<Group> groups = reader.groups(extension);
    Set<UUID> onRoute = new HashSet<>();
    groups.forEach(g -> g.members().forEach(m -> onRoute.add(m.id())));
    for (int i = 0; i < entries.size(); i++) {
      Point p = reader.point(entries.get(i), i, onRoute);
      if (p == null) {
        return new Parsed(null, problems);
      }
      points.add(p);
    }
    End end = reader.choice(extension, "end", End.class, End.STOP, Problem.ROUTE);
    EditChoice edit = reader.edit(extension);
    return new Parsed(new RouteDefinition(points, groups, end, edit), problems);
  }

  /** Reads JSON values, adding a problem for each that is missing or wrong. */
  private record Reader(List<Problem> problems) {

    @Nullable Point point(JsonValue value, int i, Set<UUID> onRoute) {
      if (!(value instanceof JsonObject o)) {
        problems.add(Problem.at(i, "the point's values are not an object"));
        return null;
      }
      Kind speedKind = choice(o, "speedKind", Kind.class, Kind.INSTANT, i);
      Double speed = number(o, "speed", 0, MAX_SPEED, "a speed", " m/s", i);
      TypedTime time = time(o, i);
      Kind altitudeKind = choice(o, "altitudeKind", Kind.class, Kind.INSTANT, i);
      Double altitude = number(o, "altitude", MIN_ALTITUDE, MAX_ALTITUDE, "an altitude", " m", i);
      List<PointEvent> events = new ArrayList<>();
      JsonArray list = o.has("events") ? array(o, "events", i) : null;
      if (list != null) {
        for (JsonValue e : list.values()) {
          PointEvent event = event(e, i, onRoute);
          if (event != null) {
            events.add(event);
          }
        }
      }
      return new Point(speedKind, speed, time, altitudeKind, altitude, events);
    }

    @Nullable TypedTime time(JsonObject point, int i) {
      JsonValue value = point.get("time");
      if (value == null) {
        return null;
      }
      if (!(value instanceof JsonObject o)) {
        problems.add(Problem.at(i, "the time is not an object"));
        return null;
      }
      Double seconds = number(o, "seconds", 0, MAX_SECONDS, "a time", " s", i);
      if (seconds == null) {
        if (!o.has("seconds")) {
          problems.add(Problem.at(i, "the time has no seconds"));
        }
        return null;
      }
      From from = choice(o, "from", From.class, From.PREVIOUS, i);
      SpeedUnit unit = SpeedUnit.MPS;
      if (o.get("unit") instanceof JsonString s) {
        SpeedUnit u = SpeedUnit.fromJson(s.value());
        if (u == null) {
          problems.add(Problem.at(i, "unknown speed unit " + s.value()));
        } else {
          unit = u;
        }
      } else if (o.has("unit")) {
        problems.add(Problem.at(i, "the time's unit is not a text"));
      }
      return new TypedTime(seconds, from, unit);
    }

    @Nullable PointEvent event(JsonValue value, int i, Set<UUID> onRoute) {
      if (!(value instanceof JsonObject o) || !(o.get("kind") instanceof JsonString kind)) {
        problems.add(Problem.at(i, "an event has no kind"));
        return null;
      }
      List<UUID> objects = new ArrayList<>();
      JsonArray ids = o.has("objects") ? array(o, "objects", i) : null;
      if (ids != null) {
        for (JsonValue id : ids.values()) {
          UUID uuid = uuid(id, i);
          if (uuid != null && !onRoute.contains(uuid)) {
            problems.add(Problem.at(i, "an event names an object that is not on the route: " + uuid));
          } else if (uuid != null) {
            objects.add(uuid);
          }
        }
      }
      List<String> wrong = new ArrayList<>();
      Effects.Effect effect = Effects.parse(o, wrong);
      wrong.forEach(w -> problems.add(Problem.at(i, w)));
      return effect == null ? null : new PointEvent(kind.value(), objects, o, effect);
    }

    List<Group> groups(JsonObject extension) {
      List<Group> groups = new ArrayList<>();
      if (!extension.has("groups")) {
        return groups;
      }
      JsonArray list = array(extension, "groups", Problem.ROUTE);
      if (list == null) {
        return groups;
      }
      Set<UUID> seen = new HashSet<>();
      for (JsonValue value : list.values()) {
        if (!(value instanceof JsonObject o)) {
          problems.add(Problem.route("a group is not an object"));
          continue;
        }
        GroupKind kind = choice(o, "kind", GroupKind.class, GroupKind.SINGLE, Problem.ROUTE);
        double spacing = 0;
        if (kind == GroupKind.CONVOY) {
          Double s = number(o, "spacing", 1, MAX_OFFSET, "a convoy's spacing", " m", Problem.ROUTE);
          spacing = s == null ? 0 : s;
          if (s == null) {
            problems.add(Problem.route("a convoy has no spacing"));
          }
        }
        List<Member> members = new ArrayList<>();
        JsonArray objects = array(o, "objects", Problem.ROUTE);
        for (JsonValue m : objects == null ? List.<JsonValue>of() : objects.values()) {
          Member member = member(m, kind);
          if (member != null && !seen.add(member.id())) {
            problems.add(Problem.route("an object is on the route twice: " + member.id()));
          } else if (member != null) {
            members.add(member);
          }
        }
        Double altitude = kind == GroupKind.FORMATION ? number(o, "altitude", MIN_ALTITUDE, MAX_ALTITUDE, "a formation's altitude", " m", Problem.ROUTE) : null;
        groups.add(new Group(kind, spacing, altitude, members));
      }
      return groups;
    }

    @Nullable Member member(JsonValue value, GroupKind kind) {
      if (!(value instanceof JsonObject o)) {
        problems.add(Problem.route("a group's object is not an object"));
        return null;
      }
      UUID id = uuid(o.get("id"), Problem.ROUTE);
      if (id == null) {
        return null;
      }
      if (kind != GroupKind.FORMATION) {
        return new Member(id, 0, 0, 0);
      }
      Double forward = number(o, "forward", -MAX_OFFSET, MAX_OFFSET, "an offset", " m", Problem.ROUTE);
      Double right = number(o, "right", -MAX_OFFSET, MAX_OFFSET, "an offset", " m", Problem.ROUTE);
      Double up = number(o, "up", -MAX_ALTITUDE, MAX_ALTITUDE, "an offset", " m", Problem.ROUTE);
      return new Member(id, forward == null ? 0 : forward, right == null ? 0 : right, up == null ? 0 : up);
    }

    @Nullable EditChoice edit(JsonObject extension) {
      if (!(extension.get("edit") instanceof JsonObject o)) {
        if (extension.has("edit")) {
          problems.add(Problem.route("the edit choice is not an object"));
        }
        return null;
      }
      Double number = number(o, "number", 0, Long.MAX_VALUE, "an edit number", "", Problem.ROUTE);
      Choice objects = choice(o, "objects", Choice.class, Choice.MOVE, Problem.ROUTE);
      return number == null ? null : new EditChoice(number.longValue(), objects);
    }

    @Nullable JsonArray array(JsonObject o, String name, int point) {
      if (o.get(name) instanceof JsonArray a) {
        return a;
      }
      problems.add(Problem.at(point, "'" + name + "' is missing or not a list"));
      return null;
    }

    /** The number at {@code name}, or null when absent; a number outside {@code min..max}, or not finite, is a problem. */
    @Nullable Double number(JsonObject o, String name, double min, double max, String what, String unit, int point) {
      JsonValue value = o.get(name);
      if (value == null) {
        return null;
      }
      if (!(value instanceof JsonNumber n)) {
        problems.add(Problem.at(point, "'" + name + "' is not a number"));
        return null;
      }
      double d = n.doubleValue();
      if (!Double.isFinite(d) || d < min || d > max) {
        problems.add(Problem.at(point, what + " must be from " + format(min) + " to " + format(max) + unit + ", not " + n.text()));
        return null;
      }
      return d;
    }

    <E extends Enum<E>> E choice(JsonObject o, String name, Class<E> type, E absent, int point) {
      JsonValue value = o.get(name);
      if (value == null) {
        return absent;
      }
      if (value instanceof JsonString s) {
        for (E e : type.getEnumConstants()) {
          if (e.name().toLowerCase(java.util.Locale.ROOT).equals(s.value())) {
            return e;
          }
        }
      }
      problems.add(Problem.at(point, "'" + name + "' has an unknown value"));
      return absent;
    }

    @Nullable UUID uuid(@Nullable JsonValue value, int point) {
      if (value instanceof JsonString s) {
        try {
          return UUID.fromString(s.value());
        } catch (IllegalArgumentException e) {
          // reported below
        }
      }
      problems.add(Problem.at(point, "not an object id: " + value));
      return null;
    }

    private static String format(double value) {
      return value == Math.rint(value) && Math.abs(value) < 1e15 ? Long.toString((long) value) : Double.toString(value);
    }
  }
}
