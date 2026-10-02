import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectConfig, loadConfig, ConfigurationError } from '../src/config.js';
const exec = promisify(execFile);

test('inspection reports missing, invalid and unreadable sources without credential values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aihub-inspection-'));
  const options = { cwd: root, homeDirectory: join(root, 'home'), skill: 'aihub-image', env: {} };
  try {
    const missing = inspectConfig(options);
    assert.equal(missing.status, 'configuration_required');
    assert.deepEqual(missing.fields.AIHUB_API_KEY, { source: 'missing', present: false, problem: 'missing' });
    assert.equal(missing.fields.AIHUB_BASE_URL?.source, 'built-in default');
    const path = join(root, '.env.local');
    await writeFile(path, 'AIHUB_API_KEY=synthetic-inspection-key\nAIHUB_BASE_URL=https://account:synthetic-url-secret@host.invalid');
    const invalid = inspectConfig(options);
    assert.deepEqual(invalid.fields.AIHUB_BASE_URL, { source: path, present: true, problem: 'invalid_url' });
    for (const value of ['synthetic-inspection-key', 'synthetic-url-secret', 'account:']) assert.ok(!JSON.stringify(invalid).includes(value));
    assert.throws(() => loadConfig(options), (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      assert.deepEqual(error.inspection, invalid); return true;
    });
    const override = inspectConfig({ ...options, env: { AIHUB_API_KEY: 'process-synthetic-key' } });
    assert.equal(override.fields.AIHUB_API_KEY?.source, 'environment');
    assert.ok(!JSON.stringify(override).includes('process-synthetic-key'));
    await rm(path); await mkdir(path);
    const unreadable = inspectConfig(options);
    assert.ok(unreadable.problems.some(p => p.reason === 'unreadable' && p.source === path));
    const disabled = inspectConfig({ ...options, useGlobalConfig: false });
    assert.equal(disabled.layers.length, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI distinguishes authentication rejection from balance, permissions and rate limits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aihub-auth-sources-'));
  const config = join(root, '.env.local');
  let status = 401;
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'synthetic rejection', code: 'synthetic_error' } }));
  });
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = (server.address() as { port: number }).port;
  const env = { ...process.env, HOME: join(root, 'home'), USERPROFILE: join(root, 'home'), AIHUB_API_KEY: '', AIHUB_BASE_URL: '' };
  const cli = resolve('scripts/aihub.mjs');
  try {
    await writeFile(config, `AIHUB_API_KEY=synthetic-cli-secret\nAIHUB_BASE_URL=http://127.0.0.1:${port}`);
    // No media tools, credentials or network are needed for config-check itself.
    const inspected = await exec(process.execPath, [cli, 'config-check', '--skill', 'aihub-image'], { cwd: root, env: { ...env, PATH: '' } });
    assert.equal(JSON.parse(inspected.stdout).status, 'ok');
    assert.equal(requests, 0);
    for (const code of [401, 402, 403, 429]) {
      status = code;
      await assert.rejects(exec(process.execPath, [cli, 'models', '--skill', 'aihub-image', '--media', 'image'], { cwd: root, env, timeout: 20_000 }), (error: unknown) => {
        const stdout = (error as { stdout: string }).stdout;
        assert.ok(!stdout.includes('synthetic-cli-secret'));
        const output = JSON.parse(stdout);
        if (code === 401) {
          assert.equal(output.configuration_issue.reason, 'authentication_rejected');
          assert.deepEqual(output.configuration_issue.sources, { AIHUB_API_KEY: config, AIHUB_BASE_URL: config });
        } else assert.equal(output.configuration_issue, undefined);
        return true;
      });
    }
    await rm(config);
    await assert.rejects(exec(process.execPath, [cli, 'config-check', '--skill', 'aihub-image'], { cwd: root, env }), (error: unknown) => {
      const failed = error as { code: number; stdout: string };
      assert.equal(failed.code, 3);
      assert.equal(JSON.parse(failed.stdout).fields.AIHUB_API_KEY.source, 'missing');
      return true;
    });
  } finally {
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await rm(root, { recursive: true, force: true });
  }
});
