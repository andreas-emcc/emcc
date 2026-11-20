package dev.emcc.plugins.fmv.out;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import java.util.List;

/** What an output link's sender takes: one picture's datagrams, 7 × 188 bytes each (brief section 10.6 point 21). */
public sealed interface SendItem extends Message {

  record Datagrams(List<Bytes> datagrams) implements SendItem {
    public Datagrams {
      datagrams = List.copyOf(datagrams);
    }
  }
}
