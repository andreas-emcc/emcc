package dev.emcc.sdk.testkit;

import dev.emcc.sdk.json.JsonValue;
import java.lang.reflect.RecordComponent;
import java.util.Collection;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * The runtime counterpart of {@link PluginRules}' message rules: checks the actual values of a
 * message before {@link FakePluginContext} delivers it. Catches what the static rules cannot, e.g.
 * a {@code List} component that holds an {@code ArrayList} instead of an unmodifiable copy.
 *
 * <pre>{@code
 * MessageCheck.requireImmutable(new TileMsg.Get(key, request));   // passes
 * MessageCheck.requireImmutable(new Bad(new ArrayList<>()));      // throws
 * }</pre>
 */
public final class MessageCheck {

  private static final int MAX_DEPTH = 32;

  private MessageCheck() {}

  /** Throws {@link IllegalArgumentException} if {@code message} is not a record or enum with immutable values only. */
  public static void requireImmutable(Object message) {
    Class<?> type = message.getClass();
    if (!type.isRecord() && !type.isEnum()) {
      throw new IllegalArgumentException("messages are records or enums: " + type.getName());
    }
    check(message, type.getSimpleName(), 0);
  }

  private static void check(@Nullable Object value, String path, int depth) {
    if (value == null) {
      return;
    }
    if (depth > MAX_DEPTH) {
      throw new IllegalArgumentException(path + ": nested too deeply (a cycle?)");
    }
    Class<?> type = value.getClass();
    if (type.isArray()) {
      throw new IllegalArgumentException(path + " is an array, which is mutable; use Bytes or List.copyOf");
    }
    if (isValue(type) || value instanceof JsonValue) {
      return; // JSON values are immutable by construction, and a POST body may nest deeper than MAX_DEPTH (CR-0026)
    }
    // Before descending into records: WorkerSpec is a record, but a service description, not a value.
    if (isSdkService(value)) {
      throw new IllegalArgumentException(path + " is an SDK service (" + type.getName() + "), not a value; it must not travel in messages");
    }
    if (value instanceof Collection<?> c) {
      requireUnmodifiable(type, path);
      int i = 0;
      for (Object element : c) {
        check(element, path + "[" + i++ + "]", depth + 1);
      }
      return;
    }
    if (value instanceof Map<?, ?> m) {
      requireUnmodifiable(type, path);
      for (Map.Entry<?, ?> e : m.entrySet()) {
        check(e.getKey(), path + ".key", depth + 1);
        check(e.getValue(), path + "[" + e.getKey() + "]", depth + 1);
      }
      return;
    }
    if (type.isRecord()) {
      for (RecordComponent rc : type.getRecordComponents()) {
        check(read(rc, value), path + "." + rc.getName(), depth + 1);
      }
      return;
    }
    if (isSdkType(type)) {
      return; // handles, Bytes, JSON values: immutable by construction
    }
    throw new IllegalArgumentException(path + " has the type " + type.getName() + ", which is not an immutable message value");
  }

  private static boolean isValue(Class<?> type) {
    return type.isEnum()
        || type.isPrimitive()
        || type == String.class
        || type == Boolean.class
        || type == Character.class
        || Number.class.isAssignableFrom(type) && (type.getPackageName().equals("java.lang") || type.getPackageName().equals("java.math"))
        || type == java.util.UUID.class
        || type == java.net.URI.class
        || type.getPackageName().equals("java.time")
        || type.getEnclosingClass() != null && type.getEnclosingClass().isEnum();
  }

  /** Whether {@code value} implements one of the SDK's service interfaces ({@link PluginRules#SDK_SERVICES}). */
  private static boolean isSdkService(Object value) {
    for (Class<?> c = value.getClass(); c != null; c = c.getSuperclass()) {
      if (PluginRules.SDK_SERVICES.contains(c.getName())) {
        return true; // e.g. WorkerSpec, a record holding a handler factory
      }
      for (Class<?> i : allInterfaces(c)) {
        if (PluginRules.SDK_SERVICES.contains(i.getName())) {
          return true;
        }
      }
    }
    return false;
  }

  private static java.util.Set<Class<?>> allInterfaces(Class<?> type) {
    var found = new java.util.HashSet<Class<?>>();
    var todo = new java.util.ArrayDeque<Class<?>>(java.util.List.of(type.getInterfaces()));
    while (!todo.isEmpty()) {
      Class<?> i = todo.pop();
      if (found.add(i)) {
        todo.addAll(java.util.List.of(i.getInterfaces()));
      }
    }
    return found;
  }

  private static boolean isSdkType(Class<?> type) {
    return type.getPackageName().startsWith("dev.emcc.sdk");
  }

  private static void requireUnmodifiable(Class<?> type, String path) {
    String n = type.getName();
    boolean unmodifiable =
        n.startsWith("java.util.ImmutableCollections$")
            || n.startsWith("java.util.Collections$Unmodifiable")
            || n.startsWith("java.util.Collections$Empty")
            || n.startsWith("java.util.Collections$Singleton")
            || isSdkType(type);
    if (!unmodifiable) {
      throw new IllegalArgumentException(path + " is a mutable " + type.getName() + "; copy it with List.copyOf, Set.copyOf or Map.copyOf");
    }
  }

  private static @Nullable Object read(RecordComponent rc, Object record) {
    try {
      var accessor = rc.getAccessor();
      accessor.setAccessible(true);
      return accessor.invoke(record);
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException("cannot read " + rc.getName() + " of " + record.getClass().getName(), e);
    }
  }
}
