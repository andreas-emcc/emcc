// @vitest-environment jsdom
// The shared popover and dialog in a page (CR-0021): in the browser's top layer, placed from the
// anchor inside the window, controlled through onClose and onCancel. jsdom has neither showPopover
// nor showModal, so the fallback is tested as it is, and the top layer with those functions stubbed;
// and it has no layout, so the tests give the anchor and the panel their sizes.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, Popover } from '../src/index.ts';
import { ANCHOR_GAP, placePopover, WINDOW_MARGIN } from '../src/components/overlay.ts';

const viewport = { width: 1024, height: 768 };

describe('placing a popover (placePopover)', () => {
  it('opens below the anchor, lined up with its start', () => {
    expect(placePopover({ left: 100, top: 10, bottom: 40 }, { width: 300, height: 200 }, viewport)).toEqual({ left: 100, top: 40 + ANCHOR_GAP, maxWidth: 1024 - 2 * WINDOW_MARGIN, maxHeight: 768 - WINDOW_MARGIN - 40 - ANCHOR_GAP, side: 'below' });
  });

  it('stays in the window for a control at the right end and at the left end', () => {
    expect(placePopover({ left: 1000, top: 10, bottom: 40 }, { width: 300, height: 200 }, viewport).left).toBe(1024 - WINDOW_MARGIN - 300);
    expect(placePopover({ left: 2, top: 10, bottom: 40 }, { width: 300, height: 200 }, viewport).left).toBe(WINDOW_MARGIN);
    expect(placePopover({ left: -50, top: 10, bottom: 40 }, { width: 2000, height: 200 }, viewport)).toMatchObject({ left: WINDOW_MARGIN, maxWidth: 1024 - 2 * WINDOW_MARGIN });
  });

  it('opens above when it does not fit below and there is more room above, and scrolls when taller', () => {
    expect(placePopover({ left: 100, top: 700, bottom: 730 }, { width: 300, height: 200 }, viewport)).toEqual({ left: 100, top: 700 - ANCHOR_GAP - 200, maxWidth: 1008, maxHeight: 700 - ANCHOR_GAP - WINDOW_MARGIN, side: 'above' });
    expect(placePopover({ left: 100, top: 700, bottom: 730 }, { width: 300, height: 2000 }, viewport)).toMatchObject({ top: WINDOW_MARGIN, side: 'above' });
    expect(placePopover({ left: 100, top: 10, bottom: 40 }, { width: 300, height: 2000 }, viewport)).toMatchObject({ top: 44, maxHeight: 716, side: 'below' });
  });
});

type Rect = { left: number; top: number; bottom: number };
const rect = (r: Rect): DOMRect => ({ ...r, right: r.left + 80, width: 80, height: r.bottom - r.top, x: r.left, y: r.top, toJSON: () => ({}) });

/** jsdom has no layout: every element measures as this panel, and the anchor's box is given (another element's with `id` "far"). */
function sizes(anchorBox: Rect, far: Rect = anchorBox) {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return rect(this.id === 'far' ? far : anchorBox);
  });
}

/** The browser's top layer, as far as the components use it. */
function topLayer() {
  const shown: Element[] = [];
  const hidden: Element[] = [];
  const modal: Element[] = [];
  const closed: Element[] = [];
  const el = HTMLElement.prototype as unknown as Record<string, unknown>;
  const dialog = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  el['showPopover'] = function (this: HTMLElement) {
    shown.push(this);
  };
  el['hidePopover'] = function (this: HTMLElement) {
    hidden.push(this);
  };
  dialog['showModal'] = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
    modal.push(this);
  };
  dialog['close'] = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    closed.push(this);
    this.dispatchEvent(new Event('close'));
  };
  return { shown, hidden, modal, closed };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const name of ['showPopover', 'hidePopover']) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  for (const name of ['showModal', 'close']) delete (HTMLDialogElement.prototype as unknown as Record<string, unknown>)[name];
});

function Control(props: { readonly onClose?: () => void; readonly far?: boolean }) {
  const [open, setOpen] = useState(true);
  const far = useRef<HTMLSpanElement>(null);
  return (
    <div className="top-bar-item" style={{ overflow: 'hidden' }}>
      <span id="far" ref={far}>
        Far
      </span>
      <div data-testid="anchor">
        <button type="button" onClick={() => setOpen((o) => !o)}>
          Bookmarks
        </button>
        <Popover
          open={open}
          label="Bookmarks"
          {...(props.far === true ? { anchor: far } : {})}
          onClose={() => {
            props.onClose?.();
            setOpen(false);
          }}
        >
          <button type="button">Home</button>
        </Popover>
      </div>
    </div>
  );
}

describe('the popover in a page', () => {
  it('without the top layer, is a plain element where it is rendered, placed from its anchor', () => {
    sizes({ left: 1000, top: 4, bottom: 36 });
    const page = render(<Control />);
    const panel = page.getByRole('dialog', { name: 'Bookmarks' });
    expect(page.getByTestId('anchor').contains(panel)).toBe(true);
    expect(panel.hasAttribute('popover')).toBe(false);
    expect([panel.style.left, panel.style.top, panel.dataset['side']]).toEqual([`${1024 - WINDOW_MARGIN - 300}px`, `${36 + ANCHOR_GAP}px`, 'below']);
  });

  it('with the top layer, is a manual popover shown on open and hidden on close, still in its place in the page', () => {
    const layer = topLayer();
    sizes({ left: 100, top: 4, bottom: 36 });
    const page = render(<Control />);
    // jsdom hides a [popover] the stub cannot open (no accessible name then), so it is found by its class.
    const panel = page.container.querySelector<HTMLElement>('.emc2-popover[aria-label="Bookmarks"]')!;
    expect([panel.getAttribute('popover'), layer.shown, page.getByTestId('anchor').contains(panel)]).toEqual(['manual', [panel], true]);
    fireEvent.click(page.getByRole('button', { name: 'Bookmarks' }));
    expect([page.container.querySelector('.emc2-popover'), layer.hidden]).toEqual([null, [panel]]);
  });

  it('is placed against the anchor it is given', () => {
    sizes({ left: 100, top: 4, bottom: 36 }, { left: 500, top: 300, bottom: 320 });
    const panel = render(<Control far />).getByRole('dialog');
    expect([panel.style.left, panel.style.top]).toEqual(['500px', `${320 + ANCHOR_GAP}px`]);
  });

  it('opens above an anchor at the bottom of the window', () => {
    sizes({ left: 100, top: 700, bottom: 730 });
    const panel = render(<Control />).getByRole('dialog');
    expect([panel.style.top, panel.style.maxHeight, panel.dataset['side']]).toEqual([`${700 - ANCHOR_GAP - 200}px`, `${700 - ANCHOR_GAP - WINDOW_MARGIN}px`, 'above']);
  });

  it('follows the anchor when the window is resized', () => {
    sizes({ left: 1000, top: 4, bottom: 36 });
    const page = render(<Control />);
    act(() => {
      globalThis.innerWidth = 800;
      globalThis.dispatchEvent(new Event('resize'));
    });
    expect(page.getByRole('dialog').style.left).toBe(`${800 - WINDOW_MARGIN - 300}px`);
    globalThis.innerWidth = 1024;
  });

  it('follows a scroll of the page, not one inside the panel', () => {
    sizes({ left: 100, top: 4, bottom: 36 });
    const panel = render(<Control />).getByRole('dialog');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect({ left: 300, top: 4, bottom: 36 }));
    fireEvent.scroll(panel);
    expect(panel.style.left).toBe('100px');
    fireEvent.scroll(document);
    expect(panel.style.left).toBe('300px');
  });

  it("keeps the panel's own scroll position when it is placed again", () => {
    sizes({ left: 100, top: 4, bottom: 36 });
    const panel = render(<Control />).getByRole('dialog');
    const written: number[] = [];
    Object.defineProperty(panel, 'scrollTop', { configurable: true, get: () => 120, set: (v: number) => void written.push(v) });
    act(() => {
      globalThis.dispatchEvent(new Event('resize'));
    });
    expect(written).toEqual([120]);
  });

  it('asks to close on a press outside, not on one inside the panel or the anchor', () => {
    sizes({ left: 100, top: 4, bottom: 36 });
    const onClose = vi.fn();
    const page = render(
      <div>
        <p>Map</p>
        <Control onClose={onClose} />
      </div>,
    );
    fireEvent.pointerDown(page.getByRole('button', { name: 'Home' }));
    fireEvent.pointerDown(page.getByRole('button', { name: 'Bookmarks' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(page.getByText('Map'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(page.queryByRole('dialog')).toBeNull();
    fireEvent.pointerDown(page.getByText('Map'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks to close on Escape from inside', () => {
    sizes({ left: 100, top: 4, bottom: 36 });
    const onClose = vi.fn();
    const page = render(<Control onClose={onClose} />);
    fireEvent.keyDown(page.getByRole('button', { name: 'Home' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function Confirm(props: { readonly onCancel: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="top-bar-item" style={{ overflow: 'hidden' }}>
      <ConfirmDialog
        open={open}
        title="Delete"
        message="Delete the folder Arctic?"
        confirmLabel="Delete folder"
        danger
        onConfirm={() => setOpen(false)}
        onCancel={() => {
          props.onCancel();
          setOpen(false);
        }}
      />
    </div>
  );
}

describe('the confirmation in a page', () => {
  it('without the top layer, is an open dialog that gives Cancel the focus and cancels on Escape', () => {
    const onCancel = vi.fn();
    const page = render(<Confirm onCancel={onCancel} />);
    const dialog = page.getByRole('alertdialog', { name: 'Delete' });
    expect([dialog.tagName, dialog.hasAttribute('open')]).toEqual(['DIALOG', true]);
    expect(document.activeElement).toBe(page.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(page.queryByRole('alertdialog')).toBeNull();
  });

  it('with the top layer, opens modal, turns the browser\'s cancel into onCancel once, and closes before it goes', () => {
    const layer = topLayer();
    const onCancel = vi.fn();
    const page = render(<Confirm onCancel={onCancel} />);
    const dialog = page.getByRole('alertdialog', { name: 'Delete' });
    expect(layer.modal).toEqual([dialog]);
    expect(document.activeElement).toBe(page.getByRole('button', { name: 'Cancel' }));
    // The browser turns Escape into a cancel event; the keydown itself is left to it.
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    const cancel = new Event('cancel', { cancelable: true });
    act(() => {
      dialog.dispatchEvent(cancel);
    });
    expect([cancel.defaultPrevented, onCancel.mock.calls.length, layer.closed]).toEqual([true, 1, [dialog]]);
  });

  it('with the top layer, takes the browser closing it anyway as a cancel', () => {
    topLayer();
    const onCancel = vi.fn();
    const page = render(<Confirm onCancel={onCancel} />);
    const dialog = page.getByRole('alertdialog');
    act(() => {
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new Event('close'));
    });
    expect([onCancel.mock.calls.length, page.queryByRole('alertdialog')]).toEqual([1, null]);
  });

  it('with the top layer in StrictMode, stays open when the first cleanup\'s close event comes late', async () => {
    topLayer();
    // Browsers fire close after close() returns, as a task.
    (HTMLDialogElement.prototype as unknown as Record<string, unknown>)['close'] = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      setTimeout(() => this.dispatchEvent(new Event('close')), 0);
    };
    const onCancel = vi.fn();
    const page = render(
      <StrictMode>
        <Confirm onCancel={onCancel} />
      </StrictMode>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect([onCancel.mock.calls.length, page.getByRole('alertdialog').hasAttribute('open')]).toEqual([0, true]);
  });

  it('with the top layer, closes on confirm without calling onCancel', () => {
    const layer = topLayer();
    const onCancel = vi.fn();
    const page = render(<Confirm onCancel={onCancel} />);
    const dialog = page.getByRole('alertdialog');
    fireEvent.click(page.getByRole('button', { name: 'Delete folder' }));
    expect([layer.closed, onCancel.mock.calls.length, page.queryByRole('alertdialog')]).toEqual([[dialog], 0, null]);
  });
});
