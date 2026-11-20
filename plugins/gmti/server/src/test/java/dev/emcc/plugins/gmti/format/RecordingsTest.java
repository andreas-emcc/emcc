package dev.emcc.plugins.gmti.format;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.testkit.TestJson;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/**
 * The decoder against the owner's recordings, read <b>where they are</b> (brief section 7: never
 * copied into the repository). Neither the recordings nor their names and counts are in the
 * repository: the folder comes only from {@code EMC2_GMTI_DATA}, and a list in it, {@value #LIST}
 * (kept there, never in git), names each file by its path in the folder and what it holds, as the
 * ESA's sheet counts them: packets, dwell segments, reports.
 *
 * <pre>{@code
 * {
 *   "recordings": [
 *     { "file": "<path in the folder>", "packets": 120, "dwells": 100, "reports": 900 },
 *     ...
 *   ],
 *   "replay": { ... }    (ReplayTest's, described there)
 * }
 * }</pre>
 *
 * Without the variable or the list the tests are skipped, and say why; a listed file that is not
 * there fails. The pcap files are the playback's business: they need a pcap reader, which the
 * plugin has no use for.
 */
public class RecordingsTest {

  /** Why a test that reads the recordings is skipped without the variable. */
  public static final String UNSET = "EMC2_GMTI_DATA is not set: it names the folder of the owner's GMTI recordings";

  /** The list's name in the folder. */
  public static final String LIST = "recordings.json";

  /** The recordings' folder, from {@code EMC2_GMTI_DATA} only; empty when it is unset or blank. */
  public static Optional<Path> folder() {
    String env = System.getenv("EMC2_GMTI_DATA");
    return env == null || env.isBlank() ? Optional.empty() : Optional.of(Path.of(env));
  }

  /** The folder's list; the calling test is skipped, with the reason, without the variable or the list. */
  public static JsonObject list() throws IOException {
    Path folder = folder().orElse(null);
    Assumptions.assumeTrue(folder != null, UNSET);
    Path list = folder.resolve(LIST);
    Assumptions.assumeTrue(Files.isRegularFile(list), "no " + LIST + " in EMC2_GMTI_DATA: it lists the recordings and what each holds");
    return (JsonObject) TestJson.parse(Files.readString(list));
  }

  /** A file the list names, by its path in the folder. */
  public static Path file(String path) {
    return folder().orElseThrow().resolve(path);
  }

  @Test
  void everyListedRecordingDecodesWithItsCounts() throws IOException {
    JsonObject list = list();
    var recordings = (JsonArray) list.get("recordings");
    assertThat(recordings).as("the list's \"recordings\"").isNotNull();
    assertThat(recordings.size()).as("the list names recordings").isPositive();
    for (JsonValue v : recordings.values()) {
      var r = (JsonObject) v;
      String path = r.getString("file");
      Path file = file(path);
      assertThat(file).as("%s, as listed", path).isRegularFile();
      long[] counted = count(Files.readAllBytes(file), path);
      assertThat(counted).as(path).containsExactly(
          r.getNumber("packets").longValueExact(), r.getNumber("dwells").longValueExact(), r.getNumber("reports").longValueExact());
    }
  }

  /** Frames the bytes by {@code P2} (reference 5) and decodes each packet: packets, dwells, reports. */
  private static long[] count(byte[] bytes, String name) {
    long packets = 0;
    long dwells = 0;
    long reports = 0;
    int at = 0;
    while (at < bytes.length) {
      assertThat(bytes.length - at).as("%s: a whole header at %d", name, at).isGreaterThanOrEqualTo(Decoder.HEADER);
      int size = (int) Decoder.packetSize(bytes, at);
      Decoded d = Decoder.decode(bytes, at, size);
      assertThat(d.reason()).as("%s: packet %d at %d: %s", name, packets, at, d.detail()).isNull();
      assertThat(d.packet().valuesOutOfRange()).isZero();
      for (Segment s : d.packet().segments()) {
        if (s instanceof Dwell dwell) {
          dwells++;
          reports += dwell.reports().size();
        }
      }
      packets++;
      at += size;
    }
    return new long[] {packets, dwells, reports};
  }
}
