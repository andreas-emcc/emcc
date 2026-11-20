/**
 * Logs out (ADR-0022): first `before` (the setup's last save, so that nothing is sent after the
 * session has ended), then `POST /logout`, which ends the session on the server, then a top-level
 * navigation to the IAM's logout page the server names, which ends the IAM's session and comes back
 * to `/`. Not a form post: the server's redirect to the IAM would be blocked by the
 * Content-Security-Policy's `form-action 'self'` (ADR-0030), and the CSP stays `'self'`.
 */
export async function logOut(
  doFetch: typeof fetch = fetch,
  navigate: (url: string) => void = (url) => { window.location.assign(url); },
  before: () => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  await before().catch(() => undefined); // its own failures are its own: the logout goes on
  try {
    const response = await doFetch('/logout', { method: 'POST', headers: { Accept: 'application/json' } });
    const body: unknown = response.ok ? await response.json() : null;
    const redirect = typeof body === 'object' && body !== null && 'redirect' in body ? body.redirect : null;
    navigate(typeof redirect === 'string' ? redirect : '/');
  } catch {
    navigate('/'); // the page reloads through the login, wherever the logout stopped
  }
}
