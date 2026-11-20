package dev.emcc.plugins.fmv.transport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.plugins.fmv.in.Mapper;
import dev.emcc.plugins.fmv.in.StandardIdentity;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.testkit.TestJson;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** The link's connection and its other settings (brief section 5), and the names it gives its stream and task (section 4). */
class LinkTest {

  private static JsonObject json(String text) {
    return (JsonObject) TestJson.parse(text);
  }

  @Test
  void criterion11_aLinkIdWithCapitalsAndUnderscoresGivesAValidStreamName() {
    String name = Link.streamName("My_Link ID-7");
    assertThat(name).isEqualTo("my-link-id-7");
    assertThat(Pattern.matches("[a-z0-9][a-z0-9-]{0,63}", name)).isTrue();
  }

  @Test
  void theStreamNameStartsWithLLetterOrDigitIsEnoughAndIsCutAt64() {
    assertThat(Link.streamName("-x")).as("a hyphen first").isEqualTo("l--x");
    assertThat(Link.streamName("_x")).isEqualTo("l--x");
    assertThat(Link.streamName("7a")).as("a digit is fine").isEqualTo("7a");
    assertThat(Link.streamName("a".repeat(100))).hasSize(64);
    assertThat(Link.streamName("é")).isEqualTo("l--");
    assertThat(Pattern.matches("[a-z0-9][a-z0-9-]{0,63}", Link.streamName("-".repeat(100)))).isTrue();
  }

  @Test
  void theTaskNameFitsATasksPatternWhateverTheName() {
    for (String name : new String[] {"FMV link 1", "7 up", "a__b", "--", "x".repeat(80), "Ä", "a b  c"}) {
      String key = Link.from(json("{\"name\":\"" + name + "\",\"port\":5000}")).key();
      assertThat(Pattern.matches("[a-z][a-z0-9]*(-[a-z0-9]+)*", key)).as(name + " -> " + key).isTrue();
      assertThat(key.length()).isLessThanOrEqualTo(64);
    }
    assertThat(Link.from(json("{\"name\":\"FMV link 1\",\"port\":5000}")).key()).isEqualTo("fmv-link-1");
  }

  @Test
  void theIdMakesTheKeyAndTheNameMakesTheDataSource() {
    Link l = Link.from(json("{\"id\":\"0192f3a4-7b5c-7d8e-9f01-23456789abcd\",\"name\":\"FMV link 1\",\"port\":5000}"));
    assertThat(l.streamName()).isEqualTo("0192f3a4-7b5c-7d8e-9f01-23456789abcd");
    assertThat(l.key()).isEqualTo("l-0192f3a4-7b5c-7d8e-9f01-23456789abcd");
    assertThat(l.dataSource()).isEqualTo("fmv-link-1");
    Link renamed = Link.from(json("{\"id\":\"0192f3a4-7b5c-7d8e-9f01-23456789abcd\",\"name\":\"Alpha\",\"port\":5000}"));
    assertThat(renamed.key()).as("a rename keeps the key").isEqualTo(l.key());
    assertThat(renamed.sameConnection(l)).isTrue();
    assertThat(renamed.dataSource()).isEqualTo("alpha");
    for (String name : new String[] {"7 up", "a__b", "--", "x".repeat(80), "Ä"}) {
      assertThat(Pattern.matches("[a-z][a-z0-9]*(-[a-z0-9]+)*", Link.from(json("{\"name\":\"" + name + "\",\"port\":5000}")).dataSource())).as(name).isTrue();
    }
  }

  @Test
  void aUnicastLinkListensOnLoopbackUnlessAnAddressIsNamed() {
    Link l = Link.from(json("{\"name\":\"a\",\"port\":5000}"));
    assertThat(l.mode()).isEqualTo(Link.Mode.UDP);
    assertThat(l.listen().address()).isEqualTo("127.0.0.1");
    assertThat(l.listen().port()).isEqualTo(5000);
    assertThat(l.enabled()).isTrue();
    assertThat(Link.from(json("{\"name\":\"a\",\"port\":5000,\"address\":\"0.0.0.0\"}")).listen().address()).isEqualTo("0.0.0.0");
  }

  @Test
  void aMulticastLinkNeedsItsInterfaceAndAGroup() {
    Link l = Link.from(json("{\"name\":\"a\",\"mode\":\"multicast\",\"group\":\"239.1.2.3\",\"port\":5000,\"interface\":\"eth0\"}"));
    assertThat(l.mode()).isEqualTo(Link.Mode.MULTICAST);
    assertThat(l.listen().address()).isEqualTo("239.1.2.3");
    assertThat(l.listen().networkInterface()).isEqualTo("eth0");
    assertThatThrownBy(() -> Link.from(json("{\"name\":\"a\",\"mode\":\"multicast\",\"group\":\"239.1.2.3\",\"port\":5000}")))
        .hasMessageContaining("link a").hasMessageContaining("network interface");
    assertThatThrownBy(() -> Link.from(json("{\"name\":\"a\",\"mode\":\"multicast\",\"port\":5000,\"interface\":\"eth0\"}"))).hasMessageContaining("group");
    assertThatThrownBy(() -> Link.from(json("{\"name\":\"a\",\"mode\":\"multicast\",\"group\":\"10.0.0.1\",\"port\":5000,\"interface\":\"eth0\"}")))
        .hasMessageContaining("not a multicast group");
  }

  @Test
  void aLinkWithoutAPortOrNameIsRefused() {
    assertThatThrownBy(() -> Link.from(json("{\"name\":\"a\"}"))).hasMessageContaining("link a");
    assertThatThrownBy(() -> Link.from(json("{\"port\":5000}"))).hasMessageContaining("needs a name");
    assertThatThrownBy(() -> Link.from(json("{\"name\":\"a\",\"port\":70000}"))).hasMessageContaining("link a");
    assertThatThrownBy(() -> Link.from(json("{\"name\":\"a\",\"port\":5000,\"mode\":\"tcp\"}"))).hasMessageContaining("mode");
  }

  @Test
  void onlyAChangedConnectionReconnects() {
    Link a = Link.from(json("{\"name\":\"a\",\"port\":5000}"));
    assertThat(a.sameConnection(Link.from(json("{\"name\":\"a\",\"port\":5000}")))).isTrue();
    assertThat(a.sameConnection(Link.from(json("{\"name\":\"a\",\"port\":5001}")))).isFalse();
    assertThat(a.sameConnection(Link.from(json("{\"name\":\"a\",\"port\":5000,\"enabled\":false}")))).as("switching off stops the task").isFalse();
  }

  @Test
  void theOtherSettingsHaveTheBriefsDefaults() {
    LinkSettings s = LinkSettings.from(json("{\"name\":\"a\",\"port\":5000}"), "a");
    assertThat(s.cameraSymbol()).isEqualTo("10030100001103002000");
    assertThat(s.cameraIdentity()).isEqualTo(StandardIdentity.FRIEND);
    assertThat(s.fovColour()).isEqualTo("#FFD400");
    assertThat(s.time()).isEqualTo(Mapper.TimeSource.RECEIVED);
    assertThat(s.staleSeconds()).isEqualTo(10);
    assertThat(s.mapClassification()).isTrue();
    assertThat(s.classificationNames()).containsExactly("UNCLASSIFIED", "RESTRICTED", "CONFIDENTIAL", "SECRET", "COSMIC TOP SECRET");
    assertThat(s.targetLayer()).isNull();
    assertThat(s.label()).isNull();
  }

  @Test
  void theOtherSettingsAreChecked() {
    assertThat(LinkSettings.from(json("{\"time\":\"stream\",\"classification\":\"link-label\",\"staleSeconds\":60,\"fovColour\":\"#00ff00\"}"), "a"))
        .satisfies(s -> {
          assertThat(s.time()).isEqualTo(Mapper.TimeSource.STREAM);
          assertThat(s.mapClassification()).isFalse();
          assertThat(s.staleSeconds()).isEqualTo(60);
          assertThat(s.fovColour()).isEqualTo("#00FF00");
        });
    for (String bad : new String[] {"\"time\":\"never\"", "\"staleSeconds\":1", "\"staleSeconds\":301", "\"fovColour\":\"yellow\"", "\"cameraSymbol\":\"123\"",
        "\"cameraIdentity\":\"ally\"", "\"classification\":\"all\"", "\"classificationNames\":[\"A\"]", "\"label\":{\"policy\":\"NATO\"}"}) {
      assertThatThrownBy(() -> LinkSettings.from(json("{" + bad + "}"), "a")).as(bad).hasMessageContaining("link a");
    }
  }
}
