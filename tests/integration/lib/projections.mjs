// Map projections written out independently of OpenLayers and proj4, so that a test can check
// where the real map draws a position (map-view-2d criteria 3 and 4, review remark N4: its own
// round trip uses the same maths on both sides). Input [lon, lat] in degrees, output metres.

const A = 6378137; // WGS84 semi-major axis
const F = 1 / 298.257223563;
const E = Math.sqrt(2 * F - F * F);
const rad = (deg) => (deg * Math.PI) / 180;

/** EPSG:3857, Web Mercator (spherical formulas on the WGS84 radius). */
export function webMercator([lon, lat]) {
  return [A * rad(lon), A * Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))];
}

/**
 * EPSG:3413, NSIDC Sea Ice Polar Stereographic North: WGS84 ellipsoid, latitude of true scale
 * 70° N, central meridian 45° W (Snyder, Map Projections, formulas 15-9, 14-15, 21-34, 21-30, 21-31).
 */
export function polarStereographicNorth([lon, lat]) {
  const t = (phi) => Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi)), E / 2);
  const m = (phi) => Math.cos(phi) / Math.sqrt(1 - E * E * Math.sin(phi) ** 2);
  const phiC = rad(70);
  const rho = (A * m(phiC) * t(rad(lat))) / t(phiC);
  const dLon = rad(lon) - rad(-45);
  return [rho * Math.sin(dLon), -rho * Math.cos(dLon)];
}

export const projections = { 'EPSG:3857': webMercator, 'EPSG:3413': polarStereographicNorth };

/**
 * Fits screen = offset + projected / resolution (x right, y down, no rotation) to two points and
 * predicts the screen position of others. Returns { resolution, predict }.
 */
export function fitScreen(project, [p1, s1], [p2, s2]) {
  const [x1, y1] = project(p1);
  const [x2, y2] = project(p2);
  const resolution = Math.hypot(x2 - x1, y2 - y1) / Math.hypot(s2.x - s1.x, s2.y - s1.y);
  return {
    resolution,
    predict(position) {
      const [x, y] = project(position);
      return { x: s1.x + (x - x1) / resolution, y: s1.y - (y - y1) / resolution };
    },
  };
}
