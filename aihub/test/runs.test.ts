import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
const exec = promisify(execFile);
const first = 'gpt-image-2.5-flare'; const second = 'gpt-image-2.5-sunburst';

async function fixture(skill = 'aihub-image') {
  const dir = await mkdtemp(join(tmpdir(), 'aihub-run-'));
  const imagePath = join(dir, 'image.png');
  await exec('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=16x16', '-frames:v', '1', '-y', imagePath]);
  const image = await readFile(imagePath);
  const state = { posts: [] as string[], firstVisible: true, firstStatus: 'failed', queryStatus: 'failed', rejection: 0, queryFailure: false, assetFailure: false,
    terminalCode: 'model_unavailable', nativeAudio: '' };
  let base = '';
  const server = createServer(async (req, res) => {
    const json = (value: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.url === '/v1/models') return json({ data: [first, second].filter(id => id !== first || state.firstVisible).map(id => ({ id })) });
    if (req.method === 'POST') {
      let text = ''; for await (const chunk of req) text += chunk;
      const body = JSON.parse(text);
      if (req.url?.startsWith('/v1beta/models/')) {
        state.posts.push('lyria-3-pro-preview');
        if (state.rejection) return json({ error: { code: 'service_unavailable' } }, state.rejection);
        return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: state.nativeAudio } }] } }] });
      }
      state.posts.push(body.model);
      if (body.model === first && state.rejection) return json({ error: { code: state.rejection === 422 ? 'model_not_support_capability' : 'fixture_failure' } }, state.rejection);
      return json({ id: body.model, model: body.model, status: body.model === first ? state.firstStatus : 'completed',
        ...(body.model === first && state.firstStatus === 'failed' ? { error: { code: state.terminalCode, type: 'task_error' } } : {}), results: [{ url: `${base}/image.png` }] });
    }
    if (req.url?.startsWith('/v1/tasks/')) {
      if (state.queryFailure) return json({ error: { message: 'fixture denied' } }, 403);
      const id = decodeURIComponent(req.url.split('/').at(-1)!);
      return json({ id, model: id, status: id === first ? state.queryStatus : 'completed',
        ...(id === first && state.queryStatus === 'failed' ? { error: { code: state.terminalCode, type: 'task_error' } } : {}), results: [{ url: `${base}/image.png` }] });
    }
    if (state.assetFailure) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length }); res.end(image);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = join(dir, 'request.json');
  await writeFile(request, JSON.stringify({ operation: 'image-generate', original_request: 'A red square', prompt: 'A red square' }));
  const call = async (options: Record<string, string>, ...args: string[]) => {
    const env = { ...process.env, AIHUB_API_KEY: 'fixture-run-secret', AIHUB_BASE_URL: base,
      AIHUB_IMAGE_MODELS: `${first},${second}`, AIHUB_MODEL_FALLBACK_POLICY: 'auto', AIHUB_MODEL_MAX_ATTEMPTS: '', ...options };
    let stdout: string; let stderr: string;
    try { ({ stdout, stderr } = await exec(process.execPath, [resolve('scripts/aihub.mjs'), ...args, '--skill', skill, '--no-global-config'], { cwd: dir, env, timeout: 20_000 })); }
    catch (error) { ({ stdout, stderr } = error as { stdout: string; stderr: string }); }
    assert.ok(!(stdout! + stderr!).includes('fixture-run-secret'));
    return JSON.parse(stdout!);
  };
  return { dir, request, state, call, start: (options: Record<string, string> = {}) => call(options, 'run', '--request-file', request, '--output-dir', dir),
    close: async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(dir, { recursive: true, force: true }); } };
}

test('real packaged CLI advances from terminal failure to the next model once and delivers actual files', async () => {
  const f = await fixture();
  try {
    const done = await f.start();
    assert.equal(done.status, 'delivered'); assert.deepEqual(f.state.posts, [first, second]);
    assert.equal(done.files.length, 1); assert.equal(done.model, second);
    const repeated = await f.call({}, 'continue', '--record', done.run_record, '--wait-seconds', '0');
    assert.equal(repeated.status, 'delivered'); assert.equal(f.state.posts.length, 2);
    assert.ok(!(await readFile(done.run_record, 'utf8')).includes('fixture-run-secret'));
  } finally { await f.close(); }
});

test('confirm persists the exact pending model and parameters across CLI processes', async () => {
  const f = await fixture();
  try {
    const pending = await f.start({ AIHUB_MODEL_FALLBACK_POLICY: 'confirm' });
    assert.equal(pending.status, 'confirmation_required'); assert.equal(pending.confirmation.model, second);
    assert.deepEqual(f.state.posts, [first]);
    const unchanged = await f.call({ AIHUB_MODEL_FALLBACK_POLICY: 'auto', AIHUB_IMAGE_MODELS: second }, 'continue', '--record', pending.run_record);
    assert.equal(unchanged.confirmation.token, pending.confirmation.token); assert.equal(f.state.posts.length, 1);
    const invalid = await f.call({}, 'continue', '--record', pending.run_record, '--confirm', 'wrong');
    assert.equal(invalid.status, 'recovery_failed'); assert.equal(f.state.posts.length, 1);
    const done = await f.call({}, 'continue', '--record', pending.run_record, '--confirm', pending.confirmation.token, '--wait-seconds', '0');
    assert.equal(done.status, 'delivered'); assert.deepEqual(f.state.posts, [first, second]);
  } finally { await f.close(); }
});

test('off, preflight_only and attempt limits prevent additional generation submissions', async () => {
  const policies: Array<Record<string, string>> = [{ AIHUB_MODEL_FALLBACK_POLICY: 'off' }, { AIHUB_MODEL_FALLBACK_POLICY: 'preflight_only' }, { AIHUB_MODEL_MAX_ATTEMPTS: '1' }];
  for (const options of policies) {
    const f = await fixture();
    try {
      const stopped = await f.start(options);
      assert.ok(['failed', 'attempt_limit'].includes(stopped.status)); assert.deepEqual(f.state.posts, [first]);
    } finally { await f.close(); }
  }
  const f = await fixture();
  try {
    f.state.firstVisible = false;
    const done = await f.start({ AIHUB_MODEL_FALLBACK_POLICY: 'preflight_only', AIHUB_MODEL_MAX_ATTEMPTS: '1' });
    assert.equal(done.status, 'delivered'); assert.deepEqual(f.state.posts, [second]);
  } finally { await f.close(); }
});

test('continue queries an accepted task and advances only after confirmed terminal failure', async () => {
  const f = await fixture();
  try {
    f.state.firstStatus = 'pending'; f.state.queryStatus = 'processing';
    const started = await f.start(); assert.equal(started.status, 'submitted');
    const waiting = await f.call({}, 'continue', '--record', started.run_record, '--wait-seconds', '0');
    assert.equal(waiting.status, 'waiting'); assert.deepEqual(f.state.posts, [first]);
    f.state.queryFailure = true;
    assert.equal((await f.call({}, 'continue', '--record', started.run_record, '--wait-seconds', '0')).status, 'query_failed');
    assert.deepEqual(f.state.posts, [first]);
    f.state.queryFailure = false; f.state.queryStatus = 'failed';
    const done = await f.call({}, 'continue', '--record', started.run_record, '--wait-seconds', '0');
    assert.equal(done.status, 'delivered'); assert.deepEqual(f.state.posts, [first, second]);
  } finally { await f.close(); }
});

test('ambiguous submissions, common auth failures and failed downloads never create replacement tasks', async () => {
  for (const status of [503, 401]) {
    const f = await fixture();
    try {
      f.state.rejection = status;
      const stopped = await f.start();
      assert.equal(stopped.status, status === 503 ? 'submission_unknown' : 'failed');
      await f.call({}, 'continue', '--record', stopped.run_record, '--wait-seconds', '0');
      assert.deepEqual(f.state.posts, [first]);
    } finally { await f.close(); }
  }
  const f = await fixture();
  try {
    f.state.firstStatus = 'completed'; f.state.queryStatus = 'completed'; f.state.assetFailure = true;
    const broken = await f.start(); assert.equal(broken.status, 'download_failed'); assert.deepEqual(f.state.posts, [first]);
    f.state.assetFailure = false;
    assert.equal((await f.call({}, 'continue', '--record', broken.run_record, '--wait-seconds', '0')).status, 'delivered');
    assert.deepEqual(f.state.posts, [first]);
  } finally { await f.close(); }
});

test('verified capability rejection permits fallback, modified plans invalidate saved approval', async () => {
  const f = await fixture();
  try {
    f.state.rejection = 422;
    assert.equal((await f.start()).status, 'delivered'); assert.deepEqual(f.state.posts, [first, second]);
    const pending = await f.start({ AIHUB_MODEL_FALLBACK_POLICY: 'confirm' });
    const record = JSON.parse(await readFile(pending.run_record, 'utf8'));
    record.plan.candidates[1].params.prompt = 'Changed without approval';
    await writeFile(pending.run_record, JSON.stringify(record));
    const failed = await f.call({}, 'continue', '--record', pending.run_record, '--confirm', pending.confirmation.token);
    assert.equal(failed.status, 'recovery_failed'); assert.match(failed.error, /modified run plan/);
    assert.equal(f.state.posts.length, 3);
    const another = await f.start({ AIHUB_MODEL_FALLBACK_POLICY: 'confirm' });
    const summary = JSON.parse(await readFile(another.run_record, 'utf8'));
    summary.confirmation.params.prompt = 'Displayed parameters differ from the request';
    await writeFile(another.run_record, JSON.stringify(summary));
    const invalidSummary = await f.call({}, 'continue', '--record', another.run_record, '--confirm', another.confirmation.token);
    assert.equal(invalidSummary.status, 'recovery_failed'); assert.match(invalidSummary.error, /confirmation no longer matches/);
    assert.equal(f.state.posts.length, 4);
  } finally { await f.close(); }
});

test('terminal policy, timeout and unknown service errors do not authorize another model', async () => {
  const f = await fixture();
  try {
    for (const code of ['content_policy_violation', 'timeout', 'service_unavailable', 'unknown_error']) {
      f.state.terminalCode = code;
      const count = f.state.posts.length;
      const stopped = await f.start();
      assert.equal(stopped.status, 'failed');
      await f.call({}, 'continue', '--record', stopped.run_record);
      assert.deepEqual(f.state.posts.slice(count), [first]);
    }
  } finally { await f.close(); }
});

test('native runs preflight before POST and preserve delivered or ambiguous outcomes on continuation', async () => {
  const f = await fixture('aihub-music');
  try {
    const audio = join(f.dir, 'music.wav');
    await exec('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-y', audio]);
    f.state.nativeAudio = (await readFile(audio)).toString('base64');
    await writeFile(f.request, JSON.stringify({ operation: 'music-native', original_request: 'Piano music', prompt: 'Piano music' }));
    const preflight = await f.start({ PATH: '' });
    assert.equal(preflight.status, 'preflight_failed'); assert.deepEqual(f.state.posts, []);
    const done = await f.call({}, 'continue', '--record', preflight.run_record);
    assert.equal(done.status, 'delivered'); assert.equal(done.files.length, 1);
    assert.equal((await f.call({}, 'continue', '--record', done.run_record)).status, 'delivered');
    assert.equal(f.state.posts.length, 1);
    f.state.rejection = 503;
    const unknown = await f.start();
    assert.equal(unknown.status, 'submission_unknown');
    assert.equal((await f.call({}, 'continue', '--record', unknown.run_record)).status, 'submission_unknown');
    assert.equal(f.state.posts.length, 2);
  } finally { await f.close(); }
});

test('music task recovery accepts its audio task ID without submitting generation', async () => {
  const f = await fixture('aihub-music');
  try {
    const result = await f.call({}, 'task', '--task-id', first, '--media', 'audio', '--output-dir', f.dir, '--wait-seconds', '0');
    assert.equal(result.status, 'remote_failed'); assert.equal(result.task_id, first);
    assert.deepEqual(f.state.posts, []);
  } finally { await f.close(); }
});
