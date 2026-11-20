/**
 * The SDK's own immutable JSON values, for opaque data: plugin extensions and settings.
 *
 * <p>{@link dev.emcc.sdk.json.JsonNumber} keeps a number exactly as written, so that blind
 * forwarding of other plugins' extensions loses no precision (ADR-0007). There is no parser here:
 * ECore converts between these values and its JSON library.
 *
 * <pre>{@code
 * JsonObject ext = JsonObject.builder()
 *     .put("how", JsonString.of("m-g"))
 *     .put("ce", JsonNumber.of("9999999.0"))
 *     .build();
 * }</pre>
 */
@NullMarked
package dev.emcc.sdk.json;

import org.jspecify.annotations.NullMarked;
