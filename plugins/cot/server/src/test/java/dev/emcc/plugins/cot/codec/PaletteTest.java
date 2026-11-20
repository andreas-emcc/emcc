package dev.emcc.plugins.cot.codec;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.cot.Manifest;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Brief function 32 and criterion 46 (M7, T-156): the manifest's palette "CoT" has the rows of the closed APP-6D and APP-6E table, in its
 * order, with the standard identity friend, and each of its codes goes out as the row's CoT type. A row removed from the manifest only, or
 * added to the table only, fails here (and {@code node plugins/cot/generate-palette.mjs --check} says what to regenerate).
 */
class PaletteTest {

  private static List<JsonObject> palette() {
    JsonArray palettes = (JsonArray) Manifest.read().get("symbolPalettes");
    assertThat(palettes.values()).as("one palette").hasSize(1);
    JsonObject cot = (JsonObject) palettes.get(0);
    assertThat(cot.getString("id")).isEqualTo("cot");
    assertThat(cot.getString("name")).isEqualTo("CoT");
    return ((JsonArray) cot.get("symbols")).values().stream().map(v -> (JsonObject) v).toList();
  }

  /** The row's CoT type without its affiliation, e.g. {@code G-U-C-I} for {@code 10121100=GUCI}. */
  private static String typeOf(String row) {
    String function = row.substring(row.indexOf('=') + 1);
    return String.join("-", function.split(""));
  }

  @Test
  void thePaletteHasTheRowsOfTheTableInItsOrderWithTheIdentityFriend() {
    List<String> rows = CotSymbolsNumeric.rows();
    List<JsonObject> symbols = palette();
    assertThat(rows).hasSize(CotSymbolsNumeric.COUNT);
    assertThat(symbols).as("one symbol per row of the table").hasSize(rows.size());
    for (int i = 0; i < rows.size(); i++) {
      String row = rows.get(i);
      String set = row.substring(0, 2);
      String entity = row.substring(2, 8);
      JsonObject symbol = symbols.get(i);
      assertThat(symbol.getString("standard")).as(row).isEqualTo("APP-6D");
      // version 10, context reality, identity friend, the symbol set, status present, no HQ, no amplifier, the entity, no sectors
      assertThat(symbol.getString("code")).as(row).isEqualTo("1003" + set + "0000" + entity + "0000");
      String label = symbol.getString("label");
      assertThat(label).as(row).startsWith(typeOf(row));
      assertThat(label.length()).as(row + ": the schema's limit").isBetween(1, 128);
    }
    assertThat(symbols.stream().map(s -> s.getString("code")).distinct()).as("each code once").hasSize(rows.size());
  }

  @Test
  void eachCodeGoesOutAsTheRowsCotTypeThroughTheCodec() {
    List<String> rows = CotSymbolsNumeric.rows();
    List<JsonObject> symbols = palette();
    for (int i = 0; i < rows.size(); i++) {
      String code = symbols.get(i).getString("code");
      var content = new MapObjectContent("core.symbol", "core.general", "manual", null, UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e02"),
          new Geometry.Point(Position.of(11.9746, 57.7089)), new Symbol(SymbolStandard.APP_6D, code, null), null, new ObjectProperties("P" + i, null),
          SecurityLabel.of("NATO", "UNCLASSIFIED"), Extensions.empty());
      CotMapper.Encoded encoded = CotMapper.encode("p" + i, content, Instant.parse("2026-11-12T12:00:00Z"), Instant.parse("2026-11-12T12:01:00Z"));
      assertThat(encoded.skip()).as(code).isNull();
      assertThat(encoded.event().type()).as(rows.get(i) + " " + code).isEqualTo("a-f-" + typeOf(rows.get(i)));
    }
  }
}
