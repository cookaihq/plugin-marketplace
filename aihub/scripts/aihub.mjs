#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const minimum = Number(/^>=(\d+)$/.exec(pkg.engines.node)?.[1]);
if (!Number.isSafeInteger(minimum) || Number(process.versions.node.split('.')[0]) < minimum) {
  console.error(JSON.stringify({ schema_version: 1, status: 'not_submitted', error: `Node ${pkg.engines.node} is required; current ${process.version}. Install Node: brew install node` }));
  process.exit(1);
}
// Published dist uses only Node built-ins: no runtime package installation or transpilation.
try {
  const { main } = await import('../dist/cli.js');
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(JSON.stringify({ schema_version: 1, status: 'not_submitted', error: `AIhub installation is incomplete: ${error.code || error.name}. Reinstall the complete Plugin; maintainers can run npm ci && npm run build in the Plugin source directory.` }));
  process.exitCode = 1;
}
