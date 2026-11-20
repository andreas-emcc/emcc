// Tests for tools/version-file.mjs: the release's version.properties (owner ACQ).
import assert from 'node:assert/strict';
import test from 'node:test';
import { versionProperties } from './version-file.mjs';

test('the version file names the release, its build and the SDK', () => {
  const text = versionProperties({ milestone: 'M9-RC1', day: '2026-11-18', commit: 'ea32e90f', dirty: false, sdk: '1.9.0' });
  assert.match(text, /^emcc\.version=M9-RC1$/m);
  assert.match(text, /^emcc\.build\.date=2026-11-18$/m);
  assert.match(text, /^emcc\.build\.commit=ea32e90f$/m);
  assert.match(text, /^emcc\.build\.dirty=false$/m);
  assert.match(text, /^emcc\.sdk\.version=1\.9\.0$/m);
});

test('CRLF on request, and a value that is not a plain name is refused', () => {
  const text = versionProperties({ milestone: 'snapshot', day: '2026-11-18', commit: 'abc1234', dirty: true, sdk: '1.9.0' }, '\r\n');
  assert.ok(!/[^\r]\n/.test(text));
  assert.match(text, /emcc\.build\.dirty=true/);
  assert.throws(() => versionProperties({ milestone: 'M9 RC1', day: '2026-11-18', commit: 'x', dirty: false, sdk: '1.9.0' }), /milestone/);
});
