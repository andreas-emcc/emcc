package dev.emcc.ecore.runtime;

/** The state of a worker, as shown in statistics and later in the monitor view. */
public enum WorkerState {

  /** Handling messages normally. */
  RUNNING,

  /** A handler call exceeded its budget and has not returned yet, and the worker was not restarted. */
  HUNG,

  /** Stopped; sends return {@link SendOutcome#CLOSED}. */
  STOPPED,

  /** A restart failed because the handler factory threw. The worker is closed. */
  FAILED
}
