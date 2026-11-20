// Tests of tools/assemble-plugins.mjs: run by tools/test.mjs with "node --test".
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { assemblePlugins } from './assemble-plugins.mjs';

let base;
let source;
let out;

const write = (file, text = 'x') => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
};
const manifest = (id, extra = {}) => JSON.stringify({ id, name: id, version: '0.1.0', sdkVersion: '^0.1.0', kind: 'general', ...extra });

before(() => {
  base = mkdtempSync(join(tmpdir(), 'emc2-assemble-test-'));
  source = join(base, 'plugins');
  out = join(base, 'build', 'plugins');
});
after(() => rmSync(base, { recursive: true, force: true }));

describe('assemblePlugins', () => {
  test('assembles a plugin with a server and a web part as the design pattern describes', () => {
    const dir = join(source, 'both');
    write(join(dir, 'plugin.json'), manifest('both', { server: { entryClass: 'a.B' }, web: { entry: 'index.js', css: ['both.css'] } }));
    write(join(dir, 'web', 'dist', 'plugin.json'), manifest('both', { server: { entryClass: 'a.B' }, web: { entry: 'index.js', css: ['both.css'], shared: { react: '19.3.0' } } }));
    write(join(dir, 'web', 'dist', 'index.js'), 'js');
    write(join(dir, 'web', 'dist', 'both.css'), 'css');
    write(join(dir, 'web', 'dist', 'assets', 'logo.svg'), 'svg');
    write(join(dir, 'server', 'target', 'emc2-plugin-both-0.1.0.jar'), 'jar');
    write(join(dir, 'server', 'target', 'emc2-plugin-both-0.1.0-sources.jar'), 'src');
    write(join(dir, 'server', 'target', 'emc2-plugin-both-0.1.0-tests.jar'), 'tests');
    write(join(dir, 'server', 'target', 'original-emc2-plugin-both-0.1.0.jar'), 'orig');

    const result = assemblePlugins({ source, out });

    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.assembled, ['both']);
    assert.deepEqual(readdirSync(join(out, 'both', 'server')), ['emc2-plugin-both-0.1.0.jar']);
    assert.deepEqual(readdirSync(join(out, 'both', 'web')).sort(), ['assets', 'both.css', 'index.js']);
    assert.equal(JSON.parse(readFileSync(join(out, 'both', 'plugin.json'), 'utf8')).web.shared.react, '19.3.0', 'the built manifest with web.shared wins');
    assert.equal(existsSync(join(out, 'both', 'web', 'plugin.json')), false, 'plugin.json is not copied into web/');
  });

  test('skips folders that start with an underscore or a dot', () => {
    write(join(source, '_template', 'plugin.json'), manifest('template'));
    write(join(source, '.hidden', 'plugin.json'), manifest('hidden'));
    const result = assemblePlugins({ source, out });
    assert.deepEqual(result.skipped.sort(), ['.hidden', '_template']);
    assert.equal(existsSync(join(out, '_template')), false);
    assert.equal(existsSync(join(out, '.hidden')), false);
  });

  test('a manifest id that differs from the folder name is a problem and nothing is installed', () => {
    write(join(source, 'wrong', 'plugin.json'), manifest('other'));
    const result = assemblePlugins({ source, out });
    assert.equal(result.problems.some((p) => p.startsWith('wrong:') && p.includes('"other"')), true);
    assert.equal(existsSync(join(out, 'wrong')), false);
    rmSync(join(source, 'wrong'), { recursive: true });
  });

  test('a declared server part without a jar, or a web part without its entry, is a problem and nothing is installed', () => {
    write(join(source, 'nojar', 'plugin.json'), manifest('nojar', { server: { entryClass: 'a.B' } }));
    write(join(source, 'noweb', 'plugin.json'), manifest('noweb', { web: { entry: 'index.js' } }));
    const result = assemblePlugins({ source, out });
    assert.equal(result.problems.some((p) => p.startsWith('nojar:') && p.includes('no jar')), true);
    assert.equal(result.problems.some((p) => p.startsWith('noweb:') && p.includes('index.js')), true);
    assert.equal(existsSync(join(out, 'nojar')), false);
    assert.equal(existsSync(join(out, 'noweb')), false);
    rmSync(join(source, 'nojar'), { recursive: true });
    rmSync(join(source, 'noweb'), { recursive: true });
  });

  test('a folder without a manifest, or with a broken one, is a problem', () => {
    write(join(source, 'empty', 'readme.txt'));
    write(join(source, 'broken', 'plugin.json'), '{ not json');
    const result = assemblePlugins({ source, out });
    assert.equal(result.problems.some((p) => p.startsWith('empty:') && p.includes('no plugin.json')), true);
    assert.equal(result.problems.some((p) => p.startsWith('broken:') && p.includes('not valid JSON')), true);
    rmSync(join(source, 'empty'), { recursive: true });
    rmSync(join(source, 'broken'), { recursive: true });
  });

  test('the output folder is emptied first, so a removed plugin disappears', () => {
    write(join(out, 'stale', 'plugin.json'), manifest('stale'));
    assemblePlugins({ source, out });
    assert.equal(existsSync(join(out, 'stale')), false);
    assert.equal(existsSync(join(out, 'both')), true);
  });

  test('a missing source folder gives an empty output and no problem', () => {
    const result = assemblePlugins({ source: join(base, 'does-not-exist'), out: join(base, 'out2') });
    assert.deepEqual(result, { assembled: [], skipped: [], problems: [] });
  });
});
