import { cp, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await cp(new URL('../catalog/', import.meta.url), new URL('../.test-build/catalog/', import.meta.url), { recursive: true });
const tests = (await readdir(new URL('../.test-build/test/', import.meta.url))).filter(name => name.endsWith('.test.js')).map(name => `.test-build/test/${name}`);
const run = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit', timeout: 180_000 });
if (run.error) console.error(run.error.message);
process.exit(run.status ?? 1);
