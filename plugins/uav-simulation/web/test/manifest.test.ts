import { describe, expect, it } from 'vitest';
import { settingsHintsProblem, settingsTextProblem } from '@emc2/plugin-sdk';
import { manifestProblem } from '@emc2/plugin-sdk/build';
import manifest from '../../plugin.json' with { type: 'json' };

// uav-simulation has no settings yet: the two settings checks pass on none, and check them once it has some.
const { settings } = manifest as { settings?: unknown };

/**
 * The manifest guard (SDK 1.9.0, CR-0048 point 1; ADR-0060 point 2; D3). Keep it when you copy the
 * template: the manifest is valid against the data model's schema, every setting the form shows has a `title` and a `description`, every group a
 * `description`, and the `x-emc2` hints have the shape the SDK documents. ECore and the shell do not
 * check the texts, so this test is where a missing one is found.
 */
describe('the manifest', () => {
  it('is valid against the plugin manifest schema', () => {
    expect(manifestProblem(manifest)).toBeNull();
  });

  it('explains every setting and group (the texts rule)', () => {
    expect(settingsTextProblem(settings)).toBeNull();
  });

  it('has well-formed settings hints', () => {
    expect(settingsHintsProblem(settings)).toBeNull();
  });
});
