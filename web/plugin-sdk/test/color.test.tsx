// @vitest-environment jsdom
// The shared ColorField in a page (CR-0018): the picker and the text, a valid colour in lower case
// only, the field's own error for typed text that is not a colour, and onCommit as TextField's.
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorField } from '../src/index.ts';

afterEach(cleanup);

function Fill(props: { readonly onChange?: (v: string) => void; readonly onCommit?: () => void; readonly error?: string; readonly initial?: string; readonly disabled?: boolean }) {
  const [value, setValue] = useState(props.initial ?? '#1F3A93');
  return (
    <ColorField
      label="Fill colour"
      value={value}
      onChange={(v) => {
        props.onChange?.(v);
        setValue(v);
      }}
      {...(props.onCommit === undefined ? {} : { onCommit: props.onCommit })}
      {...(props.error === undefined ? {} : { error: props.error })}
      {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
    />
  );
}

const text = (page: ReturnType<typeof render>) => page.getByLabelText('Fill colour') as HTMLInputElement;
const picker = (page: ReturnType<typeof render>) => page.getByLabelText('Fill colour, picker') as HTMLInputElement;

describe('ColorField', () => {
  it('shows a value of either case in lower case, in the text and the picker', () => {
    const page = render(<Fill />);
    expect([text(page).value, picker(page).value, picker(page).type]).toEqual(['#1f3a93', '#1f3a93', 'color']);
  });

  it('passes a picked colour on in lower case, and commits once when the picker closes', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const page = render(<Fill onChange={onChange} onCommit={onCommit} />);
    fireEvent.input(picker(page), { target: { value: '#A33A3A' } });
    expect([onChange.mock.calls, onCommit.mock.calls.length, text(page).value]).toEqual([[['#a33a3a']], 0, '#a33a3a']);
    fireEvent.change(picker(page), { target: { value: '#a33a3a' } });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('passes typed text on only once it is a colour, with or without the #, in lower case', () => {
    const onChange = vi.fn();
    const page = render(<Fill onChange={onChange} />);
    for (const typed of ['#A3', '#A33A3', '#A33A3A', 'FF8080']) fireEvent.change(text(page), { target: { value: typed } });
    expect(onChange.mock.calls).toEqual([['#a33a3a'], ['#ff8080']]);
    expect(text(page).value).toBe('FF8080');
    fireEvent.blur(text(page));
    expect(text(page).value).toBe('#ff8080');
  });

  it('keeps text that is not a colour, says so at Enter or blur, and does not commit it', () => {
    const onCommit = vi.fn();
    const page = render(<Fill onCommit={onCommit} />);
    fireEvent.change(text(page), { target: { value: 'red' } });
    expect(page.queryByText(/Type a colour/)).toBeNull();
    fireEvent.keyDown(text(page), { key: 'Enter' });
    expect([text(page).value, text(page).getAttribute('aria-invalid'), page.getByText('Type a colour as #rrggbb, e.g. #1f3a93') !== null, onCommit.mock.calls.length]).toEqual(['red', 'true', true, 0]);
    fireEvent.change(text(page), { target: { value: '#00ff00' } });
    expect(page.queryByText(/Type a colour/)).toBeNull();
    fireEvent.keyDown(text(page), { key: 'Enter' });
    fireEvent.blur(text(page));
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('drops kept text when the plugin passes a new value while the field is not focused, and links its error', () => {
    function Chosen() {
      const [value, setValue] = useState('#1f3a93');
      return (
        <>
          <button type="button" onClick={() => setValue('#a33a3a')}>
            Next object
          </button>
          <ColorField label="Fill colour" value={value} onChange={setValue} />
        </>
      );
    }
    const page = render(<Chosen />);
    fireEvent.focus(text(page));
    fireEvent.change(text(page), { target: { value: 'red' } });
    fireEvent.blur(text(page));
    const error = page.getByText(/Type a colour/);
    expect(text(page).getAttribute('aria-describedby')).toBe(error.id);
    fireEvent.click(page.getByRole('button', { name: 'Next object' }));
    expect([text(page).value, page.queryByText(/Type a colour/)]).toEqual(['#a33a3a', null]);
  });

  it("shows the plugin's error instead of its own, and can be disabled", () => {
    const page = render(<Fill error="Not allowed on this layer" disabled />);
    expect([page.getByText('Not allowed on this layer') !== null, text(page).disabled, picker(page).disabled, text(page).getAttribute('aria-invalid')]).toEqual([true, true, true, 'true']);
  });
});
