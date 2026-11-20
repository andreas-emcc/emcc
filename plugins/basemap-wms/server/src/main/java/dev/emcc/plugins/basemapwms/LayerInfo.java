package dev.emcc.plugins.basemapwms;

import java.util.List;

/**
 * One named layer of a server's capabilities.
 *
 * @param name the layer's name, as {@code LAYERS} takes it
 * @param title the layer's title, or its name when it has none
 * @param projections the codes the layer lists, with those it inherits from its parent layers, in upper case (e.g. {@code EPSG:3413})
 */
record LayerInfo(String name, String title, List<String> projections) {

  LayerInfo {
    projections = List.copyOf(projections);
  }
}
