package dev.emcc.ecore.runtime;

/**
 * Identifies a worker in events and statistics.
 *
 * @param id {@code <owner>/<name>}
 * @param owner {@code core} or a plugin id
 * @param name the worker's name
 */
public record WorkerInfo(String id, String owner, String name) {}
