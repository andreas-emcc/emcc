package dev.emcc.ecore.plugin;

import java.io.IOException;

/**
 * Where one viewer's stream goes: the browser's endless response, provided by the edge (SDK 1.8.0,
 * CR-0044 E1). {@link #write} and {@link #flush} are called only by the viewer's own thread, one
 * call at a time, and may block while the browser takes the bytes. {@link #end} is called once,
 * last, by that thread; {@link #abort} may come from any thread, also while a write blocks.
 */
public interface StreamSink {

  void write(byte[] chunk) throws IOException;

  void flush() throws IOException;

  /** Ends the response normally; the viewer's thread calls it once, last. */
  void end();

  /** Ends the response at once, from another thread, e.g. for a viewer whose write has stalled. */
  void abort();
}
