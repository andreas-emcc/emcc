/**
 * The setups (ADR-0031 point 5; `ctx.setup`, CR-0015 item 4): the user's arrangement, kept as the
 * user's own documents under `core` (ADR-0027), so that it follows the user to another browser.
 *
 * - **Remembered:** the current setup is the document `setup.current`. It is read at start; the
 *   shell's share (the pane layout, the clock and the look) is applied at once, and each plugin gets its share
 *   once it has started. From then on it is saved as the user works, at most about once a second,
 *   and once more when the page closes.
 * - **Named:** each is a document `setup.n.<id>` with the user's name for it inside (owner,
 *   2026-10-16: no index document that could disagree with them). At most {@link MAX_NAMED}.
 *   Restoring one applies it at once; it then becomes the remembered setup.
 *
 * **Per workspace** (ADR-0039 point 8; owner, 2026-10-27): each workspace has its own remembered
 * setup and named setups, with its pane layout and the plugins' shares. View keeps the documents
 * above, so the setups saved before workspaces are View's; another workspace's are
 * `setup.w.<id>.current` and `setup.w.<id>.n.<id>`, at most {@link MAX_NAMED} named ones each. The
 * look and the clock are the user's, the same in every workspace: they are in View's documents. At a
 * switch (`workspaces/switch.ts`) the shares of the workspace left are kept and saved, and the new
 * one's are restored; a plugin without a share there (a first visit) keeps its state.
 *
 * A setup keeps the shares of plugins that do not run in this session, so that a plugin enabled
 * again gets its share back. If the remembered setup cannot be read at start, nothing is remembered
 * for the rest of the session, so that a good setup on the server is never overwritten with the
 * default (owner, 2026-10-16); the Status panel says so.
 */
import {
  MAX_SETUP_SHARE_BYTES, UserDocumentError, uuidv7, VIEW_WORKSPACE, type JsonValue, type SetupShare, type Unsubscribe, type UserDocuments,
} from '@emc2/plugin-sdk';
import { layoutFromJson, type Layout } from '../ui/layout.ts';
import type { ClockMode, ShellStore } from '../ui/store.ts';
import { choiceFromJson, type LookChoice } from '../ui/theme.ts';

/** The remembered setup's document. */
export const CURRENT = 'setup.current';
/** Named setups' documents start with this, then an id. */
export const NAMED_PREFIX = 'setup.n.';
/** A declared workspace's setup documents start with this, then its id (`currentName`, `namedPrefix`). */
export const WORKSPACE_PREFIX = 'setup.w.';
/** The format of a setup document; a newer one is left alone. */
export const SETUP_VERSION = 1;
/** Named setups per user and workspace (owner, 2026-10-16 and 2026-10-27); the `core` namespace holds at most 200 documents. */
export const MAX_NAMED = 50;
export const MAX_NAME_LENGTH = 60;
/** The remembered setup is saved at most this often. */
export const SAVE_INTERVAL_MS = 1_000;
/**
 * The largest last save that goes with `keepalive` when the page closes: the browser takes at most
 * 64 KiB in all for such calls. A larger setup goes as a plain call, which a closing page may cut off.
 */
export const KEEPALIVE_BYTES = 60 * 1024;

/** How long a logout waits for the last save of the setup ({@link Setups.finish}). */
export const FINISH_MS = 2_000;

/** What `ctx.setup` needs of the shell (`plugins/context.ts`). */
export interface SetupRegistry {
  register(pluginId: string, share: SetupShare): Unsubscribe;
  changed(): void;
}

/** The shell's own share. */
interface ShellShare {
  readonly layout: Layout;
  /** View's only: the clock and the look are the same in every workspace (owner, 2026-10-27). */
  readonly clock?: ClockMode;
  /** The look, light or dark, and density (ADR-0034; T-052); View's only. */
  readonly look?: LookChoice;
}

/** A setup document, as stored. Named ones add their name and when they were saved. */
interface SetupDocument {
  readonly version: number;
  readonly shell: ShellShare;
  readonly plugins: Readonly<Record<string, JsonValue>>;
  readonly name?: string;
  readonly saved?: string;
}

/** A setup read from the server: the parts that could be read. */
interface ReadSetup {
  readonly layout: Layout | null;
  readonly clock: ClockMode | null;
  readonly look: LookChoice | null;
  readonly plugins: Readonly<Record<string, JsonValue>>;
  readonly name: string | null;
  readonly saved: string | null;
}

export interface NamedSetup {
  /** The document's name. */
  readonly id: string;
  readonly name: string;
  /** When it was saved, ISO 8601. */
  readonly saved: string;
}

/** What the setups control shows. */
export interface SetupsState {
  /** The named setups by name; null until read. */
  readonly named: readonly NamedSetup[] | null;
  /** A read, save, restore or removal is under way. */
  readonly busy: boolean;
  /** What went wrong last, for the control; null when the last step went well. */
  readonly error: string | null;
}

export type SaveNamedResult =
  | { readonly saved: true }
  | { readonly saved: false; readonly nameError?: string; readonly existing?: NamedSetup };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The parts of a stored setup this version can read; null if it is no setup or a newer one. */
export function readSetup(value: unknown): ReadSetup | null {
  if (!isRecord(value) || typeof value.version !== 'number' || value.version > SETUP_VERSION) return null;
  const shell = isRecord(value.shell) ? value.shell : {};
  const clock = shell.clock === 'utc' || shell.clock === 'local' ? shell.clock : null;
  return {
    layout: layoutFromJson(shell.layout),
    clock,
    look: choiceFromJson(shell.look),
    plugins: isRecord(value.plugins) ? (value.plugins as Record<string, JsonValue>) : {},
    name: typeof value.name === 'string' ? value.name : null,
    saved: typeof value.saved === 'string' ? value.saved : null,
  };
}

/** The value as JSON text, or null if it has none (e.g. undefined, a function, a cycle). */
function jsonText(value: unknown): string | null {
  try {
    const text: unknown = JSON.stringify(value);
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

const describe = (error: unknown): string =>
  error instanceof UserDocumentError ? error.message : error instanceof Error ? error.message : String(error);

/** A user's name for a setup, trimmed; or why it is not one. */
export function checkName(name: string): { readonly name: string } | { readonly error: string } {
  const trimmed = name.trim();
  if (trimmed === '') return { error: 'Enter a name.' };
  if (trimmed.length > MAX_NAME_LENGTH) return { error: `At most ${String(MAX_NAME_LENGTH)} characters.` };
  return { name: trimmed };
}

const sameName = (a: string, b: string): boolean => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
const sortByName = (setups: readonly NamedSetup[]): NamedSetup[] =>
  [...setups].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));

export interface SetupsOptions {
  readonly store: ShellStore;
  /** The user's documents under `core`. */
  readonly documents: UserDocuments;
  /** The same, with calls that outlive the page, for the last save. */
  readonly closingDocuments?: UserDocuments;
  readonly console?: Pick<Console, 'warn' | 'error'>;
  readonly now?: () => Date;
}

interface Registered {
  readonly share: SetupShare;
}

/** A workspace's remembered setup's document: View's `setup.current`, another's `setup.w.<id>.current`. */
export function currentName(workspace: string): string {
  return workspace === VIEW_WORKSPACE ? CURRENT : `${WORKSPACE_PREFIX}${workspace}.current`;
}

/** The start of a workspace's named setups' documents: View's `setup.n.`, another's `setup.w.<id>.n.`. */
export function namedPrefix(workspace: string): string {
  return workspace === VIEW_WORKSPACE ? NAMED_PREFIX : `${WORKSPACE_PREFIX}${workspace}.n.`;
}

/** The workspace whose remembered setup a document is, or null. */
function workspaceOfCurrent(name: string): string | null {
  if (name === CURRENT) return VIEW_WORKSPACE;
  const match = /^setup\.w\.(.+)\.current$/.exec(name);
  return match?.[1] ?? null;
}

export class Setups implements SetupRegistry {
  private readonly store: ShellStore;
  private readonly documents: UserDocuments;
  private readonly closingDocuments: UserDocuments;
  private readonly out: Pick<Console, 'warn' | 'error'>;
  private readonly now: () => Date;

  private readonly shares = new Map<string, Registered>();
  /** Plugins whose web part has started (`activate` finished). */
  private readonly active = new Set<string>();
  /**
   * Plugins that have had their share given at start (or had none to get), or got one from a named
   * setup: from then on their own `save` speaks for them. At most once each.
   */
  private readonly restored = new Set<string>();
  /**
   * Per workspace, the shares last read or saved, also of plugins that do not run in this session:
   * the remembered setup's at start, merged with a named setup's when one is picked, and those kept
   * when the workspace was left.
   */
  private readonly kept = new Map<string, Record<string, JsonValue>>();
  /** The read of the remembered setups, once. */
  private starting: Promise<void> | null = null;
  /** The remembered setups have been read, or could not be: plugins get their shares from now on. */
  private ready = false;
  /** Nothing is remembered in this session (the remembered setups could not be read). */
  private off = false;
  /** The workspaces whose remembered setup has changed and is not saved yet. */
  private readonly pending = new Set<string>();
  /**
   * A switch is under way: from {@link leave} to {@link enter} the plugins still hold the state of
   * the workspace left, so nothing is saved from them for the one shown (conformance review, 1).
   */
  private switching = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;
  /** The save under way (by the timer or at page hide), so that {@link finish} can wait for it. */
  private current: Promise<void> | null = null;
  /** Per workspace, the text last written as its remembered setup, so that an unchanged setup is not written again. */
  private readonly lastSaved = new Map<string, string>();
  /** Problems already reported, so that a save every second does not repeat them. */
  private readonly reported = new Set<string>();

  private state: SetupsState = { named: null, busy: false, error: null };
  private readonly listeners = new Set<() => void>();
  /** Per workspace, the read of its named setups, and the list read. */
  private readonly namedRead = new Map<string, Promise<void>>();
  private readonly namedLists = new Map<string, readonly NamedSetup[]>();

  constructor(options: SetupsOptions) {
    this.store = options.store;
    this.documents = options.documents;
    this.closingDocuments = options.closingDocuments ?? options.documents;
    this.out = options.console ?? console;
    this.now = options.now ?? (() => new Date());
    // The shell's own share follows the store: the workspace's layout, and View's clock and look.
    let seen = this.store.getView();
    this.store.subscribe(() => {
      const view = this.store.getView();
      if (view.workspace === seen.workspace && view.layout !== seen.layout) this.changed();
      if (view.clock !== seen.clock || view.look !== seen.look) this.changedIn(VIEW_WORKSPACE);
      seen = view;
    });
  }

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getState = (): SetupsState => this.state;

  private get shown(): string {
    return this.store.getView().workspace;
  }

  /**
   * Reads the remembered setups, View's and every other workspace's, and applies them: the shell's
   * share at once (each workspace's layout, View's clock and look), each plugin's once it has
   * started, from the workspace shown. Once: a later call gets the same read.
   */
  start(): Promise<void> {
    this.starting ??= this.readRemembered();
    return this.starting;
  }

  private async readRemembered(): Promise<void> {
    const values = new Map<string, JsonValue>();
    let read = false;
    try {
      // Only a setup that is there is read: a 404 would be an error in every browser console (ITA, 2026-10-16).
      const names = (await this.documents.list()).filter((name) => workspaceOfCurrent(name) !== null);
      for (const name of names) {
        const value = await this.documents.get(name);
        if (value !== null) values.set(workspaceOfCurrent(name) ?? VIEW_WORKSPACE, value);
      }
      read = true;
    } catch (error) {
      this.off = true;
      const problem = `not remembered in this session: it could not be read from the server (${describe(error)})`;
      this.store.setSetupProblem(problem);
      this.store.notify(null, { severity: 'warning', message: `Your setup could not be read from the server. Changes to it are not remembered until the page is loaded again.` });
      this.out.warn(`[core-shell] setup ${problem}`);
    }
    const applied: string[] = [];
    if (read) {
      for (const [workspace, value] of values) {
        const setup = readSetup(value);
        if (setup === null && isRecord(value) && typeof value.version === 'number' && value.version > SETUP_VERSION) {
          this.off = true; // a newer version's setup: leave it as it is
          this.store.setSetupProblem('not remembered in this session: it was saved by a newer version of emcc');
        } else if (setup === null) {
          this.out.warn(`[core-shell] the remembered setup${workspace === VIEW_WORKSPACE ? '' : ` of ${workspace}`} cannot be read; starting from the default one`);
        } else {
          this.kept.set(workspace, { ...setup.plugins });
          this.applyShell(setup, 'the remembered setup', workspace);
          applied.push(workspace);
        }
      }
    }
    this.ready = true;
    for (const pluginId of this.active) this.restoreAtStart(pluginId);
    // What was just read is not written back unchanged (conformance review F8).
    for (const workspace of applied) {
      const text = jsonText(this.documentOf(workspace));
      if (text !== null) this.lastSaved.set(workspace, text);
    }
    if (this.pending.size > 0) this.schedule();
  }

  register(pluginId: string, share: SetupShare): Unsubscribe {
    const entry: Registered = { share };
    this.shares.set(pluginId, entry); // one per plugin: a second replaces the first
    if (this.active.has(pluginId)) this.restoreAtStart(pluginId);
    return () => {
      if (this.shares.get(pluginId) === entry) this.shares.delete(pluginId);
    };
  }

  /** A plugin's web part has started: it gets its share of the remembered setup of the workspace shown. */
  pluginActive(pluginId: string): void {
    this.active.add(pluginId);
    this.restoreAtStart(pluginId);
  }

  /** Something in the setup of the workspace shown changed: it is remembered within about a second. */
  changed(): void {
    this.changedIn(this.shown);
  }

  private changedIn(workspace: string): void {
    if (this.off) return;
    this.pending.add(workspace);
    if (this.ready) this.schedule();
  }

  /**
   * A switch leaves `workspace` (`workspaces/switch.ts`, before its first step): the running
   * plugins' shares are kept for it as they are now, and its remembered setup is saved.
   */
  leave(workspace: string): void {
    if (!this.ready) return;
    // A second switch before the first one's shares were restored keeps what is kept for it.
    if (!this.switching) this.kept.set(workspace, this.pluginShares(workspace));
    this.switching = true;
    this.changedIn(workspace);
  }

  /**
   * A switch enters `workspace` (its fourth step): each running plugin with a share kept for it gets
   * that share; one without (a first visit) keeps its state. Its named setups are those listed now.
   */
  enter(workspace: string): void {
    this.switching = false;
    this.setState({ named: this.namedLists.get(workspace) ?? null, error: null });
    if (!this.ready) return;
    const shares = this.kept.get(workspace) ?? {};
    for (const [pluginId, entry] of this.shares) {
      const share = shares[pluginId];
      if (!this.active.has(pluginId) || !this.restored.has(pluginId) || share === undefined) continue;
      this.restoreShare(pluginId, entry, share);
    }
  }

  /**
   * The page closes or is hidden: changes not yet saved are sent with calls that outlive the page
   * (up to {@link KEEPALIVE_BYTES}; a larger setup as a plain call). One counts as saved only once
   * the server has it: if it fails and the page lives on (it was only hidden), it is saved again shortly.
   */
  flush(): void {
    if (this.off || !this.ready || this.pending.size === 0) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    // The browser's budget for calls that outlive the page is for all of them together (review, 6).
    let budget = KEEPALIVE_BYTES;
    for (const workspace of this.takePending()) {
      const text = jsonText(this.documentOf(workspace));
      if (text === null || text === this.lastSaved.get(workspace)) continue;
      const bytes = byteLength(text);
      const fits = bytes <= budget;
      if (fits) budget -= bytes;
      const documents = fits ? this.closingDocuments : this.documents;
      this.track(documents.put(currentName(workspace), JSON.parse(text) as JsonValue).then(() => { this.lastSaved.set(workspace, text); }, () => {
        this.pending.add(workspace);
        this.schedule();
      }));
    }
  }

  /**
   * The user logs out: changes not saved yet are saved now, after a save under way, and nothing is
   * saved after that, not even when the page is hidden. Else the page's last save would go out after
   * the logout and get 401 (ITA, keycloak/login.spec.ts, 2026-10-22). Waits at most {@link FINISH_MS};
   * a failed save is only logged: the logout goes on.
   */
  async finish(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    // Changes not saved yet, also those made during a save under way; none if nothing is remembered.
    const wanted = !this.off && this.ready ? this.takePending() : [];
    this.off = true; // no timer, no page hide, no change saves anything from now on
    this.pending.clear();
    const underWay = this.current;
    if (wanted.length === 0 && underWay === null) return;
    const last = (async () => {
      await underWay; // its answer before the logout, and the newer change after it
      for (const workspace of wanted) {
        const text = jsonText(this.documentOf(workspace));
        if (text === null || text === this.lastSaved.get(workspace)) continue;
        await this.documents.put(currentName(workspace), JSON.parse(text) as JsonValue);
        this.lastSaved.set(workspace, text);
      }
    })().catch((error: unknown) => { this.out.warn('[core-shell] the setup could not be saved before the logout', error); });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([last, new Promise<void>((resolve) => { timeout = setTimeout(resolve, FINISH_MS); })]);
    clearTimeout(timeout);
  }

  /** Reads the named setups of the workspace shown, the first time the control is opened there. */
  loadNamed(): Promise<void> {
    const workspace = this.shown;
    let read = this.namedRead.get(workspace);
    if (read === undefined) {
      read = this.readNamed(workspace);
      this.namedRead.set(workspace, read);
    }
    return read;
  }

  /** Saves the current setup under `name` in the workspace shown; `replace` overwrites a setup of that name, else it is returned as `existing`. */
  async saveNamed(name: string, replace = false): Promise<SaveNamedResult> {
    const checked = checkName(name);
    if ('error' in checked) return { saved: false, nameError: checked.error };
    await this.start(); // so that every running plugin's share is its own
    const workspace = this.shown;
    await this.loadNamed();
    const named = this.namedLists.get(workspace) ?? null;
    if (named === null) return { saved: false }; // the list could not be read: its error says so
    const existing = named.find((s) => sameName(s.name, checked.name));
    if (existing !== undefined && !replace) return { saved: false, existing };
    if (existing === undefined && named.length >= MAX_NAMED) {
      return { saved: false, nameError: `At most ${String(MAX_NAMED)} named setups: delete one first.` };
    }
    const id = existing?.id ?? `${namedPrefix(workspace)}${uuidv7()}`;
    const saved = this.now().toISOString();
    const document: SetupDocument = { ...this.documentOf(workspace), name: checked.name, saved };
    this.setState({ busy: true });
    try {
      await this.documents.put(id, document as unknown as JsonValue);
    } catch (error) {
      this.setState({ busy: false, error: `The setup could not be saved: ${describe(error)}` });
      return { saved: false };
    }
    const entry: NamedSetup = { id, name: checked.name, saved };
    this.setNamed(workspace, sortByName([...named.filter((s) => s.id !== id), entry]));
    this.setState({ busy: false, error: null });
    return { saved: true };
  }

  /** Restores a named setup of the workspace shown at once; it then becomes its remembered setup. */
  async restoreNamed(id: string): Promise<boolean> {
    await this.start(); // the remembered setup must not come after it
    const workspace = this.shown;
    this.setState({ busy: true });
    let value: JsonValue | null;
    try {
      value = await this.documents.get(id);
    } catch (error) {
      this.setState({ busy: false, error: `The setup could not be read: ${describe(error)}` });
      return false;
    }
    if (this.shown !== workspace || this.switching) {
      // Another workspace is shown now: its plugins must not get this one's shares (review, 7).
      this.setState({ busy: false, error: 'The workspace changed while the setup was read; nothing was restored.' });
      return false;
    }
    const setup = value === null ? null : readSetup(value);
    if (setup === null) {
      const gone = value === null;
      if (gone) this.setNamed(workspace, (this.namedLists.get(workspace) ?? []).filter((s) => s.id !== id));
      this.setState({
        busy: false,
        error: gone ? 'That setup is gone: it was deleted in another window.' : 'That setup cannot be read here (a newer version of emcc saved it, or it is damaged).',
      });
      return false;
    }
    const label = setup.name === null ? 'the setup' : `the setup ${setup.name}`;
    this.applyShell(setup, label, workspace);
    // A plugin still starting gets its share from here once it has started (conformance review F2).
    this.kept.set(workspace, { ...this.kept.get(workspace), ...setup.plugins });
    for (const [pluginId, entry] of this.shares) {
      const share = setup.plugins[pluginId];
      if (!this.active.has(pluginId) || share === undefined) continue;
      this.restored.add(pluginId);
      this.restoreShare(pluginId, entry, share);
    }
    this.changedIn(workspace);
    this.setState({ busy: false, error: null });
    this.store.notify(null, { severity: 'info', message: `Restored ${label}.` });
    return true;
  }

  /** The control opens again: an old error is not shown again. */
  clearError(): void {
    if (this.state.error !== null) this.setState({ error: null });
  }

  async deleteNamed(id: string): Promise<boolean> {
    const workspace = this.shown;
    this.setState({ busy: true });
    try {
      await this.documents.delete(id);
    } catch (error) {
      this.setState({ busy: false, error: `The setup could not be deleted: ${describe(error)}` });
      return false;
    }
    this.setNamed(workspace, (this.namedLists.get(workspace) ?? []).filter((s) => s.id !== id));
    this.setState({ busy: false, error: null });
    return true;
  }

  private async readNamed(workspace: string): Promise<void> {
    this.setState({ busy: true });
    try {
      const prefix = namedPrefix(workspace);
      const ids = (await this.documents.list()).filter((name) => name.startsWith(prefix));
      const read = await Promise.all(ids.map(async (id) => {
        const setup = readSetup(await this.documents.get(id));
        return setup === null || setup.name === null ? null : { id, name: setup.name, saved: setup.saved ?? '' };
      }));
      this.setNamed(workspace, sortByName(read.filter((s): s is NamedSetup => s !== null)));
      this.setState({ busy: false, error: null });
    } catch (error) {
      this.namedRead.delete(workspace); // the next opening tries again
      this.setState({ busy: false, error: `Your named setups could not be read: ${describe(error)}` });
    }
  }

  /** A workspace's named setups; the control shows the shown workspace's. */
  private setNamed(workspace: string, named: readonly NamedSetup[]): void {
    this.namedLists.set(workspace, named);
    if (workspace === this.shown) this.setState({ named });
  }

  /** A started plugin's share, once: the remembered one of the workspace shown, or a named setup's picked while it started. */
  private restoreAtStart(pluginId: string): void {
    const entry = this.shares.get(pluginId);
    if (!this.ready || entry === undefined || !this.active.has(pluginId) || this.restored.has(pluginId)) return;
    this.restored.add(pluginId);
    const share = this.kept.get(this.shown)?.[pluginId];
    if (share !== undefined) this.restoreShare(pluginId, entry, share);
  }

  /** A plugin's `restore`, with its own copy; what it throws is its failure, never the shell's. */
  private restoreShare(pluginId: string, entry: Registered, share: JsonValue): void {
    try {
      entry.share.restore(JSON.parse(JSON.stringify(share)) as JsonValue);
    } catch (error) {
      this.out.error(`[${pluginId}] its setup share could not be restored`, error);
      this.store.observe(pluginId, { state: 'DEGRADED', detail: `restoring its share of the setup failed: ${describe(error)}` });
    }
  }

  /** A setup's shell share: the workspace's layout, and the clock and look where it has them (View's). */
  private applyShell(setup: ReadSetup, label: string, workspace: string): void {
    if (setup.layout === null) this.out.warn(`[core-shell] ${label} has no pane layout this version can read; the layout stays`);
    else this.store.restoreLayout(setup.layout, workspace);
    if (setup.clock !== null) this.store.setClock(setup.clock);
    if (setup.look !== null) this.store.setLook(setup.look);
  }

  /**
   * A workspace's plugin shares: for the workspace shown every running plugin's own and the kept
   * ones of the others; for another, those kept for it.
   */
  private pluginShares(workspace: string): Record<string, JsonValue> {
    const plugins: Record<string, JsonValue> = { ...this.kept.get(workspace) };
    if (workspace !== this.shown || this.switching) return plugins;
    for (const [pluginId, entry] of this.shares) {
      if (!this.settled(pluginId)) continue; // its remembered share stays until it has been restored
      const share = this.saveShare(pluginId, entry);
      if (share !== undefined) plugins[pluginId] = share;
    }
    this.kept.set(workspace, plugins);
    return plugins;
  }

  /** A workspace's remembered setup: its layout and plugin shares; View's with the clock and the look (owner, 2026-10-27). */
  private documentOf(workspace: string): SetupDocument {
    const view = this.store.getView();
    const layout = this.store.layoutOf(workspace);
    const shell = workspace === VIEW_WORKSPACE ? { layout, clock: view.clock, look: view.look } : { layout };
    return { version: SETUP_VERSION, shell, plugins: this.pluginShares(workspace) };
  }

  /**
   * A plugin's share may be saved: it has started and got its share (or had none to get). Before
   * that, `save` would give its defaults in place of the kept share.
   */
  private settled(pluginId: string): boolean {
    return this.restored.has(pluginId);
  }

  /** A plugin's `save`, as plain JSON; undefined (and reported once) if it fails, is no JSON or is too large. */
  private saveShare(pluginId: string, entry: Registered): JsonValue | undefined {
    let value: unknown;
    try {
      value = entry.share.save();
    } catch (error) {
      this.reportOnce(`save ${pluginId}`, () => {
        this.out.error(`[${pluginId}] its setup share could not be saved`, error);
        this.store.observe(pluginId, { state: 'DEGRADED', detail: `saving its share of the setup failed: ${describe(error)}` });
      });
      return undefined;
    }
    const text = jsonText(value);
    if (text === null) {
      this.reportOnce(`json ${pluginId}`, () => {
        this.out.error(`[${pluginId}] its setup share is not JSON; it is not saved`);
        this.store.observe(pluginId, { state: 'DEGRADED', detail: 'its share of the setup is not JSON and is not saved' });
      });
      return undefined;
    }
    const bytes = byteLength(text);
    if (bytes > MAX_SETUP_SHARE_BYTES) {
      this.reportOnce(`size ${pluginId}`, () => {
        const detail = `its share of the setup (${String(Math.ceil(bytes / 1024))} KiB) is over ${String(MAX_SETUP_SHARE_BYTES / 1024)} KiB and is not saved`;
        this.out.warn(`[${pluginId}] ${detail}`);
        this.store.note(pluginId, detail);
      });
      return undefined;
    }
    return JSON.parse(text) as JsonValue; // a copy, as plain JSON
  }

  private takePending(): string[] {
    const workspaces = [...this.pending];
    this.pending.clear();
    return workspaces;
  }

  private schedule(): void {
    if (this.timer !== null || this.saving || this.off) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.track(this.save());
    }, SAVE_INTERVAL_MS);
  }

  /** Remembers a save as the one under way until it ends. */
  private track(save: Promise<void>): void {
    this.current = save;
    const ended = () => {
      if (this.current === save) this.current = null;
    };
    save.then(ended, ended);
  }

  private async save(): Promise<void> {
    if (this.pending.size === 0 || this.off) return;
    const workspaces = this.takePending();
    this.saving = true;
    try {
      for (const workspace of workspaces) {
        const text = jsonText(this.documentOf(workspace));
        if (text === null || text === this.lastSaved.get(workspace)) continue;
        try {
          await this.documents.put(currentName(workspace), JSON.parse(text) as JsonValue);
          this.lastSaved.set(workspace, text);
          this.reported.delete('remember');
        } catch (error) {
          this.reportOnce('remember', () => {
            this.out.warn('[core-shell] the setup could not be remembered', error);
            this.store.notify(null, { severity: 'warning', message: `Your setup could not be saved on the server: ${describe(error)}` });
          });
        }
      }
    } finally {
      this.saved();
    }
  }

  /** A save has ended: changes made meanwhile are saved next. */
  private saved(): void {
    this.saving = false;
    if (this.pending.size > 0) this.schedule();
  }

  private reportOnce(key: string, report: () => void): void {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    report();
  }

  private setState(change: Partial<SetupsState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of [...this.listeners]) listener();
  }
}
