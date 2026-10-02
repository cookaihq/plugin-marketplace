import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const cliUrl = new URL('../src/cli.js', import.meta.url).href;
const apiUrl = new URL('../src/apiClient.js', import.meta.url).href;
const configUrl = new URL('../src/config.js', import.meta.url).href;

/** Only the record commit fails; locks use the real filesystem in a temporary directory. */
async function persistenceFailure(mode: 'resume' | 'task') {
  const script = `
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AihubmaxClient, PollBudgetExceededError } from ${JSON.stringify(apiUrl)};
import { credentialId } from ${JSON.stringify(configUrl)};
import { main } from ${JSON.stringify(cliUrl)};
const mode = ${JSON.stringify(mode)};
const directory = await fsp.mkdtemp(join(tmpdir(), 'aihub-persistence-test-'));
const record = join(directory, 'task.json');
const key = 'synthetic-persistence-test-key';
const task = { id: 'already-paid-task', status: mode === 'resume' ? 'processing' : 'completed', model: 'gpt-image-2', results: [] };
const job = { schema_version: 1, local_id: 'fixture', skill: 'aihub-image', media: 'image', model: 'gpt-image-2',
  service_url: 'https://fixture.invalid', credential_id: credentialId(key), output_dir: join(directory, 'files'),
  submission: { state: 'known', task }, files: [], failed: [] };
if (mode === 'resume') await fsp.writeFile(record, JSON.stringify(job), { mode: 0o600 });
const originalRename = fsp.rename;
let saveAttempts = 0;
fsp.rename = async (from, to) => {
  if (String(to).endsWith('/task.json')) {
    saveAttempts++;
    throw Object.assign(new Error('simulated ENOSPC saving known task'), { code: 'ENOSPC' });
  }
  return originalRename(from, to);
};
syncBuiltinESMExports();
let posts = 0;
let queries = 0;
AihubmaxClient.prototype.submitGeneration = async () => { posts++; throw new Error('Unexpected paid submission'); };
AihubmaxClient.prototype.getTask = async () => { queries++; return task; };
AihubmaxClient.prototype.pollTask = async () => { queries++; throw new PollBudgetExceededError(task.id, task); };
process.env.AIHUB_API_KEY = key;
process.env.AIHUB_BASE_URL = 'https://fixture.invalid';
const args = mode === 'resume'
  ? ['resume', '--skill', 'aihub-image', '--record', record]
  : ['task', '--skill', 'aihub-image', '--task-id', task.id, '--media', 'image', '--output-dir', directory];
try {
  const code = await main([...args, '--no-global-config']);
  process.stderr.write(JSON.stringify({ code, posts, queries, saveAttempts, directory, expectedRecord: record }));
} finally {
  await fsp.rm(directory, { recursive: true, force: true });
}
`;
  const { stdout, stderr } = await execute(process.execPath, ['--input-type=module', '--eval', script], { timeout: 10_000 });
  return { output: JSON.parse(stdout) as Record<string, unknown>, observed: JSON.parse(stderr) as {
    code: number; posts: number; queries: number; saveAttempts: number; directory: string; expectedRecord: string;
  } };
}

test('resume preserves the paid task when saving at polling expiry fails', async () => {
  const { output, observed } = await persistenceFailure('resume');
  assert.equal(output.status, 'persistence_failed');
  assert.equal(output.task_id, 'already-paid-task');
  assert.equal(output.remote_status, 'processing');
  assert.equal(output.record, observed.expectedRecord);
  assert.match(String(output.error), /ENOSPC/);
  assert.equal(observed.code, 2);
  assert.equal(observed.posts, 0);
  assert.equal(observed.queries, 1);
  assert((observed.saveAttempts ?? 0) > 0);
});

test('adopting an existing task preserves its ID when the first record write fails', async () => {
  const { output, observed } = await persistenceFailure('task');
  assert.equal(output.status, 'persistence_failed');
  assert.equal(output.task_id, 'already-paid-task');
  assert.equal(output.remote_status, 'completed');
  assert(String(output.record).startsWith(`${observed.directory}/aihub-`));
  assert(String(output.record).endsWith('/task.json'));
  assert.match(String(output.error), /ENOSPC/);
  assert.equal(observed.code, 2);
  assert.equal(observed.posts, 0);
  assert.equal(observed.queries, 1);
  assert((observed.saveAttempts ?? 0) > 0);
});
