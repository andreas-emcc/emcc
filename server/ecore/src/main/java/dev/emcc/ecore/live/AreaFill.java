package dev.emcc.ecore.live;

import dev.emcc.ecore.geo.GeoArea;
import dev.emcc.ecore.runtime.HandlerContext;
import dev.emcc.ecore.runtime.MessageHandler;
import dev.emcc.ecore.runtime.ReplyHandle;
import dev.emcc.ecore.store.AreaSnapshot;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * A compute worker that fills area views for the browser sessions (rule C7: work that takes long
 * runs on a compute worker, not on an ordinary one). Zoomed out over 200 000 objects a fill takes
 * 100 to 300 ms: the session would hold its browser's messages that long. The gateway runs one per
 * compute thread; each session always uses the same one. Stateless: every request carries what it
 * needs, and the answer is an immutable {@link AreaView.Filled} (rule C2). A fill that throws is
 * answered as failed, so the session does not wait for its timeout (review F2); being stateless,
 * the worker is restartable after a hang.
 */
final class AreaFill implements MessageHandler<AreaFill.Fill> {

  private static final Logger LOG = LoggerFactory.getLogger(AreaFill.class);

  /** Fill a view of {@code area} from the object store's {@code answer}. */
  record Fill(GeoArea area, double resolution, int budget, AreaSnapshot answer, ReplyHandle<AreaView.Filled> replyTo) {}

  @Override
  public void handle(Fill fill, HandlerContext<Fill> context) {
    AreaView.Filled filled;
    try {
      filled = AreaView.filled(fill.area(), fill.resolution(), fill.budget(), fill.answer().objects(), fill.answer().bounds());
    } catch (RuntimeException e) {
      LOG.error("Filling an area failed", e);
      fill.replyTo().fail("the fill failed: " + e);
      return;
    }
    fill.replyTo().reply(filled);
  }
}
