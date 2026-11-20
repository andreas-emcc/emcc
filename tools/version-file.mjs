// The release's version file (owner ACQ, 2026-11-18): version.properties in the release's root, read by
// the server and reported in GET /api/health, so the shell's help menu can show which release runs.
// Keys: emcc.version (the --milestone name, e.g. M9-RC1), emcc.build.date (YYYY-MM-DD),
// emcc.build.commit (the short commit), emcc.build.dirty (true or false), emcc.sdk.version (e.g. 1.9.0).

/** The text of version.properties, with the platform's line ends. */
export function versionProperties({ milestone, day, commit, dirty, sdk }, eol = '\n') {
  for (const [key, value] of Object.entries({ milestone, day, commit, sdk })) {
    if (!/^[A-Za-z0-9.-]+$/.test(String(value ?? ''))) throw new Error(`version file: ${key} "${value}" expected`);
  }
  return [
    '# The emcc release in this folder, written by tools/release.mjs. Do not edit.',
    `emcc.version=${milestone}`,
    `emcc.build.date=${day}`,
    `emcc.build.commit=${commit}`,
    `emcc.build.dirty=${dirty ? 'true' : 'false'}`,
    `emcc.sdk.version=${sdk}`,
    '',
  ].join(eol);
}
