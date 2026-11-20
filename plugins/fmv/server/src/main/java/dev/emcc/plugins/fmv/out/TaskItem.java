package dev.emcc.plugins.fmv.out;

import dev.emcc.plugins.fmv.out.imagery.ImagerySet;
import dev.emcc.plugins.fmv.out.terrain.CellKey;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.stream.EncodedPicture;
import dev.emcc.sdk.stream.EncoderRef;
import dev.emcc.sdk.stream.EncoderSpec;
import dev.emcc.sdk.worker.Coalescing;
import java.time.Instant;
import org.jspecify.annotations.Nullable;

/**
 * What an output link's compute task takes in its inbox (brief section 10.3 point 9). The inbox
 * coalesces by key: a frame's pose by its camera, so only the newest waits; each encoded picture,
 * cell and tile by its own key, so none replaces another of its kind.
 */
public sealed interface TaskItem extends Message, Coalescing {

  /**
   * What the task needs before it renders: the frame, the sender and the link's settings. Sent again
   * after a restart; it starts a new transport stream. The encoder follows as {@link UseEncoder}.
   */
  record Setup(EncoderSpec frame, ConnectionRef<SendItem> sender, OutLink link) implements TaskItem {
    @Override
    public Object coalesceKey() {
      return "setup";
    }
  }

  /**
   * The encoder the task writes its pictures to from now on (part U: the worker starts it and posts
   * it here, CR-0050 point 1.7), or none while the worker waits to start one again: then the task
   * renders nothing ({@code no encoder}). The transport stream goes on.
   */
  record UseEncoder(@Nullable EncoderRef encoder) implements TaskItem {
    @Override
    public Object coalesceKey() {
      return "encoder";
    }
  }

  /**
   * One frame's pose, with what its ST 0601 and ST 0102 need.
   *
   * @param classification ST 0102's classification, 1 to 5
   * @param platformName tag 10: the pose's platform name, else the link's name
   */
  record Frame(Pose pose, int classification, String platformName) implements TaskItem {
    @Override
    public Object coalesceKey() {
      return "pose:" + pose.camera();
    }
  }

  /** One DTED cell's file, to parse. */
  record Cell(CellKey key, Bytes data) implements TaskItem {
    @Override
    public Object coalesceKey() {
      return "cell:" + key.lon() + ":" + key.lat();
    }
  }

  /** A cell the camera has left: dropped from the task's terrain. */
  record DropCell(CellKey key) implements TaskItem {
    @Override
    public Object coalesceKey() {
      return "cell:" + key.lon() + ":" + key.lat();
    }
  }

  /** The imagery set the link uses from now on (B3); its tiles follow. */
  record UseSet(ImagerySet set) implements TaskItem {
    @Override
    public Object coalesceKey() {
      return "set";
    }
  }

  /** One tile's file of the set in use, to decode. */
  record Tile(String set, ImagerySet.TileSpec spec, Bytes data) implements TaskItem {
    @Override
    public Object coalesceKey() {
      return "tile:" + set + "/" + spec.file();
    }
  }

  /** A tile the camera has left: dropped from the task's imagery. */
  record DropTile(String set, ImagerySet.TileSpec spec) implements TaskItem {
    @Override
    public Object coalesceKey() {
      return "tile:" + set + "/" + spec.file();
    }
  }

  /** The link's WMS tiles from now on, in this CRS: any WMS tiles the task holds are dropped (F2). */
  record UseWms(ImagerySet.Crs crs) implements TaskItem {
    @Override
    public Object coalesceKey() {
      return "wms";
    }
  }

  /** One WMS tile's image, to decode; it replaces a tile of the same key (section 10.5 point 17). */
  record WmsTile(String key, ImagerySet.TileSpec spec, Bytes data) implements TaskItem {
    @Override
    public Object coalesceKey() {
      return "wms:" + key;
    }
  }

  /** A WMS tile the view has left: dropped from the task's WMS imagery. */
  record DropWmsTile(String key, ImagerySet.TileSpec spec) implements TaskItem {
    @Override
    public Object coalesceKey() {
      return "wms:" + key;
    }
  }

  /**
   * One encoded picture back from the link's encoder ({@link EncodedPicture}, CR-0050 point 1.5): an
   * H.264 access unit, Annex B, with its picture's time and whether it is a keyframe. Keyed by the
   * encoder's generation and the picture's sequence, so that none ever replaces another, not even
   * one of an encoder started after it (each counts from 0).
   */
  record Encoded(int generation, long sequence, Instant time, boolean keyframe, Bytes accessUnit) implements TaskItem {
    /** The item for a picture of the encoder of this generation. */
    static Encoded of(int generation, EncodedPicture p) {
      return new Encoded(generation, p.sequence(), p.time(), p.keyframe(), p.accessUnit());
    }

    @Override
    public Object coalesceKey() {
      return "encoded:" + generation + ":" + sequence;
    }
  }
}
