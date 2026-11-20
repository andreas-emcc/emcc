package dev.emcc.sdk.testkit.sample.bad;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.sample.good.GoodPlugin;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

/** One class per rule violation. Each is checked on its own in PluginRulesTest. */
public final class BadSamples {

  private BadSamples() {}

  // concurrency

  public static final class StartsThread {
    void run() {
      new Thread(() -> {}).start();
    }
  }

  public static final class UsesExecutorSubclass {
    Object pool() {
      return new ScheduledThreadPoolExecutor(1);
    }
  }

  public static final class UsesLock {
    private final ReentrantLock lock = new ReentrantLock();

    void work() {
      lock.lock();
      lock.unlock();
    }
  }

  public static final class Sleeps {
    void pause() throws InterruptedException {
      TimeUnit.SECONDS.sleep(1);
    }
  }

  public static final class WaitsWithNanos {
    void pause() throws InterruptedException {
      synchronized (this) {
        wait(1, 1);
      }
    }
  }

  public static final class TimedJoin {
    void join(Thread other) throws InterruptedException {
      TimeUnit.SECONDS.timedJoin(other, 1);
    }
  }

  /** Uses no banned type, only TimeUnit.timedWait on a plain Object: tests the call check itself. */
  public static final class TimedWait {
    void await(Object lock) throws InterruptedException {
      TimeUnit.SECONDS.timedWait(lock, 1);
    }
  }

  public static final class SynchronizedMethod {
    private int count;

    synchronized void increment() {
      count++;
    }
  }

  // parallel streams

  public static final class ParallelStream {
    long count(List<String> items) {
      return items.parallelStream().count();
    }
  }

  // I/O

  public static final class OwnHttpClient {
    Object client() {
      return HttpClient.newHttpClient();
    }
  }

  public static final class ReadsFiles {
    String read() throws java.io.IOException {
      return Files.readString(Path.of("x"));
    }
  }

  public static final class OpensUrl {
    Object open() throws java.io.IOException {
      return URI.create("https://example.org").toURL().openStream();
    }
  }

  public static final class UsesFile {
    boolean exists() {
      return new java.io.File("x").exists();
    }
  }

  public static final class UsesZip {
    Object open() throws java.io.IOException {
      return new java.util.zip.ZipFile("x.zip");
    }
  }

  // process control

  public static final class Exits {
    void quit() {
      System.exit(1);
    }
  }

  public static final class StartsProcess {
    Object start() {
      return new ProcessBuilder("cmd");
    }
  }

  // dependencies

  public static final class UsesGeographicLib {
    double metres() {
      return net.sf.geographiclib.Geodesic.WGS84.Inverse(59.33, 18.07, 57.71, 11.97).s12;
    }
  }

  public static final class UsesSpring {
    Object bean() {
      return new org.springframework.fake.FakeBean();
    }
  }

  public static final class UsesEcore {
    Object internal() {
      return new dev.emcc.ecore.fake.FakeInternal();
    }
  }

  public static final class UsesOtherPlugin {
    Object other() {
      return new GoodPlugin();
    }
  }

  public static final class UsesTestKit {
    Object context() {
      return FakePluginContext.builder("x").build();
    }
  }

  // static state

  public static final class MutableStatic {
    static int counter;

    void count() {
      counter++;
    }
  }

  public static final class StaticArray {
    static final String[] NAMES = {"a", "b"};
  }

  public static final class StaticAtomic {
    static final java.util.concurrent.atomic.AtomicLong COUNTER = new java.util.concurrent.atomic.AtomicLong();
  }

  public static final class StaticMutableList {
    static final ArrayList<String> NAMES = new ArrayList<>();
  }

  public static final class StaticConcurrentMap {
    static final java.util.concurrent.ConcurrentHashMap<String, String> CACHE = new java.util.concurrent.ConcurrentHashMap<>();
  }

  // messages

  public record MessageWithLog(dev.emcc.sdk.PluginLog log) implements Message {}

  public record MessageWithContext(dev.emcc.sdk.PluginContext context) implements Message {}

  public record MessageWithSpec(dev.emcc.sdk.worker.WorkerSpec<Message> spec) implements Message {}

  public record MessageWithStore(dev.emcc.sdk.store.Store store) implements Message {}

  public record MessageWithConnection(dev.emcc.sdk.listener.ListenerConnection connection) implements Message {}

  public static final class NotARecordMessage implements Message {}

  public record ArrayMessage(byte[] data) implements Message {}

  public record MutableListMessage(ArrayList<String> names) implements Message {}

  public record OptionalMessage(Optional<String> name) implements Message {}

  public record ForeignTypeMessage(Date when) implements Message {}

  public record Holder(int[] values) {}

  public record NestedBadMessage(Holder holder) implements Message {}

  public record ListOfForeignMessage(List<Date> dates) implements Message {}

  // SDK 1.2.0: sockets and name lookups only in connection tasks (ADR-0036, rule C6)

  public static final class OpensSocketOutsideTask {
    java.net.Socket open() {
      return new java.net.Socket();
    }
  }

  public static final class LooksUpNameOutsideTask {
    java.net.InetAddress lookUp() throws java.net.UnknownHostException {
      return java.net.InetAddress.getByName("tak.example.local");
    }
  }

  public static final class ResolvesInConstructorOutsideTask {
    java.net.InetSocketAddress at() {
      return new java.net.InetSocketAddress("tak.example.local", 8087);
    }
  }

  public static final class UsesTlsFactoryOutsideTask {
    javax.net.SocketFactory factory() {
      return javax.net.ssl.SSLSocketFactory.getDefault();
    }
  }

  public static final class OpensSelectorOutsideTask {
    java.nio.channels.Selector open() throws java.io.IOException {
      return java.nio.channels.Selector.open();
    }
  }

  public static final class OpensSocketChannelOutsideTask {
    java.nio.channels.SocketChannel open() throws java.io.IOException {
      return java.nio.channels.SocketChannel.open();
    }
  }

  public static final class AsksHostNameOutsideTask {
    String name() {
      return java.net.InetAddress.getLoopbackAddress().getHostName();
    }
  }

  public static final class ProbesOutsideTask {
    boolean probe() throws java.io.IOException {
      return java.net.InetAddress.getLoopbackAddress().isReachable(100);
    }
  }

  /** A lambda task: its body belongs to this class, which is no task. */
  public static final class LambdaTask {
    dev.emcc.sdk.connection.ConnectionTask<Message> task() {
      return t -> {
        try (var socket = new java.net.DatagramSocket()) {
          t.closeOnStop(socket);
        }
      };
    }
  }

  /** A helper outside the task that takes the socket instead of its streams. */
  public static final class HelperTakesSocket {
    void write(java.net.Socket socket) throws java.io.IOException {
      socket.getOutputStream().write(1);
    }
  }

  public static final class TaskReadsFiles implements dev.emcc.sdk.connection.ConnectionTask<Message> {
    @Override
    public void run(dev.emcc.sdk.connection.TaskContext<Message> task) throws java.io.IOException {
      try (var file = java.nio.channels.FileChannel.open(Path.of("x"))) {
        task.closeOnStop(file);
      }
    }
  }

  public static final class TaskUsesHttpClient implements dev.emcc.sdk.connection.ConnectionTask<Message> {
    @Override
    public void run(dev.emcc.sdk.connection.TaskContext<Message> task) {
      task.closeOnStop(HttpClient.newHttpClient());
    }
  }

  public record MessageWithTaskContext(dev.emcc.sdk.connection.TaskContext<Message> task) implements Message {}

  public record MessageWithConnections(dev.emcc.sdk.connection.Connections connections) implements Message {}

  public record MessageWithChannels(dev.emcc.sdk.channel.Channels channels) implements Message {}

  // SDK 1.9.0 (CR-0048 point 5.7): compute tasks

  /** A compute task that writes to the store, which is its plugin's workers' to do. */
  public static final class ComputeUsesStore implements dev.emcc.sdk.compute.ComputeTask<Message> {
    private final dev.emcc.sdk.store.Store store;

    public ComputeUsesStore(dev.emcc.sdk.store.Store store) {
      this.store = store;
    }

    @Override
    public void run(dev.emcc.sdk.compute.ComputeContext<Message> task) {
      store.toString();
    }
  }

  /** A compute task that keeps the plugin's context and makes HTTP calls through it. */
  public static final class ComputeUsesContext implements dev.emcc.sdk.compute.ComputeTask<Message> {
    private final dev.emcc.sdk.PluginContext context;

    public ComputeUsesContext(dev.emcc.sdk.PluginContext context) {
      this.context = context;
    }

    @Override
    public void run(dev.emcc.sdk.compute.ComputeContext<Message> task) {
      context.http();
    }
  }

  /** A compute task whose nested helper sends on a channel. */
  public static final class ComputeHelperSendsOnChannel implements dev.emcc.sdk.compute.ComputeTask<Message> {
    @Override
    public void run(dev.emcc.sdk.compute.ComputeContext<Message> task) {}

    public static final class Helper {
      void send(dev.emcc.sdk.channel.Channels channels) {
        channels.toString();
      }
    }
  }

  /** A compute task that sets a timer. */
  public static final class ComputeUsesTimers implements dev.emcc.sdk.compute.ComputeTask<Message> {
    private dev.emcc.sdk.timer.@org.jspecify.annotations.Nullable Timers timers;

    @Override
    public void run(dev.emcc.sdk.compute.ComputeContext<Message> task) {
      java.util.Objects.requireNonNull(timers).toString();
    }
  }

  /** A compute task that sleeps instead of waiting on its inbox. */
  public static final class ComputeSleeps implements dev.emcc.sdk.compute.ComputeTask<Message> {
    @Override
    public void run(dev.emcc.sdk.compute.ComputeContext<Message> task) throws InterruptedException {
      java.util.concurrent.TimeUnit.MILLISECONDS.sleep(40);
    }
  }

  /** A compute task that opens a socket, which only connection tasks do. */
  public static final class ComputeOpensSocket implements dev.emcc.sdk.compute.ComputeTask<Message> {
    @Override
    public void run(dev.emcc.sdk.compute.ComputeContext<Message> task) throws java.io.IOException {
      try (var socket = new java.net.DatagramSocket()) {
        socket.toString();
      }
    }
  }

  /** Both a compute task and a connection task. */
  public static final class ComputeAndConnection implements dev.emcc.sdk.compute.ComputeTask<Message>, dev.emcc.sdk.connection.ConnectionTask<Message> {
    @Override
    public void run(dev.emcc.sdk.compute.ComputeContext<Message> task) {}

    @Override
    public void run(dev.emcc.sdk.connection.TaskContext<Message> task) {}
  }

  public record MessageWithComputeContext(dev.emcc.sdk.compute.ComputeContext<Message> task) implements Message {}

  public record MessageWithComputes(dev.emcc.sdk.compute.Computes computes) implements Message {}
}
