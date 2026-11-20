import type { ShellStore, ShellView } from './store.ts';

/** Messages for the user from plugins (`ctx.notify`) and from the shell (overview 4.10). */
export function Notifications({ view, store }: { readonly view: ShellView; readonly store: ShellStore }) {
  if (view.notifications.length === 0) return null;
  const names = new Map(view.plugins.map((p) => [p.id, p.name]));
  return (
    <ul className="notifications" aria-label="Notifications" aria-live="polite">
      {view.notifications.map((n) => (
        <li key={n.id} className={`notification notification-${n.severity}`}>
          {n.pluginId !== null && <span className="notification-source">{names.get(n.pluginId) ?? n.pluginId}: </span>}
          <span className="notification-message">{n.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              store.dismiss(n.id);
            }}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
