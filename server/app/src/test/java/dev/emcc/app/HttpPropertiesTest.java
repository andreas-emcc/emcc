package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import org.junit.jupiter.api.Test;

/** SDK 1.6.0 (CR-0041 part A): the bearer tokens of outbound calls, from local configuration. */
class HttpPropertiesTest {

  @Test
  void theTokensAreGivenByNameAndNeverShown() {
    HttpProperties properties = new HttpProperties(Map.of("anet", new HttpProperties.Credential("s3cret-token")));

    assertThat(properties.tokens()).containsExactly(Map.entry("anet", "s3cret-token"));
    assertThat(properties.toString()).contains("anet").doesNotContain("s3cret");
    assertThat(new HttpProperties.Credential("s3cret-token").toString()).doesNotContain("s3cret");
    assertThat(new HttpProperties(null).tokens()).isEmpty();
  }

  @Test
  void aMissingOrBadTokenOrABadNameStopsTheStartNamingTheSetting() {
    assertThatThrownBy(() -> new HttpProperties(Map.of("anet", new HttpProperties.Credential(" "))).tokens())
        .isInstanceOf(IllegalStateException.class).hasMessage("emc2.http.credentials.anet.token is missing");
    assertThatThrownBy(() -> new HttpProperties(Map.of("anet", new HttpProperties.Credential("two words"))).tokens())
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("emc2.http.credentials.anet.token may hold only visible ASCII")
        .hasMessageNotContaining("two words");
    assertThatThrownBy(() -> new HttpProperties(Map.of("a/b", new HttpProperties.Credential("t"))).tokens())
        .isInstanceOf(IllegalStateException.class).hasMessageStartingWith("emc2.http.credentials.a/b: a credential's name");
  }
}
