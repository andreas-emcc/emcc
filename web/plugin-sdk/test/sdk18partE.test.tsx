// @vitest-environment jsdom
// SDK 1.8.0 part E (CR-0044): streamUrl, the Video icon and FloatingWindow.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FloatingWindow, PLUGIN_ICONS, STREAM_NAME_PATTERN, WINDOW_DEFAULT_SIZE, WINDOW_MIN_SIZE, WINDOW_OFFSET, WINDOW_STEP, WINDOW_STEP_SHIFT,
  clampWindow, pluginIcon, streamUrl,
} from '../src/index.ts';

afterEach(cleanup);

describe('SDK 1.8.0 part E: streamUrl', () => {
  const ctx = { serverBase: '/api/plugins/fmv/' };

  it('is the stream under the plugin\'s base, at ECore\'s stream path', () => {
    expect(streamUrl(ctx, 'link-1')).toBe('/api/plugins/fmv/stream/link-1');
    expect(streamUrl(ctx, '0')).toBe('/api/plugins/fmv/stream/0');
    expect(streamUrl(ctx, 'a'.repeat(64))).toBe(`/api/plugins/fmv/stream/${'a'.repeat(64)}`);
    expect(STREAM_NAME_PATTERN).toBe('^[a-z0-9][a-z0-9-]{0,63}$');
  });

  it('refuses a name the server part could not have opened', () => {
    for (const bad of ['', '-a', 'Link', 'a_b', 'a/b', '../x', 'a?b', 'a'.repeat(65)]) expect(() => streamUrl(ctx, bad)).toThrow(/stream's name/);
  });
});

describe('SDK 1.8.0 part E: the Video icon', () => {
  it('is in PLUGIN_ICONS, now 39 names', () => {
    expect(Object.keys(PLUGIN_ICONS)).toHaveLength(39);
    expect(pluginIcon('Video')).toBe(PLUGIN_ICONS['Video']);
    expect(pluginIcon('Video')).toBeDefined();
  });
});

describe('SDK 1.8.0 part E: clampWindow', () => {
  const view = { width: 1000, height: 800 };
  it('keeps a window in the browser window and at least its smallest size', () => {
    expect(clampWindow({ left: -50, top: -10, width: 300, height: 200 }, WINDOW_MIN_SIZE, view)).toEqual({ left: 0, top: 0, width: 300, height: 200 });
    expect(clampWindow({ left: 900, top: 700, width: 300, height: 200 }, WINDOW_MIN_SIZE, view)).toEqual({ left: 700, top: 600, width: 300, height: 200 });
    expect(clampWindow({ left: 10, top: 10, width: 100, height: 50 }, WINDOW_MIN_SIZE, view)).toEqual({ left: 10, top: 10, width: 240, height: 160 });
    expect(clampWindow({ left: 10, top: 10, width: 2000, height: 2000 }, WINDOW_MIN_SIZE, view)).toEqual({ left: 0, top: 0, width: 1000, height: 800 });
  });
});

function Watch(props: { readonly title?: string; readonly onClosed?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <FloatingWindow open={open} title={props.title ?? 'Reaper 12'} onClose={() => { setOpen(false); props.onClosed?.(); }}>
      <p>video</p>
    </FloatingWindow>
  );
}

const px = (value: string) => Number(value.replace('px', ''));

describe('SDK 1.8.0 part E: FloatingWindow', () => {
  it('is a non-modal dialog labelled by its title, with its content, opened near the centre', () => {
    const page = render(<Watch />);
    const dialog = page.getByRole('dialog', { name: 'Reaper 12' });
    expect(dialog.className).toBe('emc2-window');
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(dialog.querySelector('.emc2-window-body')?.textContent).toBe('video');
    expect(px(dialog.style.width)).toBe(WINDOW_DEFAULT_SIZE.width);
    expect(px(dialog.style.height)).toBe(WINDOW_DEFAULT_SIZE.height);
    expect(px(dialog.style.left)).toBe((innerWidth - WINDOW_DEFAULT_SIZE.width) / 2);
    expect(px(dialog.style.top)).toBe((innerHeight - WINDOW_DEFAULT_SIZE.height) / 2);
  });

  it('renders nothing when closed', () => {
    const page = render(<FloatingWindow open={false} title="x" onClose={() => {}} />);
    expect(page.queryByRole('dialog')).toBeNull();
  });

  it('closes by its button and by Escape inside it', () => {
    let closed = 0;
    const page = render(<Watch onClosed={() => closed++} />);
    fireEvent.click(page.getByRole('button', { name: 'Close Reaper 12' }));
    expect(page.queryByRole('dialog')).toBeNull();
    cleanup();
    const again = render(<Watch onClosed={() => closed++} />);
    fireEvent.keyDown(again.getByText('video'), { key: 'Escape' });
    expect(again.queryByRole('dialog')).toBeNull();
    expect(closed).toBe(2);
  });

  it('stays open on a press outside it, and opens each next window offset', () => {
    const page = render(<><button type="button">map</button><Watch title="A" /><Watch title="B" /></>);
    fireEvent.pointerDown(page.getByRole('button', { name: 'map' }));
    fireEvent.click(page.getByRole('button', { name: 'map' }));
    const [a, b] = [page.getByRole('dialog', { name: 'A' }), page.getByRole('dialog', { name: 'B' })];
    expect(px(b.style.left) - px(a.style.left)).toBe(WINDOW_OFFSET);
    expect(px(b.style.top) - px(a.style.top)).toBe(WINDOW_OFFSET);
  });

  it('moves with the arrow keys on its title bar, further with Shift', () => {
    const page = render(<Watch />);
    const dialog = page.getByRole('dialog');
    const bar = page.getByRole('group', { name: 'Move Reaper 12' });
    expect(bar.getAttribute('aria-keyshortcuts')).toContain('Shift+ArrowLeft');
    const [left, top] = [px(dialog.style.left), px(dialog.style.top)];
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    fireEvent.keyDown(bar, { key: 'ArrowDown', shiftKey: true });
    expect(px(dialog.style.left)).toBe(left + WINDOW_STEP);
    expect(px(dialog.style.top)).toBe(top + WINDOW_STEP_SHIFT);
    for (let i = 0; i < 200; i++) fireEvent.keyDown(bar, { key: 'ArrowLeft', shiftKey: true });
    expect(px(dialog.style.left)).toBe(0);
  });

  it('resizes from its corner, never below its smallest size', () => {
    const page = render(<Watch />);
    const dialog = page.getByRole('dialog');
    const corner = page.getByRole('button', { name: 'Resize Reaper 12' });
    fireEvent.keyDown(corner, { key: 'ArrowRight', shiftKey: true });
    expect(px(dialog.style.width)).toBe(WINDOW_DEFAULT_SIZE.width + WINDOW_STEP_SHIFT);
    for (let i = 0; i < 100; i++) fireEvent.keyDown(corner, { key: 'ArrowUp', shiftKey: true });
    expect(px(dialog.style.height)).toBe(WINDOW_MIN_SIZE.height);
  });

  it('follows the pointer from its title bar and its corner', () => {
    const page = render(<Watch />);
    const dialog = page.getByRole('dialog');
    const [left, top, width] = [px(dialog.style.left), px(dialog.style.top), px(dialog.style.width)];
    const at = (type: string, target: EventTarget, x: number, y: number) =>
      act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })); });
    at('pointerdown', page.getByText('Reaper 12'), 100, 100);
    at('pointermove', globalThis, 130, 90);
    at('pointerup', globalThis, 130, 90);
    expect(px(dialog.style.left)).toBe(left + 30);
    expect(px(dialog.style.top)).toBe(top - 10);
    at('pointermove', globalThis, 300, 300);
    expect(px(dialog.style.left)).toBe(left + 30); // the drag ended
    at('pointerdown', page.getByRole('button', { name: 'Resize Reaper 12' }), 0, 0);
    at('pointermove', globalThis, 40, 0);
    at('pointerup', globalThis, 40, 0);
    expect(px(dialog.style.width)).toBe(width + 40);
    at('pointerdown', page.getByRole('button', { name: 'Close Reaper 12' }), 0, 0);
    at('pointermove', globalThis, 500, 0);
    expect(px(dialog.style.left)).toBe(left + 30); // a press on the close button does not move it
  });

  it('takes the focus when it opens, and gives it back when it closes from inside', () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Watch</button>
          <FloatingWindow open={open} title="Reaper 12" onClose={() => setOpen(false)}><p>video</p></FloatingWindow>
        </>
      );
    }
    const page = render(<Opener />);
    const watch = page.getByRole('button', { name: 'Watch' });
    watch.focus();
    fireEvent.click(watch);
    expect(document.activeElement).toBe(page.getByRole('group', { name: 'Move Reaper 12' }));
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(page.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(watch);
  });

  it('brings the window pressed to the front, the last opened in front at first', () => {
    const page = render(<><Watch title="A" /><Watch title="B" /></>);
    const [a, b] = [page.getByRole('dialog', { name: 'A' }), page.getByRole('dialog', { name: 'B' })];
    const z = (e: HTMLElement) => Number(e.style.zIndex);
    expect(z(b)).toBeGreaterThan(z(a));
    fireEvent.pointerDown(a.querySelector('.emc2-window-body') as Element);
    expect(z(a)).toBeGreaterThan(z(b));
    const before = z(a);
    fireEvent.pointerDown(a.querySelector('.emc2-window-body') as Element);
    expect(z(a)).toBe(before); // already in front: nothing changes
  });

  it('stays in view when the browser window shrinks', () => {
    const page = render(<Watch />);
    const dialog = page.getByRole('dialog');
    const wide = innerWidth;
    try {
      act(() => {
        Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 300 });
        globalThis.dispatchEvent(new Event('resize'));
      });
      expect(px(dialog.style.width)).toBe(300);
      expect(px(dialog.style.left)).toBe(0);
    } finally {
      Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: wide });
    }
  });
});
