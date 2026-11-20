import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INFO_LIFETIME_MS, ShellStore } from './store.ts';

const shown = (store: ShellStore) => store.getView().notifications.map((n) => [n.id, n.severity, n.message]);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('notifications', () => {
  it('info goes away after a while, warnings stay', () => {
    const store = new ShellStore();
    const info = store.notify(null, { severity: 'info', message: 'saved' });
    const warning = store.notify(null, { severity: 'warning', message: 'careful' });
    vi.advanceTimersByTime(INFO_LIFETIME_MS);
    expect(shown(store)).toEqual([[warning, 'warning', 'careful']]);
    expect(info).not.toBe(warning);
  });

  it('a sticky one stays, changes in place, and goes away as info once it is no longer sticky', () => {
    const store = new ShellStore();
    const id = store.notify(null, { severity: 'info', message: 'Deleting objects: 0 of 10' }, { sticky: true });
    vi.advanceTimersByTime(INFO_LIFETIME_MS * 2);
    store.updateNotification(id, { severity: 'info', message: 'Deleting objects: 5 of 10' }, { sticky: true });
    expect(shown(store)).toEqual([[id, 'info', 'Deleting objects: 5 of 10']]);
    store.updateNotification(id, { severity: 'info', message: 'Deleted 10 objects.' });
    vi.advanceTimersByTime(INFO_LIFETIME_MS);
    expect(shown(store)).toEqual([]);
  });

  it('one the user dismissed comes back when it is updated, so that its end is seen', () => {
    const store = new ShellStore();
    const id = store.notify(null, { severity: 'info', message: 'Deleting…' }, { sticky: true });
    store.dismiss(id);
    store.updateNotification(id, { severity: 'warning', message: 'Deleted 9 of 10 objects.' }, { sticky: true });
    expect(shown(store)).toEqual([[id, 'warning', 'Deleted 9 of 10 objects.']]);
  });
});
