import { createElement } from 'react';
import { StatusPanel } from './StatusPanel.tsx';
import type { ShellStore } from './store.ts';

/** The shell's own plugin id for its panels, reserved like every `core-` id (CR-0015 item 10). */
export const SHELL_PANELS = 'core-shell';

/** Adds the shell's Status panel ({@link StatusPanel}) at the bottom of the right pane. */
export function addStatusPanel(store: ShellStore): () => void {
  return store.addPanel(SHELL_PANELS, { id: 'status', title: 'Status', order: 10_000, component: () => createElement(StatusPanel, { store }) });
}
