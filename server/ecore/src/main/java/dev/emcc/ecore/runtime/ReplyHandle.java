package dev.emcc.ecore.runtime;

/**
 * The handle a request carries for its answer. Answer once; later answers, and answers after the
 * asker's timeout, are ignored.
 *
 * @param <R> the answer type
 */
public interface ReplyHandle<R> {

  String id();

  /** Answers with a value. */
  void reply(R value);

  /** Answers that the request failed, with a short reason in English. */
  void fail(String reason);
}
