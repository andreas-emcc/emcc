// The calls to the server part (brief function 24; design pattern, web part): only under the
// plugin's base, commands as JSON POSTs, and each failure with its message and whether Retry helps (A33).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CALL_TIMEOUT_MS, NOT_TAKEN, SimulatorServer } from '../src/server.ts';
import { FakeServer } from './harness.tsx';

const BASE = '/api/plugins/simulator/';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SimulatorServer', () => {
  it('reads with GET and sends commands as JSON POSTs under the base', async () => {
    const fake = new FakeServer(BASE).on('GET', 'routes', { status: 200, body: { running: true, routes: [] } }).on('POST', 'routes/start', { status: 200, body: {} });
    const server = new SimulatorServer(BASE);
    expect(await server.get('routes')).toEqual({ ok: true, body: { running: true, routes: [] } });
    expect(await server.post('routes/start', {})).toEqual({ ok: true, body: {} });
    expect(fake.calls).toEqual([
      { method: 'GET', path: 'routes', body: null },
      { method: 'POST', path: 'routes/start', body: {} },
    ]);
  });

  it.each([
    [401, 'You are logged out; log in again', false],
    [403, 'You may not do this', false],
    [405, NOT_TAKEN, false],
    [413, 'Too much at once; choose fewer objects', false],
    [503, 'The simulator is loading; try again', true],
    [504, 'No answer in time; it may have been done', true],
    [500, 'The server answered 500', true],
  ])('answers %i with its message', async (status, message, retry) => {
    new FakeServer(BASE).on('POST', 'routes/start', { status });
    expect(await new SimulatorServer(BASE).post('routes/start', {})).toEqual({ ok: false, status, message, retry });
  });

  it("shows the server part's own error for 400, 404 and 409", async () => {
    new FakeServer(BASE).on('POST', 'routes/x/start', { status: 409, body: { error: 'the route cannot run: point 2: no speed' } });
    expect(await new SimulatorServer(BASE).post('routes/x/start', {})).toMatchObject({ ok: false, status: 409, message: 'the route cannot run: point 2: no speed', retry: false });
  });

  it('gives every call a timeout, and treats one that ends as "no answer" (a 504)', async () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      signal = init?.signal;
      return Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
    });
    expect(await new SimulatorServer(BASE).post('routes/start', {})).toEqual({ ok: false, status: 0, message: 'No answer in time; it may have been done', retry: true });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(CALL_TIMEOUT_MS).toBe(10_000);
  });

  it('says so when the server cannot be reached', async () => {
    const fake = new FakeServer(BASE);
    fake.down = true;
    expect(await new SimulatorServer(BASE).get('routes')).toEqual({ ok: false, status: 0, message: 'The server cannot be reached', retry: true });
  });
});
