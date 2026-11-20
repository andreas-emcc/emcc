package dev.emcc.sdk.document;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class DocumentsTest {

  @Test
  void keysAreLowercaseWordsDigitsDotsAndHyphens() {
    assertThat(Documents.checkKey("layers")).isEqualTo("layers");
    assertThat(Documents.checkKey("stream.tak-north")).isEqualTo("stream.tak-north");
    assertThat(Documents.checkKey("2026-10-10")).isEqualTo("2026-10-10");
    assertThatThrownBy(() -> Documents.checkKey("Layers")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Documents.checkKey("../other-plugin")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Documents.checkKey("a/b")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Documents.checkKey("")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Documents.checkKey("a".repeat(129))).isInstanceOf(IllegalArgumentException.class);
  }
}
