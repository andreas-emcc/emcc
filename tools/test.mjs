// Runs all tests: Maven (server/), the npm workspaces at the repository root (web client and plugin web parts),
// the data model tests (model/), the plugins' own Node checks (plugins/<id>/check/*.test.mjs) and the tests of these tools.
// The workspaces' checks (eslint, tsc) run several at a time; their test runs one after another (tools/web-tests.mjs).
// Integration tests in tests/integration/ belong to the ITA and are started by that role.
// Usage: node tools/test.mjs
import { hasServer, hasWeb, modelSteps, pluginCheckFiles, root, runSteps, serverSteps, webSteps } from './lib.mjs';
import { runWebTests } from './web-tests.mjs';

if (!hasServer() && !hasWeb()) {
  console.log('Nothing to do: neither server/pom.xml nor the root package.json exists yet.');
  process.exit(0);
}
runSteps(serverSteps(['verify']));
if (hasWeb()) {
  runSteps(webSteps());
  const code = await runWebTests();
  if (code !== 0) {
    console.error(`\nFAILED: web tests (exit code ${code})`);
    process.exit(code);
  }
}
const checks = pluginCheckFiles();
runSteps([
  ...modelSteps(),
  // After the model's npm ci: the checks resolve Ajv from model/node_modules, as the data model's tests do.
  ...(checks.length > 0 ? [['plugin checks (node --test)', 'node', ['--test', ...checks], root]] : []),
  ['tools (node --test)', 'node', ['--test', 'tools/*.test.mjs', 'tools/demo/*.test.mjs'], root],
]);
console.log('\nOK');
