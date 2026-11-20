/** The keys of a pointer event (brief function 14): the add key is Ctrl, or Cmd on a Mac. */
import { describe, expect, it } from 'vitest';
import { addKeyOnly, anyModifier, clickKeys, isMac } from '../../src/engine/modifiers.ts';

const none = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };

describe('modifier keys', () => {
  it('knows a Mac by its platform, or by its user agent where the platform is empty', () => {
    expect(isMac({ platform: 'MacIntel' })).toBe(true);
    expect(isMac({ platform: 'Win32', userAgent: 'Macintosh' })).toBe(false);
    expect(isMac({ platform: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' })).toBe(true);
    expect(isMac({ platform: 'Linux x86_64' })).toBe(false);
    expect(isMac({})).toBe(false);
  });

  it('criterion 25: the add key is Ctrl alone, or Cmd alone on a Mac', () => {
    expect(addKeyOnly({ ...none, ctrlKey: true }, false)).toBe(true);
    expect(addKeyOnly({ ...none, metaKey: true }, false)).toBe(false);
    expect(addKeyOnly({ ...none, metaKey: true }, true)).toBe(true);
    expect(addKeyOnly({ ...none, ctrlKey: true }, true)).toBe(false);
    expect(addKeyOnly({ ...none, ctrlKey: true, shiftKey: true }, false)).toBe(false);
    expect(addKeyOnly({ ...none, ctrlKey: true, altKey: true }, false)).toBe(false);
  });

  it('sorts a click into no key, the add key or other keys', () => {
    expect(clickKeys(none, false)).toBeUndefined();
    expect(clickKeys({ ...none, ctrlKey: true }, false)).toBe('add');
    expect(clickKeys({ ...none, ctrlKey: true }, true)).toBe('other');
    expect(clickKeys({ ...none, shiftKey: true }, false)).toBe('other');
    expect(anyModifier({ ...none, altKey: true })).toBe(true);
    expect(anyModifier(none)).toBe(false);
  });
});
