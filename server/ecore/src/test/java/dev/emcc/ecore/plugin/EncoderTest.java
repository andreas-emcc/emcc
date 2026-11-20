package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.compute.ComputeContext;
import dev.emcc.sdk.compute.ComputeRef;
import dev.emcc.sdk.compute.ComputeSpec;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.stream.ConversionEvent;
import dev.emcc.sdk.stream.EncodedPicture;
import dev.emcc.sdk.stream.EncoderRef;
import dev.emcc.sdk.stream.EncoderSpec;
import dev.emcc.sdk.stream.RawPicture;
import dev.emcc.sdk.worker.SendResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * SDK 1.9.0 (CR-0050 point 1, ADR-0059 point 7; M9 C10): the encoder, raw I420 pictures in and H.264 access units back
 * into the plugin's compute task, on a fake ffmpeg process (live once the MCA's B4 build has the parts).
 */
class EncoderTest {

  private static final String PLUGIN = "fmv";
  private static final EncoderSpec SPEC = EncoderSpec.of("camera-1", 160, 120, 25);

  record Picture(EncodedPicture picture) implements Message {}

  record TaskEvent(dev.emcc.sdk.compute.ComputeEvent event) implements Message {}

  @TempDir Path folder;

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final LinkedBlockingQueue<ConversionEvent> events = new LinkedBlockingQueue<>();
  private final WorkerHandle<ConversionEvent> worker = runtime.owner("core-test").spawn(
      WorkerOptions.<ConversionEvent>of("encoder-events", () -> (event, ctx) -> events.add(event)));
  private final LinkedBlockingQueue<EncodedPicture> pictures = new LinkedBlockingQueue<>();
  private final List<ConversionHubTest.FakeProcess> processes = new CopyOnWriteArrayList<>();
  private final List<List<String>> commands = new CopyOnWriteArrayList<>();
  private final AtomicLong nanos = new AtomicLong(1_000_000_000L);
  private ConversionHub hub;
  private int spawned;

  @AfterEach
  void close() {
    if (hub != null) {
      hub.close();
    }
    runtime.close();
  }

  private ConversionHub hub(int max) throws Exception {
    Path ffmpeg = folder.resolve("ffmpeg.exe");
    Files.writeString(ffmpeg, "a converter");
    hub = new ConversionHub(runtime, new ConversionLimits(max, 64 * 1024, ffmpeg, ConversionLimits.DEFAULT_MAX_PIXELS), (command, own) -> {
      commands.add(command);
      ConversionHubTest.FakeProcess p = new ConversionHubTest.FakeProcess();
      processes.add(p);
      return p;
    }, null, Clock.systemUTC(), nanos::get, false);
    return hub;
  }

  /** A compute task of {@code plugin} that hands each encoded picture to the test. */
  private ComputeRef<Picture> task(String plugin) {
    PluginComputes computes = new PluginComputes(plugin, 1, "encodes.", 1, new ComputeHub(2), runtime, getClass().getClassLoader(),
        Clock.systemUTC(), new PluginLocalFolders(plugin, List.of(), JsonObject::empty, runtime, runtime.ioExecutor()),
        new TaskEngine.Watch() {
          @Override
          public void notEnding(String name) {}

          @Override
          public void ended(String name) {}
        }, Duration.ofMillis(300), runtime::startTaskThread);
    PluginWorkers w = new PluginWorkers(plugin, runtime.owner(plugin), getClass().getClassLoader());
    var events = w.spawn(dev.emcc.sdk.worker.WorkerSpec.of("task-events-" + ++spawned, Message.class, () -> (m, ctx) -> { }));
    return computes.start(ComputeSpec.of("mux", Picture.class), () -> (ComputeContext<Picture> c) -> {
      for (Picture p; (p = c.take()) != null; ) {
        pictures.add(p.picture());
      }
    }, events, TaskEvent::new);
  }

  private ConversionEvent nextEvent() throws InterruptedException {
    ConversionEvent e = events.poll(10, TimeUnit.SECONDS);
    assertThat(e).as("within 10 s").isNotNull();
    return e;
  }

  private EncodedPicture nextPicture() throws InterruptedException {
    EncodedPicture p = pictures.poll(10, TimeUnit.SECONDS);
    assertThat(p).as("within 10 s").isNotNull();
    return p;
  }

  private static RawPicture picture(Instant time) {
    byte[] data = new byte[SPEC.pictureBytes()];
    Arrays.fill(data, (byte) 'A');
    return new RawPicture(time, Bytes.of(data));
  }

  private static void waitFor(BooleanSupplier condition) throws InterruptedException {
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (!condition.getAsBoolean()) {
      assertThat(System.nanoTime()).as("within 10 s").isLessThan(end);
      Thread.sleep(5);
    }
  }

  @Test
  void runsFfmpegOnRawI420PicturesWithH264OutTaggedBt709LimitedRange() throws Exception {
    hub(2).member(PLUGIN).encode(SPEC.bitrate(6_000_000).keyframeSeconds(2), task(PLUGIN), Picture::new, worker, e -> e);
    assertThat(nextEvent()).isInstanceOf(ConversionEvent.Running.class).extracting(ConversionEvent::stream).isEqualTo("camera-1");
    waitFor(() -> commands.size() == 1);
    assertThat(commands.getFirst().subList(1, commands.getFirst().size())).containsExactly("-hide_banner", "-loglevel", "error",
        "-max_alloc", "67108864", "-threads", "1",
        "-f", "rawvideo", "-pix_fmt", "yuv420p", "-video_size", "160x120", "-framerate", "25",
        "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-i", "pipe:0",
        "-an", "-fps_mode", "passthrough", "-c:v", "h264_mf", "-b:v", "6000000", "-force_key_frames", "expr:gte(t,n_forced*2.0)", "-bf", "0", "-threads", "1",
        "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-bsf:v", "h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1",
        "-flush_packets", "1", "-f", "h264", "pipe:1");
  }

  @Test
  void writesPicturesInAndHandsEachAccessUnitWithItsPicturesTimeToTheTask() throws Exception {
    EncoderRef encoder = hub(2).member(PLUGIN).encode(SPEC, task(PLUGIN), Picture::new, worker, e -> e);
    nextEvent();
    waitFor(() -> processes.size() == 1);
    ConversionHubTest.FakeProcess p = processes.getFirst();
    Instant t0 = Instant.parse("2026-11-17T12:00:00Z");
    Instant t1 = t0.plusMillis(40);
    Instant t2 = t0.plusMillis(80);

    assertThat(encoder.write(picture(t0))).isEqualTo(SendResult.ACCEPTED);
    waitFor(() -> p.stdin().length() == SPEC.pictureBytes());
    assertThat(encoder.write(picture(t1))).isEqualTo(SendResult.ACCEPTED);
    assertThat(encoder.write(picture(t2))).isEqualTo(SendResult.ACCEPTED);
    waitFor(() -> p.stdin().length() == 3 * SPEC.pictureBytes());
    assertThatThrownBy(() -> encoder.write(new RawPicture(t0, Bytes.of(new byte[10])))).isInstanceOf(IllegalArgumentException.class)
        .hasMessage("a picture is 160x120 I420: 28800 bytes, not 10");

    p.output(AccessUnitsTest.join(AccessUnitsTest.AUD4, AccessUnitsTest.SPS, AccessUnitsTest.IDR, AccessUnitsTest.AUD4,
        AccessUnitsTest.SLICE));
    EncodedPicture first = nextPicture();
    assertThat(List.of(first.sequence(), first.time(), first.keyframe())).containsExactly(0L, t0, true);
    assertThat(HexFormat.of().formatHex(first.accessUnit().toArray()))
        .isEqualTo(HexFormat.of().formatHex(AccessUnitsTest.join(AccessUnitsTest.AUD4, AccessUnitsTest.SPS, AccessUnitsTest.IDR)));
    assertThat(pictures.poll(200, TimeUnit.MILLISECONDS)).as("the second waits for the next delimiter").isNull();

    p.output(AccessUnitsTest.AUD3);
    EncodedPicture second = nextPicture();
    assertThat(List.of(second.sequence(), second.time(), second.keyframe())).containsExactly(1L, t1, false);
    p.exit(0); // the end hands on the last unit
    EncodedPicture third = nextPicture();
    assertThat(List.of(third.sequence(), third.time())).containsExactly(2L, t2);
    assertThat(nextEvent()).isInstanceOf(ConversionEvent.Failed.class);
    assertThat(encoder.write(picture(t2))).isEqualTo(SendResult.CLOSED);

    assertThat(hub.stats(PLUGIN)).singleElement().satisfies(s -> {
      assertThat(List.of(s.stream(), s.kind())).containsExactly("camera-1", "encoder");
      assertThat(s.bytesIn()).isEqualTo(3L * SPEC.pictureBytes());
      assertThat(s.lostOutputs()).isZero();
    });
  }

  @Test
  void dropsAPictureWhileTwoWaitAndWhileItWaitsForASlot() throws Exception {
    hub(1);
    EncoderRef first = hub.member(PLUGIN).encode(SPEC, task(PLUGIN), Picture::new, worker, e -> e);
    nextEvent();
    waitFor(() -> processes.size() == 1);
    EncoderRef second = hub.member(PLUGIN).encode(EncoderSpec.of("camera-2", 160, 120, 25), task(PLUGIN), Picture::new, worker, e -> e);
    assertThat(nextEvent()).as("one slot, shared").isInstanceOf(ConversionEvent.Waiting.class);
    assertThat(second.write(picture(Instant.now()))).isEqualTo(SendResult.DROPPED);

    processes.getFirst().blockInput(); // the process takes nothing: the first picture is being written, the next waits
    assertThat(first.write(picture(Instant.now()))).isEqualTo(SendResult.ACCEPTED);
    assertThat(first.write(picture(Instant.now()))).isEqualTo(SendResult.ACCEPTED);
    assertThat(first.write(picture(Instant.now()))).as("2 wait already: a late frame is dropped").isEqualTo(SendResult.DROPPED);
    assertThat(hub.stats(PLUGIN)).filteredOn(s -> s.stream().equals("camera-1")).singleElement()
        .satisfies(s -> assertThat(s.dropped()).isEqualTo(1));
  }

  /** The MCA's B4: a converter without the encoder's parts fails encoders as unavailable, and nothing is launched. */
  @Test
  void aConverterWithoutTheEncodersPartsFailsItAsUnavailable() throws Exception {
    Path ffmpeg = folder.resolve("ffmpeg.exe");
    Files.writeString(ffmpeg, "a converter");
    hub = new ConversionHub(runtime, new ConversionLimits(2, 64 * 1024, ffmpeg, ConversionLimits.DEFAULT_MAX_PIXELS), (command, own) -> {
      commands.add(command);
      return new ConversionHubTest.FakeProcess();
    }, command -> switch (command.getLast()) { // M8's parts only
      case "-version" -> "ffmpeg version 9.0.2";
      case "-encoders" -> " ------\n V....D h264_mf  H264 via MediaFoundation";
      case "-decoders" -> " ------\n V.S.BD mpeg2video  MPEG-2 video";
      case "-formats" -> " ---\n DE  mpegts  MPEG-TS";
      default -> "Bitstream filters:\nh264_mp4toannexb";
    }, Clock.systemUTC(), nanos::get, false);
    hub.member(PLUGIN).encode(SPEC, task(PLUGIN), Picture::new, worker, e -> e);
    ConversionEvent failed = nextEvent();
    assertThat(failed).isInstanceOf(ConversionEvent.Failed.class);
    assertThat(((ConversionEvent.Failed) failed).failure()).isEqualTo(ConversionEvent.Failure.UNAVAILABLE);
    assertThat(((ConversionEvent.Failed) failed).detail()).contains("rawvideo").contains("h264_metadata");
    assertThat(commands).as("nothing launched").isEmpty();
  }

  /**
   * The MCA's B4 build, live (EMC2_TEST_FFMPEG): 50 I420 pictures at 640x360 and 25/s give 50 access units in order,
   * each with its picture's time and one delimiter, an IDR each second, and the SPS tagged BT.709 limited range.
   */
  @Test
  void encodesWithARealFfmpegWhenOneIsGiven() throws Exception {
    String ffmpeg = System.getenv("EMC2_TEST_FFMPEG");
    org.junit.jupiter.api.Assumptions.assumeTrue(ffmpeg != null, "EMC2_TEST_FFMPEG not set");
    hub = new ConversionHub(runtime, new ConversionLimits(2, 2L * 1024 * 1024, Path.of(ffmpeg), ConversionLimits.DEFAULT_MAX_PIXELS));
    EncoderSpec spec = EncoderSpec.of("live", 640, 360, 25);
    EncoderRef encoder = hub.member(PLUGIN).encode(spec, task(PLUGIN), Picture::new, worker, e -> e);
    assertThat(nextEvent()).isInstanceOf(ConversionEvent.Running.class);
    Instant t0 = Instant.parse("2026-11-17T12:00:00Z");
    for (int i = 0; i < 50; i++) {
      byte[] data = new byte[spec.pictureBytes()];
      Arrays.fill(data, 0, 640 * 360, (byte) (16 + i * 4)); // luma ramps, chroma grey: a different picture each time
      Arrays.fill(data, 640 * 360, data.length, (byte) 128);
      RawPicture picture = new RawPicture(t0.plusMillis(40L * i), Bytes.of(data));
      long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
      while (encoder.write(picture) != SendResult.ACCEPTED) { // at most 2 wait: the test waits instead of dropping
        assertThat(System.nanoTime()).as("picture %d within 10 s", i).isLessThan(end);
        Thread.sleep(2);
      }
    }
    // every picture handed to ffmpeg first: a stop drops what still waits
    waitFor(() -> hub.stats(PLUGIN).getFirst().bytesIn() == 50L * spec.pictureBytes());
    // The input closes: ffmpeg flushes the rest within Conversions.STOP_GRACE (2 s, then killed), and the last unit comes at
    // the end. Ample at 640x360; if it ever flakes on a loaded machine, wait for 49 units before the stop (review).
    encoder.stop();
    List<EncodedPicture> units = new java.util.ArrayList<>();
    for (int i = 0; i < 50; i++) {
      EncodedPicture next = pictures.poll(20, TimeUnit.SECONDS);
      if (next == null) {
        List<ConversionEvent> seen = new java.util.ArrayList<>();
        events.drainTo(seen);
        throw new AssertionError("unit " + i + " of 50 within 20 s; events " + seen + "; " + hub.stats(PLUGIN));
      }
      units.add(next);
    }
    assertThat(pictures.poll(500, TimeUnit.MILLISECONDS)).as("one unit per picture, no more").isNull();
    for (int i = 0; i < 50; i++) {
      EncodedPicture u = units.get(i);
      assertThat(u.sequence()).isEqualTo(i);
      assertThat(u.time()).isEqualTo(t0.plusMillis(40L * i));
      byte[] au = u.accessUnit().toArray();
      assertThat(nalTypes(au)).as("unit %d", i).startsWith(9).containsOnlyOnce(9);
    }
    assertThat(units.stream().filter(EncodedPicture::keyframe).map(EncodedPicture::sequence).toList()).as("an IDR each second")
        .containsExactly(0L, 25L);
    byte[] sps = sps(units.getFirst().accessUnit().toArray());
    assertThat(bt709Limited(sps)).as("the SPS's VUI: limited range, BT.709 primaries, transfer and matrix").isTrue();
    assertThat(hub.stats(PLUGIN)).singleElement().satisfies(s -> assertThat(s.lostOutputs()).isZero()); // its drops are this test's retries
  }

  /** The NAL unit types in an Annex B access unit, in order. */
  private static List<Integer> nalTypes(byte[] au) {
    List<Integer> types = new java.util.ArrayList<>();
    for (int i = 0; i + 3 < au.length; i++) {
      if (au[i] == 0 && au[i + 1] == 0 && au[i + 2] == 1) {
        types.add(au[i + 3] & 0x1f);
        i += 2;
      }
    }
    return types;
  }

  /** The first SPS's payload (after its NAL header), emulation prevention bytes removed. */
  private static byte[] sps(byte[] au) {
    for (int i = 0; i + 3 < au.length; i++) {
      if (au[i] == 0 && au[i + 1] == 0 && au[i + 2] == 1 && (au[i + 3] & 0x1f) == 7) {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        int zeros = 0;
        for (int j = i + 4; j < au.length; j++) {
          if (zeros >= 2 && au[j] == 1) {
            break; // the next start code
          }
          if (zeros >= 2 && au[j] == 3) {
            zeros = 0;
            continue;
          }
          out.write(au[j]);
          zeros = au[j] == 0 ? zeros + 1 : 0;
        }
        return out.toByteArray();
      }
    }
    throw new AssertionError("no SPS in the first unit");
  }

  /** Reads an SPS (H.264 7.3.2.1.1) to its VUI's video signal type: limited range and BT.709 (1, 1, 1). */
  private static boolean bt709Limited(byte[] sps) {
    long[] bit = {0};
    java.util.function.IntUnaryOperator u = n -> {
      int v = 0;
      for (int k = 0; k < n; k++) {
        int b = (sps[(int) (bit[0] >> 3)] >> (7 - (bit[0] & 7))) & 1;
        bit[0]++;
        v = (v << 1) | b;
      }
      return v;
    };
    java.util.function.IntSupplier ue = () -> {
      int zeros = 0;
      while (u.applyAsInt(1) == 0) {
        zeros++;
      }
      return (1 << zeros) - 1 + u.applyAsInt(zeros);
    };
    int profile = u.applyAsInt(8);
    u.applyAsInt(16); // constraint flags, level
    ue.getAsInt(); // seq_parameter_set_id
    if (List.of(100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135).contains(profile)) {
      int chroma = ue.getAsInt();
      if (chroma == 3) {
        u.applyAsInt(1);
      }
      ue.getAsInt();
      ue.getAsInt();
      u.applyAsInt(1);
      if (u.applyAsInt(1) == 1) {
        throw new AssertionError("scaling matrices: not expected from h264_mf");
      }
    }
    ue.getAsInt(); // log2_max_frame_num_minus4
    int pocType = ue.getAsInt();
    if (pocType == 0) {
      ue.getAsInt();
    } else if (pocType == 1) {
      u.applyAsInt(1);
      ue.getAsInt(); // offset_for_non_ref_pic (se, read as ue: only its length matters)
      ue.getAsInt();
      int n = ue.getAsInt();
      for (int k = 0; k < n; k++) {
        ue.getAsInt();
      }
    }
    ue.getAsInt(); // max_num_ref_frames
    u.applyAsInt(1);
    ue.getAsInt();
    ue.getAsInt(); // width and height in macroblocks
    if (u.applyAsInt(1) == 0) {
      u.applyAsInt(1); // mb_adaptive_frame_field_flag
    }
    u.applyAsInt(1); // direct_8x8_inference_flag
    if (u.applyAsInt(1) == 1) { // frame_cropping_flag
      for (int k = 0; k < 4; k++) {
        ue.getAsInt();
      }
    }
    if (u.applyAsInt(1) == 0) {
      return false; // no VUI
    }
    if (u.applyAsInt(1) == 1 && u.applyAsInt(8) == 255) { // aspect_ratio_info
      u.applyAsInt(32);
    }
    if (u.applyAsInt(1) == 1) { // overscan_info_present
      u.applyAsInt(1);
    }
    if (u.applyAsInt(1) == 0) { // video_signal_type_present_flag
      return false;
    }
    u.applyAsInt(3); // video_format
    int fullRange = u.applyAsInt(1);
    if (u.applyAsInt(1) == 0) { // colour_description_present_flag
      return false;
    }
    return fullRange == 0 && u.applyAsInt(8) == 1 && u.applyAsInt(8) == 1 && u.applyAsInt(8) == 1;
  }

  @Test
  void refusesAnotherPluginsTaskAndADuplicateNameAndStopsWhenItsTaskEnds() throws Exception {
    hub(2);
    ComputeRef<Picture> other = task("gmti");
    assertThatThrownBy(() -> hub.member(PLUGIN).encode(SPEC, other, Picture::new, worker, e -> e)).isInstanceOf(IllegalArgumentException.class)
        .hasMessage("an encoder's output is one of this plugin's own compute tasks");

    ComputeRef<Picture> mux = task(PLUGIN);
    EncoderRef encoder = hub.member(PLUGIN).encode(SPEC, mux, Picture::new, worker, e -> e);
    nextEvent();
    assertThatThrownBy(() -> hub.member(PLUGIN).encode(SPEC, mux, Picture::new, worker, e -> e)).isInstanceOf(IllegalStateException.class)
        .hasMessage("encoder camera-1 runs already");
    assertThat(encoder).isEqualTo(encoder).isNotEqualTo(hub.member(PLUGIN).encode(EncoderSpec.of("camera-3", 160, 120, 25), mux,
        Picture::new, worker, e -> e));
    nextEvent();

    waitFor(() -> processes.size() == 2);
    mux.stop();
    waitFor(() -> mux.post(new Picture(null)) == SendResult.CLOSED);
    processes.getFirst().output(AccessUnitsTest.join(AccessUnitsTest.AUD4, AccessUnitsTest.IDR, AccessUnitsTest.AUD4));
    ConversionEvent stopped = nextEvent();
    assertThat(stopped).isInstanceOf(ConversionEvent.Stopped.class);
    assertThat(((ConversionEvent.Stopped) stopped).reason()).isEqualTo("output task ended");
    assertThat(hub.stats(PLUGIN)).filteredOn(s -> s.stream().equals("camera-1")).singleElement()
        .satisfies(s -> assertThat(s.lostOutputs()).as("the unit refused, and the last one at the end").isEqualTo(2));
  }
}
