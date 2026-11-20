// The background maps this plugin provides: one `BackgroundMapProvider` per background the server part offers (brief,
// function 5). The settings give each background's name, layers, format and attribution; the server part's `backgrounds`
// answer gives only which are offered and in which projections. The two are joined here, and the providers follow both:
// a changed or removed one is taken back with the `Unsubscribe` of `services.provide` and the new one provided.
import { BACKGROUND_MAP } from '@emc2/plugin-sdk';
import type { BackgroundMapProvider, PluginContext, Settings, Unsubscribe } from '@emc2/plugin-sdk';
import { fromSettings, type Background, type Server } from './settings.ts';

/** How often the browser asks while the server part is reading capabilities. */
export const READING_POLL_MS = 5_000;
/** How often it asks otherwise, while the page is visible. */
export const IDLE_POLL_MS = 60_000;
/** After an accepted settings change the server part's read may not have started yet: ask again soon, a few times. */
export const AFTER_CHANGE_MS: readonly number[] = [1_000, 3_000];

interface Offered {
  readonly id: string;
  readonly projections: readonly string[];
}

interface Answer {
  readonly backgrounds: readonly Offered[];
  readonly reading: boolean;
  readonly version: number;
}

/** `null` if the answer is not what the server part sends. */
function readAnswer(json: unknown): Answer | null {
  if (typeof json !== 'object' || json === null) return null;
  const o = json as Readonly<Record<string, unknown>>;
  const list: unknown = o['backgrounds'];
  if (!Array.isArray(list) || typeof o['reading'] !== 'boolean' || typeof o['version'] !== 'number') return null;
  const backgrounds: Offered[] = [];
  for (const item of list as unknown[]) {
    if (typeof item !== 'object' || item === null) return null;
    const entry = item as Readonly<Record<string, unknown>>;
    const projections: unknown = entry['projections'];
    if (typeof entry['id'] !== 'string' || !Array.isArray(projections) || !(projections as unknown[]).every((p) => typeof p === 'string')) return null;
    backgrounds.push({ id: entry['id'], projections: projections as string[] });
  }
  return { backgrounds, reading: o['reading'], version: o['version'] };
}

/** The provider of one background, from the settings and the projections the server part offers it in. */
export function providerOf(serverBase: string, background: Background, server: Server, projections: readonly string[]): BackgroundMapProvider {
  const id = background.id ?? '';
  const link = background.attributionUrl.trim();
  return {
    id: `basemap-wms.${id}`,
    name: background.name,
    projections,
    source: {
      type: 'wms',
      url: `${serverBase}map/${encodeURIComponent(id)}`,
      layers: background.layers,
      version: server.version,
      format: background.format,
      transparent: background.transparent,
      mode: background.mode,
    },
    attribution: link === '' ? { text: background.attributionText } : { text: background.attributionText, url: link },
  };
}

/**
 * Keeps the provided backgrounds equal to the settings joined with the server part's offer. `start` does not wait for the
 * first answer (the shell's activation timeout is 10 s); `stop` ends the polling.
 */
export class BackgroundSync {
  private readonly provided = new Map<string, { readonly key: string; readonly unsubscribe: Unsubscribe }>();
  private settings: Settings;
  private offered: readonly Offered[] = [];
  private reading = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private burst: ReturnType<typeof setTimeout>[] = [];
  private asked = 0;
  private stopped = false;
  private lastProblem = '';

  constructor(private readonly ctx: PluginContext) {
    this.settings = ctx.settings;
  }

  /** Asks again as soon as the page becomes visible: it may have been hidden for a long time. */
  private readonly onVisible = (): void => {
    if (globalThis.document.visibilityState === 'visible') this.refresh();
  };

  start(): void {
    globalThis.document.addEventListener('visibilitychange', this.onVisible);
    this.refresh();
  }

  /** The settings changed (accepted by ECore): join again with what was offered, then ask the server part. */
  settingsChanged(settings: Settings): void {
    this.settings = settings;
    this.reconcile();
    for (const timer of this.burst) clearTimeout(timer);
    this.burst = AFTER_CHANGE_MS.map((ms) => setTimeout(() => { this.refresh(); }, ms));
    this.refresh();
  }

  stop(): void {
    this.stopped = true;
    globalThis.document.removeEventListener('visibilitychange', this.onVisible);
    clearTimeout(this.timer);
    for (const timer of this.burst) clearTimeout(timer);
  }

  /** Asks the server part which backgrounds it offers, then provides accordingly. Never rejects. */
  refresh(): void {
    const number = ++this.asked;
    fetch(`${this.ctx.serverBase}backgrounds`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${String(response.status)}`))))
      .then((json: unknown) => {
        if (this.stopped || number !== this.asked) return; // a newer question has been sent
        const answer = readAnswer(json);
        if (answer === null) throw new Error('unexpected answer');
        this.offered = answer.backgrounds;
        this.reading = answer.reading;
        this.lastProblem = '';
        this.reconcile();
        this.schedule();
      })
      .catch((error: unknown) => {
        if (this.stopped || number !== this.asked) return;
        // Keep what is provided: a failed question says nothing about the server part's offer.
        const problem = error instanceof Error ? error.message : String(error);
        if (problem !== this.lastProblem) this.ctx.log.warn(`cannot read the offered backgrounds: ${problem}`);
        this.lastProblem = problem;
        this.schedule();
      });
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // Hidden pages do not poll, unless the server part is reading, which ends soon.
      if (this.reading || globalThis.document.visibilityState !== 'hidden') this.refresh();
      else this.schedule();
    }, this.reading ? READING_POLL_MS : IDLE_POLL_MS);
  }

  /** Removes the providers that went or changed, and adds the new ones. */
  private reconcile(): void {
    const draft = fromSettings(this.settings);
    const wanted = new Map<string, { readonly key: string; readonly provider: BackgroundMapProvider }>();
    for (const offer of this.offered) {
      const background = draft.backgrounds.find((b) => b.id === offer.id);
      const server = background === undefined ? undefined : draft.servers.find((s) => s.id === background.server);
      if (background === undefined || server === undefined) continue; // not (or no longer) in the settings
      const provider = providerOf(this.ctx.serverBase, background, server, offer.projections);
      wanted.set(offer.id, { key: JSON.stringify(provider), provider });
    }
    for (const [id, entry] of [...this.provided]) {
      if (wanted.get(id)?.key !== entry.key) {
        entry.unsubscribe();
        this.provided.delete(id);
      }
    }
    for (const [id, { key, provider }] of wanted) {
      if (!this.provided.has(id)) this.provided.set(id, { key, unsubscribe: this.ctx.services.provide(BACKGROUND_MAP, provider) });
    }
    this.ctx.status.set('OK', `${String(this.provided.size)} background maps provided`);
  }

  /** The ids of the backgrounds provided now (for tests). */
  get providedIds(): readonly string[] {
    return [...this.provided.keys()];
  }
}
