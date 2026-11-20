package dev.emcc.sdk.folder;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** SDK 1.6.0 part H (CR-0041; T-157): the marker of a folder relative to the emcc folder. */
class EmccPrefixTest {

  @Test
  void theMarkerIsEmccsOwn() {
    assertThat(LocalFolder.EMCC_PREFIX).isEqualTo("%emcc%/");
    assertThat("%emcc%/settings/terrain").startsWith(LocalFolder.EMCC_PREFIX);
  }
}
