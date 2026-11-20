package dev.emcc.sdk.model;

/**
 * The part of an entity its creator controls: what a change request carries as {@code data}.
 *
 * <pre>{@code
 * EntityType type = switch (content) {
 *   case MapObjectContent o -> EntityType.OBJECT;
 *   case LayerContent l -> EntityType.LAYER;
 * };
 * }</pre>
 */
public sealed interface EntityContent permits MapObjectContent, LayerContent {

  SecurityLabel label();

  Extensions extensions();

  EntityType entityType();
}
