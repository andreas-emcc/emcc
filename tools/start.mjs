// Starts the system locally with the no-login development profile (needs a prior build, which also assembles the
// installed plugins into build/plugins/). Usage: node tools/start.mjs
// The launcher module and the profile name are defined by the CDA (server/app/); adjust here
// once they exist.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, run } from './lib.mjs';

const target = join(root, 'server', 'app', 'target');
const jar = existsSync(target)
  ? readdirSync(target).find((f) => f.endsWith('.jar') && !f.endsWith('-sources.jar') && !f.startsWith('original-'))
  : undefined;

if (!jar) {
  console.error('No launcher jar found in server/app/target/. Run "node tools/build.mjs" first.');
  console.error('(server/app/ is created by the CDA in task T-010.)');
  process.exit(1);
}
const pluginsDir = join(root, 'build', 'plugins');
const pluginArgs = existsSync(pluginsDir) ? [`--emc2.plugins.directory=${pluginsDir}`] : [];
process.exit(run('start', 'java', ['-Dspring.profiles.active=dev', '-jar', join(target, jar), ...pluginArgs]));
