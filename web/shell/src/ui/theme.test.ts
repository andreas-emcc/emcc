import { afterEach, describe, expect, it } from 'vitest';
import { ShellStore } from './store.ts';
import { choiceFromJson, DEFAULT_CHOICE, densityOf, lookOrBuiltIn, resolve, ShellTheme } from './theme.ts';

/** A stand-in for the computer's light or dark setting. */
function systemScheme(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, l: () => void) => { listeners.add(l); },
    removeEventListener: (_: string, l: () => void) => { listeners.delete(l); },
  };
  return { query: query as unknown as MediaQueryList, set: (to: boolean) => { query.matches = to; for (const l of listeners) l(); } };
}

afterEach(() => {
  document.documentElement.removeAttribute('data-look');
});

describe('the looks (ADR-0034)', () => {
  it("come from the user's choice, the installation's default and the computer's setting", () => {
    expect(resolve(DEFAULT_CHOICE, 'night-watch', true)).toEqual({ look: 'night-watch', scheme: 'dark', density: 'compact' });
    expect(resolve(DEFAULT_CHOICE, 'chart-room', false)).toEqual({ look: 'chart-room', scheme: 'light', density: 'comfortable' });
    expect(resolve({ look: 'signal', scheme: 'light', density: 'comfortable' }, 'chart-room', true))
      .toEqual({ look: 'signal', scheme: 'light', density: 'comfortable' });
    expect(densityOf({ ...DEFAULT_CHOICE, look: 'signal' }, 'chart-room')).toBe('compact'); // Signal's own default
  });

  it('read a setup kindly: unknown values keep the defaults, and something that is no choice is none', () => {
    expect(choiceFromJson({ look: 'chart-room', scheme: 'dark', density: 'compact' })).toEqual({ look: 'chart-room', scheme: 'dark', density: 'compact' });
    expect(choiceFromJson({ look: 'pink', scheme: 'dusk' })).toEqual(DEFAULT_CHOICE);
    expect(choiceFromJson('chart-room')).toBeNull();
    expect(choiceFromJson(null)).toBeNull();
    expect([lookOrBuiltIn('signal'), lookOrBuiltIn('pink'), lookOrBuiltIn(undefined)]).toEqual(['signal', 'night-watch', 'night-watch']);
  });

  it("put the look on the page at once, follow the store and the computer, and tell only of real changes", () => {
    const store = new ShellStore();
    const root = document.createElement('div');
    const system = systemScheme(false);
    const theme = new ShellTheme({ store, root, dark: system.query });
    const attributes = () => [root.dataset['look'], root.dataset['scheme'], root.dataset['density']];
    expect(attributes()).toEqual(['night-watch', 'light', 'compact']);
    const seen: string[] = [];
    theme.onChange((s) => seen.push(`${s.look} ${s.scheme} ${s.density}`));

    store.setInstallationLook('chart-room'); // the configuration arrives
    expect(attributes()).toEqual(['chart-room', 'light', 'comfortable']);
    system.set(true); // the computer goes dark
    expect(attributes()).toEqual(['chart-room', 'dark', 'comfortable']);
    store.setLook({ look: 'default', scheme: 'light', density: 'compact' }); // the user's setup
    expect(attributes()).toEqual(['chart-room', 'light', 'compact']);
    system.set(false);
    store.setClock('local'); // nothing to do with the look
    expect(seen).toEqual(['chart-room light comfortable', 'chart-room dark comfortable', 'chart-room light compact']);
  });

  it("read the token values the page's CSS gives", () => {
    const root = document.createElement('div');
    root.style.setProperty('--emc2-color-accent', '#5641d1');
    document.body.append(root);
    const theme = new ShellTheme({ store: new ShellStore(), root, dark: null });
    expect(theme.tokens().colorAccent).toBe('#5641d1');
    root.remove();
  });
});
