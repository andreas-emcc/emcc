/**
 * The Spring Boot edge: HTTP, WebSocket, security and static files (ADR-0002).
 *
 * <p>Thin by design: it translates requests into ECore messages and back. Everything is non-null
 * unless marked {@code @Nullable}.
 */
@NullMarked
package dev.emcc.app;

import org.jspecify.annotations.NullMarked;
