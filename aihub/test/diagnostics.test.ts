import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { AihubmaxClient } from '../src/apiClient.js';
import { collectRequestErrors, feedback } from '../src/diagnostics.js';
import { credentialId, type LoadedConfig } from '../src/config.js';

test('actual HTTP retries accumulate to the threshold; later success preserves files and reports only once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aihub-diagnostic-'));
  let calls = 0;
  const server = createServer((_req, res) => {
    calls++;
    res.writeHead(503, { 'Content-Type': 'application/json', 'x-request-id': `private-request-${calls}` });
    res.end(JSON.stringify({ error: { code: 'service_unavailable', message: 'test-private-key https://private.invalid/asset?token=secret user prompt /private/path' } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const cfg: LoadedConfig = { skill: 'aihub-image', apiKey: 'test-private-key', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    sources: { AIHUB_API_KEY: 'environment', AIHUB_BASE_URL: 'environment' } };
  try {
    const first = await collectRequestErrors(async events => {
      await assert.rejects(new AihubmaxClient(cfg).listLiveModels());
      return feedback(cfg, { status: 'preflight_failed', run_record: join(root, 'run.json'), attempted_models: ['gpt-image-2.5-flare'] }, events);
    });
    assert.equal(calls, 3); assert.equal(first!.upstream_error_count, 3); assert.equal(first!.show_notice, true);
    const draft = await readFile(String(first!.issue_draft), 'utf8');
    for (const value of ['test-private-key', credentialId(cfg.apiKey), 'private-request', '/private/path', 'user prompt', 'token=secret', cfg.baseUrl]) assert.ok(!draft.includes(value));
    const report = await readFile(String(first!.diagnostic), 'utf8');
    assert.ok(report.includes('private-request-1')); assert.ok(!report.includes('test-private-key'));
    assert.equal((await stat(String(first!.diagnostic))).mode & 0o777, 0o600);
    const success = { status: 'delivered', run_record: join(root, 'run.json'), files: [{ path: 'already-saved.png' }] };
    const second = await feedback(cfg, success, []);
    assert.equal(second!.upstream_error_count, 3); assert.equal(second!.show_notice, false);
    assert.equal(success.status, 'delivered'); assert.equal(success.files.length, 1);
    assert.match(await readFile(String(second!.issue_draft), 'utf8'), /任务状态: delivered/);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true }); }
});

test('terminal task errors are deduplicated across queries; capability/policy rejections are excluded', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aihub-terminal-report-'));
  let errorCode = 'model_unavailable';
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const id = req.url!.split('/').at(-1)!;
    res.end(JSON.stringify({ id, status: 'failed', error: { code: errorCode, message: 'Do not copy this raw response' } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const cfg: LoadedConfig = { skill: 'aihub-video', apiKey: 'test-secret', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    sources: { AIHUB_API_KEY: 'environment', AIHUB_BASE_URL: 'environment' } };
  try {
    const query = () => collectRequestErrors(async events => {
      await new AihubmaxClient(cfg).getTask('private-task-id');
      return feedback(cfg, { status: 'remote_failed', record: join(root, 'task.json') }, events);
    });
    const first = await query();
    assert.equal(first!.upstream_error_count, 1); assert.equal(first!.show_notice, true, 'terminal failure reports below threshold');
    const again = await query();
    assert.equal(again!.upstream_error_count, 1); assert.equal(again!.show_notice, false);
    for (const code of ['model_not_support_capability', 'content_policy_violation']) {
      errorCode = code;
      await collectRequestErrors(async events => {
        await new AihubmaxClient(cfg).getTask('other-task');
        assert.equal(events.length, 0);
      });
    }
    assert.ok(!(await readFile(String(first!.issue_draft), 'utf8')).includes('private-task-id'));
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true }); }
});
