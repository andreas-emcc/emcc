package dev.emcc.sdk.http;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import org.junit.jupiter.api.Test;

class PathTemplateTest {

  @Test
  void matchesTilePaths() {
    PathTemplate t = PathTemplate.parse("/tiles/{z}/{x}/{y}.png");
    assertThat(t.names()).containsExactly("z", "x", "y");
    assertThat(t.match("/tiles/5/17/9.png")).isEqualTo(Map.of("z", "5", "x", "17", "y", "9"));
    assertThat(t.match("/tiles/5/17/9.png")).containsKeys("z", "x", "y");
  }

  @Test
  void placeholdersStayInsideOneSegment() {
    PathTemplate t = PathTemplate.parse("/tiles/{z}/{x}/{y}.png");
    assertThat(t.match("/tiles/5/17.png")).isNull();
    assertThat(t.match("/tiles/5/17/9/1.png")).isNull();
    assertThat(t.match("/tiles/5/17/9.jpg")).isNull();
    assertThat(t.match("/tiles/5/17/.png")).isNull();
  }

  @Test
  void literalTextIsQuoted() {
    PathTemplate t = PathTemplate.parse("/a.b/{id}");
    assertThat(t.match("/a.b/7")).isEqualTo(Map.of("id", "7"));
    assertThat(t.match("/aXb/7")).isNull();
  }

  @Test
  void placeholderWithPrefixAndSuffix() {
    PathTemplate t = PathTemplate.parse("/v{major}.{minor}");
    assertThat(t.match("/v1.20")).isEqualTo(Map.of("major", "1", "minor", "20"));
  }

  @Test
  void rejectsBadTemplates() {
    for (String bad : new String[] {"tiles", "/tiles//x", "/{a}{b}", "/{a}/{a}", "/{A}", "/x y", "/tiles/"}) {
      assertThatThrownBy(() -> PathTemplate.parse(bad)).as(bad).isInstanceOf(IllegalArgumentException.class);
    }
  }
}
