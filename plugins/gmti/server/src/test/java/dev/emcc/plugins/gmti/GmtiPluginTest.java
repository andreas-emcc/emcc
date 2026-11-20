package dev.emcc.plugins.gmti;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.DataType;
import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.FieldSet;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.RelationKind;
import dev.emcc.sdk.testkit.FakePluginContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The plugin's behaviour, with the test kit's fake context: deterministic, nothing runs by itself. */
class GmtiPluginTest {

  private FakePluginContext context;
  private Plugin plugin;

  @BeforeEach
  void startLikeThePluginHost() throws Exception {
    // As the host does it: the entry class from plugin.json, the manifest's declarations, init, then start.
    context = Manifest.context().build();
    plugin = (Plugin) Class.forName(Manifest.entryClass()).getConstructor().newInstance();
    plugin.init(context);
    plugin.start();
  }

  @Test
  void reportsOkWithoutLinksAndStopsCleanly() {
    context.runUntilIdle();
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);
    assertThat(context.effectiveStatus().detail()).isEqualTo("no links");
    plugin.stop();
    assertThat(context.handlerErrors()).isEmpty();
  }

  @Test
  void criterion15_theManifestsDeclarationsValidateAndTheContextListsThem() {
    assertThat(context.dataTypes()).extracting(DataType::id).contains("gmti.detection", "gmti.platform", "gmti.dwell-area");
    DataType detection = context.dataTypes().stream().filter(t -> t.id().equals("gmti.detection")).findFirst().orElseThrow();
    assertThat(detection.defaults()).isEqualTo(new DataType.Defaults(60L, true, 120L));
    DataType platform = context.dataTypes().stream().filter(t -> t.id().equals("gmti.platform")).findFirst().orElseThrow();
    assertThat(platform.defaults()).isEqualTo(new DataType.Defaults(300L, true, 600L));
    DataType area = context.dataTypes().stream().filter(t -> t.id().equals("gmti.dwell-area")).findFirst().orElseThrow();
    assertThat(area.name()).as("T-192, CR-0042 option A").isEqualTo("GMTI dwell area");
    assertThat(area.defaults()).as("M8, T-195; owner, 2026-11-16: gone at 15 s, when the default fade makes it invisible; no expiry fade")
        .isEqualTo(new DataType.Defaults(15L, false, 0L));
    assertThat(area.manual()).isFalse();

    assertThat(context.fieldSets()).extracting(FieldSet::id).containsExactly("gmti.report");
    FieldSet report = context.fieldSets().getFirst();
    assertThat(report.label()).isEqualTo("GMTI report");
    assertThat(report.fields()).containsExactly(
        "radialVelocity", "wrapVelocity", "snr", "classification", "classProbability", "slantRangeError", "crossRangeError", "heightError",
        "radialVelocityError", "rcs", "truthTag", "jobId", "revisitIndex", "dwellIndex", "reportIndex");
    assertThat(context.declaredFields()).extracting(DeclaredField::name).containsExactlyInAnyOrderElementsOf(report.fields());
    assertThat(context.declaredFields()).as("measurements: not editable by others").noneMatch(DeclaredField::editableByOthers);

    assertThat(context.relationKinds()).as("on by default (T-182), its colour the setting pairingColour, yellow without it (part C)").containsExactly(
        new RelationKind("gmti.pairing", "GMTI Pairing", RelationKind.Line.of("#FFFF00", 1.0, null, null).withStrokeColorSetting("/pairingColour"), true));
  }
}
