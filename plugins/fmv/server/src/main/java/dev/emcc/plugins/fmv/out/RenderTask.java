package dev.emcc.plugins.fmv.out;

import dev.emcc.plugins.fmv.klv.St0601Writer;
import dev.emcc.plugins.fmv.out.imagery.Imagery;
import dev.emcc.plugins.fmv.out.imagery.ImagerySet;
import dev.emcc.plugins.fmv.out.imagery.TilePicture;
import dev.emcc.plugins.fmv.out.render.GroundFallback;
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
 *       picture and written to ECore's encoder (part U, {@link EncoderRef}; {@code encoder dropped}
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
    private TaskItem.@Nullable Setup setup;
    private @Nullable EncoderRef encoder;
    private @Nullable Imagery imagery;
    private @Nullable Imagery wms;
    private @Nullable Renderer renderer;
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
      for (TaskItem item; (item = task.poll(Duration.ofSeconds(1))) != null || !task.stopping(); ) {
        if (item != null) {
          handle(item);
        }
        if (System.nanoTime() - lastReport >= REPORT_NANOS) {
          report();
        }
      }
    }

    private void handle(TaskItem item) {
      switch (item) {
        case TaskItem.Setup s -> {
          setup = s;
          mux = new TsMuxer();
          task.detail("frame", s.frame().width() + "×" + s.frame().height() + " at " + s.frame().frameRate());
        }
        case TaskItem.UseEncoder u -> {
          encoder = u.encoder();
          task.detail("encoder", u.encoder() == null ? "none" : u.encoder().name());
        }
        case TaskItem.Cell c -> {
          try {
            terrain.put(DtedCell.parse(c.data().toArray()));
          } catch (DtedCell.DtedException e) {
            task.count("terrain refused", 1);
            task.log().warn("{}: the terrain cell {} is refused: {}", link, c.key().path(0), e.getMessage());
          }
        }
        case TaskItem.DropCell d -> terrain.remove(d.key());
        case TaskItem.UseSet u -> imagery = new Imagery(u.set());
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
        case TaskItem.Frame f -> frame(f);
        case TaskItem.Encoded e -> encoded(e);
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
      }
      byte[] out = java.util.Objects.requireNonNull(picture);
      long start = System.nanoTime();
      int missing = r.render(pose, terrain, GroundFallback.SEA_LEVEL, imagery, wms, new Renderer.Options(s.link().bilinear(), s.link().haze()), out);
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
      SendResult written = e.write(new RawPicture(pose.time(), Bytes.of(out)));
      if (written != SendResult.ACCEPTED) { // waiting for a slot, two pictures waiting already, or ended
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
      task.send(worker, new OutputMsg.Rendered(link, rendered, late, encoderDropped, encoded, muxed, noImagery, ms));
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
