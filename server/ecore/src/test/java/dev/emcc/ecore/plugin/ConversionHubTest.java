package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.stream.ConversionEvent;
import dev.emcc.sdk.stream.ConversionEvent.Failure;
import dev.emcc.sdk.stream.ConversionRef;
import dev.emcc.sdk.stream.ConversionSpec;
import dev.emcc.sdk.stream.Conversions;
import dev.emcc.sdk.stream.StreamRef;
import dev.emcc.sdk.stream.StreamSpec;
import dev.emcc.sdk.worker.SendResult;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** T-211: ECore's conversion service (CR-0044 E2) on a fake converter process. */
class ConversionHubTest {

  private static final String PLUGIN = "fmv";

  @TempDir Path folder;

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final Probe<ConversionEvent> events = new Probe<>();
  private final WorkerHandle<ConversionEvent> worker = runtime.owner("core-test").spawn(
      WorkerOptions.<ConversionEvent>of("conversion-events", () -> (event, ctx) -> events.add(event)));
  private final StreamHub streams = new StreamHub(runtime, StreamLimits.DEFAULT);
  private final AtomicLong nanos = new AtomicLong(1_000_000_000L);
  private final AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-11-15T12:00:00Z"));
  private final Clock clock = new Clock() {
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
      return now.get();
    }
  };
  private final List<FakeProcess> processes = new CopyOnWriteArrayList<>();
  private final List<List<String>> commands = new CopyOnWriteArrayList<>();
  private final List<Path> folders = new CopyOnWriteArrayList<>();
  private ConversionHub hub;

  @AfterEach
  void close() {
    if (hub != null) {
      hub.close();
    }
    streams.close();
    runtime.close();
  }

  private ConversionHub hub(int max, boolean converter) throws IOException {
    return hub(max, converter, null);
  }

  /** @param checker the start check's commands, or {@code null} for none */
  private ConversionHub hub(int max, boolean converter, ConverterCheck.@org.jspecify.annotations.Nullable Runner checker)
      throws IOException {
    Path ffmpeg = folder.resolve("ffmpeg.exe");
    if (converter) {
      Files.writeString(ffmpeg, "a converter");
    }
    hub = new ConversionHub(runtime, new ConversionLimits(max, 64 * 1024, ffmpeg, ConversionLimits.DEFAULT_MAX_PIXELS), (command, own) -> {
      commands.add(command);
      folders.add(own);
      FakeProcess p = new FakeProcess();
      processes.add(p);
      return p;
    }, checker, clock, nanos::get, false);
    return hub;
  }

  private StreamRef stream(String name) {
    return streams.member(PLUGIN).open(new StreamSpec(name, "video/mp2t", "plugin.fmv.view", SecurityLabel.of("NATO", "UNCLASSIFIED")));
  }

  private ConversionRef start(StreamRef target) {
    return hub.member(PLUGIN).start(ConversionSpec.mpeg2ToH264(target), worker, e -> e);
  }

  private <E extends ConversionEvent> E next(Class<E> type) {
    ConversionEvent e = events.next();
    assertThat(e).isInstanceOf(type);
    return type.cast(e);
  }

  @Test
  void runsTheConverterWithFixedArgumentsAndPipesOnly() throws Exception {
    hub(2, true);
    start(stream("cam"));
    next(ConversionEvent.Running.class);
    waitFor(() -> !commands.isEmpty());
    List<String> command = commands.getFirst();
    assertThat(command).contains("-i", "pipe:0", "pipe:1", "h264_mf", "-copyts", "-an", "4000000", "expr:gte(t,n_forced*1.0)",
            "-max_interleave_delta", "-probesize")
        .containsSequence("-max_alloc", "67108864").containsSequence("-max_streams", "16")
        .doesNotContain("-y").noneMatch(a -> a.contains("http") || a.contains("file:"));
    assertThat(command.indexOf("-max_pixels")).as("an input option, before -i").isPositive().isLessThan(command.indexOf("-i"));
    assertThat(command.indexOf("-max_streams")).as("an input option, before -i").isPositive().isLessThan(command.indexOf("-i"));
    assertThat(command.indexOf("-max_alloc")).as("a global option, before -i").isPositive().isLessThan(command.indexOf("-i"));
    assertThat(command.get(command.indexOf("-max_pixels") + 1)).isEqualTo("8294400");
    assertThat(command.stream().filter(a -> a.endsWith("ffmpeg.exe"))).singleElement().satisfies(a -> assertThat(Path.of(a)).isAbsolute());
  }

  @Test
  void refusesAPictureLimitOutsideItsRange() {
    Path ffmpeg = folder.resolve("ffmpeg.exe");
    org.assertj.core.api.Assertions.assertThatIllegalArgumentException()
        .isThrownBy(() -> new ConversionLimits(2, 64 * 1024, ffmpeg, 640L * 480 - 1)).withMessageContaining("max-pixels");
    org.assertj.core.api.Assertions.assertThatIllegalArgumentException()
        .isThrownBy(() -> new ConversionLimits(2, 64 * 1024, ffmpeg, 35_000_001L)).withMessageContaining("max-pixels");
    assertThat(ConversionLimits.DEFAULT.maxPixels()).isEqualTo(3840L * 2160);
  }

  @Test
  void givesEachProcessAnEmptyFolderOfItsOwnAndRemovesItWhenItEnds() throws Exception {
    hub(2, true);
    ConversionRef c = start(stream("cam"));
    next(ConversionEvent.Running.class);
    waitFor(() -> folders.size() == 1);
    Path own = folders.getFirst();
    assertThat(own).isEmptyDirectory();
    assertThat(own.getFileName().toString()).startsWith("emcc-conversion-");

    c.stop();
    processes.getFirst().exit(0);
    next(ConversionEvent.Stopped.class);
    assertThat(own).doesNotExist();
  }

  @Test
  void removesTheFolderOfALaunchThatFailsAndRefusesARestartTimeOutsideItsRange() throws Exception {
    List<Path> made = new CopyOnWriteArrayList<>();
    Path ffmpeg = folder.resolve("ffmpeg.exe");
    Files.writeString(ffmpeg, "a converter");
    hub = new ConversionHub(runtime, new ConversionLimits(2, 64 * 1024, ffmpeg, ConversionLimits.DEFAULT_MAX_PIXELS), (command, own) -> {
      made.add(own);
      throw new IOException("access denied");
    }, null, clock, nanos::get, false);
    start(stream("cam"));
    next(ConversionEvent.Running.class); // it had its slot; the launch then failed
    ConversionEvent.Failed failed = next(ConversionEvent.Failed.class);
    assertThat(failed.failure()).isEqualTo(Failure.UNAVAILABLE);
    assertThat(failed.detail()).contains("did not start").contains("access denied");
    assertThat(made).singleElement().satisfies(own -> assertThat(own).doesNotExist());

    assertThatThrownBy(() -> new ConversionLimits(2, 64 * 1024, ffmpeg, ConversionLimits.DEFAULT_MAX_PIXELS, 0))
        .hasMessageContaining("restart-seconds");
    assertThatThrownBy(() -> new ConversionLimits(2, 64 * 1024, ffmpeg, ConversionLimits.DEFAULT_MAX_PIXELS, 601))
        .hasMessageContaining("restart-seconds");
  }

  @Test
  void letsAStartForTheSameStreamWaitUntilItsRestartTimeIsOver() throws Exception {
    hub(2, true);
    StreamRef cam = stream("cam");
    ConversionRef first = start(cam);
    next(ConversionEvent.Running.class);
    first.stop();
    waitFor(() -> processes.size() == 1);
    processes.getFirst().exit(0);
    next(ConversionEvent.Stopped.class);

    nanos.addAndGet(TimeUnit.SECONDS.toNanos(ConversionLimits.DEFAULT_RESTART_SECONDS - 1));
    start(cam);
    assertThat(next(ConversionEvent.Waiting.class).stream()).as("a free slot, but within 10 s of the last launch").isEqualTo("cam");
    ConversionRef other = start(stream("other"));
    assertThat(next(ConversionEvent.Running.class).stream()).as("not held up by the waiting one").isEqualTo("other");
    hub.checkTimers();
    assertThat(events.drain()).as("still too soon").isEmpty();

    nanos.addAndGet(TimeUnit.SECONDS.toNanos(1));
    hub.checkTimers();
    assertThat(next(ConversionEvent.Running.class).stream()).isEqualTo("cam");
    assertThat(processes).hasSize(3);
    other.stop();
  }

  @Test
  void aConverterThatLacksAPartMakesEveryStartUnavailableWithTheReason() throws Exception {
    List<List<String>> asked = new CopyOnWriteArrayList<>();
    hub(2, true, command -> {
      asked.add(command);
      return switch (command.getLast()) {
        case "-version" -> "ffmpeg version 9.0.2 Copyright (c) 2000-2026 the FFmpeg developers";
        case "-encoders" -> "Encoders:\n ------\n V....D libx264    H.264";
        case "-decoders" -> "Decoders:\n ------\n V.S.BD mpeg2video  MPEG-2 video";
        default -> "Formats:\n ---\n DE  mpegts   MPEG-TS";
      };
    });
    assertThat(asked).extracting(List::getLast).containsExactly("-version", "-encoders", "-decoders", "-formats", "-bsfs");

    start(stream("cam"));
    ConversionEvent.Failed failed = next(ConversionEvent.Failed.class);
    assertThat(failed.failure()).isEqualTo(Failure.UNAVAILABLE);
    assertThat(failed.detail()).contains("h264_mf").doesNotContain("mpeg2video").doesNotContain("mpegts");
    assertThat(processes).as("no converter launched").isEmpty();
  }

  @Test
  void aConverterWithEveryPartRunsAsBefore() throws Exception {
    hub(2, true, command -> switch (command.getLast()) {
      case "-version" -> "ffmpeg version 9.0.2";
      case "-encoders" -> " ------\n V....D h264_mf  H264 via MediaFoundation";
      case "-decoders" -> " ------\n V.S.BD mpeg2video  MPEG-2 video";
      default -> " ---\n D   mpegts  MPEG-TS\n  E  mpegts  MPEG-TS";
    });
    start(stream("cam"));
    next(ConversionEvent.Running.class);
  }

  @Test
  void takesTheFreeSlotsAndLetsTheRestWaitInOrderDroppingTheirInput() throws Exception {
    hub(1, true);
    ConversionRef a = start(stream("a"));
    assertThat(next(ConversionEvent.Running.class).stream()).isEqualTo("a");
    ConversionRef b = start(stream("b"));
    assertThat(next(ConversionEvent.Waiting.class).stream()).isEqualTo("b");
    assertThat(b.write(Bytes.of(new byte[] {1}))).isEqualTo(SendResult.DROPPED);

    a.stop();
    waitFor(() -> processes.size() == 1);
    processes.getFirst().exit(0); // ffmpeg ends once its input closes
    assertThat(next(ConversionEvent.Stopped.class).reason()).isEqualTo("stopped");
    assertThat(next(ConversionEvent.Running.class).stream()).as("b takes the freed slot").isEqualTo("b");
    assertThat(hub.stats(PLUGIN)).extracting(ConversionHub.ConversionStatus::stream, ConversionHub.ConversionStatus::state)
        .contains(org.assertj.core.groups.Tuple.tuple("b", "RUNNING"), org.assertj.core.groups.Tuple.tuple("a", "STOPPED"));
    assertThat(hub.stats(PLUGIN)).filteredOn(s -> s.stream().equals("b")).singleElement()
        .satisfies(s -> assertThat(s.dropped()).isEqualTo(1));
  }

  @Test
  void withoutAConverterFailsAsUnavailableAndMayBeStartedAgainAfterAMinute() throws Exception {
    hub(2, false);
    StreamRef cam = stream("cam");
    ConversionRef c = start(cam);

    ConversionEvent.Failed failed = next(ConversionEvent.Failed.class);
    assertThat(failed.failure()).isEqualTo(Failure.UNAVAILABLE);
    assertThat(failed.detail()).contains("ffmpeg.exe");
    assertThat(c.write(Bytes.of(new byte[] {1}))).isEqualTo(SendResult.CLOSED);
    assertThat(cam.write(Bytes.of(new byte[] {1}), true)).as("the plugin may write its stream itself").isEqualTo(SendResult.ACCEPTED);
    assertThatThrownBy(() -> start(cam)).isInstanceOf(IllegalStateException.class).hasMessageContaining("60 s");

    now.set(now.get().plus(Conversions.RETRY_AFTER).plusSeconds(1));
    start(cam);
    assertThat(next(ConversionEvent.Failed.class).failure()).isEqualTo(Failure.UNAVAILABLE);
  }

  @Test
  void refusesASecondConversionIntoTheSameStreamAndAnotherPluginsStream() throws Exception {
    hub(2, true);
    StreamRef cam = stream("cam");
    start(cam);
    next(ConversionEvent.Running.class);
    assertThatThrownBy(() -> start(cam)).isInstanceOf(IllegalStateException.class).hasMessageContaining("already");
    StreamRef other = streams.member("gmti").open(new StreamSpec("x", "video/mp2t", "plugin.gmti.view", SecurityLabel.of("NATO", "UNCLASSIFIED")));
    assertThatThrownBy(() -> start(other)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void feedsItsInputToTheProcessAndItsOutputWithHeaderAndStartPointsIntoTheStream() throws Exception {
    hub(2, true);
    StreamRef cam = stream("cam");
    ConversionRef c = start(cam);
    next(ConversionEvent.Running.class);
    waitFor(() -> processes.size() == 1);
    FakeProcess p = processes.getFirst();

    assertThat(c.write(Bytes.utf8("mpeg-2 in"))).isEqualTo(SendResult.ACCEPTED);
    waitFor(() -> p.stdin().equals("mpeg-2 in"));
    assertThat(cam.write(Bytes.of(new byte[] {1}), true)).as("the plugin's own writes while it converts").isEqualTo(SendResult.DROPPED);

    p.output(TsOutputTest.join(TsOutputTest.pat(0), TsOutputTest.pmt(0),
        TsOutputTest.packet(TsOutputTest.VIDEO_PID, true, true, 0, new byte[0]),
        TsOutputTest.packet(TsOutputTest.VIDEO_PID, false, false, 1, new byte[0]),
        TsOutputTest.packet(TsOutputTest.VIDEO_PID, false, false, 2, new byte[0])));
    StreamHub.StreamStatus status = waitForStream("cam", s -> s.bytesIn() >= 4 * 188);
    assertThat(status.startBufferBytes()).as("the buffer from the start point on").isEqualTo(2 * 188);
    assertThat(hub.stats(PLUGIN)).singleElement().satisfies(s -> {
      assertThat(s.bytesIn()).isEqualTo(9);
      assertThat(s.bytesOut()).isEqualTo(5 * 188);
    });
  }

  @Test
  void failsWithoutOutputAfterItsFirstInputAndWhenItsOutputStalls() throws Exception {
    hub(2, true);
    ConversionRef first = start(stream("a"));
    next(ConversionEvent.Running.class);
    first.write(Bytes.of(new byte[] {1}));
    nanos.addAndGet(Conversions.START_TIMEOUT.toNanos() + 1);
    hub.checkTimers();
    ConversionEvent.Failed failed = next(ConversionEvent.Failed.class);
    assertThat(failed.failure()).isEqualTo(Failure.START);
    assertThat(processes.getFirst().killed()).isTrue();

    ConversionRef second = start(stream("b"));
    next(ConversionEvent.Running.class);
    waitFor(() -> processes.size() == 2);
    second.write(Bytes.of(new byte[] {1}));
    processes.get(1).output(TsOutputTest.join(TsOutputTest.pat(0), TsOutputTest.pmt(0)));
    waitFor(() -> hub.stats(PLUGIN).stream().anyMatch(s -> s.stream().equals("b") && s.bytesOut() > 0));
    nanos.addAndGet(1_000);
    second.write(Bytes.of(new byte[] {2})); // input after the last output
    nanos.addAndGet(Conversions.STALL_TIMEOUT.toNanos() + 1);
    hub.checkTimers();
    assertThat(next(ConversionEvent.Failed.class).failure()).isEqualTo(Failure.STALLED);
  }

  @Test
  void reportsAProcessThatEndsByItselfWithItsExitCodeAndItsLastErrorsAsPlainText() throws Exception {
    hub(2, true);
    start(stream("cam"));
    next(ConversionEvent.Running.class);
    waitFor(() -> processes.size() == 1);
    FakeProcess p = processes.getFirst();
    p.error("Invalid data\u001b[31m found\nwhen processing input");
    Thread.sleep(100);
    p.exit(1);

    ConversionEvent.Failed failed = next(ConversionEvent.Failed.class);
    assertThat(failed.failure()).isEqualTo(Failure.EXITED);
    assertThat(failed.detail()).isEqualTo("exit code 1; Invalid data?[31m found when processing input");
  }

  @Test
  void stopsByClosingTheInputAndKillsAProcessThatLingersPastTheGrace() throws Exception {
    hub(2, true);
    ConversionRef c = start(stream("cam"));
    next(ConversionEvent.Running.class);
    waitFor(() -> processes.size() == 1);
    FakeProcess p = processes.getFirst();

    c.stop();
    waitFor(p::stdinClosed);
    assertThat(p.killed()).as("not before the grace").isFalse();
    ConversionEvent.Stopped stopped = next(ConversionEvent.Stopped.class); // the scheduled kill after STOP_GRACE ends it
    assertThat(stopped.reason()).isEqualTo("stopped");
    assertThat(p.killed()).isTrue();
    assertThat(c.write(Bytes.of(new byte[] {1}))).isEqualTo(SendResult.CLOSED);
    c.stop(); // again: no effect
  }

  @Test
  void stopsWhenItsStreamClosesOrItsPluginStops() throws Exception {
    hub(2, true);
    StreamRef a = stream("a");
    start(a);
    next(ConversionEvent.Running.class);
    start(stream("b"));
    next(ConversionEvent.Running.class);
    waitFor(() -> processes.size() == 2);

    a.close();
    processes.getFirst().exit(0);
    assertThat(next(ConversionEvent.Stopped.class).reason()).isEqualTo("stream closed");

    hub.release(hub.member(PLUGIN));
    processes.get(1).exit(0);
    assertThat(next(ConversionEvent.Stopped.class).reason()).isEqualTo("plugin stopped");
  }

  @Test
  void dropsInputPastItsQueue() throws Exception {
    hub(2, true);
    ConversionRef c = start(stream("cam"));
    next(ConversionEvent.Running.class);
    waitFor(() -> processes.size() == 1);
    processes.getFirst().blockInput(); // a converter that does not read

    int accepted = 0;
    int dropped = 0;
    for (int i = 0; i < 40; i++) {
      SendResult r = c.write(Bytes.of(new byte[4096]));
      if (r == SendResult.ACCEPTED) {
        accepted++;
      } else if (r == SendResult.DROPPED) {
        dropped++;
      }
    }
    assertThat(dropped).as("past 64 KiB waiting").isPositive();
    assertThat(accepted * 4096).isLessThanOrEqualTo(64 * 1024 + 4096 * 2);
  }

  /** M9 C5: the start check on a real ffmpeg (EMC2_TEST_FFMPEG) finds every part and its version. */
  @Test
  void checksARealFfmpegAtStart() {
    String ffmpeg = System.getenv("EMC2_TEST_FFMPEG");
    org.junit.jupiter.api.Assumptions.assumeTrue(ffmpeg != null, "EMC2_TEST_FFMPEG not set");
    ConverterCheck.Result r = ConverterCheck.check(Path.of(ffmpeg), ConverterCheck::run);
    assertThat(r.problem()).isNull();
    assertThat(r.encoderProblem()).as("SDK 1.9.0: the B4 build has the encoder's parts").isNull();
    assertThat(r.version()).startsWith("ffmpeg version");
    ConverterCheck.Result wrong = ConverterCheck.check(Path.of(System.getProperty("java.home"), "bin",
        ConversionLimits.windows() ? "java.exe" : "java"), ConverterCheck::run);
    assertThat(wrong.problem()).as("a program that is no ffmpeg").contains("did not answer");
  }

  /** With a real ffmpeg (EMC2_TEST_FFMPEG) and an MPEG-2 sample (EMC2_TEST_FFMPEG_INPUT): H.264 with start points comes out. */
  @Test
  void convertsWithARealFfmpegWhenOneIsGiven() throws Exception {
    String ffmpeg = System.getenv("EMC2_TEST_FFMPEG");
    String input = System.getenv("EMC2_TEST_FFMPEG_INPUT");
    org.junit.jupiter.api.Assumptions.assumeTrue(ffmpeg != null && input != null, "EMC2_TEST_FFMPEG and EMC2_TEST_FFMPEG_INPUT not set");
    hub = new ConversionHub(runtime, new ConversionLimits(2, 2L * 1024 * 1024, Path.of(ffmpeg), ConversionLimits.DEFAULT_MAX_PIXELS));
    StreamRef cam = stream("cam");
    ConversionRef c = hub.member(PLUGIN).start(ConversionSpec.mpeg2ToH264(cam), worker, e -> e);
    next(ConversionEvent.Running.class);
    byte[] sample = Files.readAllBytes(Path.of(input));
    for (int at = 0; at < Math.min(sample.length, 8 * 1024 * 1024); at += 188 * 7) {
      while (c.write(Bytes.of(java.util.Arrays.copyOfRange(sample, at, Math.min(sample.length, at + 188 * 7)))) == SendResult.DROPPED) {
        Thread.sleep(5);
      }
    }
    StreamHub.StreamStatus status = waitForStream("cam", s -> s.startBufferBytes() > 0 && s.bytesIn() > 100_000);
    assertThat(status.bytesIn()).isPositive();
    c.stop();
    assertThat(next(ConversionEvent.Stopped.class).reason()).isEqualTo("stopped");
  }

  /**
   * SRA, M8: the same sample with its MPEG-2 sequence headers claiming 4080 x 4080, over the 3840 x 2160 limit. Without
   * the limit it took 4 GB and gave output; with it the decoder refuses every picture, so a live input (its pipe kept
   * open) gives no output and the start timer ends it (ffmpeg itself exits, code 69, only at the input's end). No
   * converter process stays.
   */
  @Test
  void failsAPictureOverTheLimitAndLeavesNoConverterRunning() throws Exception {
    String ffmpeg = System.getenv("EMC2_TEST_FFMPEG");
    String input = System.getenv("EMC2_TEST_FFMPEG_INPUT");
    org.junit.jupiter.api.Assumptions.assumeTrue(ffmpeg != null && input != null, "EMC2_TEST_FFMPEG and EMC2_TEST_FFMPEG_INPUT not set");
    byte[] sample = Files.readAllBytes(Path.of(input));
    assertThat(sample[0]).as("a 188-byte transport stream from its first byte").isEqualTo((byte) 0x47);
    int patched = 0;
    for (int i = 0; i + 7 <= sample.length; i++) { // sequence_header_code, then 12 bits width and 12 bits height
      if (sample[i] == 0 && sample[i + 1] == 0 && sample[i + 2] == 1 && sample[i + 3] == (byte) 0xb3 && i % 188 + 7 <= 188) {
        sample[i + 4] = (byte) 0xff; // 4080 = 0xff0
        sample[i + 5] = (byte) 0x0f;
        sample[i + 6] = (byte) 0xf0;
        patched++;
      }
    }
    assertThat(patched).as("sequence headers in the sample").isPositive();
    List<Process> started = new CopyOnWriteArrayList<>();
    hub = new ConversionHub(runtime, new ConversionLimits(2, 2L * 1024 * 1024, Path.of(ffmpeg), ConversionLimits.DEFAULT_MAX_PIXELS),
        (command, own) -> {
          Process p = ConversionHub.launch(command, own);
          started.add(p);
          return p;
        }, null, java.time.Clock.systemUTC(), System::nanoTime, true);
    ConversionRef c = hub.member(PLUGIN).start(ConversionSpec.mpeg2ToH264(stream("cam")), worker, e -> e);
    next(ConversionEvent.Running.class);
    Thread feeder = Thread.ofPlatform().daemon().start(() -> { // the test's own feeder; ECore's code makes none
      for (int at = 0; at < Math.min(sample.length, 8 * 1024 * 1024) && !Thread.currentThread().isInterrupted(); at += 188 * 7) {
        while (c.write(Bytes.of(java.util.Arrays.copyOfRange(sample, at, Math.min(sample.length, at + 188 * 7)))) == SendResult.DROPPED) {
          try {
            Thread.sleep(5);
          } catch (InterruptedException e) {
            return;
          }
        }
      }
    });
    List<ConversionEvent> seen = new ArrayList<>();
    waitFor(() -> {
      seen.addAll(events.drain());
      return seen.stream().anyMatch(ConversionEvent.Failed.class::isInstance); // START_TIMEOUT and the once-a-second timer
    });
    feeder.interrupt();
    feeder.join(1000);
    assertThat(seen).singleElement().isInstanceOfSatisfying(ConversionEvent.Failed.class,
        f -> assertThat(f.failure()).isEqualTo(Failure.START));
    assertThat(streams.stats().stream().filter(x -> x.name().equals("cam")).findFirst().orElseThrow().bytesIn())
        .as("nothing reached the stream").isZero();
    assertThat(started).as("one converter").hasSize(1);
    waitFor(() -> !started.getFirst().isAlive());
  }

  private StreamHub.StreamStatus waitForStream(String name, java.util.function.Predicate<StreamHub.StreamStatus> done) throws InterruptedException {
    long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
    while (true) {
      StreamHub.StreamStatus s = streams.stats().stream().filter(x -> x.name().equals(name)).findFirst().orElseThrow();
      if (done.test(s) || System.nanoTime() > until) {
        assertThat(done.test(s)).as("stream %s: %s", name, s).isTrue();
        return s;
      }
      Thread.sleep(10);
    }
  }

  private static void waitFor(java.util.function.BooleanSupplier condition) throws InterruptedException {
    long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
    while (!condition.getAsBoolean()) {
      assertThat(System.nanoTime()).as("within 30 s").isLessThan(until);
      Thread.sleep(5);
    }
  }

  /** A converter process in memory: its input recorded, its output and errors given by the test, its exit or kill. */
  static final class FakeProcess extends Process {
    private static final byte[] END = new byte[0];
    private final ByteArrayOutputStream in = new ByteArrayOutputStream();
    private volatile boolean inClosed;
    private final CountDownLatch inputOpen = new CountDownLatch(0);
    private volatile CountDownLatch blocked = new CountDownLatch(0);
    private final LinkedBlockingQueue<byte[]> out = new LinkedBlockingQueue<>();
    private final LinkedBlockingQueue<byte[]> err = new LinkedBlockingQueue<>();
    private final CountDownLatch exited = new CountDownLatch(1);
    private volatile int code;
    private volatile boolean killed;

    String stdin() {
      synchronized (in) {
        return in.toString(java.nio.charset.StandardCharsets.UTF_8);
      }
    }

    boolean stdinClosed() {
      return inClosed;
    }

    boolean killed() {
      return killed;
    }

    void blockInput() {
      blocked = new CountDownLatch(1);
    }

    void output(byte[] bytes) {
      out.add(bytes);
    }

    void error(String text) {
      err.add(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    void exit(int exitCode) {
      code = exitCode;
      end();
    }

    private void end() {
      out.add(END);
      err.add(END);
      exited.countDown();
    }

    @Override
    public OutputStream getOutputStream() {
      return new OutputStream() {
        @Override
        public void write(int b) throws IOException {
          write(new byte[] {(byte) b}, 0, 1);
        }

        @Override
        public void write(byte[] b, int off, int len) throws IOException {
          try {
            blocked.await();
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          }
          if (inClosed || exited.getCount() == 0) {
            throw new IOException("closed");
          }
          synchronized (in) {
            in.write(b, off, len);
          }
        }

        @Override
        public void close() {
          inClosed = true;
        }
      };
    }

    @Override
    public InputStream getInputStream() {
      return queueStream(out);
    }

    @Override
    public InputStream getErrorStream() {
      return queueStream(err);
    }

    private static InputStream queueStream(LinkedBlockingQueue<byte[]> queue) {
      return new InputStream() {
        private byte[] current = new byte[0];
        private int at;
        private boolean ended;

        @Override
        public int read() throws IOException {
          byte[] one = new byte[1];
          return read(one, 0, 1) < 0 ? -1 : one[0] & 0xff;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
          while (!ended && at == current.length) {
            try {
              current = queue.take();
            } catch (InterruptedException e) {
              Thread.currentThread().interrupt();
              throw new IOException(e);
            }
            at = 0;
            if (current == END) {
              ended = true;
            }
          }
          if (ended) {
            return -1;
          }
          int n = Math.min(len, current.length - at);
          System.arraycopy(current, at, b, off, n);
          at += n;
          return n;
        }
      };
    }

    @Override
    public int waitFor() throws InterruptedException {
      exited.await();
      return code;
    }

    @Override
    public boolean waitFor(long timeout, TimeUnit unit) throws InterruptedException {
      return exited.await(timeout, unit);
    }

    @Override
    public int exitValue() {
      if (exited.getCount() > 0) {
        throw new IllegalThreadStateException("running");
      }
      return code;
    }

    @Override
    public boolean isAlive() {
      return exited.getCount() > 0;
    }

    @Override
    public void destroy() {
      destroyForcibly();
    }

    @Override
    public Process destroyForcibly() {
      if (exited.getCount() > 0) {
        killed = true;
        code = 137;
        blocked.countDown();
        end();
      }
      return this;
    }

    @Override
    public long pid() {
      return 4242;
    }

    @Override
    public ProcessHandle toHandle() {
      throw new UnsupportedOperationException("a fake process");
    }

    Duration unused() {
      return Duration.ZERO;
    }
  }
}
