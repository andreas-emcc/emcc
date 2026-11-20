/**
 * Plugin documents: a plugin's own small JSON documents, stored by the persistence manager
 * (ADR-0024; docs/plugins/sdk-v1.md). Every answer arrives later as a message.
 *
 * <pre>{@code
 * context.documents().get("layers", self, LayersLoaded::new);
 * }</pre>
 */
@NullMarked
package dev.emcc.sdk.document;

import org.jspecify.annotations.NullMarked;
