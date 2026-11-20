package dev.emcc.sdk.stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Permissions;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.SendResult;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** SDK 1.8.0 part E (CR-0044): the stream and conversion types, and the path ECore keeps for streams. */
class StreamTypesTest {

  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final String VIEW = Permissions.ofPlugin("fmv", "view");

  @Test
  void aStreamSpecChecksItsNameMediaTypeAndPermission() {
    var spec = StreamSpec.of("link-1", "video/mp2t", VIEW, LABEL);
    assertThat(spec.name()).isEqualTo("link-1");
    assertThat(spec.label()).isEqualTo(LABEL);
    assertThat(StreamSpec.of("0", "video/mp2t", VIEW, LABEL).name()).isEqualTo("0");
    assertThat(StreamSpec.of("a".repeat(64), "video/mp2t", VIEW, LABEL).name()).hasSize(64);
    for (String bad : new String[] {"", "-a", "Link", "a_b", "a/b", "a.b", "a".repeat(65)}) {
      assertThatThrownBy(() -> StreamSpec.of(bad, "video/mp2t", VIEW, LABEL)).as(bad).isInstanceOf(IllegalArgumentException.class);
    }
    for (String bad : new String[] {"video", "Video/MP2T", "video/mp2t; x=1", "/mp2t"}) {
      assertThatThrownBy(() -> StreamSpec.of("a", bad, VIEW, LABEL)).as(bad).isInstanceOf(IllegalArgumentException.class);
    }
    assertThatThrownBy(() -> StreamSpec.of("a", "video/mp2t", "view", LABEL)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new StreamSpec("a", "video/mp2t", null, LABEL)).isInstanceOf(NullPointerException.class);
    assertThatThrownBy(() -> new StreamSpec("a", "video/mp2t", VIEW, null)).isInstanceOf(NullPointerException.class);
    assertThat(StreamSpec.of("a", "video/mp2t", Permissions.SETTINGS_ADMIN, LABEL).permission()).isEqualTo("settings.admin");
  }

  @Test
  void theLimitsAreTheCrs() {
    assertThat(Streams.PATH).isEqualTo("/stream/");
    assertThat(Streams.MAX_OPEN).isEqualTo(32);
    assertThat(Streams.MAX_CHUNK).isEqualTo(65_536);
    assertThat(Streams.MAX_HEADER).isEqualTo(4_096);
    assertThat(Streams.MAX_RATE).isEqualTo(50_000_000L);
    assertThat(Streams.VIEWER_STALL).hasSeconds(30);
    assertThat(Conversions.START_TIMEOUT).hasSeconds(10);
    assertThat(Conversions.STALL_TIMEOUT).hasSeconds(5);
    assertThat(Conversions.STOP_GRACE).hasSeconds(2);
    assertThat(Conversions.RETRY_AFTER).hasMinutes(1);
  }

  @Test
  void aConversionSpecHasDefaultsAndBounds() {
    StreamRef target = new Target();
    var spec = ConversionSpec.mpeg2ToH264(target);
    assertThat(spec.kind()).isEqualTo(ConversionSpec.Kind.MPEG2_TS_TO_H264_TS);
    assertThat(spec.target()).isSameAs(target);
    assertThat(spec.bitrate()).isEqualTo(4_000_000L);
    assertThat(spec.keyframeSeconds()).isEqualTo(1.0);
    assertThat(spec.bitrate(6_000_000).keyframeSeconds(0.5)).isEqualTo(new ConversionSpec(ConversionSpec.Kind.MPEG2_TS_TO_H264_TS, target, 6_000_000, 0.5));
    assertThat(spec.bitrate(500_000).bitrate()).isEqualTo(500_000);
    assertThat(spec.bitrate(20_000_000).bitrate()).isEqualTo(20_000_000);
    assertThat(spec.keyframeSeconds(10).keyframeSeconds()).isEqualTo(10);
    assertThatThrownBy(() -> spec.bitrate(499_999)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> spec.bitrate(20_000_001)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> spec.keyframeSeconds(0.49)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> spec.keyframeSeconds(10.01)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> spec.keyframeSeconds(Double.NaN)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> ConversionSpec.mpeg2ToH264(null)).isInstanceOf(NullPointerException.class);
  }

  @Test
  void conversionEventsNeedTheirFields() {
    Instant at = Instant.parse("2026-11-14T12:00:00Z");
    ConversionEvent e = new ConversionEvent.Failed("link-1", at, ConversionEvent.Failure.STALLED, "");
    assertThat(e.stream()).isEqualTo("link-1");
    assertThat(e.at()).isEqualTo(at);
    assertThat(new ConversionEvent.Stopped("a", at, "stopped").reason()).isEqualTo("stopped");
    assertThat(ConversionEvent.Failure.values()).containsExactly(ConversionEvent.Failure.UNAVAILABLE, ConversionEvent.Failure.START, ConversionEvent.Failure.STALLED, ConversionEvent.Failure.EXITED);
    assertThatThrownBy(() -> new ConversionEvent.Waiting(null, at)).isInstanceOf(NullPointerException.class);
    assertThatThrownBy(() -> new ConversionEvent.Running("a", null)).isInstanceOf(NullPointerException.class);
    assertThatThrownBy(() -> new ConversionEvent.Failed("a", at, null, "")).isInstanceOf(NullPointerException.class);
  }

  @Test
  void noBrowserEndpointMayUseTheStreamPath() {
    for (String path : new String[] {"/stream", "/stream/", "/stream/{name}", "/stream/a/b"}) {
      assertThatThrownBy(() -> Endpoint.get(path)).as(path).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("/stream/");
      assertThatThrownBy(() -> Endpoint.post(path).requires(VIEW)).as(path).isInstanceOf(IllegalArgumentException.class);
    }
    assertThat(Endpoint.get("/streams").path().template()).isEqualTo("/streams");
    assertThat(Endpoint.get("/streamer/{x}").path().template()).isEqualTo("/streamer/{x}");
    assertThat(Endpoint.get("/links/stream").path().template()).isEqualTo("/links/stream");
    assertThat(Endpoint.service("GET", "/stream/{x}").service()).isTrue(); // served at /api/services/, apart
  }

  @Test
  void streamsAndConversionsAreAbstract() throws Exception {
    assertThat(PluginContext.class.getMethod("streams").isDefault()).isFalse(); // ECore gives it since T-208
    assertThat(PluginContext.class.getMethod("conversions").isDefault()).isFalse(); // since T-211, the 1.8.0 freeze
  }

  /** A stream handle for the specs; it does nothing. */
  private static final class Target implements StreamRef {
    @Override
    public HandleId id() {
      return new HandleId("t");
    }

    @Override
    public String name() {
      return "t";
    }

    @Override
    public SendResult write(Bytes chunk, boolean startPoint) {
      return SendResult.ACCEPTED;
    }

    @Override
    public void header(Bytes header) {}

    @Override
    public void label(SecurityLabel label) {}

    @Override
    public int viewers() {
      return 0;
    }

    @Override
    public void close() {}
  }
}
