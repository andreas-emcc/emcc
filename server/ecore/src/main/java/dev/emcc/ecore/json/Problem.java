package dev.emcc.ecore.json;

/**
 * One reason why a document is invalid.
 *
 * @param path JSON Pointer into the document, e.g. {@code /data/geometry/coordinates/0}; empty for
 *     the whole document
 * @param problem what is wrong, in English
 */
public record Problem(String path, String problem) {}
