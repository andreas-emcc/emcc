/**
 * Capabilities (SDK 1.4.0; ADR-0044, CR-0030 part 4): optional interfaces a plugin's class
 * implements when its manifest declares them, so that a new function that not every plugin needs
 * never becomes a required member of an existing interface (ADR-0044 point 6). In 1.4.0 the only
 * one is {@link dev.emcc.sdk.capability.Temporal}, the user's time (ADR-0045).
 */
@NullMarked
package dev.emcc.sdk.capability;

import org.jspecify.annotations.NullMarked;
