import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Answer, ComputeThreads } from './api.ts';
import { ComputeThreadsField } from './ComputeThreadsField.tsx';

/** SDK 1.9.0 (ADR-0064 point 4; owner PQ1 A): a plugin's compute threads atop its Settings entry. */
describe('the compute threads field', () => {
  afterEach(cleanup);

  const stored = (allowed: number): Answer<ComputeThreads> => ({ ok: true, value: { declared: 4, reason: 'Renders one simulated camera per thread.', allowed } });

  it('shows the admin\'s number with the declaration and its reason, and saves a new one at once', async () => {
    const api = { compute: vi.fn(() => Promise.resolve(stored(4))), saveCompute: vi.fn((_id: string, n: number) => Promise.resolve(stored(n))) };
    render(<ComputeThreadsField pluginId="fmv" api={api} />);

    const input = await screen.findByLabelText<HTMLInputElement>('Tasks at once');
    expect(input.value).toBe('4');
    expect(screen.getByText(/It declares 4: Renders one simulated camera per thread\. Lowering the number stops its newest tasks at once\./))
      .toBeTruthy();
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
    expect(save.disabled, 'nothing changed').toBe(true);

    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.click(save);
    await waitFor(() => { expect(api.saveCompute).toHaveBeenCalledWith('fmv', 1); });
    await waitFor(() => { expect(save.disabled).toBe(true); });
    expect(input.value).toBe('1');
  });

  it('refuses a number outside 0 to the declaration before it is sent, and says what the server refused', async () => {
    const refused: Answer<ComputeThreads> = { ok: false, message: 'The server refused the values; nothing was changed.', invalid: true,
      problems: [{ path: '/allowed', problem: 'a whole number from 0 to 4, the plugin\'s declaration' }] };
    const api = { compute: vi.fn(() => Promise.resolve(stored(2))), saveCompute: vi.fn(() => Promise.resolve(refused)) };
    render(<ComputeThreadsField pluginId="fmv" api={api} />);
    const input = await screen.findByLabelText<HTMLInputElement>('Tasks at once');
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });

    for (const wrong of ['5', '-1', '1.5', 'two']) {
      fireEvent.change(input, { target: { value: wrong } });
      expect(save.disabled, wrong).toBe(true);
      expect(input.getAttribute('aria-invalid')).toBe('true');
    }
    expect(screen.getByText('A whole number from 0 to 4.')).toBeTruthy();

    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(save);
    expect(await screen.findByText('a whole number from 0 to 4, the plugin\'s declaration')).toBeTruthy();
  });
});
