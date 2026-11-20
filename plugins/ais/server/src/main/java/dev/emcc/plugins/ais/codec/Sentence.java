package dev.emcc.plugins.ais.codec;

/**
 * One checked {@code !xxVDM} or {@code !xxVDO} sentence.
 *
 * @param count the number of sentences the message has, 1 to 9
 * @param number this sentence's place in it, 1 to {@code count}
 * @param sequenceId the sequential message id that joins the fragments; empty for a single sentence
 * @param channel the radio channel ({@code A}, {@code B}, {@code 1}, {@code 2}) or empty
 * @param payload six-bit armoured text, at least one character, all in the six-bit set
 * @param fillBits the bits at the end of the last fragment that are padding, 0 to 5
 */
public record Sentence(int count, int number, String sequenceId, String channel, String payload, int fillBits) {}
