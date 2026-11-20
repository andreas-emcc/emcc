package dev.emcc.sdk.folder;

import java.util.List;

/**
 * SDK 1.4.0: the local folders the plugin's manifest declares in {@code folders} (CR-0030 part 6).
 * Fixed while the plugin runs; each folder's path follows its setting.
 */
public interface LocalFolders {

  /**
   * The declared folder with this id.
   *
   * @throws IllegalArgumentException when the manifest declares no folder with this id
   */
  LocalFolder folder(String id);

  /** The ids the manifest declares, in its order. */
  List<String> ids();
}
