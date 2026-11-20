/**
 * The output link's terrain (brief section 10.5, ADR-0059 point 8): DTED cells of levels 0 to 2 from
 * the declared {@code terrain} folder, read through the SDK's {@code LocalFolder} only (ADR-0049),
 * by {@code fmv}'s own reader after spike S10's (plugins share no code). The worker reads the bytes;
 * the compute task parses them and owns the heights.
 */
@NullMarked
package dev.emcc.plugins.fmv.out.terrain;

import org.jspecify.annotations.NullMarked;
