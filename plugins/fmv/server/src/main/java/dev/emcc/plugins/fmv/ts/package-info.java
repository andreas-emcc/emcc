/**
 * Reading an MPEG-2 transport stream (ISO/IEC 13818-1, MISB ST 1402) only as far as the plugin needs
 * (ADR-0057 point 2): the PAT and PMT, the KLV stream, random access points and the video's size.
 * Pure code: no I/O, no threads.
 */
@NullMarked
package dev.emcc.plugins.fmv.ts;

import org.jspecify.annotations.NullMarked;
