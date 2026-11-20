// Build, dev server and tests of the shell.
//
// `vite build` first runs the vendor build (build/vendor.ts): the shared libraries into
// dist/assets/vendor/ and dist/importmap.json. Then it builds the shell with those libraries
// external, so the shell and every plugin use the same instances, and inlines the import map into
// index.html before every module script (spike S4). The server puts the import map's hash into its
// Content-Security-Policy.
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { sharedExternals, type ImportMap } from '@emc2/plugin-sdk/build';
import { buildVendor } from './build/vendor.ts';

// The emc2 server (node tools/start.mjs) listens on this port.
const server = 'http://127.0.0.1:8080';
const shellDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = fileURLToPath(new URL('./dist', import.meta.url));

/** Puts the import map into index.html, before every module script. */
function inlineImportMap(importMap: ImportMap): Plugin {
  return {
    name: 'emc2-inline-import-map',
    transformIndexHtml: () => [
      { tag: 'script', attrs: { type: 'importmap' }, children: JSON.stringify(importMap), injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig(async ({ command, mode }) => {
  const isBuild = command === 'build' && mode !== 'test';
  const importMap = isBuild ? await buildVendor({ shellDir, outDir }) : null;
  return {
    plugins: importMap ? [sharedExternals(importMap), react(), inlineImportMap(importMap)] : [react()],
    server: {
      // During development (npm run dev), API calls and the live picture go to the running emc2
      // server. It checks Host and, for the WebSocket, Origin: both must name the server itself.
      proxy: { '/api': { target: server, changeOrigin: true, ws: true, headers: { origin: server } } },
    },
    build: {
      outDir: 'dist',
      // The vendor build has emptied dist/ and written assets/vendor/ and importmap.json into it.
      emptyOutDir: false,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['src/testing/setup.ts'],
      // Well above Testing Library's 5 s wait (setup.ts): a test that waits in vain fails with its
      // own message, not with the timer's.
      testTimeout: 30_000,
    },
  };
});
