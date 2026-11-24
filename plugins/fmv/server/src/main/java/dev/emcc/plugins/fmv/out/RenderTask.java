package dev.emcc.plugins.fmv.out;

import dev.emcc.plugins.fmv.klv.St0601Writer;
import dev.emcc.plugins.fmv.out.imagery.Imagery;
import dev.emcc.plugins.fmv.out.imagery.ImagerySet;
import dev.emcc.plugins.fmv.out.imagery.TilePicture;
import dev.emcc.plugins.fmv.out.render.BitErrors;
import dev.emcc.plugins.fmv.out.render.Degrader;
import dev.emcc.plugins.fmv.out.render.GroundFallback;
import dev.emcc.plugins.fmv.out.render.Overlay;
import dev.emcc.plugins.fmv.out.render.Renderer;
import dev.emcc.plugins.fmv.out.terrain.DtedCell;
import dev.emcc.plugins.fmv.out.terrain.Terrain;
import dev.emcc.plugins.fmv.ts.TsMuxer;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.compute.ComputeContext;
import dev.emcc.sdk.compute.ComputeTask;
import dev.emcc.sdk.stream.EncoderRef;
import dev.emcc.sdk.stream.RawPicture;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.List;
import java.util.Locale;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * An output link's compute task (brief section 10.3 point 11; ADR-0059 point 7; ADR-0064): its own
 * loop on a compute thread ECore owns. For each item of its inbox:
 *
 * <ul>
 *   <li>a <b>pose</b> older than one frame period is skipped ({@code late}), else rendered into an I420
 *       picture, given the link's drawn bit errors when they are on ({@link BitErrors}, F5), and
 *       written to ECore's encoder (part U, {@link EncoderRef}; {@code encoder dropped}
 *       when it refuses it), and kept by its time for 2 s; without an encoder nothing is rendered
 *       ({@code no encoder});
 *   <li>an <b>encoded picture</b> is muxed with ST 0601 from the pose of its time (every {@code
 *       metadataEvery}th) and ST 0102, and its datagrams posted to the link's sender;
 *   <li>a <b>cell</b> or <b>tile</b> is parsed or decoded into the task's own terrain or imagery.
 * </ul>
 *
 * Its state is its own (section 10.3 point 12): a restart starts clean, and the worker sends the
 * setup, cells and tiles again. It makes no HTTP call, uses no store and opens no socket.
 */
final class RenderTask implements ComputeTask<TaskItem> {

  /** How long a pose is kept for its encoded picture's metadata. */
  static final Duration RING = Duration.ofSeconds(2);

  private static final long REPORT_NANOS = 1_000_000_000L;
  private static final Duration RENDER_WINDOW = Duration.ofSeconds(10);

  /** How long the task parses and decodes after a frame before it looks at its inbox again (F1). */
  static final long LOAD_BUDGET_NANOS = 15_000_000L;

  private final String link;
  private final WorkerRef<OutputMsg> worker;
  private final Supplier<Instant> clock;

  RenderTask(String link, WorkerRef<OutputMsg> worker, Supplier<Instant> clock) {
    this.link = link;
    this.worker = worker;
    this.clock = clock;
  }

  @Override
  public void run(ComputeContext<TaskItem> task) {
    new Loop(task).run();
  }

  /** One run's state: only this task touches it. */
  private final class Loop {
    private final ComputeContext<TaskItem> task;
    private final Terrain terrain = new Terrain();
    private final Deque<TaskItem.Frame> ring = new ArrayDeque<>();
    private final Deque<long[]> renderTimes = new ArrayDeque<>(); // {when, nanos taken}
    /** The terrain and imagery items waiting to be parsed or decoded, in order (F1). */
    private final Deque<TaskItem> loading = new ArrayDeque<>();
    private TaskItem.@Nullable Setup setup;
    private @Nullable EncoderRef encoder;
    private @Nullable Imagery imagery;
    private @Nullable Imagery wms;
    private @Nullable Renderer renderer;
    private @Nullable Degrader degrader;
    private @Nullable BitErrors bitErrors;
    private long bitErrorEvents;
    private long bitErrorBlocks;
    private long overlays;
    private long overlayNanos;
    /** The pictures the current encoder took: its keyframes fall by this count (F5). */
    private long encoderPictures;
    private byte @Nullable [] picture;
    private TsMuxer mux = new TsMuxer();
    private long rendered;
    private long late;
    private long encoderDropped;
    private long encoded;
    private long muxed;
    private long noImagery;
    private long lastReport = System.nanoTime();

    Loop(ComputeContext<TaskItem> task) {
      this.task = task;
    }

    void run() {
      for (TaskItem item; (item = task.poll(loading.isEmpty() ? Duration.ofSeconds(1) : Duration.ofMillis(1))) != null || !task.stopping(); ) {
        if (item != null) {
          handle(item);
        }
        if (!loading.isEmpty() && (item == null || item instanceof TaskItem.Frame)) {
          load(); // after each frame, or while nothing else waits
        }
        if (System.nanoTime() - lastReport >= REPORT_NANOS) {
          report();
        }
      }
    }

    /**
     * Parses and decodes what waits to load, in order, for {@link #LOAD_BUDGET_NANOS} at the most (and
     * one item at the least): so frames go on reaching the encoder while a large set loads (F1, owner
     * ACS A; ECore fails an encoder that gives no output 10 s after its first picture).
     */
    private void load() {
      long start = System.nanoTime();
      do {
        loadOne(loading.removeFirst());
      } while (!loading.isEmpty() && System.nanoTime() - start < LOAD_BUDGET_NANOS);
    }

    private void handle(TaskItem item) {
      switch (item) {
        case TaskItem.Cell c -> loading.addLast(c);
        case TaskItem.DropCell d -> loading.addLast(d);
        case TaskItem.UseSet u -> loading.addLast(u);
        case TaskItem.Tile t -> loading.addLast(t);
        case TaskItem.DropTile d -> loading.addLast(d);
        case TaskItem.UseWms u -> loading.addLast(u);
        case TaskItem.WmsTile t -> loading.addLast(t);
        case TaskItem.DropWmsTile d -> loading.addLast(d);
        case TaskItem.Frame f -> {
          if (!loading.isEmpty()) {
            task.count("frames while loading", 1);
          }
          frame(f);
        }
        case TaskItem.Encoded e -> encoded(e);
        case TaskItem.Setup s -> control(s);
        case TaskItem.Look l -> control(l);
        case TaskItem.UseEncoder u -> control(u);
      }
    }

    /** The setup, a look change and the encoder: at once, before any frame after them. */
    private void control(TaskItem item) {
      switch (item) {
        case TaskItem.Setup s -> {
          setup = s;
          mux = new TsMuxer();
          task.detail("frame", s.frame().width() + "×" + s.frame().height() + " at " + s.frame().frameRate());
        }
        case TaskItem.Look l -> {
          TaskItem.Setup s = setup;
          if (s != null) {
            setup = new TaskItem.Setup(s.frame(), s.sender(), l.link()); // the same muxer: the stream goes on
          }
        }
        case TaskItem.UseEncoder u -> {
          if (u.encoder() != encoder) { // a new encoder counts its pictures, and so its keyframes, from 0
            encoderPictures = 0;
            if (bitErrors != null) {
              bitErrors.encoderStarted();
            }
          }
          encoder = u.encoder();
          task.detail("encoder", u.encoder() == null ? "none" : u.encoder().name());
        }
        default -> throw new IllegalArgumentException("not a control item: " + item.getClass().getSimpleName());
      }
    }

    /** The terrain and imagery items, in the order they came (a drop or a new set after its tiles). */
    private void loadOne(TaskItem item) {
      switch (item) {
        case TaskItem.Cell c -> {
          try {
            terrain.put(DtedCell.parse(c.data().toArray()));
          } catch (DtedCell.DtedException e) {
            task.count("terrain refused", 1);
            task.log().warn("{}: the terrain cell {} is refused: {}", link, c.key().path(0), e.getMessage());
          }
        }
        case TaskItem.DropCell d -> terrain.remove(d.key());
        case TaskItem.UseSet u -> {
          ImagerySet set = u.set();
          imagery = set == null ? null : new Imagery(set);
        }
        case TaskItem.Tile t -> {
          Imagery im = imagery;
          if (im != null && im.set().folder().equals(t.set())) {
            try {
              im.add(t.spec(), TilePicture.decode(t.data().toArray(), t.spec().width(), t.spec().height()));
            } catch (TilePicture.PictureException e) {
              task.count("tile refused", 1);
              task.log().warn("{}: the tile {} is refused: {}", link, t.set() + "/" + t.spec().file(), e.getMessage());
            }
          }
        }
        case TaskItem.DropTile d -> {
          Imagery im = imagery;
          if (im != null && im.set().folder().equals(d.set())) {
            im.remove(d.spec());
          }
        }
        case TaskItem.UseWms u -> wms = new Imagery(new ImagerySet("wms", "WMS", "", "", u.crs(), List.of()));
        case TaskItem.WmsTile t -> {
          Imagery im = wms;
          if (im != null) {
            im.remove(t.spec()); // a newer image of the same tile replaces it
            try {
              im.add(t.spec(), TilePicture.decode(t.data().toArray(), t.spec().width(), t.spec().height()));
            } catch (TilePicture.PictureException e) {
              task.count("tile refused", 1);
              task.log().warn("{}: the WMS tile {} is refused: {}", link, t.key(), e.getMessage());
            }
          }
        }
        case TaskItem.DropWmsTile d -> {
          Imagery im = wms;
          if (im != null) {
            im.remove(d.spec());
          }
        }
        default -> throw new IllegalArgumentException("not an item to load: " + item.getClass().getSimpleName());
      }
      if (item instanceof TaskItem.Tile || item instanceof TaskItem.WmsTile) {
        task.count("tiles decoded", 1);
      }
    }

    private void frame(TaskItem.Frame f) {
      TaskItem.Setup s = setup;
      if (s == null || task.stopping()) {
        return;
      }
      Pose pose = f.pose();
      Instant now = clock.get();
      if (Duration.between(pose.time(), now).toNanos() > 1_000_000_000L / pose.rate()) {
        late++;
        task.count("late", 1);
        return; // never waited for: the newest pose replaces it in the inbox anyway (ADR-0059 point 7)
      }
      if (pose.width() != s.frame().width() || pose.height() != s.frame().height()) {
        task.count("frame size changed", 1); // the worker restarts the pipeline for the new size (O10)
        return;
      }
      EncoderRef e = encoder;
      if (e == null) {
        task.count("no encoder", 1); // the worker starts one again after RETRY_AFTER: nothing to render for meanwhile
        return;
      }
      Renderer r = renderer;
      if (r == null || r.width() != pose.width() || r.height() != pose.height()) {
        r = new Renderer(pose.width(), pose.height());
        renderer = r;
        picture = new byte[r.pictureBytes()];
        degrader = null;
      }
      byte[] out = java.util.Objects.requireNonNull(picture);
      OutLink link = s.link();
      Degrader.Settings degraded = link.degraded();
      long start = System.nanoTime();
      int missing;
      if (degraded != null) {
        Degrader d = degrader;
        if (d == null) {
          d = new Degrader(pose.width(), pose.height(), link.id().hashCode());
          degrader = d;
        }
        missing = d.render(pose, terrain, GroundFallback.SEA_LEVEL, imagery, wms, link.bilinear(), degraded, out);
      } else {
        missing = r.render(pose, terrain, GroundFallback.SEA_LEVEL, imagery, wms, new Renderer.Options(link.bilinear(), link.haze()), out);
      }
      long took = System.nanoTime() - start;
      rendered++;
      task.count("rendered", 1);
      if (missing > 0) {
        noImagery++;
        task.count("no imagery", 1);
      }
      renderTimes.addLast(new long[] {start, took});
      while (!renderTimes.isEmpty() && start - renderTimes.peekFirst()[0] > RENDER_WINDOW.toNanos()) {
        renderTimes.removeFirst();
      }
      ring.addLast(f);
      while (!ring.isEmpty() && Duration.between(ring.peekFirst().pose().time(), pose.time()).compareTo(RING) > 0) {
        ring.removeFirst();
      }
      if (f.overlay()) { // after the renderer and the degraded camera, before the bit errors and the encoder (function 27)
        long overlayStart = System.nanoTime();
        int c = f.classification();
        List<String> names = link.classificationNames();
        String classification = c >= 1 && c <= names.size() ? names.get(c - 1) : "CLASSIFICATION " + c;
        Renderer.FrameCentre centre = Renderer.centre(pose, terrain, GroundFallback.SEA_LEVEL);
        Overlay.draw(out, pose.width(), pose.height(), Overlay.texts(pose, classification, f.platformName(), centre));
        overlayNanos += System.nanoTime() - overlayStart;
        overlays++;
        task.count("overlays", 1);
      }
      BitErrors errors = bitErrors(link.bitErrors());
      if (errors != null) { // drawn before the encoder (F5; owner, M9.2: drawn, so that every player shows the same)
        boolean keyframe = BitErrors.keyframe(encoderPictures, s.frame().frameRate() * s.frame().keyframeSeconds());
        BitErrors.Hit hit = errors.apply(pose.time(), out, pose.width(), pose.height(), keyframe);
        if (hit.event()) {
          bitErrorEvents++;
          task.count("bit error events", 1);
        }
        if (hit.blocks() > 0) {
          bitErrorBlocks += hit.blocks();
          task.count("bit error blocks", hit.blocks());
        }
      }
      SendResult written = e.write(new RawPicture(pose.time(), Bytes.of(out)));
      if (errors != null) {
        errors.written(written == SendResult.ACCEPTED, out);
      }
      if (written == SendResult.ACCEPTED) {
        encoderPictures++;
      } else { // waiting for a slot, two pictures waiting already, or ended
        encoderDropped++;
        task.count("encoder dropped", 1);
      }
    }

    private void encoded(TaskItem.Encoded e) {
      TaskItem.Setup s = setup;
      if (s == null) {
        return;
      }
      encoded++;
      task.count("encoded", 1);
      TaskItem.Frame f = poseAt(e.time());
      byte[] klv = null;
      if (f != null && muxed % s.link().metadataEvery() == 0) {
        Renderer.FrameCentre centre = Renderer.centre(f.pose(), terrain, GroundFallback.SEA_LEVEL);
        klv = St0601Writer.write(f.pose(), centre, f.platformName(), f.classification(), s.link().classifyingCountry());
      }
      List<byte[]> datagrams = mux.picture(e.time(), e.keyframe(), e.accessUnit().toArray(), klv);
      muxed++;
      task.count("muxed", 1);
      List<Bytes> out = new ArrayList<>(datagrams.size());
      for (byte[] d : datagrams) {
        out.add(Bytes.of(d));
      }
      s.sender().post(new SendItem.Datagrams(out));
    }

    /** The link's bit errors for these settings: the same while they stay, a new run of the seed when they change, none while off. */
    private @Nullable BitErrors bitErrors(BitErrors.@Nullable Settings settings) {
      BitErrors b = bitErrors;
      if (settings == null) {
        bitErrors = null;
      } else if (b == null || !b.settings().equals(settings)) {
        bitErrors = new BitErrors(settings);
      }
      return bitErrors;
    }

    /** The kept pose of a picture's time, or {@code null} when it has gone. */
    private TaskItem.@Nullable Frame poseAt(Instant time) {
      for (TaskItem.Frame f : ring) {
        if (f.pose().time().equals(time)) {
          return f;
        }
      }
      return null;
    }

    private void report() {
      lastReport = System.nanoTime();
      double ms = median();
      if (ms >= 0) {
        task.detail("render time (median, 10 s)", String.format(Locale.ROOT, "%.1f ms", ms));
      }
      task.detail("waiting to load", Integer.toString(loading.size()));
      if (overlays > 0) {
        task.detail("overlay time (mean)", String.format(Locale.ROOT, "%.2f ms", overlayNanos / 1e6 / overlays));
      }
      task.send(worker, new OutputMsg.Rendered(link, rendered, late, encoderDropped, encoded, muxed, noImagery, ms, bitErrorEvents, bitErrorBlocks));
    }

    private double median() {
      if (renderTimes.isEmpty()) {
        return -1;
      }
      long[] t = renderTimes.stream().mapToLong(x -> x[1]).toArray();
      Arrays.sort(t);
      return t[t.length / 2] / 1e6;
    }
  }
}
