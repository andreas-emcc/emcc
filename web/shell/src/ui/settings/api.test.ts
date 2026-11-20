import { describe, expect, it, vi } from 'vitest';
import { SettingsApi } from './api.ts';

const answering = (response: Response | Promise<Response>) => vi.fn<typeof fetch>(() => Promise.resolve(response));

describe('the settings calls', () => {
  it('read and save a plugin\'s settings, with the id encoded in the path', async () => {
    const doFetch = answering(Response.json({ schema: { type: 'object' }, values: { a: 1 } }));
    const api = new SettingsApi(doFetch);
    expect(await api.plugin('a b')).toEqual({ ok: true, value: { schema: { type: 'object' }, values: { a: 1 } } });
    expect(doFetch.mock.calls[0]?.[0]).toBe('/api/settings/plugins/a%20b');
    expect(doFetch.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });

    doFetch.mockResolvedValueOnce(Response.json({ values: { a: 2 } }));
    expect(await api.savePlugin('coordinates', { a: 2 })).toEqual({ ok: true, value: { a: 2 } });
    expect(doFetch.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT', body: '{"a":2}', headers: { 'Content-Type': 'application/json' },
    });
  });

  it('change a data type\'s behaviour and set it back to the defaults', async () => {
    const type = { id: 'cot.cot', name: 'CoT', declaredBy: 'cot', defaults: { fadeWhenExpired: true }, behaviour: { fadeWhenExpired: false } };
    const doFetch = answering(Response.json(type));
    const api = new SettingsApi(doFetch);
    expect(await api.saveDataType('cot.cot', { fadeWhenExpired: false })).toEqual({ ok: true, value: type });
    doFetch.mockResolvedValueOnce(Response.json(type));
    await api.resetDataType('cot.cot');
    expect(doFetch.mock.calls.map((c) => [c[0], c[1]?.method])).toEqual([
      ['/api/settings/data-types/cot.cot', 'PUT'], ['/api/settings/data-types/cot.cot', 'DELETE'],
    ]);
  });

  it('turn a refusal into a message with the server\'s problems', async () => {
    const api = new SettingsApi(answering(Response.json(
      { problems: [{ path: '/port', problem: 'must be at most 65535' }, { path: 1 }] }, { status: 400 },
    )));
    expect(await api.savePlugin('cot', { port: 70000 })).toEqual({
      ok: false, message: 'The server refused the values; nothing was changed.', problems: [{ path: '/port', problem: 'must be at most 65535' }],
      invalid: true, // the server checked them (SDK 1.3.0's settings panel gets the problems)
    });
  });

  it('say what a status means, and that edits are kept when the server does not answer', async () => {
    const message = async (doFetch: typeof fetch) => {
      const answer = await new SettingsApi(doFetch).plugin('x');
      return answer.ok ? 'ok' : answer.message;
    };
    expect(await message(answering(new Response('', { status: 401 })))).toBe('Your login has ended. Reload the page to log in again.');
    expect(await message(answering(new Response('', { status: 403 })))).toBe('This needs the settings.admin permission.');
    expect(await message(answering(new Response('', { status: 404 })))).toBe('The server does not know this plugin.');
    expect(await message(answering(new Response('', { status: 500 })))).toBe('The server answered HTTP 500; nothing was changed.');
    expect(await message(answering(new Response('not json')))).toBe('The server sent an answer this page cannot read.');
    expect(await message(() => Promise.reject(new TypeError('Failed to fetch')))).toBe('The server did not answer. Your edits are kept; try again.');
  });
});
