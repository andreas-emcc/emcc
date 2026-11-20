/**
 * KLV (SMPTE ST 336) as STANAG 4609 carries it: the MISB ST 0601 UAS Datalink Local Set and the ST 0102
 * security set nested in it. Pure Java, no library (ADR-0057 point 2). Pure code: no I/O, no threads.
 */
@NullMarked
package dev.emcc.plugins.fmv.klv;

import org.jspecify.annotations.NullMarked;
