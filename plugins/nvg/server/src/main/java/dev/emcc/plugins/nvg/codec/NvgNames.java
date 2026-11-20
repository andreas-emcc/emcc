package dev.emcc.plugins.nvg.codec;

import java.util.Set;

/** The XML names the codec reads and writes. */
public final class NvgNames {

  /** NVG 2.0's namespace (the TIDE schemas). */
  public static final String NVG = "https://tide.act.nato.int/schemas/2012/10/nvg";

  /** STANAG 4774, the confidentiality label. */
  public static final String SLAB = "urn:nato:stanag:4774:confidentialitymetadatalabel:1:0";

  /** STANAG 4778, the binding of a label to its data. */
  public static final String MB = "urn:nato:stanag:4778:bindinginformation:1:0";

  /** The version this plugin writes. */
  public static final String WRITTEN_VERSION = "2.0.2";

  /** The versions this plugin reads (brief, section 2). */
  public static final Set<String> READ_VERSIONS = Set.of("2.0.0", "2.0.1", "2.0.2");

  private NvgNames() {}

  /** Whether {@code namespace} is NVG's; documents without a namespace are read as NVG too. */
  static boolean isNvg(String namespace) {
    return namespace.isEmpty() || namespace.equals(NVG);
  }
}
