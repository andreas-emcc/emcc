// The mass test's known set (mass/PLAN.md, section 2): fixed data, the same on every run. Each object's name carries
// its instance and number ("A-017"), so that a copy can be traced to its source.
import { randomUUID } from 'node:crypto';

export type LonLat = [number, number];
export type Label = { policyIdentifier: { name: string }; classification: string; categories?: unknown[] };
export type Kind = 'symbol' | 'graphic' | 'shape';
export type Item = { name: string; kind: Kind; request: any; classification: string };

/** The classifications of the NATO policy that the links send (each link's highest is CONFIDENTIAL). */
export const SENT_CLASSIFICATIONS = ['UNCLASSIFIED', 'RESTRICTED', 'CONFIDENTIAL'];
export const HIGHEST = { policy: 'NATO', classification: 'CONFIDENTIAL' };
/** The label of what cot receives (a CoT event carries no label: the link's applies). */
export const COT_LABEL = { policy: 'NATO', classification: 'RESTRICTED' };

const label = (classification: string, categories?: unknown[]): Label => ({
  policyIdentifier: { name: 'NATO' },
  classification,
  ...(categories ? { categories } : {}),
});

/** Symbols of the three standards the model takes (APP-6B is the 2525C layout), four identities, land, air, sea. */
export const SYMBOLS = [
  { standard: 'APP-6D', sidc: '10031000001211000000', what: 'friend infantry' },
  { standard: 'APP-6D', sidc: '10061000001211000000', what: 'hostile infantry' },
  { standard: 'APP-6D', sidc: '10041000001211000000', what: 'neutral infantry' },
  { standard: 'APP-6D', sidc: '10011000001211000000', what: 'unknown infantry' },
  { standard: 'APP-6D', sidc: '10030100001101000000', what: 'friend fixed-wing aircraft' },
  { standard: 'APP-6E', sidc: '13031000001211000000', what: 'APP-6E friend infantry' },
  { standard: 'APP-6B', sidc: 'SFGPUCI--------', what: 'APP-6B (2525C) friend infantry' },
  { standard: 'APP-6B', sidc: 'SHGPUCI--------', what: 'APP-6B (2525C) hostile infantry' },
  { standard: 'APP-6B', sidc: 'SFGPUCI----D---', what: 'APP-6B (2525C) friend infantry platoon' },
] as const;

/** Points in every quadrant (latitude ≠ longitude), one by the antimeridian and one near the pole; then a grid. */
const SPECIAL: LonLat[] = [
  [18.0634, 59.3346],
  [-70.6483, -33.4569],
  [151.2093, -33.8688],
  [-74.006, 40.7128],
  [179.95, -16.5],
  [-179.95, 52.1],
  [15.6, 78.2],
  [44.5, -12.3],
];

export function position(instance: number, n: number): LonLat {
  const shift = instance * 0.0031;
  if (n < SPECIAL.length) return [SPECIAL[n][0] + (SPECIAL[n][0] > 179 ? -shift : shift), SPECIAL[n][1] + shift];
  const i = n - SPECIAL.length;
  return [round(10 + ((i * 0.37) % 20) + shift), round(55.5 + ((i * 0.23) % 10) + shift)];
}

const round = (x: number) => Math.round(x * 1e7) / 1e7;

function create(layerId: string, data: Record<string, unknown>) {
  return {
    requestId: randomUUID(),
    entityType: 'object',
    operation: 'create',
    entityId: randomUUID(),
    data: { dataType: 'core.general', dataSource: 'manual', layerId, ...data },
    source: { plugin: 'ita-test' },
  };
}

/** `count` symbols, then one SECRET symbol that no link may send. */
export function symbols(instance: number, layerId: string, count: number): Item[] {
  const letter = String.fromCharCode(65 + instance);
  const items: Item[] = [];
  for (let n = 0; n <= count; n++) {
    const secret = n === count;
    const s = SYMBOLS[n % SYMBOLS.length];
    const name = secret ? `${letter}-SECRET` : `${letter}-${String(n).padStart(3, '0')}`;
    const classification = secret ? 'SECRET' : SENT_CLASSIFICATIONS[n % SENT_CLASSIFICATIONS.length];
    // One label with a releasability category, for nvg's STANAG 4778 labels.
    const categories = n === 1 ? [{ tagName: 'Releasable To', type: 'permissive', values: ['SWE', 'NOR'] }] : undefined;
    const modifiers = {
      uniqueDesignation: `${letter}${n}`,
      higherFormation: '2 BDE',
      quantity: String(10 + (n % 7)),
      staffComments: `mass ${letter}`,
      additionalInformation: s.what,
      direction: (45 + n * 7) % 360,
      speed: 5 + (n % 4),
    };
    items.push({
      name,
      kind: 'symbol',
      classification,
      request: create(layerId, {
        type: 'core.symbol',
        geometry: { type: 'Point', coordinates: position(instance, n) },
        symbol: { standard: s.standard, sidc: s.sidc, modifiers },
        label: label(classification, categories),
        properties: { name },
      }),
    });
  }
  return items;
}

/** APP-6D control measures (symbol set 25) with their kind, and one APP-6E area. */
const GRAPHICS = [
  { key: '25110100', what: 'boundary', kind: 'line', standard: 'APP-6D' },
  { key: '25140300', what: 'phase line', kind: 'line', standard: 'APP-6D' },
  { key: '25140100', what: 'forward line of troops', kind: 'line', standard: 'APP-6D' },
  { key: '25141000', what: 'line of departure', kind: 'line', standard: 'APP-6D' },
  { key: '25151403', what: 'main attack (axis of advance)', kind: 'axis', standard: 'APP-6D' },
  { key: '25150200', what: 'assembly area', kind: 'area', standard: 'APP-6D' },
  { key: '25270800', what: 'mined area', kind: 'area', standard: 'APP-6D' },
  { key: '25120100', what: 'area of operations', kind: 'area', standard: 'APP-6D' },
  { key: '25151700', what: 'objective', kind: 'area', standard: 'APP-6D' },
  { key: '25271800', what: 'APP-6E chemical contaminated area', kind: 'area', standard: 'APP-6E' },
] as const;

const sidcOf = (standard: string, key: string) => `${standard === 'APP-6E' ? '13' : '10'}03${key.slice(0, 2)}0000${key.slice(2)}0000`;

/** Graphics (`core.multipoint`) and two plain shapes (`core.shape`), round a centre per instance in Sweden. */
export function graphics(instance: number, layerId: string): Item[] {
  const letter = String.fromCharCode(65 + instance);
  const items: Item[] = [];
  const at = (n: number, dx: number, dy: number): LonLat => [round(14 + (n % 5) * 0.4 + dx + instance * 0.05), round(57 + Math.floor(n / 5) * 0.3 + dy + instance * 0.05)];
  GRAPHICS.forEach((g, n) => {
    const name = `${letter}-G${String(n).padStart(2, '0')}`;
    const classification = SENT_CLASSIFICATIONS[n % SENT_CLASSIFICATIONS.length];
    const geometry =
      g.kind === 'area'
        ? { type: 'Polygon', coordinates: [[at(n, 0, 0), at(n, 0.2, 0.01), at(n, 0.21, 0.12), at(n, 0.02, 0.11), at(n, 0, 0)]] }
        : g.kind === 'axis'
          ? { type: 'LineString', coordinates: [at(n, 0, 0), at(n, 0.15, 0.03), at(n, 0.3, 0.02), at(n, 0.25, 0.06)] }
          : { type: 'LineString', coordinates: [at(n, 0, 0), at(n, 0.1, 0.05), at(n, 0.3, 0.04)] };
    items.push({
      name,
      kind: 'graphic',
      classification,
      request: create(layerId, {
        type: 'core.multipoint',
        geometry,
        symbol: { standard: g.standard, sidc: sidcOf(g.standard, g.key), modifiers: { uniqueDesignation: `${letter}G${n}` } },
        label: label(classification),
        properties: { name },
      }),
    });
  });
  const style = { strokeColor: '#2C784C', strokeWidth: 2 };
  items.push({
    name: `${letter}-S00`,
    kind: 'shape',
    classification: 'UNCLASSIFIED',
    request: create(layerId, { type: 'core.shape', geometry: { type: 'LineString', coordinates: [at(10, 0, 0), at(10, 0.2, 0.1)] }, style, label: label('UNCLASSIFIED'), properties: { name: `${letter}-S00` } }),
  });
  items.push({
    name: `${letter}-S01`,
    kind: 'shape',
    classification: 'RESTRICTED',
    request: create(layerId, {
      type: 'core.shape',
      geometry: { type: 'Polygon', coordinates: [[at(11, 0, 0), at(11, 0.1, 0), at(11, 0.1, 0.1), at(11, 0, 0.1), at(11, 0, 0)]] },
      style,
      label: label('RESTRICTED'),
      properties: { name: `${letter}-S01` },
    }),
  });
  return items;
}
