// The plugin's settings as the web part uses them: read leniently from `ctx.settings` (ECore has validated them against the
// manifest's schema), written back in the manifest's shape, and checked for what the schema cannot check (brief, function 6).
import type { JsonValue, Settings } from '@emc2/plugin-sdk';

export type WmsVersion = '1.3.0' | '1.1.1';
export type ImageFormat = 'image/png' | 'image/jpeg';
export type Mode = 'tiles' | 'image';

let lastKey = 0;

/** A key for a draft item, stable while it is edited (React's list key; not saved). */
export function newKey(): string {
  return `item-${String(++lastKey)}`;
}

export interface Server {
  readonly key?: string;
  /**
   * A server added in the panel has its id made from its name, again at each change of the name, until it is saved: the
   * backgrounds that name it follow. A saved server keeps its id.
   */
  readonly id?: string;
  readonly isNew?: boolean;
  readonly name: string;
  readonly url: string;
  readonly version: WmsVersion;
  /** Text, as typed, so that a half-typed number is kept; `problems` checks it. */
  readonly timeout: string;
}

export interface Background {
  readonly key?: string;
  /** Absent for a background added in the panel and not saved yet: the id is made from the name at the first save. */
  readonly id?: string;
  readonly name: string;
  /** The id of a server; empty until one is chosen. */
  readonly server: string;
  /** Bottom first, the order WMS draws `LAYERS` in. */
  readonly layers: readonly string[];
  readonly mode: Mode;
  readonly format: ImageFormat;
  readonly transparent: boolean;
  readonly attributionText: string;
  readonly attributionUrl: string;
}

export interface Draft {
  readonly servers: readonly Server[];
  readonly backgrounds: readonly Background[];
}

export const DEFAULT_TIMEOUT = 8;
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** The schema's pattern for a server's address: http or https, no user name or password. */
const URL_PATTERN = /^https?:\/\/[^/?#@\s]+([/?#]\S*)?$/;
const LINK_PATTERN = /^https?:\/\/\S+$/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** The draft the panel edits, from the saved settings. A malformed entry is skipped, since ECore has accepted only valid ones. */
export function fromSettings(values: Settings): Draft {
  const servers: Server[] = [];
  const rawServers: unknown = values['servers'];
  if (Array.isArray(rawServers)) {
    for (const item of rawServers as unknown[]) {
      if (!isRecord(item) || typeof item['id'] !== 'string') continue;
      servers.push({
        key: newKey(),
        id: item['id'],
        name: text(item['name'], item['id']),
        url: text(item['url'], ''),
        version: item['version'] === '1.1.1' ? '1.1.1' : '1.3.0',
        timeout: String(typeof item['timeoutSeconds'] === 'number' ? item['timeoutSeconds'] : DEFAULT_TIMEOUT),
      });
    }
  }
  const backgrounds: Background[] = [];
  const rawBackgrounds: unknown = values['backgrounds'];
  if (Array.isArray(rawBackgrounds)) {
    for (const item of rawBackgrounds as unknown[]) {
      if (!isRecord(item) || typeof item['id'] !== 'string') continue;
      const attribution = isRecord(item['attribution']) ? item['attribution'] : {};
      const layers: unknown = item['layers'];
      backgrounds.push({
        key: newKey(),
        id: item['id'],
        name: text(item['name'], item['id']),
        server: text(item['server'], ''),
        layers: Array.isArray(layers) ? (layers as unknown[]).filter((l): l is string => typeof l === 'string') : [],
        mode: item['mode'] === 'image' ? 'image' : 'tiles',
        format: item['format'] === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        transparent: item['transparent'] === true,
        attributionText: text(attribution['text'], ''),
        attributionUrl: text(attribution['url'], ''),
      });
    }
  }
  return { servers, backgrounds };
}

/** The settings to save, in the manifest's shape. Every item must have its id (see {@link withIds}). */
export function toSettings(draft: Draft): Settings {
  const servers: JsonValue[] = draft.servers.map((s) => ({
    id: s.id ?? '',
    name: s.name.trim(),
    url: s.url.trim(),
    protocol: 'wms',
    version: s.version,
    timeoutSeconds: Number(s.timeout.trim()),
  }));
  const backgrounds: JsonValue[] = draft.backgrounds.map((b) => {
    const link = b.attributionUrl.trim();
    return {
      id: b.id ?? '',
      name: b.name.trim(),
      server: b.server,
      layers: [...b.layers],
      mode: b.mode,
      format: b.format,
      transparent: b.transparent,
      attribution: link === '' ? { text: b.attributionText.trim() } : { text: b.attributionText.trim(), url: link },
    };
  });
  return { servers, backgrounds };
}

/** A canonical text of settings, to tell whether two are the same (the key order is fixed by {@link toSettings}). */
export function canonical(values: Settings): string {
  return JSON.stringify(toSettings(fromSettings(values)));
}

export function draftKey(draft: Draft): string {
  return JSON.stringify(toSettings(draft));
}

/** An id from a name: lower case letters, digits and single hyphens, at most 64 characters, not one of `taken`. */
export function makeId(name: string, taken: ReadonlySet<string>, fallback: string): string {
  const base = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
    .replace(/-+$/g, '');
  const stem = base === '' ? fallback : base;
  let id = stem;
  for (let n = 2; taken.has(id); n++) id = `${stem}-${String(n)}`;
  return id;
}

/** The draft with an id for every item that has none, made from its name and unique among the ids already there. */
export function withIds(draft: Draft): Draft {
  const serverIds = new Set(draft.servers.flatMap((s) => (s.id === undefined ? [] : [s.id])));
  const servers = draft.servers.map((s) => {
    if (s.id !== undefined) return s;
    const id = makeId(s.name, serverIds, 'server');
    serverIds.add(id);
    return { ...s, id };
  });
  const backgroundIds = new Set(draft.backgrounds.flatMap((b) => (b.id === undefined ? [] : [b.id])));
  const backgrounds = draft.backgrounds.map((b) => {
    if (b.id !== undefined) return b;
    const id = makeId(b.name, backgroundIds, 'background');
    backgroundIds.add(id);
    return { ...b, id };
  });
  return { servers, backgrounds };
}

/** A problem with one field, found before saving. `path` is a JSON Pointer into {@link toSettings}'s result, as ECore reports them. */
export interface FieldProblem {
  readonly path: string;
  readonly problem: string;
}

/**
 * What the schema cannot check, and the schema's own simple rules, so that the admin sees them at the field before ECore
 * does: a background's server is in the list, its layers are chosen, numbers and addresses are well formed. Ids are made
 * unique by {@link withIds}, so no check is needed for them.
 */
export function problems(draft: Draft): FieldProblem[] {
  const found: FieldProblem[] = [];
  const serverIds = new Set(draft.servers.flatMap((s) => (s.id === undefined ? [] : [s.id])));
  draft.servers.forEach((s, i) => {
    const at = `/servers/${String(i)}`;
    if (s.name.trim() === '') found.push({ path: `${at}/name`, problem: 'Give the server a name.' });
    const url = s.url.trim();
    if (url === '') found.push({ path: `${at}/url`, problem: 'Enter the server address.' });
    else if (!URL_PATTERN.test(url)) found.push({ path: `${at}/url`, problem: 'Use an http or https address without a user name or password.' });
    const timeout = Number(s.timeout.trim());
    if (s.timeout.trim() === '' || !Number.isInteger(timeout) || timeout < 1 || timeout > 20) {
      found.push({ path: `${at}/timeoutSeconds`, problem: 'Use a whole number of seconds from 1 to 20.' });
    }
  });
  draft.backgrounds.forEach((b, i) => {
    const at = `/backgrounds/${String(i)}`;
    if (b.name.trim() === '') found.push({ path: `${at}/name`, problem: 'Give the background a name.' });
    if (b.server === '') found.push({ path: `${at}/server`, problem: 'Choose a server.' });
    else if (!serverIds.has(b.server)) found.push({ path: `${at}/server`, problem: 'This server is not in the list.' });
    if (b.layers.length === 0) found.push({ path: `${at}/layers`, problem: 'Choose at least one layer.' });
    else if (b.layers.length > 20) found.push({ path: `${at}/layers`, problem: 'Choose at most 20 layers.' });
    if (b.transparent && b.format !== 'image/png') found.push({ path: `${at}/transparent`, problem: 'Transparency needs PNG.' });
    if (b.attributionText.trim() === '') found.push({ path: `${at}/attribution/text`, problem: 'Enter the attribution text.' });
    const link = b.attributionUrl.trim();
    if (link !== '' && !LINK_PATTERN.test(link)) found.push({ path: `${at}/attribution/url`, problem: 'Use an http or https address.' });
  });
  for (const s of draft.servers) {
    if (s.id !== undefined && !ID_PATTERN.test(s.id)) found.push({ path: '/servers', problem: `The id ${s.id} is not valid.` });
  }
  return found;
}

/** The names of the backgrounds that use a server, so that the panel refuses removing it. */
export function backgroundsUsing(draft: Draft, serverId: string | undefined): string[] {
  if (serverId === undefined) return [];
  return draft.backgrounds.filter((b) => b.server === serverId).map((b) => b.name.trim() === '' ? (b.id ?? 'unnamed') : b.name.trim());
}

/** One layer of a server, as the layer list endpoint gives it. */
export interface LayerInfo {
  readonly name: string;
  readonly title: string;
  readonly projections: readonly string[];
}

/** The projections every layer in `chosen` lists, for those the server has; `null` when none of them is known. */
export function commonProjections(chosen: readonly string[], layers: readonly LayerInfo[]): readonly string[] | null {
  let common: readonly string[] | null = null;
  for (const name of chosen) {
    const layer = layers.find((l) => l.name === name);
    if (layer === undefined) continue;
    common = common === null ? layer.projections : common.filter((p) => layer.projections.includes(p));
  }
  return common;
}
