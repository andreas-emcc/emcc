/**
 * The user's display settings in this page (SDK 1.4.0 part 5; ADR-0046, ADR-0052): `ctx.display`
 * for every plugin, the same in every workspace. The server keeps the user's choices and the
 * admin's defaults (`GET /api/display`); this page resolves them with the loaded relation kinds
 * (`resolveDisplay`). After the live notice `display`, and after each `welcome`, it reads both again,
 * one read at a time, so every browser of the user ends on what was stored last (owner, 2026-11-07).
 *
 * A change in the window applies at once here and is saved: `preview` while a slider is held, `save`
 * on its release (owner, 2026-11-07). While a change is held or being saved, a read's answer is set
 * aside and the page reads again afterwards, so an older answer never undoes the user's change.
 */
import {
  displayChoicesProblem, resolveDisplay, type DisplayChoices, type DisplaySettings, type ReadonlyState, type RelationKind, type Unsubscribe,
} from '@emc2/plugin-sdk';

export const DISPLAY_PATH = '/api/display';
const TIMEOUT_MS = 10_000;

/** The server's answer to a read: what the user and the admin have set. */
export interface StoredDisplay {
  readonly choices: DisplayChoices;
  readonly defaults: DisplayChoices;
}

export interface DisplayStateOptions {
  readonly relationKinds: readonly RelationKind[];
  readonly fetch?: typeof fetch;
  /** A message for the user when a change could not be saved. */
  readonly onProblem?: (message: string) => void;
  readonly log?: Pick<Console, 'warn'>;
}

/** Choices as the server gave them, or `{}` (and a warning) when they are not well formed. */
function checked(value: unknown, what: string, log: Pick<Console, 'warn'>): DisplayChoices {
  const problem = displayChoicesProblem(value);
  if (problem === null) return value as DisplayChoices;
  log.warn(`The ${what} display settings from the server are not used: ${problem}`);
  return {};
}

export class DisplayState implements ReadonlyState<DisplaySettings> {
  private readonly kinds: readonly RelationKind[];
  private readonly doFetch: typeof fetch;
  private readonly onProblem: (message: string) => void;
  private readonly log: Pick<Console, 'warn'>;
  private readonly listeners = new Set<(value: DisplaySettings) => void>();
  private stored: StoredDisplay = { choices: {}, defaults: {} };
  private current: DisplaySettings;
  private reading = false;
  private again = false;
  private held = false;
  private saving = 0;

  constructor(options: DisplayStateOptions) {
    this.kinds = options.relationKinds;
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.onProblem = options.onProblem ?? (() => undefined);
    this.log = options.log ?? console;
    this.current = resolveDisplay({}, {}, this.kinds);
  }

  get value(): DisplaySettings {
    return this.current;
  }

  /** What the user has set (relation switches of kinds not loaded included) and the admin's defaults. */
  get choices(): DisplayChoices {
    return this.stored.choices;
  }

  get defaults(): DisplayChoices {
    return this.stored.defaults;
  }

  get relationKinds(): readonly RelationKind[] {
    return this.kinds;
  }

  onChange(listener: (value: DisplaySettings) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Reads the user's choices and the admin's defaults; a read asked for during one follows it. */
  async load(): Promise<void> {
    if (this.reading) {
      this.again = true;
      return;
    }
    this.reading = true;
    try {
      do {
        this.again = false;
        const read = await this.read();
        if (read === null) continue;
        if (this.held || this.saving > 0) this.again = true; // after the change, read again
        else this.apply(read);
      } while (this.again && !this.held && this.saving === 0);
    } finally {
      this.reading = false;
    }
  }

  /** Shows `choices` at once without saving them, e.g. while a slider is held. */
  preview(choices: DisplayChoices): void {
    this.held = true;
    this.apply({ ...this.stored, choices });
  }

  /** Shows and saves `choices`, the user's whole choices (`{}`: "Use defaults"). */
  async save(choices: DisplayChoices): Promise<void> {
    this.held = false;
    this.apply({ ...this.stored, choices });
    this.saving += 1;
    let problem: string | null;
    try {
      problem = await this.write(DISPLAY_PATH, choices);
    } finally {
      this.saving -= 1;
    }
    if (problem !== null) this.onProblem(`Your display settings were not saved: ${problem}`);
    if (this.saving === 0) await this.load(); // the stored state, also after a refusal
  }

  /** The admin saved new defaults (Settings › Display): shown at once, before the notice. */
  defaultsSaved(defaults: DisplayChoices): void {
    this.apply({ ...this.stored, defaults });
  }

  private apply(next: StoredDisplay): void {
    this.stored = next;
    const value = resolveDisplay(next.choices, next.defaults, this.kinds);
    if (JSON.stringify(value) === JSON.stringify(this.current)) return;
    this.current = value;
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch (error) {
        this.log.warn('A display settings listener failed', error);
      }
    }
  }

  private async read(): Promise<StoredDisplay | null> {
    try {
      const response = await this.doFetch(DISPLAY_PATH, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) {
        this.log.warn(`The display settings could not be read: HTTP ${String(response.status)}`);
        return null;
      }
      const body = (await response.json()) as { readonly choices?: unknown; readonly defaults?: unknown };
      return { choices: checked(body.choices, "user's", this.log), defaults: checked(body.defaults, "admin's", this.log) };
    } catch (error) {
      this.log.warn('The display settings could not be read', error);
      return null;
    }
  }

  /** Null when stored, else the problem. */
  private async write(path: string, choices: DisplayChoices): Promise<string | null> {
    let response: Response;
    try {
      response = await this.doFetch(path, {
        method: 'PUT',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(choices),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return 'the server did not answer';
    }
    if (response.ok) return null;
    try {
      const body = (await response.json()) as { readonly problem?: unknown };
      if (typeof body.problem === 'string') return body.problem;
    } catch {
      // no problem text
    }
    return `the server answered HTTP ${String(response.status)}`;
  }
}
