/**
 * The looks (ADR-0034; T-052): Night Watch, Chart Room and Signal, each light or dark, compact or
 * comfortable. The user's choice is part of their setup (the shell's share, `setups/setups.ts`):
 * the look (the installation's default, or one of the three), light or dark (the computer's
 * setting, or one of them), and the density (the look's default, or one of the two). A choice that
 * keeps the installation's default follows the admin's (Settings › General) at the next load.
 *
 * {@link ShellTheme} turns the choice into the page root's attributes, which `tokens.css` and
 * `shell-look.css` follow, at once and without a reload, and tells `ctx.theme`'s listeners.
 */
import { TOKENS, type ColourScheme, type Density, type Look, type ThemeState, type TokenName, type Unsubscribe } from '@emc2/plugin-sdk';
import type { ShellStore } from './store.ts';

export const LOOKS: readonly Look[] = ['night-watch', 'chart-room', 'signal'];
export const LOOK_NAMES: Readonly<Record<Look, string>> = { 'night-watch': 'Night Watch', 'chart-room': 'Chart Room', signal: 'Signal' };
/** Each look's default density (looks.md). */
export const LOOK_DENSITY: Readonly<Record<Look, Density>> = { 'night-watch': 'compact', 'chart-room': 'comfortable', signal: 'compact' };
/** The installation's default until the configuration has arrived, and until an admin chooses one. */
export const BUILT_IN_LOOK: Look = 'night-watch';

/** The user's choice (ADR-0034 consequences). */
export interface LookChoice {
  readonly look: Look | 'default';
  readonly scheme: ColourScheme | 'system';
  readonly density: Density | 'look';
}

export const DEFAULT_CHOICE: LookChoice = { look: 'default', scheme: 'system', density: 'look' };

const isLook = (value: unknown): value is Look => LOOKS.includes(value as Look);

/** The choice in a stored setup; null if it holds none this version can read. Unknown values fall back to the default's. */
export function choiceFromJson(value: unknown): LookChoice | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Readonly<Record<string, unknown>>;
  return {
    look: isLook(v.look) ? v.look : 'default',
    scheme: v.scheme === 'light' || v.scheme === 'dark' ? v.scheme : 'system',
    density: v.density === 'compact' || v.density === 'comfortable' ? v.density : 'look',
  };
}

/** A look the configuration names; the built-in one for anything else. */
export function lookOrBuiltIn(value: unknown): Look {
  return isLook(value) ? value : BUILT_IN_LOOK;
}

/** The look and density a choice comes to with this installation default. */
export function lookOf(choice: LookChoice, installation: Look): Look {
  return choice.look === 'default' ? installation : choice.look;
}

export function densityOf(choice: LookChoice, installation: Look): Density {
  return choice.density === 'look' ? LOOK_DENSITY[lookOf(choice, installation)] : choice.density;
}

/** What the page shows for a choice, the installation default and the computer's setting. */
export function resolve(choice: LookChoice, installation: Look, systemDark: boolean): ThemeState {
  return {
    look: lookOf(choice, installation),
    scheme: choice.scheme === 'system' ? (systemDark ? 'dark' : 'light') : choice.scheme,
    density: densityOf(choice, installation),
  };
}

/** What `ctx.theme` needs of the shell. */
export interface ThemeSource {
  readonly current: ThemeState;
  tokens(): Readonly<Record<TokenName, string>>;
  /** Called after the look, light or dark, or the density changed (also the computer's setting). */
  onChange(listener: (state: ThemeState) => void): Unsubscribe;
}

export interface ShellThemeOptions {
  readonly store: ShellStore;
  /** The element the attributes go on; the page root. */
  readonly root?: HTMLElement;
  /** The computer's dark setting; none in tests without `matchMedia`. */
  readonly dark?: MediaQueryList | null;
}

const same = (a: ThemeState, b: ThemeState): boolean => a.look === b.look && a.scheme === b.scheme && a.density === b.density;

/** Applies the store's choice to the page, and tells the listeners of every change. */
export class ShellTheme implements ThemeSource {
  private state: ThemeState;
  private readonly listeners = new Set<(state: ThemeState) => void>();
  private readonly root: HTMLElement;
  private readonly dark: MediaQueryList | null;

  constructor(private readonly options: ShellThemeOptions) {
    this.root = options.root ?? document.documentElement;
    this.dark = options.dark !== undefined ? options.dark : typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    this.state = this.resolved();
    this.apply();
    options.store.subscribe(() => { this.update(); });
    this.dark?.addEventListener('change', () => { this.update(); });
  }

  get current(): ThemeState {
    return this.state;
  }

  /** The current value of every token, as the page's CSS sets it now. */
  tokens(): Readonly<Record<TokenName, string>> {
    const style = getComputedStyle(this.root);
    return Object.fromEntries((Object.keys(TOKENS) as TokenName[]).map((name) => [name, style.getPropertyValue(TOKENS[name]).trim()])) as Record<TokenName, string>;
  }

  onChange(listener: (state: ThemeState) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private resolved(): ThemeState {
    const view = this.options.store.getView();
    return resolve(view.look, view.installationLook, this.dark?.matches === true);
  }

  private update(): void {
    const next = this.resolved();
    if (same(next, this.state)) return;
    this.state = next;
    this.apply();
    for (const listener of [...this.listeners]) listener(next);
  }

  private apply(): void {
    this.root.dataset['look'] = this.state.look;
    this.root.dataset['scheme'] = this.state.scheme;
    this.root.dataset['density'] = this.state.density;
  }
}
