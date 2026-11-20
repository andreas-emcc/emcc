package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.monitor.MonitorSnapshot;
import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/** M9 C2: the Monitor's answer is ECore's snapshot with the edge's {@code https} beside it, nothing dropped. */
class MonitorControllerTest {

  @Test
  void theAnswerCarriesEverySnapshotFieldThenHttps() {
    List<String> snapshot = components(MonitorSnapshot.class);
    List<String> answer = components(MonitorController.Answer.class);
    assertThat(answer).as("a field added to MonitorSnapshot must be added to the answer").hasSize(snapshot.size() + 1);
    assertThat(answer.subList(0, snapshot.size())).isEqualTo(snapshot);
    assertThat(answer.getLast()).isEqualTo("https:dev.emcc.app.HttpsConfiguration$Https");
  }

  private static List<String> components(Class<? extends Record> type) {
    return Arrays.stream(type.getRecordComponents()).map(MonitorControllerTest::name).toList();
  }

  private static String name(RecordComponent c) {
    return c.getName() + ":" + c.getGenericType().getTypeName();
  }
}
