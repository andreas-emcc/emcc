package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.connection.Backoff;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.Restart;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * One run of a TCP link's task (T-126). The inbox outlives the runs of a task, so a {@link LinkInbox.Closed} that names an earlier
 * run can be in it when the next run's writer reads it, and the writer must ignore it. The task is started by hand here, with the
 * plugin's own settings and a worker of the test that records the messages the task sends (the run's id is in them), so that the
 * test can post an end that names another run and one that names this one.
 */
class LinkRunTest {

  @AfterEach
  void closeRigs() {
    Rig.closeAll();
  }

  /** What the task sent to "the applier": the test reads the id of the run from {@code Connected}. */
  private static final class Recorder {
    final List<ApplierMsg> got = new CopyOnWriteArrayList<>();

    UUID run() {
      return got.stream().filter(ApplierMsg.Connected.class::isInstance).map(m -> ((ApplierMsg.Connected) m).loop()).findFirst().orElse(null);
    }
  }

  private static ConnectionRef<LinkInbox> startOutLink(Rig rig, TcpPeer peer, Recorder recorder) {
    Config.LinkConfig link = Config.parse(rig.withLinks(Rig.tcp("direct", peer.port(), "out"))).links().getFirst();
    WorkerRef<ApplierMsg> applier = rig.ctx.workers().spawn(WorkerSpec.of("recorder", ApplierMsg.class, () -> (message, context) -> recorder.got.add(message)));
    ConnectionSpec<LinkInbox> spec = ConnectionSpec.of("direct", LinkInbox.class).inbox(100, Overflow.coalesceByKey())
        .restart(Restart.always(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60))));
    return rig.ctx.connections().start(spec, () -> new TcpLinkTask(link, Config.EMPTY.globals(), applier, rig.clock));
  }

  @Test
  void theEndOfAnEarlierRunDoesNotEndTheRunThatIsUp() {
    var rig = new Rig();
    TcpPeer peer = rig.addPeer("direct");
    var recorder = new Recorder();
    ConnectionRef<LinkInbox> task = startOutLink(rig, peer, recorder);
    peer.awaitConnection(1);
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return recorder.run() != null;
    }, "the run to say it is connected");

    task.post(new LinkInbox.Closed(UUID.randomUUID(), "the end of an earlier run"));
    // the writer takes its inbox in order: an event posted after the end reaches the peer only once the writer has dealt with it
    task.post(new LinkInbox.Send(UUID.randomUUID(), rig.freshAtom("after-the-old-end", 0, 59.3507, 18.1012)));
    TcpPeer.waitUntil(() -> peer.awaitConnection(1).received().contains("after-the-old-end"), "the event after the old end, on the first connection");
    rig.advance(Duration.ofSeconds(5));
    assertThat(peer.accepted()).as("the run was not ended and the link did not connect again").isEqualTo(1);
    assertThat(rig.ctx.connections().task("direct").restarts()).isZero();
  }

  @Test
  void theEndOfThisRunDoesEndItAndTheLinkConnectsAgain() {
    var rig = new Rig();
    TcpPeer peer = rig.addPeer("direct");
    var recorder = new Recorder();
    ConnectionRef<LinkInbox> task = startOutLink(rig, peer, recorder);
    peer.awaitConnection(1);
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return recorder.run() != null;
    }, "the run to say it is connected");

    // the control of the test above: the same message with this run's id ends the run, and ECore connects the link again
    task.post(new LinkInbox.Closed(recorder.run(), "the end of this run"));
    TcpPeer.waitUntil(() -> {
      rig.advance(Duration.ofSeconds(1));
      return peer.accepted() >= 2;
    }, "the link to connect again after the end of its run");
    assertThat(peer.accepted()).isEqualTo(2);
  }
}
