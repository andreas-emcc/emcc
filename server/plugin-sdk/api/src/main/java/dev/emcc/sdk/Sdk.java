package dev.emcc.sdk;

/**
 * The SDK itself. Both SDKs (Java and web) share one version, because a manifest has one {@code
 * sdkVersion} for both parts of a plugin.
 *
 * <pre>{@code
 * // in ECore: the SDK version it implements, compared with each manifest's sdkVersion range
 * boolean ok = SdkVersions.compatible(manifest.sdkVersion(), Sdk.VERSION);
 * }</pre>
 */
public final class Sdk {

  /**
   * The SDK version, in SemVer. A compile-time constant: code compiled against the SDK keeps the
   * value it was compiled with. In ECore it is the version ECore implements; in a plugin's tests it
   * is the version the plugin is built against. Equal to the web SDK's {@code SDK_VERSION} and to
   * this artifact's Maven version without {@code -SNAPSHOT} (checked by the SDK's tests).
   */
  public static final String VERSION = "1.9.0";

  private Sdk() {}
}
