import { describe, expect, it, vi } from 'vitest';
import { logOut } from './logout.ts';

describe('logOut', () => {
  it('posts to /logout asking for JSON and goes to the IAM logout page the server names', async () => {
    const doFetch = vi.fn(() => Promise.resolve(Response.json({ redirect: 'https://iam.example/logout?id_token_hint=x' })));
    const navigate = vi.fn();

    await logOut(doFetch, navigate);

    expect(doFetch).toHaveBeenCalledWith('/logout', { method: 'POST', headers: { Accept: 'application/json' } });
    expect(navigate).toHaveBeenCalledWith('https://iam.example/logout?id_token_hint=x');
  });

  it("runs `before` first (the setup's last save), and logs out also when it fails", async () => {
    const order: string[] = [];
    const doFetch = vi.fn(() => { order.push('POST /logout'); return Promise.resolve(Response.json({ redirect: '/bye' })); });
    const navigate = vi.fn();

    await logOut(doFetch, navigate, () => { order.push('before'); return Promise.resolve(); });
    await logOut(doFetch, navigate, () => Promise.reject(new Error('no answer')));

    expect(order).toEqual(['before', 'POST /logout', 'POST /logout']);
    expect(navigate.mock.calls).toEqual([['/bye'], ['/bye']]);
  });

  it('goes to the start page when the server names no logout page, answers an error or cannot be reached', async () => {
    const navigate = vi.fn();
    await logOut((() => Promise.resolve(Response.json({}))), navigate);
    await logOut((() => Promise.resolve(new Response('', { status: 500 }))), navigate);
    await logOut((() => Promise.reject(new TypeError('Failed to fetch'))), navigate);
    expect(navigate.mock.calls).toEqual([['/'], ['/'], ['/']]);
  });
});
