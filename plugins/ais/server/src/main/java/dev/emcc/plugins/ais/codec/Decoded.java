package dev.emcc.plugins.ais.codec;

import org.jspecify.annotations.Nullable;

/**
 * What a payload became: a message, or the counter that says why not ({@code dropped: too short},
 * {@code ignored: type 4}, {@code no position}), plus how many values were left out as out of range
 * (they are counted whether or not there is a message).
 *
 * @param message the message, or {@code null}
 * @param reason the counter's name when there is no message
 * @param outOfRange values left out because they were outside their range
 */
public record Decoded(@Nullable AisMessage message, @Nullable String reason, int outOfRange) {}
