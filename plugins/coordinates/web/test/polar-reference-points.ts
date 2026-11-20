// Polar reference points for UPS and polar MGRS (brief, acceptance criteria 4 and 9).
//
// Source, independent of proj4 and mgrs: GeographicLib GeoConvert 2.5.2 (C. F. F. Karney), the online
// converter at https://geographiclib.sourceforge.io/cgi-bin/GeoConvert, queried on 2026-10-11 with
// "Output zone: match input or standard". GeographicLib follows NGA's rules for UPS and the polar
// MGRS letters, and truncates MGRS. Five points in each polar area, the poles included; every point
// has latitude ≠ longitude.
//
// - position: the input, WGS84 [longitude, latitude]
// - dms: GeoConvert's DMS (0.0001")
// - ups: GeoConvert's UPS at 1 mm, written with the UPS letter (from its MGRS) instead of n/s
// - upsMetres, upsMetresPosition: the UPS rounded to metres, and GeoConvert's position of that text
// - mgrs: GeoConvert's MGRS with 8 digits per axis (1 mm), truncated
// - mgrs5, mgrs5Corner: the same truncated to 5 digits (1 m), and GeoConvert's position of the
//   south-west corner of that 1 m square (its UPS easting and northing)
//
// At a pole the longitude is arbitrary: GeoConvert answers the north pole's UPS with longitude 180.
// Compare positions there by distance, not by longitude.
import type { Position } from '@emc2/plugin-sdk';

export interface PolarReferencePoint {
  readonly note: string;
  readonly position: Position;
  readonly dms: string;
  readonly ups: string;
  readonly upsMetres: string;
  readonly upsMetresPosition: Position;
  readonly mgrs: string;
  readonly mgrs5: string;
  readonly mgrs5Corner: Position;
}

export const POLAR_REFERENCE_POINTS: readonly PolarReferencePoint[] = [
  {
    note: 'north, west: Y',
    position: [-45.25, 84.5],
    dms: '84°30\'00.0000" N 045°15\'00.0000" W',
    ups: 'Y 1566018.958 1569789.727',
    upsMetres: 'Y 1566019 1569790',
    upsMetresPosition: [-45.250015347, 84.500001995],
    mgrs: 'YTC 66018957 69789727',
    mgrs5: 'YTC 66018 69789',
    mgrs5Corner: [-45.2500147689, 84.4999892853],
  },
  {
    note: 'north, east: Z',
    position: [12.345678, 86.123456],
    dms: '86°07\'24.4416" N 012°20\'44.4408" E',
    ups: 'Z 2092054.787 1579409.875',
    upsMetres: 'Z 2092055 1579410',
    upsMetresPosition: [12.3457092996, 86.1234566915],
    mgrs: 'ZAC 92054786 79409874',
    mgrs5: 'ZAC 92054 79409',
    mgrs5Corner: [12.3455508471, 86.1234498260],
  },
  {
    note: 'north, east, near the pole',
    position: [150.5, 89.876543],
    dms: '89°52\'35.5548" N 150°30\'00.0000" E',
    ups: 'Z 2006749.488 2011929.680',
    upsMetres: 'Z 2006749 2011930',
    upsMetresPosition: [150.5024348405, 89.8765426598],
    mgrs: 'ZAH 06749488 11929680',
    mgrs5: 'ZAH 06749 11929',
    mgrs5Corner: [150.5003764718, 89.8765504993],
  },
  {
    note: 'north, west, near 180°',
    position: [-170.25, 87.5],
    dms: '87°30\'00.0000" N 170°15\'00.0000" W',
    ups: 'Y 1952988.272 2273592.139',
    upsMetres: 'Y 1952988 2273592',
    upsMetresPosition: [-170.2499397343, 87.5000008185],
    mgrs: 'YZK 52988272 73592139',
    mgrs5: 'YZK 52988 73592',
    mgrs5Corner: [-170.2499397343, 87.5000008185],
  },
  {
    note: 'the north pole',
    position: [0, 90],
    dms: '90°00\'00.0000" N 000°00\'00.0000" E',
    ups: 'Z 2000000.000 2000000.000',
    upsMetres: 'Z 2000000 2000000',
    upsMetresPosition: [180, 90],
    mgrs: 'ZAH 00000000 00000000',
    mgrs5: 'ZAH 00000 00000',
    mgrs5Corner: [180, 90],
  },
  {
    note: 'south, west: A',
    position: [-65.4321, -80.5],
    dms: '80°30\'00.0000" S 065°25\'55.5600" W',
    ups: 'A 1038644.170 2439491.733',
    upsMetres: 'A 1038644 2439492',
    upsMetresPosition: [-65.432090639, -80.499997624],
    mgrs: 'ALS 38644169 39491732',
    mgrs5: 'ALS 38644 39491',
    mgrs5Corner: [-65.4321399354, -80.5000013442],
  },
  {
    note: 'south, east: B',
    position: [45.678901, -85.123456],
    dms: '85°07\'24.4416" S 045°40\'44.0436" E',
    ups: 'B 2387570.279 2378492.729',
    upsMetres: 'B 2387570 2378493',
    upsMetresPosition: [45.678859903, -85.1234560928],
    mgrs: 'BFR 87570278 78492729',
    mgrs5: 'BFR 87570 78492',
    mgrs5Corner: [45.6789355712, -85.1234623749],
  },
  {
    note: 'south, west, near the pole',
    position: [-123.456789, -88.765432],
    dms: '88°45\'55.5552" S 123°27\'24.4404" W',
    ups: 'A 1885640.963 1924431.373',
    upsMetres: 'A 1885641 1924431',
    upsMetresPosition: [-123.4569277454, -88.7654304288],
    mgrs: 'AYM 85640962 24431373',
    mgrs5: 'AYM 85640 24431',
    mgrs5Corner: [-123.4566973, -88.765422915],
  },
  {
    note: 'south, east, near 180°',
    position: [170.75, -82.25],
    dms: '82°15\'00.0000" S 170°45\'00.0000" E',
    ups: 'B 2138511.196 1149509.362',
    upsMetres: 'B 2138511 1149509',
    upsMetresPosition: [170.7500167316, -82.2499970775],
    mgrs: 'BBD 38511195 49509362',
    mgrs5: 'BBD 38511 49509',
    mgrs5Corner: [170.7500167316, -82.2499970775],
  },
  {
    note: 'the south pole',
    position: [0, -90],
    dms: '90°00\'00.0000" S 000°00\'00.0000" E',
    ups: 'B 2000000.000 2000000.000',
    upsMetres: 'B 2000000 2000000',
    upsMetresPosition: [0, -90],
    mgrs: 'BAN 00000000 00000000',
    mgrs5: 'BAN 00000 00000',
    mgrs5Corner: [0, -90],
  },
];

/**
 * Around the limits and at ±180°, from GeoConvert (2026-10-11), as the `utm` format writes them
 * (metres, rounded) and as MGRS writes them (5 digits, truncated).
 *
 * The brief puts points exactly on 84° N and 80° S in UTM. GeoConvert agrees at 80° S. At exactly
 * 84° N it answers UPS (GeographicLib uses UTM below 84°), so the UTM values there come from
 * GeoConvert with "Output zone: standard UTM zone".
 */
export const POLAR_EDGES: readonly { readonly note: string; readonly position: Position; readonly utm: string; readonly mgrs: string }[] = [
  { note: 'just below 84° N', position: [-40.5, 83.999999], utm: '24X 482497 9328322', mgrs: '24XVU 82496 28321' },
  { note: 'exactly 84° N: UTM', position: [-40.5, 84], utm: '24X 482497 9328322', mgrs: '24XVU 82496 28321' },
  { note: 'just above 84° N, west', position: [-40.5, 84.000001], utm: 'Y 1566995 1493016', mgrs: 'YTB 66995 93016' },
  { note: 'just above 84° N, east', position: [8.5, 84.000001], utm: 'Z 2098549 1340596', mgrs: 'ZAA 98548 40595' },
  { note: 'just above 80° S', position: [160.5, -79.999999], utm: '57C 529075 1118039', mgrs: '57CWM 29075 18039' },
  { note: 'exactly 80° S: UTM', position: [160.5, -80], utm: '57C 529075 1118039', mgrs: '57CWM 29075 18039' },
  { note: 'just below 80° S, east', position: [160.5, -80.000001], utm: 'B 2371511 950886', mgrs: 'BFB 71510 50886' },
  { note: 'exactly 80° S, west: UTM', position: [-65.5, -80], utm: '20C 451550 1117373', mgrs: '20CMS 51550 17373' },
  { note: 'just below 80° S, west', position: [-65.5, -80.000001], utm: 'A 987258 2461533', mgrs: 'AKS 87257 61533' },
  { note: '180° E in the north: east letter', position: [180, 84.5], utm: 'Z 2000000 2611081', mgrs: 'ZAP 00000 11081' },
  { note: '180° W in the north: east letter too', position: [-180, 84.5], utm: 'Z 2000000 2611081', mgrs: 'ZAP 00000 11081' },
  { note: '180° in the south: east letter', position: [180, -85.5], utm: 'B 2000000 1500146', mgrs: 'BAH 00000 00146' },
  { note: 'north pole, another longitude', position: [-45, 90], utm: 'Z 2000000 2000000', mgrs: 'ZAH 00000 00000' },
  { note: 'south pole, another longitude', position: [120, -90], utm: 'B 2000000 2000000', mgrs: 'BAN 00000 00000' },
];
