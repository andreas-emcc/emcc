package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.store.Change;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketAddress;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * A peer that stays connected and stops reading must not hold an {@code out} link for ever (owner, 2026-10-28, Z1): a write that has
 * made no progress for {@code writeStallSeconds} closes the connection, and the link connects again and sends everything again.
 */
class StallTest {

  private static final Actor USER = Actor.plugin("draw-symbols");
  /** Enough events to fill the buffers of a socket on loopback, and so to block the writer of a peer that reads nothing. */
  private static final int COUNT = 30_000;

  @AfterEach
  void closeRigs() {
    Rig.closeAll();
  }

  /** A link to a peer that has taken its first connection and then stopped reading, with the writer blocked in a write. */
  private static final class Stalled {
    final Rig rig = new Rig();
    final TcpPeer peer;
    /** The virtual seconds that have passed since the objects were made. */
    int seconds;
    private final Layer layer;

    Stalled(String limitSetting) {
      layer = rig.ctx.store().seedLayer("Big");
      rig.ctx.store().gap();
      rig.ctx.runUntilIdle();
      for (int i = 0; i < COUNT; i++) {
        var content = new MapObjectContent("core.symbol", "core.general", "manual", null, layer.id(),
            new Geometry.Point(Position.of(5.0 + (i % 1000) / 100.0, 50.0 + (i / 1000) / 10.0)),
            new Symbol(SymbolStandard.APP_6B, "SFGPUCI--------", null), null, new ObjectProperties("N" + i, null), rig.ctx.defaultLabel(),
            Extensions.empty());
        rig.ctx.store().applyAs(USER, Change.createObject(UUID.randomUUID(), content));
      }
      rig.ctx.runUntilIdle();
      if (limitSetting != null) {
        rig.ctx.changeSettings(rig.ctx.settings().with("writeStallSeconds", JsonNumber.of(Integer.parseInt(limitSetting))));
      }
      peer = rig.addOutLink("tak-big", "out", List.of(layer), "\"refreshSeconds\":0");
      peer.awaitConnection(1).pauseReading();
      waitUntilBlocked();
    }

    /** Ticks, one at a time, until what the link has written stops growing: the writer is then in a write that does not return. */
    private void waitUntilBlocked() {
      int[] steady = {0};
      long[] last = {-1};
      TcpPeer.waitUntil(() -> {
        tick();
        long now = rig.sentCount("tak-big");
        steady[0] = now == last[0] ? steady[0] + 1 : 0;
        last[0] = now;
        sleep(100);
        return steady[0] >= 3;
      }, "the writer to block (status: " + rig.status() + ")", 120);
      assertThat(last[0]).as("the writer must be blocked by the peer that reads nothing, not have written everything").isLessThan(COUNT);
    }

    void tick() {
      rig.advance(Duration.ofSeconds(1));
      seconds++;
    }

    /** Ticks, a moment of real time apart so that the new connection can be made, until the plugin has connected again. */
    void tickUntilReconnected(int most) {
      for (int i = 0; i < most && peer.accepted() == 1; i++) {
        tick();
        sleep(30);
      }
      peer.awaitConnection(2);
    }

    static void sleep(long millis) {
      try {
        Thread.sleep(millis);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new AssertionError("interrupted");
      }
    }
  }

  @Test
  void aPeerThatStopsReadingGetsANewConnectionAfterTheLimitAndEverythingIsSentAgain() {
    var s = new Stalled(null); // the default: 60 seconds
    assertThat(s.peer.accepted()).isEqualTo(1);
    while (s.seconds < 59) {
      s.tick();
    }
    assertThat(s.peer.accepted()).as("not before the limit").isEqualTo(1);
    s.tickUntilReconnected(40);
    TcpPeer.Conn fresh = s.peer.awaitConnection(2);
    assertThat(s.seconds).as("the limit counts from the write that blocked, which was some seconds in").isBetween(60, 60 + 25);
    assertThat(s.rig.status()).contains("1 write stall");
    assertThat(s.peer.accepted()).isEqualTo(2);
    // everything is sent again on the new connection, paced
    s.rig.awaitEvents(s.peer, COUNT, 180);
    assertThat(s.rig.part("tak-big")).startsWith("tak-big: connected since").doesNotContain("write stalled");
  }

  @Test
  void theLimitIsTheSetting() {
    var s = new Stalled("30");
    while (s.seconds < 29) {
      s.tick();
    }
    assertThat(s.peer.accepted()).as("not before the limit").isEqualTo(1);
    s.tickUntilReconnected(40);
    assertThat(s.seconds).as("30 seconds, not the 60 of the default").isBetween(30, 30 + 25);
  }

  @Test
  void aLinkThatHasNothingToWriteIsNeverStalled() {
    var rig = new Rig();
    Layer layer = rig.ctx.store().seedLayer("Few");
    rig.ctx.store().gap();
    rig.ctx.runUntilIdle();
    rig.ctx.store().applyAs(USER, Change.createObject(UUID.randomUUID(), new MapObjectContent("core.symbol", "core.general", "manual", null,
        layer.id(), new Geometry.Point(Position.of(11.9746, 57.7089)), new Symbol(SymbolStandard.APP_6B, "SFGPUCI--------", null), null,
        new ObjectProperties("ONE", null), rig.ctx.defaultLabel(), Extensions.empty())));
    rig.ctx.runUntilIdle();
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(layer), "\"refreshSeconds\":0");
    rig.awaitSent("tak-out", 1);
    for (int i = 0; i < 300; i++) {
      rig.advance(Duration.ofSeconds(1));
    }
    assertThat(peer.accepted()).isEqualTo(1);
    assertThat(rig.status()).doesNotContain("write stall");
  }

  @Test
  void aLinkThatIsDownIsNeverStalled() {
    var rig = new Rig();
    Layer layer = rig.ctx.store().seedLayer("Few");
    rig.ctx.store().gap();
    rig.ctx.runUntilIdle();
    rig.ctx.store().applyAs(USER, Change.createObject(UUID.randomUUID(), new MapObjectContent("core.symbol", "core.general", "manual", null,
        layer.id(), new Geometry.Point(Position.of(11.9746, 57.7089)), new Symbol(SymbolStandard.APP_6B, "SFGPUCI--------", null), null,
        new ObjectProperties("ONE", null), rig.ctx.defaultLabel(), Extensions.empty())));
    rig.ctx.runUntilIdle();
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(layer), "\"refreshSeconds\":0");
    rig.awaitSent("tak-out", 1);
    peer.stopListening();
    peer.liveConn().close();
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.status().contains("not connected");
    }, "the loss to be seen");
    for (int i = 0; i < 300; i++) {
      rig.advance(Duration.ofSeconds(1));
    }
    assertThat(rig.status()).as("still down, and never stalled").doesNotContain("connected since").doesNotContain("write stall");
  }

  /**
   * A socket whose every write and read blocks until it is closed, as the connection to a peer that has stopped reading. A real socket
   * cannot be made to block on the presence event: it is some 350 bytes, written first on a connection with an empty send buffer.
   */
  private static final class BlockedSocket extends Socket {
    private final CountDownLatch closed = new CountDownLatch(1);

    private void block() throws IOException {
      try {
        closed.await();
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      throw new IOException("Socket closed");
    }

    @Override
    public OutputStream getOutputStream() {
      return new OutputStream() {
        @Override
        public void write(int b) throws IOException {
          block();
        }

        @Override
        public void write(byte[] bytes, int offset, int length) throws IOException {
          block();
        }
      };
    }

    @Override
    public InputStream getInputStream() {
      return new InputStream() {
        @Override
        public int read() throws IOException {
          block();
          return -1;
        }
      };
    }

    @Override
    public SocketAddress getRemoteSocketAddress() {
      return InetSocketAddress.createUnresolved("stub.example.test", 9);
    }

    @Override
    public void close() {
      closed.countDown();
    }
  }

  /**
   * A link whose peer has stopped reading before the presence event is written. A {@code both} link gets a new connection after the
   * limit, not before; an {@code in} link is not watched (owner, 2026-10-28, AF1 and AG1), and keeps its connection.
   */
  private static void thePresenceWriteBlocks(String direction) {
    var opens = new AtomicInteger();
    var rig = Rig.withOpener(true, task -> {
      Socket socket = task.closeOnStop(new BlockedSocket());
      opens.incrementAndGet();
      return socket;
    });
    {
      Layer layer = rig.ctx.store().seedLayer("Few");
      rig.ctx.store().gap();
      rig.ctx.runUntilIdle();
      rig.addLinkWithoutPeer("tak-" + direction, direction, List.of(layer));
      int seconds = 0;
      if (direction.equals("in")) {
        Stalled.sleep(300); // the task has told the worker that it is in the write
        for (int i = 0; i < 200; i++) {
          rig.advance(Duration.ofSeconds(1));
          Stalled.sleep(5);
        }
        assertThat(opens.get()).as("an in link is not watched: still the first connection").isEqualTo(1);
        assertThat(rig.status()).doesNotContain("write stall");
        return;
      }
      while (seconds < 59) {
        rig.advance(Duration.ofSeconds(1));
        seconds++;
      }
      assertThat(opens.get()).as("not before the limit").isEqualTo(1);
      for (int i = 0; i < 100 && opens.get() == 1; i++) {
        rig.advance(Duration.ofSeconds(1));
        seconds++;
        Stalled.sleep(30);
      }
      assertThat(opens.get()).as("a new connection after " + seconds + " seconds (status: " + rig.status() + ")").isGreaterThanOrEqualTo(2);
      assertThat(seconds).isGreaterThanOrEqualTo(60);
      assertThat(rig.status()).contains("write stall");
    }
  }

  @Test
  void aPeerThatStopsReadingWhileThePresenceEventIsWrittenDoesNotRestartAnInLink() {
    thePresenceWriteBlocks("in");
  }

  @Test
  void aPeerThatStopsReadingWhileThePresenceEventIsWrittenGetsANewConnectionOnABothLink() {
    thePresenceWriteBlocks("both");
  }

  @Test
  void aLinkThatHasWrittenItsPresenceEventAndHasNothingMoreToWriteIsNeverStalled() {
    var rig = new Rig(true, "tak-in");
    TcpPeer peer = rig.peer("tak-in");
    TcpPeer.waitUntil(() -> peer.accepted() == 1, "the connection");
    TcpPeer.waitUntil(() -> peer.conn().received().contains("t-x-c-t"), "the presence event");
    for (int i = 0; i < 300; i++) {
      rig.advance(Duration.ofSeconds(1));
    }
    assertThat(peer.accepted()).as("the presence write finished: nothing to stall on").isEqualTo(1);
    assertThat(rig.status()).doesNotContain("write stall");
  }
}
