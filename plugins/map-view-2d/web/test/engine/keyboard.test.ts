/** The Escape key (review remark N6): ends an interaction, except where the user types. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenForDrawingKeys, listenForEscape } from '../../src/engine/keyboard.ts';

afterEach(() => {
  document.body.replaceChildren();
});

function press(target: EventTarget, key = 'Escape'): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function element(html: string): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  document.body.append(holder);
  const found = holder.querySelector('[data-target]');
  if (!(found instanceof HTMLElement)) throw new Error('no target');
  return found;
}

describe('Escape', () => {
  it('reports Escape on the page, and only Escape', () => {
    const listener = vi.fn();
    listenForEscape(document, listener);
    press(document.body);
    press(document.body, 'Enter');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to a text field, a text area, a list box and editable content', () => {
    const listener = vi.fn();
    listenForEscape(document, listener);
    for (const html of [
      '<input data-target>',
      '<input type="search" data-target>',
      '<textarea data-target></textarea>',
      '<select data-target><option>a</option></select>',
      '<div contenteditable="true"><span data-target>text</span></div>',
    ]) {
      press(element(html));
    }
    expect(listener).not.toHaveBeenCalled();
  });

  it('still reports Escape on a button or a checkbox (the placing button keeps the focus after a click)', () => {
    const listener = vi.fn();
    listenForEscape(document, listener);
    for (const html of ['<button data-target>Place</button>', '<input type="checkbox" data-target>', '<div contenteditable="false"><span data-target>x</span></div>']) {
      press(element(html));
    }
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('stops listening when told to', () => {
    const listener = vi.fn();
    const stop = listenForEscape(document, listener);
    stop();
    press(document.body);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('the drawing keys (brief function 17)', () => {
  it('Enter finishes and Backspace removes the last point, also on the button that started drawing, without its own action', () => {
    const enter = vi.fn();
    const backspace = vi.fn();
    const stop = listenForDrawingKeys(document, { enter, backspace });
    const button = element('<button data-target>Draw</button>');
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); // Enter on the button does not start drawing again
    press(document.body, 'Backspace');
    press(document.body, 'Escape'); // Escape is the controller's, through listenForEscape
    expect(enter).toHaveBeenCalledTimes(1);
    expect(backspace).toHaveBeenCalledTimes(1);
    stop();
    press(document.body, 'Enter');
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it('leaves Enter and Backspace to a text field, a text area, a list box and editable content', () => {
    const enter = vi.fn();
    const backspace = vi.fn();
    const stop = listenForDrawingKeys(document, { enter, backspace });
    for (const html of ['<input data-target>', '<textarea data-target></textarea>', '<select data-target><option>a</option></select>', '<div contenteditable="true"><span data-target>t</span></div>']) {
      const target = element(html);
      press(target, 'Enter');
      press(target, 'Backspace');
    }
    stop();
    expect(enter).not.toHaveBeenCalled();
    expect(backspace).not.toHaveBeenCalled();
  });

  it("counts only where it is told to: the page, the map, the starting button (owner, 2026-10-16), not another plugin's button", () => {
    const enter = vi.fn();
    const start = element('<button data-target>Draw</button>');
    const other = element('<button data-target>Other plugin</button>');
    const stop = listenForDrawingKeys(document, { enter, backspace: vi.fn() }, (target) => target === document.body || target === start);
    const onOther = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    other.dispatchEvent(onOther);
    expect(onOther.defaultPrevented).toBe(false); // the other button keeps its Enter
    press(start, 'Enter');
    press(document.body, 'Enter');
    stop();
    expect(enter).toHaveBeenCalledTimes(2);
  });
});
