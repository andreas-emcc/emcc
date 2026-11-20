/**
 * Java types of the common data model 1.9.0 ({@code model/}, ADR-0007). Written by hand and checked
 * by the codec contract test in the test kit against {@code model/examples/}.
 *
 * <p>The types carry no JSON annotations; ECore maps them to and from JSON. They check what is
 * cheap and structural (nulls, immutable copies, coordinate ranges, operation and payload
 * consistency); the full schema rules are checked where documents enter the system.
 * <b>Coordinates are always longitude, latitude</b>.
 *
 * <pre>{@code
 * var content = new MapObjectContent("core.symbol", MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, layerId,
 *     new Geometry.Point(Position.of(18.0686, 59.3293)),
 *     new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null),
 *     null, new ObjectProperties("1st Company", null), context.defaultLabel(), Extensions.empty());
 * }</pre>
 */
@NullMarked
package dev.emcc.sdk.model;

import org.jspecify.annotations.NullMarked;
