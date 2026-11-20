import { describe, expect, it } from 'vitest';
import { Drafts } from './drafts.ts';
import { below, changedValues, emptyOf, fieldOf, labelOf, readNumber, sameJson, valueAt, type Field } from './schema.ts';

/** Like cot's settings: a list of objects with a nested optional object. */
const COT = {
  type: 'object',
  properties: {
    streams: {
      description: 'The TAK systems.', type: 'array', default: [],
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', pattern: '^[a-z]+$', maxLength: 64 },
          host: { type: 'string', minLength: 1, maxLength: 253 },
          port: { type: 'integer', minimum: 1, maximum: 65535 },
          transport: { enum: ['tcp', 'tls'], default: 'tcp' },
          label: { type: 'object', properties: { policy: { type: 'string' } }, required: ['policy'] },
          enabled: { type: 'boolean', default: true },
        },
        required: ['name', 'host', 'port'],
      },
    },
    idleTimeoutSeconds: { type: 'integer', minimum: 1, maximum: 3600, default: 300 },
  },
};

const objectOf = (field: Field) => {
  if (field.kind !== 'object') throw new Error(`not an object: ${field.kind}`);
  return field;
};

describe('the settings form model', () => {
  it('makes an input of the right kind for each property, with its limits', () => {
    const root = objectOf(fieldOf(COT, 'Settings'));
    expect(root.properties.map((p) => [p.name, p.field.kind, p.field.label])).toEqual([
      ['streams', 'list', 'Streams'],
      ['idleTimeoutSeconds', 'number', 'Idle timeout seconds'],
    ]);
    expect(root.properties[1]?.field).toMatchObject({ integer: true, minimum: 1, maximum: 3600, default: 300 });
    const streams = root.properties[0]?.field;
    if (streams?.kind !== 'list') throw new Error('streams');
    const stream = objectOf(streams.item);
    expect(stream.properties.map((p) => [p.name, p.field.kind, p.required])).toEqual([
      ['name', 'text', true], ['host', 'text', true], ['port', 'number', true],
      ['transport', 'choice', false], ['label', 'object', false], ['enabled', 'boolean', false],
    ]);
    expect(stream.properties[0]?.field).toMatchObject({ pattern: '^[a-z]+$', maxLength: 64 });
    expect(stream.properties[3]?.field).toMatchObject({ options: ['tcp', 'tls'] });
  });

  it('takes a title over the property name, and lists of numbers with a fixed length', () => {
    const field = objectOf(fieldOf({
      properties: {
        extent: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
        mode: { title: 'Drawing mode', type: 'string', enum: ['a', 'b'] },
      },
    }, 'Settings'));
    expect(field.properties[0]?.field).toMatchObject({ kind: 'list', minItems: 4, maxItems: 4, item: { kind: 'number', integer: false } });
    expect(field.properties[1]?.field).toMatchObject({ kind: 'choice', label: 'Drawing mode' });
  });

  it('gives a JSON text box to whatever it cannot show as inputs', () => {
    for (const schema of [
      { oneOf: [{ type: 'string' }, { type: 'integer' }] },
      { $ref: '#/$defs/x' },
      { type: ['string', 'null'] },
      { type: 'array' },
      { type: 'object' },
      { enum: [{ a: 1 }] },
      {},
      true,
    ]) {
      expect(fieldOf(schema, 'X').kind, JSON.stringify(schema)).toBe('json');
    }
  });

  it('knows a picked layer and a set of them by their annotation (SDK 1.2.0), and nothing else as one', () => {
    // As in model/examples/valid/manifest-layer-picker.json.
    const pick = { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string', minLength: 1, maxLength: 256 } }, required: ['name'] };
    const links = fieldOf({
      type: 'array', default: [],
      items: {
        type: 'object',
        properties: {
          targetLayer: { ...pick, description: 'Where received objects go.', 'x-emc2': { kind: 'layer' } },
          sourceLayers: { type: 'array', default: [], items: { ...pick, 'x-emc2': { kind: 'layer', allowNew: false } } },
          other: { ...pick, 'x-emc2': { kind: 'colour' } },
        },
      },
    }, 'Links');
    if (links.kind !== 'list') throw new Error(links.kind);
    const [target, sources, other] = objectOf(links.item).properties.map((p) => p.field);

    expect(target).toMatchObject({ kind: 'layer', allowNew: true, label: 'Target layer', description: 'Where received objects go.' });
    expect(sources).toMatchObject({ kind: 'layers', allowNew: false, default: [] });
    expect(other?.kind, 'another annotation').toBe('object');
    expect(emptyOf(objectOf(links.item))).toEqual({ sourceLayers: [] }); // a single pick starts unset, a set with its default
    if (target === undefined || sources === undefined) throw new Error('missing');
    expect(emptyOf(target)).toBeNull();
    expect(emptyOf({ ...sources, default: undefined })).toEqual([]);
  });

  it('starts a new list item with its defaults and empty required values', () => {
    const streams = objectOf(fieldOf(COT, 'Settings')).properties[0]?.field;
    if (streams?.kind !== 'list') throw new Error('streams');
    expect(emptyOf(streams.item)).toEqual({ name: '', host: '', port: 1, transport: 'tcp', enabled: true });
    expect(emptyOf(streams)).toEqual([]); // its default
  });

  it('names properties for people, and builds JSON Pointers', () => {
    expect(labelOf('upstreamTimeoutSeconds')).toBe('Upstream timeout seconds');
    expect(labelOf('max_event-bytes')).toBe('Max event bytes');
    expect(labelOf('url')).toBe('Url');
    expect(below('', 'streams')).toBe('/streams');
    expect(below('/streams', 0)).toBe('/streams/0');
    expect(below('', 'a/b~c')).toBe('/a~1b~0c');
  });

  it('finds the value a JSON Pointer names', () => {
    const value = { streams: [{ name: 'north' }], 'a/b~c': 1 };
    expect(valueAt(value, '')).toBe(value);
    expect(valueAt(value, '/streams/0/name')).toBe('north');
    expect(valueAt(value, below('', 'a/b~c'))).toBe(1);
    for (const pointer of ['/streams/1', '/streams/01', '/streams/x', '/streams/0/name/0', '/missing', '/toString']) {
      expect(valueAt(value, pointer), pointer).toBeUndefined();
    }
  });

  it('reads typed numbers, and says why text is not one', () => {
    expect(readNumber(' 42 ', true)).toEqual({ value: 42, problem: null });
    expect(readNumber('-1.5e3', false)).toEqual({ value: -1500, problem: null });
    expect(readNumber('.5', false)).toEqual({ value: 0.5, problem: null });
    expect(readNumber('', true)).toEqual({ value: undefined, problem: null });
    for (const text of ['3x', '1,5', '0x10', 'Infinity', '1e999', '-']) {
      expect(readNumber(text, false), text).toEqual({ value: undefined, problem: 'Not a number.' });
    }
    expect(readNumber('2.5', true)).toEqual({ value: undefined, problem: 'Not a whole number.' });
  });

  it('compares JSON without regard to the order of members', () => {
    expect(sameJson({ a: 1, b: [1, { c: true }] }, { b: [1, { c: true }], a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson(null, {})).toBe(false);
  });
});

describe('drafts', () => {
  it('keep edits per key until dropped; an edit back to the start is no draft', () => {
    const drafts = new Drafts();
    let told = 0;
    drafts.subscribe(() => { told++; });
    drafts.edit('plugin/a', { x: 1 }, { x: 2 });
    expect(drafts.get('plugin/a')).toEqual({ base: { x: 1 }, value: { x: 2 } });
    expect(drafts.any()).toBe(true);
    drafts.edit('plugin/a', { x: 1 }, { x: 1 });
    expect(drafts.get('plugin/a')).toBeUndefined();
    expect(drafts.any()).toBe(false);
    drafts.drop('plugin/a'); // nothing to drop: nobody is told
    expect(told).toBe(2);
  });
});

describe('the count of unsaved changes (T-203 part C)', () => {
  it('counts each changed leaf value, and a list item or property only one side has as one', () => {
    expect(changedValues({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(0);
    expect(changedValues({ a: 1, b: 'x' }, { a: 2, b: 'y' })).toBe(2);
    expect(changedValues({ links: [{ host: 'a', port: 1 }] }, { links: [{ host: 'b', port: 2 }, { host: 'c', port: 3 }] }), 'two values, one item added').toBe(3);
    expect(changedValues({ a: 1 }, { a: 1, b: { c: 2 } }), 'a new property').toBe(1);
    expect(changedValues([1, 2, 3], [1])).toBe(2);
  });
});
