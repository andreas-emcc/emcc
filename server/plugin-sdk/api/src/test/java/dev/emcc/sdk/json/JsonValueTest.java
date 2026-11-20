package dev.emcc.sdk.json;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import org.junit.jupiter.api.Test;

class JsonValueTest {

  @Test
  void numbersKeepTheirTextExactly() {
    String beyondDouble = "0.10000000000000000555111512312578270211815834045410156250001";
    JsonNumber n = JsonNumber.of(beyondDouble);
    assertThat(n.text()).isEqualTo(beyondDouble);
    assertThat(n.bigDecimalValue()).isEqualTo(new BigDecimal(beyondDouble));
    assertThat(JsonNumber.of("123456789012345678901234567890").bigDecimalValue().toPlainString())
        .isEqualTo("123456789012345678901234567890");
  }

  @Test
  void numbersAreEqualByValue() {
    assertThat(JsonNumber.of("1.50")).isEqualTo(JsonNumber.of("1.5")).isEqualTo(JsonNumber.of("15e-1"));
    assertThat(JsonNumber.of("1.50").hashCode()).isEqualTo(JsonNumber.of("15e-1").hashCode());
    assertThat(JsonNumber.of("-0.0")).isEqualTo(JsonNumber.of("0")).hasSameHashCodeAs(JsonNumber.of("0"));
    assertThat(JsonNumber.of("1")).isNotEqualTo(JsonNumber.of("1.0000000000000000000001"));
  }

  @Test
  void rejectsWhatIsNotAJsonNumber() {
    for (String bad : new String[] {"01", "1.", ".5", "+1", "NaN", "1e", "0x10", " 1", ""}) {
      assertThatThrownBy(() -> JsonNumber.of(bad)).as(bad).isInstanceOf(IllegalArgumentException.class);
    }
    assertThatThrownBy(() -> JsonNumber.of(Double.NaN)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void doublesBecomeShortJsonText() {
    assertThat(JsonNumber.of(0.1).text()).isEqualTo("0.1");
    assertThat(JsonNumber.of(1e20).doubleValue()).isEqualTo(1e20);
    assertThat(JsonNumber.of(1e20).text()).doesNotContain("E").doesNotContain("+");
  }

  @Test
  void objectsAreEqualRegardlessOfOrderButKeepIt() {
    var ab = new LinkedHashMap<String, JsonValue>();
    ab.put("a", JsonNumber.of(1));
    ab.put("b", JsonString.of("x"));
    var ba = new LinkedHashMap<String, JsonValue>();
    ba.put("b", JsonString.of("x"));
    ba.put("a", JsonNumber.of("1.0"));
    assertThat(JsonObject.of(ab)).isEqualTo(JsonObject.of(ba)).hasSameHashCodeAs(JsonObject.of(ba));
    assertThat(JsonObject.of(ab).names()).containsExactly("a", "b");
  }

  @Test
  void objectsRejectDuplicateNamesAndAreImmutable() {
    assertThatThrownBy(() -> JsonObject.builder().put("a", JsonNull.INSTANCE).put("a", JsonBoolean.TRUE))
        .isInstanceOf(IllegalArgumentException.class);
    JsonObject o = JsonObject.builder().put("a", JsonNull.INSTANCE).build();
    assertThatThrownBy(() -> o.members().put("b", JsonNull.INSTANCE)).isInstanceOf(UnsupportedOperationException.class);
    assertThat(o.with("b", JsonBoolean.TRUE).size()).isEqualTo(2);
    assertThat(o.size()).isEqualTo(1);
  }

  @Test
  void typedGettersFailClearly() {
    JsonObject settings = JsonObject.builder().put("maxZoom", JsonNumber.of(19)).build();
    assertThat(settings.getNumber("maxZoom").longValueExact()).isEqualTo(19);
    assertThatThrownBy(() -> settings.getString("maxZoom")).hasMessageContaining("not a JsonString");
    assertThatThrownBy(() -> settings.getString("missing")).hasMessageContaining("no member");
  }
}
