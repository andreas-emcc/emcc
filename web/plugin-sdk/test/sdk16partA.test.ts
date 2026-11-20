// SDK and data model 1.6.0 part A (CR-0041; ADR-0055 point 4): core.text in the web SDK's model.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CORE_TEXT,
  TEXT_MAX_LENGTH,
  TEXT_SIZE_DEFAULT,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  type MapObject,
  type MapObjectContent,
  type TextContent,
} from '../src/index.ts';

describe('SDK 1.6.0 part A: core.text', () => {
  it('has the limits of the schema and the Java SDK', () => {
    expect(CORE_TEXT).toBe('core.text');
    expect(TEXT_MAX_LENGTH).toBe(1024);
    expect([TEXT_SIZE_MIN, TEXT_SIZE_DEFAULT, TEXT_SIZE_MAX]).toEqual([8, 14, 48]);
    const schema = JSON.parse(readFileSync(new URL('../../../model/schemas/map-object.schema.json', import.meta.url), 'utf8')) as {
      $defs: { text: { properties: { value: { maxLength: number }; size: { minimum: number; maximum: number } } } };
    };
    expect(schema.$defs.text.properties.value.maxLength).toBe(TEXT_MAX_LENGTH);
    expect([schema.$defs.text.properties.size.minimum, schema.$defs.text.properties.size.maximum]).toEqual([TEXT_SIZE_MIN, TEXT_SIZE_MAX]);
  });

  it('reads the model example as a MapObject with its text', () => {
    const example = JSON.parse(readFileSync(new URL('../../../model/examples/valid/object-text.json', import.meta.url), 'utf8')) as MapObject;
    expect(example.type).toBe(CORE_TEXT);
    const text: TextContent | undefined = example.text;
    expect(text).toEqual({ value: 'Bridge 12\nclosed', rotation: 330, size: 16 });
    expect(example.geometry).toEqual({ type: 'Point', coordinates: [15.2, 58.4] });
  });

  it('types a text object without a symbol', () => {
    const content: MapObjectContent = {
      type: CORE_TEXT,
      dataType: 'core.general',
      dataSource: 'nvg-file',
      layerId: '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01',
      geometry: { type: 'Point', coordinates: [15.2, 58.4] },
      text: { value: 'Alpha' },
      label: { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' },
    };
    expect(content.text?.rotation ?? 0).toBe(0);
    expect(content.symbol).toBeUndefined();
  });
});
