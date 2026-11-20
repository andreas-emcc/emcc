package dev.emcc.sdk.stream;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.compute.ComputeRef;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;
import java.util.function.Function;

/**
 * SDK 1.8.0 (CR-0044 E2; ADR-0057 point 8; CR-0045): ECore's conversion service. ECore runs a
 * shipped ffmpeg as a separate process per conversion and owns the process, its pipes and its
 * stop; plugins never start a program. The plugin feeds the input through the {@link
 * ConversionRef}, and the output goes straight from the process into the target stream, never back
 * through the plugin: ECore reads the output's PAT, PMT and random access indicators and sets the
 * stream's header and start points itself. SDK 1.9.0 adds encoders ({@link #encode}): raw pictures in, the
 * access units back to the plugin's compute task (CR-0050).
 *
 * <pre>{@code
 * ConversionRef mpeg2 = context.conversions().start(
 *     ConversionSpec.mpeg2ToH264(video), links, LinkMsg.Conversion::new);
 * task.post(new LinkMsg.Convert(mpeg2));   // the connection task writes the datagrams to it
 * }</pre>
 *
 * <p><b>Slots</b> (owner, 2026-11-14, A): the ECore setting {@code emc2.conversions.max} (default
 * 2, about half a core each) caps the conversions that run. One that finds no free slot gets
 * {@link ConversionEvent.Waiting}, takes the next slot that frees, in the order they asked, and then
 * gets {@link ConversionEvent.Running}. Its input is dropped until then.
 *
 * <p><b>The process:</b> ffmpeg from the ECore setting {@code emc2.conversions.ffmpeg}, by default
 * the release's {@code tools/ffmpeg/}; fixed arguments, pipes only, no network and no files; at the
 * operating system's lower priority where the platform allows. Its timeouts: {@link #START_TIMEOUT},
 * {@link #STALL_TIMEOUT} and {@link #STOP_GRACE}. ECore never restarts a failed conversion; the
 * plugin may start it again after {@link #RETRY_AFTER}. ECore counts per conversion its state, the
 * bytes in and out, the dropped input and, where the platform gives it, the CPU time.
 */
public interface Conversions {

  /** A conversion that gives no output this long after its first input fails ({@link ConversionEvent.Failure#START}). */
  Duration START_TIMEOUT = Duration.ofSeconds(10);

  /** A conversion that gives no output this long while input arrives fails ({@link ConversionEvent.Failure#STALLED}). */
  Duration STALL_TIMEOUT = Duration.ofSeconds(5);

  /** At a stop ECore closes the process's input, and kills it after this long. */
  Duration STOP_GRACE = Duration.ofSeconds(2);

  /** How long after a target's conversion failed before the plugin may start one for it again. */
  Duration RETRY_AFTER = Duration.ofMinutes(1);

  /**
   * Starts a conversion into {@code spec.target()} and returns at once; {@link ConversionEvent}s go
   * to {@code events}, converted by {@code toMessage} (plugin code: pure, non-blocking, run in that
   * worker), always delivered and in order, as {@code Connections.start}'s are. The first event is
   * {@code Waiting} or {@code Running}; without a converter (none installed, or the setting names
   * none) the only event is {@code Failed} with {@link ConversionEvent.Failure#UNAVAILABLE} (owner,
   * T-211).
   *
   * @throws IllegalStateException if the target is closed, already the target of a conversion that
   *     has not ended, or its last conversion failed less than {@link #RETRY_AFTER} ago
   */
  <M extends Message> ConversionRef start(ConversionSpec spec, WorkerRef<M> events, Function<ConversionEvent, ? extends M> toMessage);

  /**
   * SDK 1.9.0 (CR-0050 point 1; ADR-0059 point 7; owner, UQ1 A and UQ2 A): starts an encoder, raw
   * I420 pictures in ({@link EncoderRef#write}), H.264 access units back into the compute task
   * {@code output}, and returns at once.
   *
   * <ul>
   *   <li><b>The output:</b> each {@link EncodedPicture}, through {@code toItem} (plugin code: pure,
   *       non-blocking), is posted to {@code output} with its inbox's overflow policy, never
   *       blocking; ECore counts what the inbox drops. {@code output} is a compute task of this
   *       plugin. An inbox item should give each picture a coalesce key of its own (e.g. {@link
   *       EncodedPicture#sequence()}), and the inbox should leave room for {@link
   *       EncoderRef#MAX_WAITING} pictures in flight.
   *   <li><b>The events:</b> {@link ConversionEvent}s to {@code events}, as for {@link #start}: the
   *       first is {@code Waiting} or {@code Running}; their {@code stream()} is the encoder's name.
   *   <li><b>A slot:</b> a running encoder takes one conversion slot, shared with the MPEG-2
   *       conversions ({@code emc2.conversions.max}).
   *   <li><b>The process:</b> as for {@link #start}, with the same timeouts and {@link #RETRY_AFTER};
   *       without a converter the only event is {@code Failed} with {@link
   *       ConversionEvent.Failure#UNAVAILABLE}.
   * </ul>
   *
   * <pre>{@code
   * EncoderRef encoder = context.conversions().encode(EncoderSpec.of("uav-north", 1280, 720, 25),
   *     render, LinkItem.Encoded::new, links, LinkMsg.Encoder::new);
   * render.post(new LinkItem.Start(encoder));   // the task writes its pictures to it
   * }</pre>
   *
   * <p>Abstract since the 1.9.0 freeze, with part U (a default method that threw until ECore gave
   * it, C10). The test kit's {@code FakeConversions} gives it.
   *
   * @throws IllegalArgumentException if {@code output} is not a compute task of this plugin
   * @throws IllegalStateException if an encoder of that name has not ended, or its last one failed
   *     less than {@link #RETRY_AFTER} ago
   */
  <I extends Message, M extends Message> EncoderRef encode(EncoderSpec spec, ComputeRef<I> output, Function<EncodedPicture, ? extends I> toItem,
      WorkerRef<M> events, Function<ConversionEvent, ? extends M> toMessage);
}
