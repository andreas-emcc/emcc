/** The DOM ids and React keys of the panels: ids for `PanelHandle.show()` (SDK 1.1.0), which scrolls a panel into view. */

/** The DOM id of a plugin's panel: only letters, digits and `-`, so any plugin and panel id fit. */
export function panelElementId(pluginId: string, panelId: string): string {
  const safe = (value: string) => Array.from(value, (c) => (/[A-Za-z0-9]/.test(c) ? c : `_${c.charCodeAt(0).toString(16)}`)).join('');
  return `panel-${safe(pluginId)}-${safe(panelId)}`;
}

/** Scrolls a plugin's panel into view, if it is on the page. */
export function revealPanel(pluginId: string, panelId: string): void {
  if (typeof document === 'undefined') return;
  document.getElementById(panelElementId(pluginId, panelId))?.scrollIntoView({ block: 'nearest' });
}

/**
 * A panel's or overlay's React key: its registration in the workspace shown, so that a switch
 * unmounts the old workspace's panels and overlays and mounts the new one's, also those in both
 * (SDK `CurrentWorkspace` step 1; the briefs' rule 3; owner, 2026-10-28).
 */
export function mountKey(workspace: string, item: { readonly key: string }): string {
  return `${workspace}/${item.key}`;
}
