// Tests for tools/sdk-kit.mjs: the SDK kit of M9 B5 (G1, G20).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { root } from './lib.mjs';
import { flatPom, installBat, installSh, kitReadme, kitTemplateFiles, managedVersions, RUNTIME_MODULES, sdkVersions } from './sdk-kit.mjs';

const read = (...p) => readFileSync(join(root, ...p), 'utf8');

test('the Java and web SDKs have one version', () => {
  const { maven, web } = sdkVersions();
  assert.match(web, /^\d+\.\d+\.\d+$/);
  assert.equal(maven.replace(/-SNAPSHOT$/, ''), web);
});

test('the flattened SDK POM has no parent and pins its own dependencies, not the test ones', () => {
  const versions = sdkVersions();
  const pom = flatPom(read('server', 'plugin-sdk', 'api', 'pom.xml'), versions);
  assert.ok(!pom.includes('<parent>'));
  assert.match(pom, /<artifactId>emc2-plugin-sdk<\/artifactId>\s*<version>[^<]+<\/version>/);
  assert.match(pom, /<artifactId>jspecify<\/artifactId>\s*<version>\d[^<]*<\/version>/);
  assert.match(pom, /<artifactId>GeographicLib-Java<\/artifactId>\s*<version>2\.1<\/version>/);
  assert.ok(!/junit|assertj|archunit/.test(pom), 'no test dependencies');
  assert.ok(!pom.includes('${'), 'no unresolved property');
});

test('the flattened test kit POM depends on this SDK and takes JUnit\'s version from its BOM', () => {
  const versions = sdkVersions();
  const pom = flatPom(read('server', 'plugin-sdk', 'testkit', 'pom.xml'), versions);
  assert.match(pom, new RegExp(`<artifactId>emc2-plugin-sdk</artifactId>\\s*<version>${versions.maven.replace(/\./g, '\\.')}</version>`));
  const junit = managedVersions().byBomGroup['org.junit'];
  assert.match(pom, new RegExp(`<artifactId>junit-jupiter-api</artifactId>\\s*<version>${junit.replace(/\./g, '\\.')}</version>`));
  assert.match(pom, /<artifactId>archunit<\/artifactId>/);
  assert.ok(!/assertj|<artifactId>junit-jupiter<\/artifactId>/.test(pom), 'no test dependencies');
  assert.ok(!pom.includes('${'));
});

test('the plugin parent stands alone, so the kit ships it as it is', () => {
  const pom = read('server', 'plugin-sdk', 'plugin-parent', 'pom.xml');
  assert.ok(!pom.includes('<parent>'));
});

test('the template\'s repository paths point at the kit, and only those change', () => {
  const versions = sdkVersions();
  const files = Object.fromEntries(['server/pom.xml', 'web/vite.config.ts', 'web/package.json']
    .map((f) => [f, read('plugins', '_template', ...f.split('/'))]));
  const out = kitTemplateFiles(versions, files);
  assert.match(out['server/pom.xml'], /<relativePath\/>/);
  assert.ok(!out['server/pom.xml'].includes('server/plugin-sdk/plugin-parent'));
  assert.ok(out['web/vite.config.ts'].includes("'../../web/importmap.json'"));
  const pkg = JSON.parse(out['web/package.json']);
  assert.equal(pkg.devDependencies['@emc2/plugin-sdk'], `file:../../web/emc2-plugin-sdk-${versions.web}.tgz`);
  assert.equal(pkg.peerDependencies['@emc2/plugin-sdk'], versions.web);
  assert.throws(() => kitTemplateFiles(versions, { ...files, 'web/vite.config.ts': 'nothing' }), /expected/);
});

test('the readme lists the runtime\'s Java modules (G20); release.mjs uses the same list', () => {
  const readme = kitReadme(sdkVersions());
  for (const m of RUNTIME_MODULES) assert.ok(readme.includes(`\`${m}\``), m);
  assert.ok(read('tools', 'release.mjs').includes('RUNTIME_MODULES'));
});

test('the install scripts copy maven/ into the local repository', () => {
  assert.ok(installBat().includes('%USERPROFILE%\\.m2\\repository'));
  assert.ok(!/[^\r]\n/.test(installBat()), 'CRLF');
  assert.ok(installSh().includes('$HOME/.m2/repository'));
});
