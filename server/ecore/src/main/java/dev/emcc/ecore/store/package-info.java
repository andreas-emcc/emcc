/**
 * The object store: the single writer of the live picture, for objects and layers (overview 4.4,
 * ADR-0005, ADR-0018). It applies change requests in one worker, answers each exactly once (a
 * change event on {@code objects.changed}, or a change rejection to the requester), enforces the
 * model rules the schema cannot express and extension ownership. Everything is non-null unless
 * marked {@code @Nullable}.
 */
@NullMarked
package dev.emcc.ecore.store;

import org.jspecify.annotations.NullMarked;
