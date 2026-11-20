import { UserDocumentError } from '@emc2/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { userDocumentsOf } from './userDocuments.ts';

const pathOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

interface Call { readonly method: string; readonly url: string; readonly body: string | undefined }

/** A server that answers with `answer` and records the calls. */
function server(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  const doFetch: typeof fetch = (input, init) => {
    const call = { method: init?.method ?? 'GET', url: pathOf(input), body: typeof init?.body === 'string' ? init.body : undefined };
    calls.push(call);
    return Promise.resolve(answer(call));
  };
  return { calls, documents: userDocumentsOf('bookmarks', doFetch) };
}

const problem = (status: number, text: string) => Response.json({ problem: text }, { status });

async function refusal(promise: Promise<unknown>): Promise<UserDocumentError> {
  const error: unknown = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(UserDocumentError);
  return error as UserDocumentError;
}

describe('a web part\'s user documents', () => {
  it('reads, writes, lists and removes its own documents on the server', async () => {
    const { calls, documents } = server((call) => {
      if (call.method === 'GET' && call.url.endsWith('/tree')) return Response.json({ folders: [] });
      if (call.method === 'GET') return Response.json({ names: ['tree'] });
      return new Response(null, { status: 204 });
    });

    await documents.put('tree', { folders: [] });
    expect(await documents.get('tree')).toEqual({ folders: [] });
    expect(await documents.list()).toEqual(['tree']);
    await documents.delete('tree');
    expect(calls).toEqual([
      { method: 'PUT', url: '/api/user-documents/bookmarks/tree', body: '{"folders":[]}' },
      { method: 'GET', url: '/api/user-documents/bookmarks/tree', body: undefined },
      { method: 'GET', url: '/api/user-documents/bookmarks', body: undefined },
      { method: 'DELETE', url: '/api/user-documents/bookmarks/tree', body: undefined },
    ]);
  });

  it('gives null for a document that is not there', async () => {
    const { documents } = server(() => problem(404, 'no such document'));
    expect(await documents.get('tree')).toBeNull();
  });

  it('refuses a bad name without asking the server', async () => {
    const { calls, documents } = server(() => new Response(null, { status: 204 }));
    expect((await refusal(documents.put('My Tree', 1))).problem).toBe('bad-name');
    expect((await refusal(documents.get('../core/x'))).problem).toBe('bad-name');
    expect(calls).toEqual([]);
  });

  it('tells the server\'s refusals apart', async () => {
    const cases: [number, string, string][] = [
      [413, 'the document has 262145 bytes as JSON, more than 262144', 'too-large'],
      [507, 'the user\'s documents would have 4194305 bytes, more than 4194304', 'user-full'],
      [409, 'the namespace bookmarks has 200 documents, the most it may have', 'too-many'],
      [400, 'not a document name', 'bad-name'],
      [404, 'no running plugin with a web part has the id bookmarks', 'unavailable'],
      [401, 'not logged in', 'unavailable'],
      [503, 'busy; try again', 'unavailable'],
    ];
    for (const [status, text, expected] of cases) {
      const { documents } = server(() => problem(status, text));
      const error = await refusal(documents.put('tree', 1));
      expect(error.problem, String(status)).toBe(expected);
      expect(error.message).toBe(text);
    }
    const { documents } = server(() => problem(404, 'no running plugin with a web part has the id bookmarks'));
    expect((await refusal(documents.get('tree'))).problem, 'an unknown namespace on a read').toBe('unavailable');
  });

  it('gives every call a timeout, and one that ends is unavailable', async () => {
    let signal: AbortSignal | null | undefined;
    const documents = userDocumentsOf('bookmarks', (_input, init) => {
      signal = init?.signal;
      return Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
    });
    const error = await refusal(documents.get('tree'));
    expect(error.problem).toBe('unavailable');
    expect(error.message).toContain('timed out');
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('counts an answer that is not JSON, such as a login page, as no answer', async () => {
    const { documents } = server(() => new Response('<html>Log in</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const error = await refusal(documents.get('tree'));
    expect(error.problem).toBe('unavailable');
    expect(error.message).toBe('the server\'s answer is not JSON (200)');
    expect((await refusal(documents.list())).problem).toBe('unavailable');
  });

  it('refuses a value that is not JSON as the plugin\'s mistake, without asking the server', async () => {
    const { calls, documents } = server(() => new Response(null, { status: 204 }));
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(documents.put('tree', undefined as unknown as null)).rejects.toThrow(new TypeError('a user document must be a JSON value, not undefined'));
    await expect(documents.put('tree', cyclic as never)).rejects.toThrow(TypeError);
    await expect(documents.put('tree', 1n as never)).rejects.toThrow(/must be a JSON value/);
    expect(calls).toEqual([]);
  });

  it('is unavailable when the server cannot be reached', async () => {
    const documents = userDocumentsOf('bookmarks', () => Promise.reject(new TypeError('Failed to fetch')));
    const error = await refusal(documents.list());
    expect(error.problem).toBe('unavailable');
    expect(error.message).toContain('Failed to fetch');
  });
});
