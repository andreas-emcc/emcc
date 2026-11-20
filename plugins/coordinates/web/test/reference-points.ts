// Reference points for the conversion tests (brief, acceptance criterion 1).
//
// Source, independent of proj4 and mgrs: GeographicLib GeoConvert 2.5.2 (C. F. F. Karney), the online
// converter at https://geographiclib.sourceforge.io/cgi-bin/GeoConvert, queried on 2026-10-08 with
// "Output zone: match input or standard". GeographicLib follows the NGA rules for UTM and MGRS,
// including the Norway and Svalbard zones, and truncates MGRS. Every point has latitude ≠ longitude.
//
// - position: the input, WGS84 [longitude, latitude]
// - dms: GeoConvert's DMS (precision 1 mm, 0.0001")
// - utm: GeoConvert's UTM at 1 mm, written with the latitude band (from its MGRS) instead of n/s
// - utmMetres, utmMetresPosition: the UTM rounded to metres, and GeoConvert's position of that text
// - mgrs: GeoConvert's MGRS with 8 digits per axis (1 mm), truncated
// - mgrs5, mgrs5Corner: the same truncated to 5 digits (1 m), and GeoConvert's position of the
//   south-west corner of that 1 m square (its UTM easting and northing)
import type { Position } from '@emc2/plugin-sdk';

export interface ReferencePoint {
  readonly note: string;
  readonly position: Position;
  readonly dms: string;
  readonly utm: string;
  readonly utmMetres: string;
  readonly utmMetresPosition: Position;
  readonly mgrs: string;
  readonly mgrs5: string;
  readonly mgrs5Corner: Position;
}

export const REFERENCE_POINTS: readonly ReferencePoint[] = [
  {
    note: "Stockholm, NE",
    position: [18.0686, 59.3293],
    dms: "59°19'45.4800\" N 018°04'06.9600\" E",
    utm: '34V 333230.061 6580391.323',
    utmMetres: '34V 333230 6580391',
    utmMetresPosition: [18.0685991765, 59.3292970758],
    mgrs: '34VCL 33230061 80391323',
    mgrs5: '34VCL 33230 80391',
    mgrs5Corner: [18.0685991765, 59.3292970758],
  },
  {
    note: "the brief's example, NE",
    position: [15.654321, 60.123456],
    dms: "60°07'24.4416\" N 015°39'15.5556\" E",
    utm: '33V 536360.046 6665340.361',
    utmMetres: '33V 536360 6665340',
    utmMetresPosition: [15.6543201029, 60.1234527632],
    mgrs: '33VWG 36360046 65340360',
    mgrs5: '33VWG 36360 65340',
    mgrs5Corner: [15.6543201029, 60.1234527632],
  },
  {
    note: "Washington DC, NW",
    position: [-77.035278, 38.889484],
    dms: "38°53'22.1424\" N 077°02'07.0008\" W",
    utm: '18S 323479.932 4306481.423',
    utmMetres: '18S 323480 4306481',
    utmMetresPosition: [-77.0352771074, 38.8894801997],
    mgrs: '18SUJ 23479931 06481423',
    mgrs5: '18SUJ 23479 06481',
    mgrs5Corner: [-77.0352886306, 38.8894799988],
  },
  {
    note: "Fairbanks, NW",
    position: [-147.716389, 64.837778],
    dms: "64°50'16.0008\" N 147°42'59.0004\" W",
    utm: '6W 466013.317 7190567.775',
    utmMetres: '6W 466013 7190568',
    utmMetresPosition: [-147.7163957382, 64.8377799851],
    mgrs: '6WVS 66013317 90567775',
    mgrs5: '6WVS 66013 90567',
    mgrs5Corner: [-147.7163954996, 64.8377710128],
  },
  {
    note: "Rio de Janeiro, SW",
    position: [-43.210487, -22.951916],
    dms: "22°57'06.8976\" S 043°12'37.7532\" W",
    utm: '23K 683477.821 7460685.520',
    utmMetres: '23K 683478 7460686',
    utmMetresPosition: [-43.2104853086, -22.9519116479],
    mgrs: '23KPQ 83477820 60685520',
    mgrs5: '23KPQ 83477 60685',
    mgrs5Corner: [-43.2104949395, -22.951920787],
  },
  {
    note: "near Quito, SW, just south of the equator",
    position: [-78.456789, -0.123456],
    dms: "00°07'24.4416\" S 078°27'24.4404\" W",
    utm: '17M 783088.658 9986340.858',
    utmMetres: '17M 783089 9986341',
    utmMetresPosition: [-78.4567859259, -0.1234547167],
    mgrs: '17MQV 83088657 86340858',
    mgrs5: '17MQV 83088 86340',
    mgrs5Corner: [-78.4567949029, -0.1234637559],
  },
  {
    note: "Sydney, SE",
    position: [151.215297, -33.856784],
    dms: "33°51'24.4224\" S 151°12'55.0692\" E",
    utm: '56H 334900.261 6252290.522',
    utmMetres: '56H 334900 6252291',
    utmMetresPosition: [151.2152942663, -33.8567796537],
    mgrs: '56HLH 34900261 52290522',
    mgrs5: '56HLH 34900 52290',
    mgrs5Corner: [151.2152940787, -33.8567886685],
  },
  {
    note: "Cape Town, SE",
    position: [18.424055, -33.924869],
    dms: "33°55'29.5284\" S 018°25'26.5980\" E",
    utm: '34H 261877.351 6243185.689',
    utmMetres: '34H 261877 6243186',
    utmMetresPosition: [18.4240512878, -33.9248661143],
    mgrs: '34HBH 61877351 43185688',
    mgrs5: '34HBH 61877 43185',
    mgrs5Corner: [18.4240510164, -33.9248751242],
  },
  {
    note: "Tokyo, NE",
    position: [139.691706, 35.689487],
    dms: "35°41'22.1532\" N 139°41'30.1416\" E",
    utm: '54S 381622.754 3950297.459',
    utmMetres: '54S 381623 3950297',
    utmMetresPosition: [139.6917087884, 35.6894828947],
    mgrs: '54SUE 81622753 50297458',
    mgrs5: '54SUE 81622 50297',
    mgrs5Corner: [139.6916977391, 35.6894827746],
  },
  {
    note: "Fiji, SE, next to the antimeridian",
    position: [179.912345, -16.512345],
    dms: "16°30'44.4420\" S 179°54'44.4420\" E",
    utm: '60K 810902.979 8172143.313',
    utmMetres: '60K 810903 8172143',
    utmMetresPosition: [179.9123452401, -16.5123478264],
    mgrs: '60KZG 10902978 72143313',
    mgrs5: '60KZG 10902 72143',
    mgrs5Corner: [179.9123358814, -16.512347957],
  },
  {
    note: "Bergen: Norway exception, 32V instead of 31V",
    position: [5.322054, 60.391263],
    dms: "60°23'28.5468\" N 005°19'19.3944\" E",
    utm: '32V 297351.170 6700644.370',
    utmMetres: '32V 297351 6700644',
    utmMetresPosition: [5.3220512979, 60.3912595971],
    mgrs: '32VKN 97351169 00644370',
    mgrs5: '32VKN 97351 00644',
    mgrs5Corner: [5.3220512979, 60.3912595971],
  },
  {
    note: "west of the Norway exception, 31V",
    position: [2.345678, 60.412345],
    dms: "60°24'44.4420\" N 002°20'44.4408\" E",
    utm: '31V 463958.962 6697513.517',
    utmMetres: '31V 463959 6697514',
    utmMetresPosition: [2.3456786013, 60.4123493374],
    mgrs: '31VDG 63958962 97513517',
    mgrs5: '31VDG 63958 97513',
    mgrs5Corner: [2.3456606281, 60.4123402701],
  },
  {
    note: "Svalbard exception, 31X instead of 32X",
    position: [8.123456, 78.512345],
    dms: "78°30'44.4420\" N 008°07'24.4416\" E",
    utm: '31X 613768.748 8720536.954',
    utmMetres: '31X 613769 8720537',
    utmMetresPosition: [8.1234674561, 78.5123452167],
    mgrs: '31XFH 13768748 20536953',
    mgrs5: '31XFH 13768 20536',
    mgrs5Corner: [8.1234187209, 78.5123370764],
  },
  {
    note: "Svalbard exception, 33X instead of 32X",
    position: [10.654321, 78.312345],
    dms: "78°18'44.4420\" N 010°39'15.5556\" E",
    utm: '33X 401811.664 8696876.146',
    utmMetres: '33X 401812 8696876',
    utmMetresPosition: [10.654336304, 78.3123439204],
    mgrs: '33XVG 01811663 96876145',
    mgrs5: '33XVG 01811 96876',
    mgrs5Corner: [10.6542922115, 78.3123432555],
  },
  {
    note: "Svalbard exception, 35X instead of 34X",
    position: [22.654321, 79.123456],
    dms: "79°07'24.4416\" N 022°39'15.5556\" E",
    utm: '35X 408539.945 8787160.676',
    utmMetres: '35X 408540 8787161',
    utmMetresPosition: [22.6543224635, 79.1234589351],
    mgrs: '35XMH 08539944 87160675',
    mgrs5: '35XMH 08539 87160',
    mgrs5Corner: [22.6542786604, 79.1234493343],
  },
  {
    note: "Svalbard exception, 37X instead of 36X",
    position: [34.765432, 80.234567],
    dms: "80°14'04.4412\" N 034°45'55.5552\" E",
    utm: '37X 419884.886 8910686.309',
    utmMetres: '37X 419885 8910686',
    utmMetresPosition: [34.7654392018, 80.2345643162],
    mgrs: '37XDK 19884885 10686308',
    mgrs5: '37XDK 19884 10686',
    mgrs5Corner: [34.7653865353, 80.2345636642],
  },
  {
    note: "just below the 84° N limit",
    position: [-40.123456, 83.912345],
    dms: "83°54'44.4420\" N 040°07'24.4416\" W",
    utm: '24X 486699.181 9318437.978',
    utmMetres: '24X 486699 9318438',
    utmMetresPosition: [-40.1234713132, 83.9123451667],
    mgrs: '24XVU 86699180 18437977',
    mgrs5: '24XVU 86699 18437',
    mgrs5Corner: [-40.1234696665, 83.9123362108],
  },
  {
    note: "just above the 80° S limit",
    position: [160.123456, -79.876543],
    dms: "79°52'35.5548\" S 160°07'24.4416\" E",
    utm: '57C 522043.723 1131981.060',
    utmMetres: '57C 522044 1131981',
    utmMetresPosition: [160.123470179, -79.8765434928],
    mgrs: '57CWM 22043722 31981060',
    mgrs5: '57CWM 22043 31981',
    mgrs5Corner: [160.1234192269, -79.8765436657],
  },
];
