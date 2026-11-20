/**
 * Object access for server parts (docs/plugins/sdk-v1.md, CR-0010 point 10): changes to the
 * object store, queries and subscriptions. Every answer arrives later as a message to a worker; no
 * handler ever waits (rule C5). Objects change only through change requests (ADR-0005).
 *
 * <pre>{@code
 * context.store().submit(Change.createObject(newId, content).withExternalRef(ref).bySystem("tak-north"),
 *     Duration.ofSeconds(10), self, outcome -> new Applied(uid, outcome));
 * context.store().query(ObjectQuery.byExternalSystem("cot"), Duration.ofSeconds(10), self, Loaded::new);
 * }</pre>
 */
@NullMarked
package dev.emcc.sdk.store;

import org.jspecify.annotations.NullMarked;
