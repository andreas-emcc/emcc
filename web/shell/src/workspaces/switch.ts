/**
 * The workspace shown and its switch (ADR-0039 point 3; SDK 1.2.0 `CurrentWorkspace`; T-080,
 * owner 2026-10-27). A page shows one workspace at a time; choosing another one's tab switches, in
 * the SDK's order:
 *
 * 1. the setup of the workspace left is kept (`setups/setups.ts`), then the shell shows the new
 *    workspace's panels, overlays and pane layout (`ShellStore.setWorkspace`);
 * 2. **the map view's moment:** the shell dispatches {@link SWITCH_EVENT} on the Map Pane's element,
 *    the one it gave `MapViewMount.mount`, at once (synchronously). map-view-2d ends its running
 *    interactions, clears every fade list and the selection then (its brief, function 22; owner,
 *    2026-10-27: an event, no SDK member);
 * 3. each subscription that follows the workspace shown subscribes again and gets a fresh
 *    snapshot; the switch waits for them, at most {@link SNAPSHOT_WAIT_MS} (owner, 2026-10-27);
 * 4. each plugin's setup share for the new workspace is restored;
 * 5. the plugins' `ctx.workspace.onChange` listeners are called.
 *
 * A newer switch ends an older one's waiting: its steps 4 and 5 do not run.
 */
import type { Unsubscribe, WorkspaceInfo } from '@emc2/plugin-sdk';
import { flushSync } from 'react-dom';
import { VIEW_INFO, type ShellStore } from '../ui/store.ts';

/**
 * The event of the map view's moment, on the Map Pane's element. Its `detail.workspace` is the
 * workspace switched to. A shell-to-map-view agreement (web/README.md), not an SDK member.
 */
export const SWITCH_EVENT = 'emc2:workspace-switch';

/** How long a switch waits for the fresh snapshots before it goes on (owner, 2026-10-27). */
export const SNAPSHOT_WAIT_MS = 5_000;

/** What a switch needs besides the store. */
export interface SwitchParts {
  /** Step 3: the channels that follow the workspace shown subscribe for it; resolves when each has its fresh snapshot. */
  follow(workspace: string): Promise<void>;
  /** Before step 1: the setup of the workspace left is kept. */
  leave(workspace: string): void;
  /** Step 4: the plugins' shares of the new workspace's setup. */
  enter(workspace: string): void;
}

const NO_PARTS: SwitchParts = { follow: () => Promise.resolve(), leave: () => undefined, enter: () => undefined };

export class WorkspaceSwitch {
  private readonly listeners = new Set<(workspace: WorkspaceInfo) => void>();
  private generation = 0;
  private parts: SwitchParts = NO_PARTS;
  private readonly out: Pick<Console, 'warn' | 'error'>;

  constructor(private readonly store: ShellStore, options: { readonly console?: Pick<Console, 'warn' | 'error'> } = {}) {
    this.out = options.console ?? console;
  }

  /** The live picture and the setups, once they exist (the plugins' channels come with the plugins). */
  connect(parts: Partial<SwitchParts>): void {
    this.parts = { ...this.parts, ...parts };
  }

  /** The workspace shown (`ctx.workspace.current`). */
  get current(): WorkspaceInfo {
    const view = this.store.getView();
    return view.workspaces.find((w) => w.id === view.workspace) ?? VIEW_INFO;
  }

  /** `ctx.workspace.onChange`: called at a switch's last step. */
  onChange(listener: (workspace: WorkspaceInfo) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * Shows workspace `id`, if the user may see it and it is not shown already. Resolves when the
   * switch has ended: its last step done, or a newer switch begun.
   */
  async show(id: string): Promise<void> {
    const from = this.store.getView().workspace;
    if (id === from || !this.store.getView().workspaces.some((w) => w.id === id)) return;
    const generation = ++this.generation;
    this.parts.leave(from);
    // Step 1, rendered at once: the old panels are unmounted and the new ones mounted before the moment (review, 4).
    flushSync(() => { this.store.setWorkspace(id); });
    this.moment(id); // step 2
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => { resolve('late'); }, SNAPSHOT_WAIT_MS); });
    const fresh = await Promise.race([this.parts.follow(id).then(() => 'fresh' as const, () => 'fresh' as const), late]); // step 3
    clearTimeout(timer);
    if (generation !== this.generation) return; // a newer switch goes on from here
    if (fresh === 'late') this.out.warn(`[core-shell] the fresh snapshots of ${id} took over ${String(SNAPSHOT_WAIT_MS)} ms; the switch goes on`);
    this.parts.enter(id); // step 4
    const shown = this.current;
    for (const listener of [...this.listeners]) {
      try {
        listener(shown); // step 5; each plugin's listener is guarded by its context
      } catch (error) {
        this.out.error('[core-shell] a workspace listener failed', error);
      }
    }
  }

  /** Step 2: the map view's moment, on the Map Pane's element, at once. */
  private moment(workspace: string): void {
    const element = this.store.mapPane;
    if (element === null) return;
    try {
      element.dispatchEvent(new CustomEvent(SWITCH_EVENT, { detail: { workspace } }));
    } catch (error) {
      this.out.error('[core-shell] the map view failed at the switch\'s moment', error);
    }
  }
}
