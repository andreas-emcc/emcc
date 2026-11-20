// Builds everything: the Maven modules in server/, the npm workspaces at the repository root (web client and
// plugin web parts, CR-0006), then assembles the installed layout of the plugins into build/plugins/ and writes
// the third-party notices to build/THIRD-PARTY-NOTICES.txt (T-028). A shipped package without a licence text
// fails the build.
// Usage: node tools/build.mjs
import { assembleRepositoryPlugins } from './assemble-plugins.mjs';
import { runAll, serverSteps, webSteps } from './lib.mjs';
import { writeNotices } from './notices.mjs';

runAll(
  [
    ...serverSteps(['-DskipTests', 'package']),
    ...webSteps(['run', 'build', '--workspaces', '--if-present']),
  ],
  () => [...assembleRepositoryPlugins(), ...writeNotices()],
);
