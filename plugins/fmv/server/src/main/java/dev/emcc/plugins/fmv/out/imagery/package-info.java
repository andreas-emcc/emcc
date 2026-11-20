/**
 * The output link's imagery (brief section 10.5 points 15 and 16, O4, A1): imagery sets from the
 * declared {@code imagery} folder, each an {@code imagery.json} with its source, licence, CRS and
 * JPEG or PNG tiles. The worker reads the bytes; the compute task decodes them with the JDK's
 * ImageIO, from memory only (owner, Q2), and owns the pictures.
 */
@NullMarked
package dev.emcc.plugins.fmv.out.imagery;

import org.jspecify.annotations.NullMarked;
