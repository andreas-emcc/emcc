// A route point's events and the Event panel (brief functions 13 and 22; the owner's Q14, A44).
// An event is "hide", or "set": core fields (name, description, SIDC, text modifiers) and other
// plugins' declared fields. Its format is the plugin's README's ("Events"); the server part checks
// it and applies it as each object passes the point.
import { declaredFieldProblem, sameField } from '@emc2/plugin-sdk';
import type { DeclaredField, FieldValue, JsonValue, PanelHandle, SymbolService, TextModifierName, Uuid } from '@emc2/plugin-sdk';
import { isJson } from './definition.ts';
import type { Json } from './definition.ts';
import type { RouteEditorModel } from './editor.ts';
import { Model } from './model.ts';
import type { Failure } from './model.ts';

/** The data model's text modifiers, in its order (`TextModifierName`). */
export const TEXT_MODIFIERS = [
  'additionalInformation', 'altitudeDepth', 'auxiliaryEquipmentIndicator', 'combatEffectiveness', 'commonIdentifier', 'country', 'dtg',
  'engagementBar', 'engagementType', 'equipmentTeardownTime', 'evaluationRating', 'guardedUnit', 'headquartersElement', 'higherFormation',
  'hostile', 'iffSif', 'installationComposition', 'location', 'platformType', 'quantity', 'reinforcedReduced', 'sigint',
  'signatureEquipment', 'specialDesignator', 'specialHeadquarters', 'staffComments', 'type', 'uniqueDesignation',
] as const satisfies readonly TextModifierName[];

/** "uniqueDesignation" → "Unique designation". */
export function modifierLabel(name: string): string {
  const words = name.replace(/([A-Z])/g, ' $1').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What an event does to a core field: leaves it, sets it, or clears it (the SIDC cannot be cleared). */
export type CoreMode = 'keep' | 'set' | 'clear';

export interface CoreValue {
  readonly mode: CoreMode;
  readonly text: string;
}

export interface TextRow {
  readonly name: TextModifierName;
  /** Clear removes the modifier. */
  readonly mode: 'set' | 'clear';
  readonly text: string;
}

/** The Event panel's form. */
export interface EventForm {
  readonly kind: 'hide' | 'set';
  /** Empty for all the route's objects. */
  readonly objects: readonly Uuid[];
  readonly name: CoreValue;
  readonly description: CoreValue;
  readonly sidc: CoreValue;
  readonly texts: readonly TextRow[];
  /** Declared fields to set; a null value clears one. */
  readonly fields: readonly FieldValue[];
}

const KEEP: CoreValue = { mode: 'keep', text: '' };

export const EMPTY_FORM: EventForm = { kind: 'set', objects: [], name: KEEP, description: KEEP, sidc: KEEP, texts: [], fields: [] };

function coreValue(core: Json, key: string): CoreValue {
  if (!(key in core)) return KEEP;
  const v = core[key];
  return typeof v === 'string' ? { mode: 'set', text: v } : { mode: 'clear', text: '' };
}

/** The form for an existing event; what it cannot show is left out. */
export function formOf(event: Json): EventForm {
  const objects = Array.isArray(event['objects']) ? (event['objects'] as readonly JsonValue[]).filter((o): o is string => typeof o === 'string') : [];
  if (event['kind'] === 'hide') return { ...EMPTY_FORM, kind: 'hide', objects };
  const core = isJson(event['core']) ? event['core'] : {};
  const texts = isJson(core['texts']) ? core['texts'] : {};
  const known = new Set<string>(TEXT_MODIFIERS);
  const fields = Array.isArray(event['fields'])
    ? (event['fields'] as readonly JsonValue[]).flatMap((f) => {
      if (!isJson(f) || typeof f['plugin'] !== 'string' || typeof f['name'] !== 'string') return [];
      const value = f['value'];
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null ? [{ plugin: f['plugin'], name: f['name'], value }] : [];
    })
    : [];
  return {
    kind: 'set',
    objects,
    name: coreValue(core, 'name'),
    description: coreValue(core, 'description'),
    sidc: coreValue(core, 'sidc'),
    texts: Object.entries(texts).flatMap(([name, value]) =>
      known.has(name) ? [{ name: name as TextModifierName, mode: typeof value === 'string' ? 'set' as const : 'clear' as const, text: typeof value === 'string' ? value : '' }] : []),
    fields,
  };
}

/** The event's JSON (the README's "Events"). */
export function eventOf(form: EventForm): Json {
  const objects = form.objects.length === 0 ? {} : { objects: [...form.objects] };
  if (form.kind === 'hide') return { kind: 'hide', ...objects };
  const core: { [key: string]: JsonValue } = {};
  for (const key of ['name', 'description', 'sidc'] as const) {
    const v = form[key];
    if (v.mode === 'set') core[key] = v.text.trim();
    else if (v.mode === 'clear') core[key] = null;
  }
  if (form.texts.length > 0) core['texts'] = Object.fromEntries(form.texts.map((t) => [t.name, t.mode === 'set' ? t.text.trim() : null]));
  return {
    kind: 'set',
    ...objects,
    ...(Object.keys(core).length === 0 ? {} : { core }),
    ...(form.fields.length === 0 ? {} : { fields: form.fields.map((f) => ({ plugin: f.plugin, name: f.name, value: f.value })) }),
  };
}

/** What stops the form from being saved, by field (`name`, `description`, `sidc`, `texts.<i>`, `form`). */
export function formProblems(form: EventForm, declared: readonly DeclaredField[], symbols: SymbolService | null): { readonly [key: string]: string } {
  const out: { [key: string]: string } = {};
  if (form.kind === 'hide') return out;
  const text = (key: 'name' | 'description', max: number) => {
    const v = form[key];
    if (v.mode !== 'set') return;
    const t = v.text.trim();
    if (t === '') out[key] = 'Type a value, or choose "Clear it"';
    else if (t.length > max) out[key] = `At most ${String(max)} characters`;
  };
  text('name', 256);
  text('description', 4096);
  if (form.sidc.mode === 'clear') out['sidc'] = 'The SIDC cannot be cleared';
  if (form.sidc.mode === 'set') {
    const sidc = form.sidc.text.trim();
    if (sidc === '' || sidc.length > 30) out['sidc'] = 'Type a SIDC of up to 30 characters';
    else if (symbols !== null) {
      const check = symbols.validate(sidc.length === 15 ? 'APP-6B' : sidc.length === 30 ? 'APP-6E' : 'APP-6D', sidc);
      if (!check.valid) out['sidc'] = check.problem ?? 'Not a valid SIDC';
    }
  }
  const seen = new Set<string>();
  form.texts.forEach((t, i) => {
    if (seen.has(t.name)) out[`texts.${String(i)}`] = `${modifierLabel(t.name)} is listed twice`;
    seen.add(t.name);
    if (t.mode === 'set' && (t.text.trim() === '' || t.text.trim().length > 128)) out[`texts.${String(i)}`] = 'Type 1 to 128 characters, or choose "Clear it"';
  });
  for (const f of form.fields) {
    const field = declared.find((d) => sameField(d, f));
    const problem = field === undefined ? `no plugin declares ${f.plugin}.${f.name}` : declaredFieldProblem(field, f.value);
    if (problem !== null) out[`fields.${f.plugin}.${f.name}`] = problem;
  }
  const changes = ['name', 'description', 'sidc'].filter((k) => form[k as 'name'].mode !== 'keep').length + form.texts.length + form.fields.length;
  if (changes === 0) out['form'] = 'Choose at least one change';
  return out;
}

/** A short description of an event for its point's row, e.g. "Hide · all" or "Change name, Team (cot) · 2 objects". */
export function summary(event: Json, declared: readonly DeclaredField[]): string {
  const form = formOf(event);
  const who = form.objects.length === 0 ? 'all' : form.objects.length === 1 ? '1 object' : `${String(form.objects.length)} objects`;
  if (form.kind === 'hide') return `Hide · ${who}`;
  if (event['kind'] !== 'set') return `Unknown event · ${who}`;
  const what = [
    ...(['name', 'description', 'sidc'] as const).filter((k) => form[k].mode !== 'keep').map((k) => (k === 'sidc' ? 'SIDC' : k)),
    ...form.texts.map((t) => modifierLabel(t.name).toLowerCase()),
    ...form.fields.map((f) => {
      const d = declared.find((x) => sameField(x, f));
      const name = d === undefined ? `${f.plugin}.${f.name}` : `${d.label} (${d.plugin})`;
      return f.value === null ? `clear ${name}` : name; // A90
    }),
  ];
  return `Change ${what.length === 0 ? 'nothing' : what.join(', ')} · ${who}`;
}

export interface EventState {
  readonly open: boolean;
  readonly routeId: Uuid | null;
  readonly point: number;
  /** The event's place in the point's list; null for a new one. */
  readonly index: number | null;
  readonly form: EventForm;
  /** The declared fields the event had when it was opened (function 26). */
  readonly startFields: readonly FieldValue[];
  /** Counts the opens, so that the fields editor starts afresh for each (function 26, A87). */
  readonly opened: number;
  readonly failure: Failure | null;
  readonly busy: boolean;
}

/** The Event panel's model (Q14): it saves with its own Save, since an event is several fields at once. */
export class EventModel extends Model<EventState> {
  private handle: PanelHandle | null = null;

  constructor(
    private readonly editor: RouteEditorModel,
    private readonly addPanel: () => PanelHandle,
  ) {
    super({ open: false, routeId: null, point: 0, index: null, form: EMPTY_FORM, startFields: [], opened: 0, failure: null, busy: false });
  }

  /** Opens an existing event (`index`), or a new one at `point` (`index` null). */
  open(routeId: Uuid, point: number, index: number | null, event: Json | null): void {
    const form = event === null ? EMPTY_FORM : formOf(event);
    this.update({ open: true, routeId, point, index, form, startFields: form.fields, opened: this.getState().opened + 1, failure: null, busy: false });
    // A panel added below others stays out of sight unless shown (part D, as draw-shapes does).
    this.handle ??= this.addPanel();
    this.handle.show();
  }

  close(): void {
    this.handle?.remove();
    this.handle = null;
    this.update({ open: false, routeId: null, failure: null, busy: false });
  }

  setForm(patch: Partial<EventForm>): void {
    this.update({ form: { ...this.getState().form, ...patch } });
  }

  /**
   * The declared fields from the editor (function 26; the owner, 2026-10-31): a field emptied that
   * the event had stays, as "clear it" when the event fires; one it did not have is left out.
   */
  setFields(fields: readonly FieldValue[]): void {
    const start = this.getState().startFields;
    this.setForm({ fields: fields.filter((f) => f.value !== null || start.some((s) => sameField(s, f))) });
  }

  dismissFailure(): void {
    this.update({ failure: null });
  }

  /** Writes the event into the point's list, from the newest route; closes on success. */
  async save(problems: { readonly [key: string]: string }): Promise<void> {
    const { routeId, point, index, form, busy } = this.getState();
    if (busy || Object.keys(problems).length > 0) return;
    if (routeId === null || this.editor.getState().routeId !== routeId) {
      this.update({ failure: { message: 'The route is no longer open in the route editor', retry: null } });
      return;
    }
    const json = eventOf(form);
    this.update({ busy: true, failure: null });
    const saved = await this.editor.setEvents(point, (events) => (index === null ? [...events, json] : events.map((e, j) => (j === index ? json : e))));
    if (saved) this.close();
    else this.update({ busy: false, failure: this.editor.getState().failure ?? { message: 'The event was not saved', retry: null } });
  }
}
