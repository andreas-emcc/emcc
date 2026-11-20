// @vitest-environment jsdom
// SDK 1.2.0 part 1 (CR-0025): Button's and IconButton's aria-expanded and aria-haspopup,
// IconButton's title (CR-0024), TextField's new props and its linked error, a popover's presses
// inside a dialog opened meanwhile, and the fake map view's AbortSignal (CR-0020).
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, ConfirmDialog, IconButton, Popover, TextField } from '../src/index.ts';
import { createFakeMapView } from '../src/testing/index.ts';

afterEach(() => {
  cleanup();
  for (const name of ['showModal', 'close']) delete (HTMLDialogElement.prototype as unknown as Record<string, unknown>)[name];
});

/** jsdom has no showModal; a stub that opens and closes the dialog as the browser does. */
function modalDialogs() {
  const dialog = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  dialog['showModal'] = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  dialog['close'] = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

describe('Button and IconButton (SDK 1.2.0)', () => {
  it('render expanded and hasPopup as aria-expanded and aria-haspopup, and nothing without them', () => {
    const page = render(
      <>
        <Button expanded={false} hasPopup="menu">
          More
        </Button>
        <IconButton icon={Plus} label="Add field" expanded hasPopup="menu" />
        <Button>Plain</Button>
      </>,
    );
    const more = page.getByRole('button', { name: 'More' });
    const add = page.getByRole('button', { name: 'Add field' });
    const plain = page.getByRole('button', { name: 'Plain' });
    expect([more.getAttribute('aria-expanded'), more.getAttribute('aria-haspopup')]).toEqual(['false', 'menu']);
    expect([add.getAttribute('aria-expanded'), add.getAttribute('aria-haspopup')]).toEqual(['true', 'menu']);
    expect([plain.hasAttribute('aria-expanded'), plain.hasAttribute('aria-haspopup')]).toEqual([false, false]);
  });

  it("IconButton's title is its tooltip, and its label stays its name (CR-0024)", () => {
    const page = render(
      <>
        <IconButton icon={Plus} label="Delete layer" title="Only empty layers can be deleted" disabled />
        <IconButton icon={Plus} label="New layer" />
      </>,
    );
    const del = page.getByRole('button', { name: 'Delete layer' });
    expect([del.getAttribute('title'), del.getAttribute('aria-label')]).toEqual(['Only empty layers can be deleted', 'Delete layer']);
    expect(page.getByRole('button', { name: 'New layer' }).getAttribute('title')).toBe('New layer');
  });
});

describe('TextField (SDK 1.2.0)', () => {
  it('passes readOnly, inputMode, autoComplete and spellCheck to the input', () => {
    const page = render(<TextField label="Callsign" value="ALPHA-1" onChange={() => {}} readOnly inputMode="text" autoComplete="off" spellCheck={false} />);
    const input = page.getByLabelText('Callsign') as HTMLInputElement;
    expect([input.readOnly, input.getAttribute('inputmode'), input.getAttribute('autocomplete'), input.getAttribute('spellcheck')]).toEqual([true, 'text', 'off', 'false']);
  });

  it('links its error with aria-describedby, outside the label, so the name is the label only', () => {
    const page = render(<TextField label="Speed" value="fast" onChange={() => {}} error="Type a number" />);
    const input = page.getByRole('textbox', { name: 'Speed' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = input.getAttribute('aria-describedby');
    expect(described).not.toBeNull();
    const error = page.container.ownerDocument.getElementById(described!);
    expect(error?.textContent).toBe('Type a number');
    expect(error?.closest('label')).toBeNull();
  });

  it('reports typing, and commits on Enter and on blur (F6, moved from review.test.tsx)', () => {
    const typed: string[] = [];
    const onCommit = vi.fn();
    const page = render(<TextField label="Name" value="A" onChange={(v) => void typed.push(v)} onCommit={onCommit} error="Too short" />);
    const input = page.getByRole('textbox', { name: 'Name' });
    expect(page.getByText('Too short')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'a' });
    fireEvent.blur(input);
    expect([typed, onCommit.mock.calls.length]).toEqual([['Alpha'], 2]);
  });

  it('has no description without an error, and still commits on Enter and on leaving', () => {
    const onCommit = vi.fn();
    const page = render(<TextField label="Name" value="A" onChange={() => {}} onCommit={onCommit} />);
    const input = page.getByRole('textbox', { name: 'Name' });
    expect([input.hasAttribute('aria-describedby'), input.hasAttribute('aria-invalid')]).toEqual([false, false]);
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });
});

function WithConfirm(props: { readonly onClose: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div>
      <div>
        <button type="button">Bookmarks</button>
        <Popover open label="Bookmarks" onClose={props.onClose}>
          <button type="button" onClick={() => setConfirming(true)}>
            Delete folder
          </button>
        </Popover>
      </div>
      <span>Elsewhere</span>
      <ConfirmDialog
        open={confirming}
        title="Delete the folder?"
        confirmLabel="Delete"
        onConfirm={() => setConfirming(false)}
        onCancel={() => setConfirming(false)}
        message="It holds 3 bookmarks."
      />
    </div>
  );
}

describe('a popover and a dialog opened meanwhile (SDK 1.2.0)', () => {
  it('a press inside the dialog is not a press outside the popover', () => {
    modalDialogs();
    const onClose = vi.fn();
    const page = render(<WithConfirm onClose={onClose} />);
    fireEvent.click(page.getByRole('button', { name: 'Delete folder' }));
    const confirm = page.container.ownerDocument.querySelector('dialog[open]');
    expect(confirm).not.toBeNull();
    fireEvent.pointerDown(confirm!.querySelector('button')!);
    expect(onClose).not.toHaveBeenCalled();
    // A press outside both still asks to close.
    fireEvent.pointerDown(page.getByText('Elsewhere'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a press in a dialog around the popover still is', () => {
    modalDialogs();
    const onClose = vi.fn();
    function Around() {
      return (
        <ConfirmDialog
          open
          title="Settings"
          confirmLabel="Done"
          onConfirm={() => {}}
          onCancel={() => {}}
          message={
            <>
              <span>In the dialog</span>
              <span>
                <button type="button">Pick</button>
                <Popover open label="Choices" onClose={onClose}>
                  <button type="button">One</button>
                </Popover>
              </span>
            </>
          }
        />
      );
    }
    const page = render(<Around />);
    fireEvent.pointerDown(page.getByText('In the dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the fake map view's signal (CR-0020)", () => {
  it('ends the running interaction with null when its signal aborts, as Escape does', async () => {
    const map = createFakeMapView();
    const tool = new AbortController();
    const drawing = map.draw('polygon', { signal: tool.signal });
    expect(map.runningInteraction).toBe('draw:polygon');
    tool.abort();
    await expect(drawing).resolves.toBeNull();
    expect(map.runningInteraction).toBeNull();
  });

  it('starts nothing for a signal aborted before, and leaves another running interaction alone', async () => {
    const map = createFakeMapView();
    const pick = map.pickPoint();
    const done = new AbortController();
    done.abort();
    await expect(map.edit('0190a0c0-0000-7000-8000-000000000001', { signal: done.signal })).resolves.toBeNull();
    expect(map.runningInteraction).toBe('pickPoint');
    map.completeInteraction([15, 60]);
    await expect(pick).resolves.toEqual([15, 60]);
  });

  it('an already aborted signal wins over NotOnMapError for edit', async () => {
    const map = createFakeMapView();
    const id = '0190a0c0-0000-7000-8000-000000000003';
    map.setNotDrawn([id]);
    const done = new AbortController();
    done.abort();
    await expect(map.edit(id, { signal: done.signal })).resolves.toBeNull();
    await expect(map.edit(id)).rejects.toThrow('not on the map');
  });

  it('an abort after the interaction ended changes nothing', async () => {
    const map = createFakeMapView();
    const tool = new AbortController();
    const drag = map.dragObject('0190a0c0-0000-7000-8000-000000000002', { signal: tool.signal });
    map.completeInteraction([16, 61]);
    await expect(drag).resolves.toEqual([16, 61]);
    const next = map.pickPoint();
    tool.abort();
    expect(map.runningInteraction).toBe('pickPoint');
    map.completeInteraction([17, 62]);
    await expect(next).resolves.toEqual([17, 62]);
  });
});
