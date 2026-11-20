package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelList;
import dev.emcc.sdk.channel.ChannelRef;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.channel.ChannelState;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** SDK 1.9.0 part U (CR-0050 point 2; UQ4 A): a channel's state in the test kit, as senders see it. */
class FakeChannelsStateTest {

  sealed interface Msg extends Message permits Item, Channels {}

  record Item(ChannelItem item) implements Msg {}

  record Channels(ChannelList list) implements Msg {}

  private static final ChannelId NORTH = new ChannelId("fmv", "uav-north");
  private static final ChannelId TAK = new ChannelId("cot", "tak-north");

  private final List<Msg> received = new ArrayList<>();

  private WorkerRef<Msg> worker(FakePluginContext ctx) {
    return ctx.workers().spawn(WorkerSpec.of("link", Msg.class, () -> (m, c) -> received.add(m)));
  }

  private List<ChannelList> lists() {
    return received.stream().filter(Channels.class::isInstance).map(m -> ((Channels) m).list()).toList();
  }

  private static ChannelInfo find(ChannelList list, ChannelId id) {
    return list.channels().stream().filter(c -> c.id().equals(id)).findFirst().orElseThrow();
  }

  @Test
  void theOfferingPluginSetsItsStateAndWatchersSeeEachChange() {
    var ctx = FakePluginContext.builder("fmv").build();
    WorkerRef<Msg> w = worker(ctx);
    ChannelRef ref = ctx.channels().offer(ChannelSpec.of("uav-north", "UAV North (out)", "stanag-4609"), w, Item::new);
    ctx.channels().watch(w, Channels::new);
    ctx.runUntilIdle();
    assertThat(find(lists().getLast(), NORTH).state()).isEqualTo(ChannelState.READY);
    int before = lists().size();

    ref.state(ChannelState.NOT_SENDING, "No destination");
    ctx.runUntilIdle();
    assertThat(lists()).hasSize(before + 1);
    assertThat(find(lists().getLast(), NORTH).state()).isEqualTo(ChannelState.NOT_SENDING);
    assertThat(find(lists().getLast(), NORTH).stateDetail()).isEqualTo("No destination");
    assertThat(ctx.channels().offered().getFirst().state()).isEqualTo(ChannelState.NOT_SENDING);

    ref.state(ChannelState.NOT_SENDING, "No destination"); // the same: no new list
    ctx.runUntilIdle();
    assertThat(lists()).hasSize(before + 1);

    // coalesced: two changes before the worker runs give the latest list only
    ref.state(ChannelState.DEGRADED, "Frames late");
    ref.state(ChannelState.READY, "");
    ctx.runUntilIdle();
    assertThat(lists()).hasSize(before + 2);
    assertThat(find(lists().getLast(), NORTH).state()).isEqualTo(ChannelState.READY);

    assertThatThrownBy(() -> ref.state(ChannelState.DEGRADED, "x".repeat(129))).isInstanceOf(IllegalArgumentException.class);
    ref.withdraw();
    ref.state(ChannelState.DEGRADED, "after"); // does nothing once withdrawn
    assertThat(ctx.channels().offered()).isEmpty();
  }

  @Test
  void aScriptedChannelsStateIsSetByTheTest() {
    var ctx = FakePluginContext.builder("uav-simulation").build();
    WorkerRef<Msg> w = worker(ctx);
    ctx.channels().addOther(ChannelInfo.of("fmv", ChannelSpec.of("uav-north", "UAV North (out)", "stanag-4609")).withState(ChannelState.NOT_SENDING, "No render thread"));
    ctx.channels().addOther(ChannelInfo.of("cot", ChannelSpec.of("tak-north", "TAK North (out)", "cot")));
    ctx.channels().watch(w, Channels::new);
    ctx.runUntilIdle();
    assertThat(find(lists().getLast(), NORTH).stateDetail()).isEqualTo("No render thread");
    assertThat(find(lists().getLast(), TAK).state()).isEqualTo(ChannelState.READY);

    ctx.channels().setOtherState(NORTH, ChannelState.READY, "");
    ctx.runUntilIdle();
    assertThat(find(lists().getLast(), NORTH).state()).isEqualTo(ChannelState.READY);
    assertThatThrownBy(() -> ctx.channels().setOtherState(new ChannelId("fmv", "none"), ChannelState.READY, "")).isInstanceOf(IllegalArgumentException.class);
  }
}
