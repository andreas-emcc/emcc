package dev.emcc.sdk.testkit;

import static com.tngtech.archunit.base.DescribedPredicate.not;
import static com.tngtech.archunit.core.domain.JavaClass.Predicates.assignableTo;
import static com.tngtech.archunit.core.domain.JavaClass.Predicates.resideInAPackage;
import static com.tngtech.archunit.core.domain.JavaClass.Predicates.resideInAnyPackage;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.fields;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.methods;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.domain.JavaField;
import com.tngtech.archunit.core.domain.JavaMethodCall;
import com.tngtech.archunit.core.domain.JavaModifier;
import com.tngtech.archunit.core.domain.JavaParameterizedType;
import com.tngtech.archunit.core.domain.JavaType;
import com.tngtech.archunit.core.domain.JavaTypeVariable;
import com.tngtech.archunit.core.domain.JavaWildcardType;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import dev.emcc.sdk.Message;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;

/**
 * The ArchUnit rule set every plugin's server part must pass (overview 4.2, ADR-0002, ADR-0003,
 * docs/plugins/sdk-v0.md). The rules apply to the plugin's own classes; bundled third-party
 * libraries are allowed, but must not start threads or block (design pattern).
 *
 * <p>A plugin's classes live in {@code dev.emcc.plugins.<id without hyphens>}, e.g.
 * {@code dev.emcc.plugins.basemaposm} for {@code basemap-osm} ({@link #packageFor(String)}).
 *
 * <pre>{@code
 * class ArchitectureTest {
 *   @Test
 *   void followsThePluginRules() {
 *     PluginRules.checkPlugin("basemap-osm");
 *   }
 * }
 * }</pre>
 */
public final class PluginRules {

  private static final Pattern PLUGIN_ID = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  /** Types that start, schedule or coordinate threads, or block on them. Matched by assignability. */
  private static final List<Class<?>> CONCURRENCY =
      List.of(
          Thread.class,
          ThreadGroup.class,
          java.util.concurrent.Executor.class,
          java.util.concurrent.ForkJoinTask.class,
          java.util.concurrent.Future.class,
          java.util.concurrent.CompletionStage.class,
          java.util.Timer.class,
          java.util.TimerTask.class,
          java.util.concurrent.locks.Lock.class,
          java.util.concurrent.locks.ReadWriteLock.class,
          java.util.concurrent.locks.Condition.class,
          java.util.concurrent.locks.StampedLock.class,
          java.util.concurrent.locks.LockSupport.class,
          java.util.concurrent.Semaphore.class,
          java.util.concurrent.CountDownLatch.class,
          java.util.concurrent.CyclicBarrier.class,
          java.util.concurrent.Phaser.class,
          java.util.concurrent.Exchanger.class,
          java.util.concurrent.BlockingQueue.class);

  /**
   * Own HTTP and file I/O, everywhere: plugins use the SDK's outbound HTTP; their data goes through
   * the persistence manager, and local files are read only through the SDK's declared folders
   * (SDK 1.4.0, {@code LocalFolder}; model rule 19).
   */
  private static final List<Class<?>> IO =
      List.of(
          java.net.http.HttpClient.class,
          java.net.URLConnection.class,
          java.nio.channels.FileChannel.class,
          java.nio.channels.AsynchronousFileChannel.class,
          java.nio.file.Files.class,
          java.io.FileInputStream.class,
          java.io.FileOutputStream.class,
          java.io.FileReader.class,
          java.io.FileWriter.class,
          java.io.RandomAccessFile.class,
          java.io.File.class,
          java.util.zip.ZipFile.class);

  /**
   * SDK 1.2.0: sockets of any kind (MulticastSocket and the TLS sockets included, by
   * assignability), socket factories, the NIO network channels and selectors. Allowed only in
   * connection tasks (ADR-0036; rule C6).
   */
  private static final List<Class<?>> SOCKETS =
      List.of(
          java.net.Socket.class,
          java.net.ServerSocket.class,
          java.net.DatagramSocket.class,
          javax.net.SocketFactory.class,
          javax.net.ServerSocketFactory.class,
          javax.net.ssl.SSLEngine.class,
          java.nio.channels.NetworkChannel.class,
          java.nio.channels.Selector.class,
          java.nio.channels.spi.SelectorProvider.class);

  /**
   * SDK interfaces that are services or code, not values: they must never travel inside messages
   * (ACA review). The SDK's value types and handles ({@code WorkerRef}, {@code ReplyTo},
   * {@code ResponseHandle}) are allowed.
   */
  static final Set<String> SDK_SERVICES =
      Set.of(
          "dev.emcc.sdk.Plugin",
          "dev.emcc.sdk.PluginContext",
          "dev.emcc.sdk.PluginLog",
          "dev.emcc.sdk.Status",
          "dev.emcc.sdk.Cancellable",
          "dev.emcc.sdk.worker.Workers",
          "dev.emcc.sdk.worker.WorkerContext",
          "dev.emcc.sdk.worker.WorkerSpec",
          "dev.emcc.sdk.worker.Handler",
          "dev.emcc.sdk.topic.Topics",
          "dev.emcc.sdk.timer.Timers",
          "dev.emcc.sdk.http.OutboundHttp",
          "dev.emcc.sdk.http.Endpoints",
          "dev.emcc.sdk.listener.Listeners",
          "dev.emcc.sdk.listener.Listener",
          "dev.emcc.sdk.listener.ListenerConnection",
          "dev.emcc.sdk.listener.ListenerContext",
          "dev.emcc.sdk.connection.Connections",
          "dev.emcc.sdk.connection.ConnectionTask",
          "dev.emcc.sdk.connection.TaskContext",
          "dev.emcc.sdk.compute.Computes",
          "dev.emcc.sdk.compute.ComputeTask",
          "dev.emcc.sdk.compute.ComputeContext",
          "dev.emcc.sdk.channel.Channels",
          "dev.emcc.sdk.stream.Streams",
          "dev.emcc.sdk.stream.Conversions",
          "dev.emcc.sdk.store.Store",
          "dev.emcc.sdk.document.Documents",
          "dev.emcc.sdk.folder.LocalFolders",
          "dev.emcc.sdk.folder.LocalFolder");

  private static final List<Class<?>> PROCESS = List.of(ProcessBuilder.class, Process.class, ProcessHandle.class);

  /**
   * SDK 1.9.0 (CR-0048 point 5.7; ADR-0064 point 3): what a compute task may not use, since it is its
   * plugin's workers' to do: the plugin's context, the store, documents, channels, streams, topics,
   * timers, workers, connections, endpoints, outbound HTTP and the conversion service. SDK 1.9.0 part U
   * (CR-0050 point 1.7): a task writes its pictures through an {@code EncoderRef}, a handle its worker
   * started and posted to it, which is allowed.
   */
  private static final List<Class<?>> NOT_IN_COMPUTE =
      List.of(
          dev.emcc.sdk.PluginContext.class,
          dev.emcc.sdk.store.Store.class,
          dev.emcc.sdk.document.Documents.class,
          dev.emcc.sdk.channel.Channels.class,
          dev.emcc.sdk.stream.Streams.class,
          dev.emcc.sdk.stream.Conversions.class,
          dev.emcc.sdk.topic.Topics.class,
          dev.emcc.sdk.timer.Timers.class,
          dev.emcc.sdk.worker.Workers.class,
          dev.emcc.sdk.worker.WorkerContext.class,
          dev.emcc.sdk.connection.Connections.class,
          dev.emcc.sdk.http.Endpoints.class,
          dev.emcc.sdk.http.OutboundHttp.class);

  private PluginRules() {}

  /** The package of a plugin: {@code dev.emcc.plugins.} plus the plugin id without hyphens. */
  public static String packageFor(String pluginId) {
    if (!PLUGIN_ID.matcher(pluginId).matches()) {
      throw new IllegalArgumentException("not a plugin id: " + pluginId);
    }
    return "dev.emcc.plugins." + pluginId.replace("-", "").toLowerCase(Locale.ROOT);
  }

  /** Imports the plugin's main classes (not its tests) from its conventional package and checks every rule. */
  public static void checkPlugin(String pluginId) {
    check(packageFor(pluginId));
  }

  /** Imports the main classes (not tests) of {@code pluginPackage} and checks every rule. */
  public static void check(String pluginPackage) {
    JavaClasses classes = new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS).importPackages(pluginPackage);
    if (classes.isEmpty()) {
      throw new AssertionError("no classes found in " + pluginPackage + " (plugin classes live in dev.emcc.plugins.<id>)");
    }
    check(pluginPackage, classes);
  }

  /** Checks every rule against {@code classes}. */
  public static void check(String pluginPackage, JavaClasses classes) {
    for (ArchRule rule : all(pluginPackage)) {
      rule.check(classes);
    }
  }

  /** All rules, for the plugin whose classes live in {@code pluginPackage} and its subpackages. */
  public static List<ArchRule> all(String pluginPackage) {
    String own = pluginPackage + "..";
    return List.of(
        noClasses()
            .should()
            .dependOnClassesThat(anyAssignableTo(CONCURRENCY))
            .orShould()
            .callMethodWhere(
                call("TimeUnit.sleep, timedWait, timedJoin or Object.wait",
                    c -> ownedBy(c, java.util.concurrent.TimeUnit.class, "sleep", "timedWait", "timedJoin") || named(c, Object.class, "wait")))
            .as("concurrency: plugins do not create threads, executors, futures or timers, use locks or synchronizers, sleep or wait (rules C1, C4); use workers, timers and outbound HTTP from the SDK"),
        methods()
            .should()
            .notHaveModifier(JavaModifier.SYNCHRONIZED)
            .allowEmptyShould(true)
            .as("synchronized methods: plugins have no synchronized methods; state is owned by one worker (rules C2, C4)"),
        noClasses()
            .should()
            .callMethodWhere(call("parallel streams", c -> named(c, java.util.Collection.class, "parallelStream") || named(c, java.util.stream.BaseStream.class, "parallel")))
            .as("parallel streams: plugins do not use parallel streams, which run on the common thread pool (rule C1)"),
        noClasses()
            .should()
            .dependOnClassesThat(anyAssignableTo(IO))
            .orShould()
            .callMethodWhere(call("URL.openConnection or URL.openStream", c -> named(c, java.net.URL.class, "openConnection") || named(c, java.net.URL.class, "openStream")))
            .as("I/O: plugins do no HTTP or file I/O of their own, in connection tasks neither; use the SDK's outbound HTTP and the persistence manager (rule C6, ADR-0024)"),
        noClasses()
            .that(not(IN_CONNECTION_TASK))
            .should()
            .dependOnClassesThat(anyAssignableTo(SOCKETS))
            .orShould()
            .callMethodWhere(call("a name lookup or a network probe (InetAddress.getByName, getAllByName, getLocalHost, getHostName, getCanonicalHostName, isReachable)",
                c -> ownedBy(c, java.net.InetAddress.class, "getByName", "getAllByName", "getLocalHost", "getHostName", "getCanonicalHostName", "isReachable")
                    || named(c, java.net.InetSocketAddress.class, "getHostName")))
            .orShould()
            .callConstructorWhere(DescribedPredicate.describe("new InetSocketAddress(String, int), which looks the name up",
                c -> c.getTargetOwner().isEquivalentTo(java.net.InetSocketAddress.class)
                    && c.getTarget().getRawParameterTypes().size() == 2
                    && c.getTarget().getRawParameterTypes().getFirst().isEquivalentTo(String.class)))
            .allowEmptyShould(true)
            .as("sockets: plugins open sockets and look names up only in connection tasks, classes that implement ConnectionTask and their nested classes (SDK 1.2.0; ADR-0036, rule C6)"),
        noClasses()
            .that(IN_COMPUTE_TASK)
            .should()
            .dependOnClassesThat(anyAssignableTo(NOT_IN_COMPUTE))
            .allowEmptyShould(true)
            .as("compute tasks: a class that implements ComputeTask, and its nested classes, uses no plugin context, store, documents, channels, streams, conversions, topics, timers, workers, connections, endpoints or outbound HTTP; it sends to its plugin's workers, which do (SDK 1.9.0; ADR-0064 point 3). Write a compute task as a class: a lambda's code is its enclosing class's"),
        classes()
            .that(IN_COMPUTE_TASK)
            .should()
            .notBeAssignableTo(dev.emcc.sdk.connection.ConnectionTask.class)
            .allowEmptyShould(true)
            .as("compute or connection: no class is both a ComputeTask and a ConnectionTask, nor nested in the one and the other (SDK 1.9.0; ADR-0064 point 3)"),
        noClasses()
            .should()
            .dependOnClassesThat(anyAssignableTo(PROCESS))
            .orShould()
            .callMethodWhere(call("System.exit or Runtime process control", c -> named(c, System.class, "exit") || ownedBy(c, Runtime.class, "exit", "halt", "exec", "addShutdownHook", "removeShutdownHook")))
            .as("process control: plugins do not start processes, exit the JVM or add shutdown hooks"),
        noClasses()
            .should()
            .dependOnClassesThat()
            .resideInAPackage("org.springframework..")
            .as("Spring: plugins do not use Spring (ADR-0002)"),
        noClasses()
            .should()
            .dependOnClassesThat()
            .resideInAPackage("net.sf.geographiclib..")
            .as("GeographicLib: plugins use the SDK's Geodesy, never the library behind it, which ECore does not share with plugins (CR-0025 part 7, R3)"),
        noClasses()
            .should()
            .dependOnClassesThat(
                resideInAPackage("dev.emcc..")
                    .and(not(resideInAPackage(own).or(resideInAPackage("dev.emcc.sdk..").and(not(resideInAPackage("dev.emcc.sdk.testkit..")))))))
            .as("SDK only: plugins use only the SDK (not its test kit in main code), never ECore internals or another plugin's code (ADR-0003)"),
        fields()
            .that()
            .areStatic()
            .should()
            .beFinal()
            .allowEmptyShould(true)
            .as("static state: plugins have no non-final static fields; state lives in workers (rule C2)"),
        fields()
            .that()
            .areStatic()
            .should(holdImmutableTypes())
            .allowEmptyShould(true)
            .as("static constants: static final fields hold immutable values: no arrays, atomics, concurrent or mutable collections (List.of constants are fine) (rule C2)"),
        classes()
            .that()
            .implement(Message.class)
            .and()
            .areNotInterfaces()
            .should(beRecordsOrEnums())
            .allowEmptyShould(true)
            .as("message types: messages are records or enums (rule C3)"),
        classes()
            .that()
            .implement(Message.class)
            .should(haveOnlyAllowedComponentTypes(pluginPackage))
            .allowEmptyShould(true)
            .as("message fields: message components have immutable types from the allow list (rule C3, docs/plugins/sdk-v0.md)"),
        classes()
            .should(beInANullMarkedPackage())
            .as("null handling: every package is @NullMarked (JSpecify)"));
  }

  /** SDK 1.9.0: a class that implements {@code ComputeTask}, or is nested (also anonymously) in one. */
  private static final DescribedPredicate<JavaClass> IN_COMPUTE_TASK =
      DescribedPredicate.describe("in a compute task", c -> {
        for (JavaClass at = c; at != null; at = at.getEnclosingClass().orElse(null)) {
          if (at.isAssignableTo(dev.emcc.sdk.compute.ComputeTask.class)) {
            return true;
          }
        }
        return false;
      });

  /** A class that implements {@code ConnectionTask}, or is nested (also anonymously) in one. */
  private static final DescribedPredicate<JavaClass> IN_CONNECTION_TASK =
      DescribedPredicate.describe("in a connection task", c -> {
        for (JavaClass at = c; at != null; at = at.getEnclosingClass().orElse(null)) {
          if (at.isAssignableTo(dev.emcc.sdk.connection.ConnectionTask.class)) {
            return true;
          }
        }
        return false;
      });

  private static DescribedPredicate<JavaClass> anyAssignableTo(List<Class<?>> types) {
    DescribedPredicate<JavaClass> p = assignableTo(types.getFirst());
    for (Class<?> t : types.subList(1, types.size())) {
      p = p.or(assignableTo(t));
    }
    return p;
  }

  private static DescribedPredicate<JavaMethodCall> call(String description, java.util.function.Predicate<JavaMethodCall> test) {
    return DescribedPredicate.describe(description, test);
  }

  private static boolean named(JavaMethodCall c, Class<?> owner, String name) {
    return c.getTarget().getName().equals(name) && c.getTarget().getOwner().isAssignableTo(owner);
  }

  private static boolean ownedBy(JavaMethodCall c, Class<?> owner, String... names) {
    for (String n : names) {
      if (named(c, owner, n)) {
        return true;
      }
    }
    return false;
  }

  private static ArchCondition<JavaClass> beRecordsOrEnums() {
    return new ArchCondition<>("be records or enums") {
      @Override
      public void check(JavaClass c, ConditionEvents events) {
        events.add(new SimpleConditionEvent(c, c.isEnum() || isRecord(c), c.getName() + " implements Message but is neither a record nor an enum"));
      }
    };
  }

  /**
   * The allow list for message components: primitives and their wrappers, {@code String},
   * {@code BigDecimal}, {@code BigInteger}, {@code UUID}, {@code URI}, {@code java.time} values,
   * enums, the SDK's own types (immutable by construction), {@code List}, {@code Set} and {@code Map}
   * of allowed types, and the plugin's own records (checked the same way), enums and message
   * interfaces. No arrays, no {@code Optional}, nothing else.
   */
  private static ArchCondition<JavaClass> haveOnlyAllowedComponentTypes(String pluginPackage) {
    return new ArchCondition<>("have only allowed component types") {
      @Override
      public void check(JavaClass c, ConditionEvents events) {
        if (!isRecord(c)) {
          return;
        }
        checkRecord(c, pluginPackage, events, new HashSet<>());
      }
    };
  }

  private static void checkRecord(JavaClass record, String own, ConditionEvents events, Set<String> visited) {
    if (!visited.add(record.getName())) {
      return;
    }
    for (JavaField f : record.getFields()) {
      if (f.getModifiers().contains(JavaModifier.STATIC)) {
        continue;
      }
      String problem = problemWith(f.getType(), own, events, visited);
      events.add(new SimpleConditionEvent(f, problem == null, record.getName() + "." + f.getName() + ": " + problem));
    }
  }

  private static final Set<String> VALUE_TYPES =
      Set.of(
          "java.lang.String", "java.lang.Boolean", "java.lang.Byte", "java.lang.Short", "java.lang.Integer", "java.lang.Long",
          "java.lang.Float", "java.lang.Double", "java.lang.Character", "java.math.BigDecimal", "java.math.BigInteger",
          "java.util.UUID", "java.net.URI");

  private static final Set<String> CONTAINERS = Set.of("java.util.List", "java.util.Set", "java.util.Map");

  /** Null if {@code type} is allowed, otherwise why not. */
  private static @Nullable String problemWith(JavaType type, String own, ConditionEvents events, Set<String> visited) {
    if (type instanceof JavaTypeVariable<?>) {
      return null;
    }
    if (type instanceof JavaWildcardType w) {
      for (JavaType bound : w.getUpperBounds()) {
        String p = problemWith(bound, own, events, visited);
        if (p != null) {
          return p;
        }
      }
      return null;
    }
    JavaClass raw = type.toErasure();
    if (raw.isArray()) {
      return "arrays are mutable; use Bytes or List.copyOf";
    }
    String name = raw.getName();
    if (raw.isPrimitive() || VALUE_TYPES.contains(name) || raw.getPackageName().equals("java.time") || raw.isEnum()) {
      return null;
    }
    if (SDK_SERVICES.contains(name)) {
      return "the SDK service " + raw.getSimpleName() + " is not a value and must not travel in messages";
    }
    if (raw.getPackageName().startsWith("dev.emcc.sdk") && !raw.getPackageName().startsWith("dev.emcc.sdk.testkit")) {
      return null;
    }
    if (CONTAINERS.contains(name)) {
      if (type instanceof JavaParameterizedType p) {
        for (JavaType arg : p.getActualTypeArguments()) {
          String problem = problemWith(arg, own, events, visited);
          if (problem != null) {
            return "element type: " + problem;
          }
        }
      }
      return null;
    }
    boolean ownType = raw.getPackageName().equals(own) || raw.getPackageName().startsWith(own + ".");
    if (ownType && isRecord(raw)) {
      checkRecord(raw, own, events, visited);
      return null;
    }
    if (ownType && raw.isInterface() && raw.isAssignableTo(Message.class)) {
      return null;
    }
    return "type " + name + " is not on the allow list (immutable values, SDK types, List/Set/Map, own records and enums)";
  }

  /** Declared types a static final field must not have. Interfaces like {@code List} are fine (by convention filled with {@code List.of}). */
  private static ArchCondition<JavaField> holdImmutableTypes() {
    return new ArchCondition<>("hold immutable types") {
      @Override
      public void check(JavaField f, ConditionEvents events) {
        if (f.getModifiers().contains(JavaModifier.SYNTHETIC)) {
          return; // e.g. an enum's $VALUES or a switch map, generated by the compiler
        }
        JavaClass type = f.getRawType();
        String problem = null;
        if (type.isArray()) {
          problem = "an array";
        } else if (type.getPackageName().equals("java.util.concurrent.atomic")) {
          problem = "an atomic";
        } else if (type.getPackageName().startsWith("java.util.concurrent") && (type.isAssignableTo(java.util.Collection.class) || type.isAssignableTo(java.util.Map.class))) {
          problem = "a concurrent collection";
        } else if (!type.isInterface() && (type.isAssignableTo(java.util.Collection.class) || type.isAssignableTo(java.util.Map.class))) {
          problem = "a mutable collection class (declare List, Set or Map and use List.of, Set.of or Map.of)";
        } else if (MUTABLE_VALUE_TYPES.contains(type.getName())) {
          problem = "a mutable type";
        }
        events.add(new SimpleConditionEvent(f, problem == null, f.getFullName() + " is " + problem));
      }
    };
  }

  private static final Set<String> MUTABLE_VALUE_TYPES = Set.of("java.lang.StringBuilder", "java.lang.StringBuffer", "java.util.Date", "java.util.Calendar");

  private static boolean isRecord(JavaClass c) {
    try {
      return c.reflect().isRecord();
    } catch (RuntimeException | LinkageError e) {
      return false;
    }
  }

  private static ArchCondition<JavaClass> beInANullMarkedPackage() {
    return new ArchCondition<>("be in a package annotated with @NullMarked") {
      @Override
      public void check(JavaClass c, ConditionEvents events) {
        events.add(new SimpleConditionEvent(c, c.getPackage().isAnnotatedWith(NullMarked.class), c.getPackageName() + " has no package-info.java with @NullMarked"));
      }
    };
  }
}
