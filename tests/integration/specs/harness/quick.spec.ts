// Quick run: @always @harness
import { expect, test } from '@playwright/test';
import { areaProblems, selectForBranch, selectRun, specAreas } from '../../lib/quick.mjs';

// The quick run's selection (T-063, lib/quick.mjs): every spec file declares its areas, the
// full-run rule of agents/mca.md (merge procedure, step 3) holds, and real past merges get the run
// they should. No server and no browser.

const always = () => specAreas().filter((s) => s.areas.includes('@always')).map((s) => s.file);

test('every spec file declares known quick run areas, and every fixture names existing spec files', () => {
  expect(areaProblems()).toEqual([]);
  expect(always().length, 'some files run in every quick run').toBeGreaterThan(5);
});

test('the full-run paths of agents/mca.md, and a path the mapping does not cover, give the full run', () => {
  const full = [
    'server/ecore/src/main/java/dev/emcc/ecore/ECore.java',
    'server/app/src/main/resources/application.properties',
    'server/pom.xml',
    'web/shell/src/App.tsx',
    'web/plugin-sdk/src/context.ts',
    'model/schemas/object.schema.json',
    'tools/build.mjs',
    'package-lock.json',
    'package.json',
    '.gitignore',
    'tests/integration/run.mjs',
    'tests/integration/lib/live.mjs',
    'tests/integration/playwright.config.ts',
    'tests/integration/package-lock.json',
    'tests/integration/specs/live/helper.ts',
    'tests/integration/fixtures/plugins/ita-new/plugin.json',
    'spikes/x/run.mjs',
    '.claude/settings.json',
    'agents/run.sh',
  ];
  for (const path of full) {
    const selection = selectRun([path]);
    expect(selection.mode, path).toBe('full');
    expect(selection.reasons[0][1], path).toMatch(/^FULL: /);
  }
});

test('plugins, server/pom.xml module lines, spec files, fixtures and documentation give a quick run with what they select', () => {
  // The @always files and those with the area @plugin-cot (more join as specs are added).
  const ofCot = specAreas().filter((s) => s.areas.includes('@plugin-cot')).map((s) => s.file);
  expect(ofCot).toContain('criteria/cot.spec.ts');
  expect(selectRun(['plugins/cot/server/src/main/java/dev/emcc/plugins/cot/Applier.java'])).toMatchObject({
    mode: 'quick',
    files: [...new Set([...always(), ...ofCot])].sort(),
  });
  // A plugin without specs of its own runs the files that load every plugin.
  expect(selectRun(['plugins/new-one/web/src/index.tsx'])).toMatchObject({ mode: 'quick', files: always() });
  expect(selectRun(['plugins/_template/plugin.json'])).toMatchObject({ mode: 'quick', files: always() });
  expect(selectRun(['server/pom.xml'], { pomOnlyAddsModules: true, addedModules: ['cot'] }).files).toContain('criteria/cot.spec.ts');
  expect(selectRun(['tests/integration/specs/flows/layers.spec.ts']).files).toContain('flows/layers.spec.ts');
  expect(selectRun(['tests/integration/specs/flows/gone.spec.ts'], { deleted: new Set(['tests/integration/specs/flows/gone.spec.ts']) }).files).toEqual(always());
  expect(selectRun(['tests/integration/specs/performance/map-view.spec.ts']).files).toEqual(always());
  expect(selectRun(['tests/integration/fixtures/plugins/ita-listener/src/ListenerPlugin.java']).files).toContain('tak/listener.spec.ts');
  expect(selectRun(['tests/integration/fixtures/data/m0/journal.jsonl']).files).toContain('live/persistence.spec.ts');
  for (const doc of ['docs/status.md', 'docs/test-reports/x.md', 'server/README.md', 'web/shell/README.md', 'agents/ita.md', '.claude/agents/x.md', 'requirements.md', 'documents/design/src/x.svg']) {
    expect(selectRun([doc]), doc).toMatchObject({ mode: 'quick', files: always() });
  }
});

test('real past merges get the run they should (git history of main)', () => {
  // pca-coordinates/settings-view-check (0f074ba): a plugin-only branch.
  const coordinates = selectForBranch('0f074ba^1', '0f074ba^2');
  expect(coordinates.mode).toBe('quick');
  // The @always files and those with the area @plugin-coordinates (more may join as specs are added).
  const ofCoordinates = specAreas().filter((s) => s.areas.includes('@plugin-coordinates')).map((s) => s.file);
  expect(ofCoordinates).toContain('flows/coordinates.spec.ts');
  expect(coordinates.files).toEqual([...new Set([...always(), ...ofCoordinates])].sort());
  // cda/settings-ux (673e4f9): the shell.
  expect(selectForBranch('673e4f9^1', '673e4f9^2').mode).toBe('full');
  // ita/cot-criteria's own changes (after its last merge of main): specs, but also shared test code.
  const cot = selectForBranch('ba26f2a', '8a49691');
  expect(cot.mode).toBe('full');
  expect(cot.reasons.filter(([, why]) => why.startsWith('FULL')).map(([path]) => path)).toEqual(['tests/integration/lib/cot.ts', 'tests/integration/performance-report.mjs']);
});
