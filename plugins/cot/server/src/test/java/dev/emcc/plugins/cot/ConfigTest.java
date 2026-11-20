package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.testkit.TestJson;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ConfigTest {

  private static Config parse(String json) {
    return Config.parse((JsonObject) TestJson.parse(json));
  }

  @Test
  void theManifestsDefaultsAreNoLinkAndTheDocumentedGlobals() {
    Config config = Config.parse(Manifest.settingDefaults());
    assertThat(config.links()).isEmpty();
    assertThat(config.problems()).isEmpty();
    assertThat(config.storedStreams()).isEmpty();
    assertThat(config.globals()).isEqualTo(new Config.Globals(Duration.ofMinutes(5), 65_536, true, "emcc"));
    assertThat(config.globals()).isEqualTo(Config.EMPTY.globals());
    assertThat(config.writeStall()).isEqualTo(Config.EMPTY.writeStall());
  }

  @Test
  void aTcpLinkIsAListEntryWithNamedFields() {
    UUID layer = UUID.fromString("0198a0a0-0000-7000-8000-000000000001");
    Config config = parse("{\"links\":[{\"name\":\"tak-north\",\"direction\":\"in\",\"transport\":\"tls\",\"host\":\"tak.example.local\",\"port\":8089,"
        + "\"targetLayer\":{\"id\":\"" + layer + "\",\"name\":\"TAK North\"},"
        + "\"label\":{\"policy\":\"NATO\",\"classification\":\"NATO RESTRICTED\"},\"enabled\":false}]}");
    assertThat(config.problems()).isEmpty();
    Config.LinkConfig link = config.links().getFirst();
    assertThat(link.name()).isEqualTo("tak-north");
    assertThat(link.direction()).isEqualTo(Config.Direction.IN);
    assertThat(link.transport()).isEqualTo(Config.Transport.TLS);
    assertThat(link.host()).isEqualTo("tak.example.local");
    assertThat(link.port()).isEqualTo(8089);
    assertThat(link.target().id()).isEqualTo(layer);
    assertThat(link.target().name()).isEqualTo("TAK North");
    assertThat(link.label().classification()).isEqualTo("NATO RESTRICTED");
    assertThat(link.enabled()).isFalse();
    assertThat(link.problem()).isNull();
    assertThat(link.where()).isEqualTo("tak.example.local:8089");
  }

  @Test
  void aLinkWithOnlyTheRequiredFieldsUsesTheDefaults() {
    Config.LinkConfig link = parse("{\"links\":[{\"name\":\"tak-north\",\"direction\":\"in\",\"host\":\"h.example.local\",\"port\":8087}]}").links().getFirst();
    assertThat(link.transport()).as("tcp").isEqualTo(Config.Transport.TCP);
    assertThat(link.target()).as("a new layer named like the link").isNull();
    assertThat(link.newLayerName()).isEqualTo("tak-north");
    assertThat(link.label()).as("the server's default label").isNull();
    assertThat(link.enabled()).isTrue();
  }

  @Test
  void aNewLayerGetsTheNameTheAdminGave() {
    Config.LinkConfig link = parse("{\"links\":[{\"name\":\"tak-north\",\"direction\":\"in\",\"host\":\"h.example.local\",\"port\":8087,"
        + "\"targetLayer\":{\"name\":\"Tracks\"}}]}").links().getFirst();
    assertThat(link.target().isNew()).isTrue();
    assertThat(link.newLayerName()).isEqualTo("Tracks");
  }

  @Test
  void aUdpLinkListensOnLoopbackUnlessAnAdminNamesAnAddress() {
    Config.LinkConfig plain = parse("{\"links\":[{\"name\":\"mesh\",\"direction\":\"in\",\"transport\":\"udp\",\"port\":6969}]}").links().getFirst();
    assertThat(plain.problem()).isNull();
    assertThat(plain.listen().address()).isEqualTo("127.0.0.1");
    assertThat(plain.listen().port()).isEqualTo(6969);
    assertThat(plain.host()).isNull();
    assertThat(plain.where()).isEqualTo("127.0.0.1:6969");

    Config.LinkConfig open = parse("{\"links\":[{\"name\":\"mesh\",\"direction\":\"in\",\"transport\":\"udp\",\"address\":\"0.0.0.0\",\"port\":6969}]}").links().getFirst();
    assertThat(open.listen().address()).isEqualTo("0.0.0.0");
  }

  @Test
  void aMulticastLinkNeedsItsGroupAndAnInterface() {
    Config.LinkConfig ok = parse("{\"links\":[{\"name\":\"mesh\",\"direction\":\"in\",\"transport\":\"multicast\",\"address\":\"239.2.3.1\",\"port\":6969,\"interface\":\"eth0\"}]}")
        .links().getFirst();
    assertThat(ok.problem()).isNull();
    assertThat(ok.listen().networkInterface()).isEqualTo("eth0");
    assertThat(ok.where()).isEqualTo("239.2.3.1:6969 on eth0");

    Config none = parse("{\"links\":[{\"name\":\"mesh\",\"direction\":\"in\",\"transport\":\"multicast\",\"address\":\"239.2.3.1\",\"port\":6969}]}");
    Config.LinkConfig stopped = none.links().getFirst();
    assertThat(stopped.problem()).as("the link stays stopped and says why").contains("an admin names one");
    assertThat(none.problems()).hasSize(1);

    Config.LinkConfig noGroup = parse("{\"links\":[{\"name\":\"mesh\",\"direction\":\"in\",\"transport\":\"multicast\",\"port\":6969,\"interface\":\"eth0\"}]}").links().getFirst();
    assertThat(noGroup.problem()).contains("group");
  }

  @Test
  void aTcpLinkWithoutAHostOrPortStaysStoppedAndSaysWhy() {
    Config.LinkConfig noHost = parse("{\"links\":[{\"name\":\"a\",\"direction\":\"in\",\"port\":1}]}").links().getFirst();
    assertThat(noHost.problem()).isEqualTo("the host is missing");
    Config.LinkConfig bad = parse("{\"links\":[{\"name\":\"a\",\"direction\":\"in\",\"host\":\"h.example.local\",\"port\":70000}]}").links().getFirst();
    assertThat(bad.problem()).isEqualTo("the port must be 1 to 65535");
  }

  @Test
  void aTcpLinkNeverReadsAnAddressOrAnInterface() {
    // "address" and "interface" belong to the links that listen; a TCP link's peer is host and port only.
    Config.LinkConfig link = parse("{\"links\":[{\"name\":\"a\",\"direction\":\"in\",\"host\":\"h.example.local\",\"port\":8087,\"address\":\"10.9.9.9\"}]}").links().getFirst();
    assertThat(link.host()).isEqualTo("h.example.local");
    assertThat(link.listen()).isNull();
  }

  @Test
  void badEntriesAreLeftOutAndReportedAndTheGoodOnesStay() {
    Config config = parse("{\"links\":["
        + "{\"name\":\"ok-1\",\"direction\":\"in\",\"host\":\"h.example.local\",\"port\":1},"
        + "{\"name\":\"Bad\",\"direction\":\"in\",\"host\":\"h.example.local\",\"port\":1},"
        + "{\"name\":\"manual\",\"direction\":\"in\",\"host\":\"h.example.local\",\"port\":1},"
        + "{\"name\":\"odd\",\"direction\":\"in\",\"host\":\"h.example.local\",\"port\":1,\"transport\":\"carrier-pigeon\"},"
        + "{\"name\":\"label\",\"direction\":\"in\",\"host\":\"h.example.local\",\"port\":1,\"label\":{\"policy\":\"NATO\"}},"
        + "{\"name\":\"layer\",\"direction\":\"in\",\"host\":\"h.example.local\",\"port\":1,\"targetLayer\":{\"id\":\"not-a-uuid\",\"name\":\"x\"}},"
        + "{\"name\":\"dir\",\"direction\":\"sideways\",\"host\":\"h.example.local\",\"port\":1},"
        + "{\"name\":\"ok-1\",\"direction\":\"in\",\"host\":\"h.example.local\",\"port\":2},"
        + "\"not an object\"]}");
    assertThat(config.links()).extracting(Config.LinkConfig::name).containsExactly("ok-1");
    assertThat(config.problems()).hasSize(8);
  }

  @Test
  void aNameInAProblemIsCleanedOfControlCharacters() {
    Config config = parse("{\"links\":[{\"name\":\"Bad\\nERROR forged\",\"direction\":\"in\"}]}");
    assertThat(config.problems()).hasSize(1);
    assertThat(config.problems().getFirst()).doesNotContain("\n");
  }

  @Test
  void storedStreamsOfEarlierVersionsAreNotReadButNamed() {
    Config config = parse("{\"streams\":[{\"name\":\"tak-north\",\"host\":\"h.example.local\",\"port\":8087},{\"name\":\"tak-south\",\"host\":\"h2.example.local\",\"port\":8089}]}");
    assertThat(config.links()).isEmpty();
    assertThat(config.storedStreams()).containsExactly("tak-north", "tak-south");
    assertThat(config.problems()).isEmpty();
  }

  @Test
  void globalsOutOfRangeFallBackToTheDefaults() {
    Config config = parse("{\"idleTimeoutSeconds\":0,\"maxEventBytes\":10,\"sendPresence\":false,\"presenceCallsign\":\"base-1\"}");
    assertThat(config.globals()).isEqualTo(new Config.Globals(Duration.ofMinutes(5), 65_536, false, "base-1"));
    assertThat(config.problems()).hasSize(2);
  }

  @Test
  void globalsInRangeAreUsed() {
    Config config = parse("{\"idleTimeoutSeconds\":45,\"maxEventBytes\":2048}");
    assertThat(config.globals().idle()).isEqualTo(Duration.ofSeconds(45));
    assertThat(config.globals().maxEventBytes()).isEqualTo(2048);
    assertThat(config.problems()).isEmpty();
  }

  @Test
  void theWriteStallLimitIsSixtySecondsFiveToAnHourAndOutOfRangeIsAProblem() {
    assertThat(parse("{}").writeStall()).isEqualTo(Duration.ofSeconds(60));
    assertThat(parse("{\"writeStallSeconds\":5}").writeStall()).isEqualTo(Duration.ofSeconds(5));
    assertThat(parse("{\"writeStallSeconds\":3600}").writeStall()).isEqualTo(Duration.ofHours(1));
    for (String bad : new String[] {"4", "0", "3601", "-1", "1.5"}) {
      Config config = parse("{\"writeStallSeconds\":" + bad + "}");
      assertThat(config.writeStall()).as(bad).isEqualTo(Duration.ofSeconds(60));
      assertThat(config.problems()).as(bad).hasSize(1);
      assertThat(config.problems().getFirst()).contains("writeStallSeconds must be 5 to 3600");
    }
  }

  @Test
  void aChangeOfTheWriteStallLimitDoesNotReconnectTheLinks() {
    assertThat(parse("{\"writeStallSeconds\":5}").globals()).isEqualTo(parse("{}").globals());
  }

  @Test
  void theSameConnectionIgnoresTheTargetLayerAndLabel() {
    Config.LinkConfig a = parse("{\"links\":[{\"name\":\"s\",\"direction\":\"in\",\"host\":\"h.example.local\",\"port\":1}]}").links().getFirst();
    Config.LinkConfig b = parse("{\"links\":[{\"name\":\"s\",\"direction\":\"in\",\"host\":\"h.example.local\",\"port\":1,\"targetLayer\":{\"name\":\"Other\"}}]}").links().getFirst();
    Config.LinkConfig c = parse("{\"links\":[{\"name\":\"s\",\"direction\":\"in\",\"host\":\"h.example.local\",\"port\":2}]}").links().getFirst();
    Config.LinkConfig d = parse("{\"links\":[{\"name\":\"s\",\"direction\":\"in\",\"transport\":\"tls\",\"host\":\"h.example.local\",\"port\":1}]}").links().getFirst();
    assertThat(a.sameConnection(b)).isTrue();
    assertThat(a.sameConnection(c)).isFalse();
    assertThat(a.sameConnection(d)).isFalse();
  }

  // ---------------------------------------------------------------- out and both (brief functions 11, 12, 14, 18, 20)

  private static final String LAYER = "{\"id\":\"0198a0a0-0000-7000-8000-000000000001\",\"name\":\"Own forces\"}";

  @Test
  void anOutLinkHasSourceLayersALimitAndTheTimes() {
    Config.LinkConfig link = parse("{\"links\":[{\"name\":\"tak-out\",\"direction\":\"out\",\"host\":\"h.example.local\",\"port\":8087,\"sourceLayers\":[" + LAYER + "],"
        + "\"highestClassification\":{\"policy\":\"NATO\",\"classification\":\"RESTRICTED\"},\"staleSeconds\":45,\"refreshSeconds\":15}]}").links().getFirst();
    assertThat(link.problem()).isNull();
    assertThat(link.direction()).isEqualTo(Config.Direction.OUT);
    assertThat(link.direction().sends()).isTrue();
    assertThat(link.direction().receives()).isFalse();
    assertThat(link.sourceLayers()).hasSize(1);
    assertThat(link.limit()).isNotNull();
    assertThat(link.staleSeconds()).isEqualTo(45);
    assertThat(link.refreshSeconds()).isEqualTo(15);
  }

  @Test
  void theTimesDefaultToSixtyAndThirtySecondsAndAreChecked() {
    Config.LinkConfig plain = parse("{\"links\":[{\"name\":\"a\",\"direction\":\"out\",\"host\":\"h.example.local\",\"port\":1}]}").links().getFirst();
    assertThat(plain.staleSeconds()).isEqualTo(60);
    assertThat(plain.refreshSeconds()).isEqualTo(30);
    assertThat(plain.limit()).as("absent: the server's default label's classification").isNull();
    assertThat(plain.sourceLayers()).isEmpty();

    Config bad = parse("{\"links\":[{\"name\":\"a\",\"direction\":\"out\",\"host\":\"h.example.local\",\"port\":1,\"staleSeconds\":0,\"refreshSeconds\":100000}]}");
    assertThat(bad.links().getFirst().staleSeconds()).isEqualTo(60);
    assertThat(bad.links().getFirst().refreshSeconds()).isEqualTo(30);
    assertThat(bad.problems()).hasSize(2);
    assertThat(parse("{\"links\":[{\"name\":\"a\",\"direction\":\"out\",\"host\":\"h\",\"port\":1,\"refreshSeconds\":0}]}").links().getFirst().refreshSeconds())
        .as("0 is allowed: only changes go out").isZero();
  }

  @Test
  void aSourceLayerMustBeAnExistingLayerAndAnInLinkIgnoresTheOnesItKeeps() {
    Config.LinkConfig fresh = parse("{\"links\":[{\"name\":\"a\",\"direction\":\"out\",\"host\":\"h\",\"port\":1,\"sourceLayers\":[{\"name\":\"New\"}]}]}").links().getFirst();
    assertThat(fresh.problem()).contains("existing layer");
    Config.LinkConfig in = parse("{\"links\":[{\"name\":\"a\",\"direction\":\"in\",\"host\":\"h\",\"port\":1,\"sourceLayers\":[" + LAYER + "]}]}").links().getFirst();
    assertThat(in.problem()).as("kept from an earlier both: valid (criterion 31)").isNull();
    assertThat(in.sourceLayers()).as("and ignored").isEmpty();
    Config.LinkConfig inNew = parse("{\"links\":[{\"name\":\"a\",\"direction\":\"in\",\"host\":\"h\",\"port\":1,\"sourceLayers\":[{\"name\":\"New\"}]}]}").links().getFirst();
    assertThat(inNew.problem()).as("a greyed field is not checked beyond its shape").isNull();
    assertThat(parse("{\"links\":[{\"name\":\"a\",\"direction\":\"out\",\"host\":\"h\",\"port\":1,\"sourceLayers\":\"no\"}]}").links()).isEmpty();
    assertThat(parse("{\"links\":[{\"name\":\"a\",\"direction\":\"out\",\"host\":\"h\",\"port\":1,\"highestClassification\":{\"policy\":\"NATO\"}}]}").links()).isEmpty();
  }

  @Test
  void aUdpLinkThatSendsNeedsAHostAndAPortAndABothLinkAlsoListens() {
    Config.LinkConfig out = parse("{\"links\":[{\"name\":\"a\",\"direction\":\"out\",\"transport\":\"udp\",\"host\":\"10.1.2.3\",\"port\":6969}]}").links().getFirst();
    assertThat(out.problem()).isNull();
    assertThat(out.host()).isEqualTo("10.1.2.3");
    assertThat(out.listen()).as("an out link listens on nothing").isNull();
    assertThat(out.where()).isEqualTo("to 10.1.2.3:6969");

    Config.LinkConfig noHost = parse("{\"links\":[{\"name\":\"a\",\"direction\":\"out\",\"transport\":\"udp\",\"port\":6969}]}").links().getFirst();
    assertThat(noHost.problem()).isEqualTo("the host is missing");

    Config.LinkConfig both = parse("{\"links\":[{\"name\":\"a\",\"direction\":\"both\",\"transport\":\"udp\",\"host\":\"127.0.0.2\",\"port\":6969}]}").links().getFirst();
    assertThat(both.problem()).isNull();
    assertThat(both.listen().address()).as("loopback unless an admin sets another address").isEqualTo("127.0.0.1");
    assertThat(both.host()).isEqualTo("127.0.0.2");
    assertThat(both.where()).isEqualTo("127.0.0.1:6969 and to 127.0.0.2:6969");
  }

  @Test
  void aMulticastLinkNeedsItsInterfaceInEveryDirection() {
    for (String direction : new String[] {"in", "out", "both"}) {
      Config.LinkConfig stopped = parse("{\"links\":[{\"name\":\"a\",\"direction\":\"" + direction + "\",\"transport\":\"multicast\",\"address\":\"239.2.3.1\",\"port\":6969}]}").links().getFirst();
      assertThat(stopped.problem()).as(direction).contains("an admin names one");
      Config.LinkConfig ok = parse("{\"links\":[{\"name\":\"a\",\"direction\":\"" + direction + "\",\"transport\":\"multicast\",\"address\":\"239.2.3.1\",\"port\":6969,\"interface\":\"eth0\"}]}").links().getFirst();
      assertThat(ok.problem()).as(direction).isNull();
    }
  }
}
