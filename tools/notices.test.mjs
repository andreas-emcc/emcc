// Tests for tools/notices.mjs: the pure parts (text cleaning, the EPL-2.0 cut, the fallback choice, labels, rendering).
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addNotes, clean, eplSection, EXTRA_NOTES, fallbackLicence, KEPT_TEXTS, keptTextFile, licenceLabel, render } from './notices.mjs';

test('clean unifies line ends and trims trailing spaces and blank edge lines', () => {
  assert.equal(clean('\r\n\nMIT License  \r\nCopyright (c) 2026 A\t\r\n\r\n'), 'MIT License\nCopyright (c) 2026 A');
});

test('eplSection keeps the EPL-2.0 part of a dual EPL-2.0 / GPL-2.0 file and drops the GPL part', () => {
  const dual = '# Eclipse Public License - v 2.0\n\n  1. DEFINITIONS\n  You may add notices.\n\n---\n\n##    The GNU General Public License (GPL) Version 2, June 1991\n\n  GPL text\n';
  const epl = eplSection(dual);
  assert.ok(epl.startsWith('# Eclipse Public License - v 2.0'));
  assert.ok(epl.endsWith('You may add notices.'));
  assert.ok(!epl.includes('GNU General Public License'));
  assert.equal(eplSection('MIT License\n...'), undefined);
});

test('fallbackLicence takes the first option of the expression that has a standard text', () => {
  const standard = { 'Apache-2.0': 'A', 'EPL-2.0': 'E' };
  assert.equal(fallbackLicence('EPL-2.0 OR LGPL-2.1-only', standard), 'EPL-2.0');
  assert.equal(fallbackLicence('(LGPL-2.1-only OR Apache-2.0)', standard), 'Apache-2.0');
  assert.equal(fallbackLicence('Apache-2.0', standard), 'Apache-2.0');
  assert.equal(fallbackLicence('MIT', standard), undefined, 'an MIT text needs its copyright line, so no standard text');
  assert.equal(fallbackLicence(undefined, standard), undefined);
});

test('licenceLabel names the option used when a package offers a choice', () => {
  assert.equal(licenceLabel({ license: 'MIT' }), 'MIT');
  assert.equal(licenceLabel({ license: 'EPL-2.0 OR GPL' }), 'EPL-2.0 (used option of: EPL-2.0 OR GPL)');
  assert.equal(licenceLabel({ license: 'GPL OR EPL-2.0' }), 'EPL-2.0 (used option of: GPL OR EPL-2.0)');
  assert.equal(licenceLabel({ license: 'EPL-2.0 OR LGPL-2.1-only', added: { licence: 'EPL-2.0' } }),
    'EPL-2.0 (no text in the package: standard text added; used option of: EPL-2.0 OR LGPL-2.1-only)');
  assert.match(licenceLabel({}), /see its text/);
});

test('render lists every package and prints each distinct set of texts once', () => {
  const mit = [{ file: 'LICENSE', text: 'MIT License\nCopyright (c) Meta' }];
  const packages = [
    { ecosystem: 'npm', name: 'react@19.3.0', license: 'MIT', texts: mit },
    { ecosystem: 'npm', name: 'react-dom@19.3.0', license: 'MIT', texts: mit },
    { ecosystem: 'maven', name: 'logback-core@1.5.38', license: 'EPL-2.0 OR LGPL-2.1-only', texts: [{ file: 'EPL-2.0 (standard text, added)', text: 'EPL TEXT' }],
      added: { licence: 'EPL-2.0', holder: 'QOS.ch', source: 'https://github.com/qos-ch/logback' } },
  ];
  const out = render(packages, { commit: 'abc1234', date: '2026-10-09' });
  assert.match(out, /commit abc1234, 2026-10-09/);
  assert.match(out, /Packages \(3\):/);
  assert.equal(out.match(/MIT License/g).length, 1, 'identical texts are printed once');
  assert.match(out, /\[\d\] react-dom@19\.3\.0, react@19\.3\.0/);
  assert.match(out, /logback-core@1\.5\.38 carries no licence text\. It is used under the EPL-2\.0/);
  assert.match(out, /Copyright holder: QOS\.ch\.\nSource: https:\/\/github\.com\/qos-ch\/logback/);
  assert.match(out, /runtime\/legal\//);
  assert.ok(out.indexOf('maven  logback-core') < out.indexOf('npm    react'), 'maven first, then npm, sorted');
});

test('keptTextFile names the kept text of a package by ecosystem and name, without the version', () => {
  assert.equal(keptTextFile({ ecosystem: 'maven', name: 'asm@9.7.1' }), 'maven-asm.txt');
  assert.equal(keptTextFile({ ecosystem: 'npm', name: '@scope/pkg@1.0.0' }), 'npm-@scope-pkg.txt');
});

test('the kept ASM text has its own copyright line and the BSD-3-Clause terms', () => {
  const file = join(KEPT_TEXTS, keptTextFile({ ecosystem: 'maven', name: 'asm@9.7.1' }));
  assert.ok(existsSync(file), file);
  const text = readFileSync(file, 'utf8');
  assert.match(text, /^ASM: a very small and fast Java bytecode manipulation framework\r?\nCopyright \(c\) 2000-2011 INRIA, France Telecom/);
  assert.match(text, /Neither the name of the copyright holders nor the names of its\s+contributors/);
});

test('a package with a kept text is labelled and rendered as such, not as a standard text', () => {
  const asm = { ecosystem: 'maven', name: 'asm@9.7.1', license: 'BSD-3-Clause', kept: true,
    texts: [{ file: 'maven-asm.txt (kept in tools/third-party-texts/)', text: 'ASM TEXT' }] };
  assert.equal(licenceLabel(asm), 'BSD-3-Clause (no text in the package: its own text kept in tools/third-party-texts/)');
  const out = render([asm], { commit: 'abc1234', date: '2026-10-11' });
  assert.match(out, /asm@9\.7\.1 carries no licence text\. Its own licence text, kept with emc2's build tools, follows\./);
  assert.match(out, /--- maven-asm\.txt \(kept in tools\/third-party-texts\/\) ---\n\nASM TEXT/);
  assert.ok(!out.includes('standard text is added'));
});

test('plugin data folders: an approved data set is found, any other one is not approved', async () => {
  const { mkdtempSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { checkData } = await import('./licenses.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'emc2-data-'));
  try {
    for (const id of ['basemap-naturalearth', 'other-map', 'no-data']) mkdirSync(join(dir, id), { recursive: true });
    mkdirSync(join(dir, 'basemap-naturalearth', 'data'));
    mkdirSync(join(dir, 'other-map', 'data'));
    const found = checkData(dir);
    assert.deepEqual(found.map((d) => [d.plugin, d.approved]), [['basemap-naturalearth', 'CR-0009'], ['other-map', undefined]]);
    assert.equal(found[0].license, 'Public domain');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the kept Natural Earth text names the version, the public domain and the credit', () => {
  const text = readFileSync(join(KEPT_TEXTS, 'data-natural-earth.txt'), 'utf8');
  assert.match(text, /version 5\.1\.2/);
  assert.match(text, /public domain/);
  assert.match(text, /Made with Natural Earth/);
});

test('CR-0029: mil-sym-ts gets its CC-BY-3.0 note beside its own LICENSE, and only a shipped mil-sym-ts gets it', () => {
  const milsym = { ecosystem: 'npm', name: '@armyc2.c5isr.renderer/mil-sym-ts-web@2.10.9', texts: [{ file: 'LICENSE', text: 'Apache' }] };
  const other = { ecosystem: 'npm', name: 'react@19.2.0', texts: [{ file: 'LICENSE', text: 'MIT' }] };
  assert.deepEqual(addNotes([milsym, other]), []);
  assert.equal(milsym.texts.length, 2);
  assert.equal(milsym.texts[0].file, 'LICENSE');
  assert.ok(milsym.texts[1].file.endsWith('cc-by-3.0-note.txt (kept in tools/third-party-texts/, CR-0029)'), milsym.texts[1].file);
  assert.ok(milsym.texts[1].text.includes('mdlGeodesic.IntersectLines'));
  assert.ok(milsym.texts[1].text.includes('https://creativecommons.org/licenses/by/3.0/'));
  assert.equal(other.texts.length, 1);
  assert.deepEqual(addNotes([]), []);
});

test('a missing note file is reported, not skipped', () => {
  const p = { ecosystem: 'npm', name: '@armyc2.c5isr.renderer/mil-sym-ts-web@2.10.9', texts: [] };
  assert.equal(addNotes([p], '/no/such/folder').length, EXTRA_NOTES.length);
});
