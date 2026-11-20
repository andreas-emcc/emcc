import type { ModifierName } from '@emc2/plugin-sdk';

/**
 * What the catalogue needs of a draw rule beyond mil-sym-ts's lookup (brief, function 8).
 * - `points`: what each control point is (the SDK's `GraphicCatalogEntry.points` convention);
 * - `required`: the amplifiers without which the graphic does not draw (checked against mil-sym-ts by a test);
 * - `arrow`: an arrow whose last point sets the arrowhead's width;
 * - `roles`: an area whose points have roles, so it is stored as a `LineString`, not a `Polygon`
 *   whose ring the store may reverse (model rule 1).
 *
 * Written from the anchor-point descriptions of MIL-STD-2525D's draw rules, which mil-sym-ts follows
 * (its `DrawRules` documentation), and APP-6 E's control measures.
 */
export interface DrawRule {
  readonly points: readonly string[];
  readonly required?: readonly ModifierName[];
  readonly arrow?: true;
  readonly roles?: true;
}

const CORNER: DrawRule = { points: ['a corner of the area'] };
const LINE: DrawRule = { points: ['a point of the line'] };
const CIRCLE: DrawRule = { points: ['the centre', 'a point on the circle, where it starts; it sets the radius'], roles: true };
const HALF_CIRCLE: DrawRule = { points: ['the tip of the arrowhead', 'the end of the straight part', 'the size and direction of the half circle'], roles: true };
const TIP_REAR: DrawRule = { points: ['the tip of the arrowhead', 'the rear of the symbol'] };
const TWO_TIPS: DrawRule = { points: ['the tip of the first arrowhead', 'the tip of the second arrowhead'] };
const VERTEX_TIPS: DrawRule = { points: ['the vertex', 'the tip of the first arrowhead', 'the tip of the second arrowhead'], roles: true };
const BLOCK: DrawRule = { points: ['one end of the straight line across', 'the other end of that line', 'the end of the line at right angles to it'], roles: true };
const DISRUPT: DrawRule = { points: ['one end of the straight line across', 'the other end of that line', 'the tip of the longest arrow'], roles: true };
const AXIS: DrawRule = { points: ['the tip of the arrow', 'the axis, from the tip back to the tail', 'the width of the arrowhead'], arrow: true };
const GAP: DrawRule = { points: ['one end of the near side', 'the other end of the near side', 'one end of the far side', 'the other end of the far side'] };
const CENTRE_DISTANCE: DrawRule = { points: ['the centre'], required: ['distances'] };
const CENTRE_DISTANCE_AZIMUTH: DrawRule = { points: ['the centre'], required: ['distances', 'azimuths'] };
const WEAPON: DrawRule = { points: ['the weapon or sensor'], required: ['distances'] };

/** The draw rules of the graphics mil-sym-ts draws from points, by the names of its `DrawRules`. */
export const DRAW_RULES: Readonly<Record<string, DrawRule>> = {
  AREA1: CORNER,
  AREA2: CORNER,
  AREA3: CORNER,
  AREA4: CORNER,
  AREA5: { points: ['one end of the half circle’s opening', 'the other end of the opening', 'the end of the arrow'], roles: true },
  AREA6: CIRCLE,
  AREA7: { points: ['the tip of the arrowhead', 'one end of the line at the back', 'the other end of the line at the back'], roles: true },
  AREA8: { points: ['one end of the line at the back', 'the other end of the line at the back', 'the tip of the first arrowhead', 'the tip of the second arrowhead'], roles: true },
  AREA9: CORNER,
  AREA10: CORNER,
  AREA11: BLOCK,
  AREA12: DISRUPT,
  AREA13: { points: ['one corner', 'the opposite corner'], roles: true },
  AREA14: { points: ['the centre', 'a point on a circle, which sets its radius, from the inner circle out', 'a point on the outer circle'], roles: true },
  AREA15: CIRCLE,
  AREA16: CIRCLE,
  AREA17: { points: ['one end of the straight line across', 'the other end of that line', 'the rear of the symbol'], roles: true },
  AREA18: { points: ['the tip of the first arrowhead', 'the end of the first arrow', 'the tip of the second arrowhead', 'the end of the second arrow'], roles: true },
  AREA19: CIRCLE,
  AREA20: CORNER,
  AREA21: VERTEX_TIPS,
  AREA23: CORNER,
  AREA24: BLOCK,
  AREA25: DISRUPT,
  AREA26: { points: ['the first half of the points outline the inner zone, the second half the outer zone, with as many points in each'], roles: true },
  AREA27: HALF_CIRCLE,
  POINT12: { points: ['the tip of the first arrowhead', 'the tip of the second arrowhead', 'the rear of the symbol'] },
  POINT17: CENTRE_DISTANCE_AZIMUTH,
  POINT18: { points: ['the centre of rotation'], required: ['distances', 'azimuths'] },
  LINE1: LINE,
  LINE2: LINE,
  LINE3: VERTEX_TIPS,
  LINE4: { points: ['one corner', 'the opposite corner'] },
  LINE5: { points: ['the start of the line', 'the end of the line'] },
  LINE6: LINE,
  LINE7: LINE,
  LINE8: { points: ['the start of the path', 'a turn of the path', 'the end of the path'] },
  LINE9: TIP_REAR,
  LINE10: { points: ['the tip of the arrowhead', 'the rear of the symbol', 'the end of the 90-degree arc'] },
  LINE11: GAP,
  LINE12: { points: ['one end of the symbol', 'the other end', 'one side of the symbol'] },
  LINE13: LINE,
  LINE14: TWO_TIPS,
  LINE16: GAP,
  LINE17: { points: ['one end of the first line', 'the other end of the first line', 'where the parallel line lies'] },
  LINE18: TWO_TIPS,
  LINE19: { points: ['one front corner', 'the other front corner'] },
  LINE20: TIP_REAR,
  LINE21: LINE,
  LINE22: { points: ['one end of the opening', 'the other end of the opening', 'the rear of the symbol'] },
  LINE23: { points: ['one end of the straight line across', 'the other end of that line', 'the rear of the symbol'] },
  LINE24: HALF_CIRCLE,
  LINE25: TIP_REAR,
  LINE26: { points: ['with four points: the tip of the first arrowhead; with three: the vertex', 'with four: the end of the first arrow; with three: the tip of the first arrowhead', 'with four: the end of the second arrow; with three: the tip of the second arrowhead', 'the tip of the second arrowhead'] },
  LINE27: { points: ['the centre of the circle', 'with four points: a point on the circle, which sets its radius; with three: the tip of the arrowhead', 'with four: the bend of the arc; with three: the end of the 90-degree arc', 'the end of the arrow'] },
  LINE28: TIP_REAR,
  LINE29: { points: ['the tip of the arrowhead', 'one end of the curved line at the back', 'the other end of the curved line'] },
  LINE30: { points: ['the tip of the arrowhead', 'the end of the symbol', 'the length of the angled lines (its distance from the second point)'] },
  LINE31: { points: ['the start of the straight line', 'the end of the straight part', 'the diameter of the half circle', 'the direction of the half circle'] },
  LINE32: { points: ['the end of the straight part', 'the centre of the two arcs', 'the tip of the arrowhead'] },
  LINE33: { points: ['the start of the straight line', 'the end of the straight part', 'the size and direction of the half circle, and the tip of the arrowhead'] },
  LINE50: { points: ['the tip of the arrowhead', 'the rear of the symbol', 'the width of the symbol'] },
  CORRIDOR1: { points: ['a point of the corridor’s centre line'], required: ['distances'] },
  AXIS1: AXIS,
  AXIS2: AXIS,
  POLYLINE1: { points: ['one end of the lane', 'the other end of the lane', 'the width on one side'] },
  ELLIPSE1: CENTRE_DISTANCE_AZIMUTH,
  RECTANGULAR1: { points: ['the middle of one side', 'the middle of the opposite side'], required: ['distances'], roles: true },
  RECTANGULAR2: CENTRE_DISTANCE_AZIMUTH,
  RECTANGULAR3: { points: ['the centre', 'the orientation of the rectangle'], required: ['distances'], roles: true },
  CIRCULAR1: CENTRE_DISTANCE,
  CIRCULAR2: WEAPON,
  ARC1: { points: ['the weapon or sensor'], required: ['distances', 'azimuths'] },
};
