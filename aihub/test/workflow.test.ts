import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { readJob, writeJob, withJobLock } from '../src/state.js';
import { modelEntry, validateGeneration } from '../src/models.js';
import { credentialId } from '../src/config.js';
import { result } from '../src/workflow.js';

const exec = promisify(execFile);
const cli = resolve('scripts/aihub.mjs');
const key = 'offline-test-key-not-a-real-secret';
async function run(cwd: string, base: string, ...args: string[]) {
  const child = spawn(process.execPath, [cli, ...args, '--no-global-config'], { cwd, env: { ...process.env, AIHUB_API_KEY: key, AIHUB_BASE_URL: base }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', chunk => { out += chunk; });
  child.stderr.on('data', chunk => { err += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
  const [code] = await once(child, 'exit'); clearTimeout(timer);
  assert.ok(!out.includes(key) && !err.includes(key), 'credentials must not be logged');
  return { code, json: JSON.parse(out) as Record<string, any> };
}

test('new CLI persists a task and resumes it through partial download to verified delivery without another POST', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aihub-cli-'));
  const png = join(dir, 'fixture.png');
  await exec('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=16x16', '-frames:v', '1', '-y', png]);
  const image = await readFile(png);
  let posts = 0; let asset2 = false; let queryFails = true; let base = '';
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const json = (value: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.url === '/v1/models') return json({ data: [{ id: 'gpt-image-2' }] });
    if (req.method === 'POST') { posts++; return json({ id: 'test-task', status: 'pending', model: 'gpt-image-2' }); }
    if (req.url?.startsWith('/v1/tasks/')) {
      if (queryFails) return json({ error: { message: 'fixture query denied' } }, 403);
      return json({ id: 'test-task', status: 'completed', model: 'gpt-image-2', results: [{ url: `${base}/one.png` }, { video_url: `${base}/two.png` }] });
    }
    if (req.url === '/two.png' && !asset2) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length }); res.end(image);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const params = join(dir, 'request.json'); await writeFile(params, JSON.stringify({ prompt: 'A blue square' }));
  try {
    const missingRecord = join(dir, 'missing-task.json');
    const missing = await run(dir, base, 'resume', '--skill', 'aihub-image', '--record', missingRecord);
    assert.equal(missing.code, 2);
    assert.equal(missing.json.status, 'recovery_failed');
    assert.equal(missing.json.record, missingRecord);
    assert.equal(posts, 0);
    const alias = join(dir, 'plugin-alias');
    await symlink(resolve('.'), alias, 'dir');
    const refused = await run(dir, base, 'generate', '--skill', 'aihub-image', '--media', 'image', '--model', 'gpt-image-2', '--params-file', params, '--output-dir', join(alias, 'new-output'));
    assert.equal(refused.json.status, 'not_submitted'); assert.match(refused.json.error, /outside the Plugin installation/); assert.equal(posts, 0);
    const start = await run(dir, base, 'generate', '--skill', 'aihub-image', '--media', 'image', '--model', 'gpt-image-2', '--params-file', params, '--output-dir', dir);
    assert.equal(start.json.status, 'submitted'); assert.equal(start.json.task_id, 'test-task'); assert.equal(posts, 1);
    const record = start.json.record as string;
    assert.equal((await stat(record)).mode & 0o777, 0o600);
    assert.ok(!(await readFile(record, 'utf8')).includes(key));
    const failedQuery = await run(dir, base, 'resume', '--skill', 'aihub-image', '--record', record, '--wait-seconds', '0');
    assert.equal(failedQuery.json.status, 'query_failed'); assert.equal(failedQuery.json.task_id, 'test-task');
    queryFails = false;
    const partial = await run(dir, base, 'resume', '--skill', 'aihub-image', '--record', record, '--wait-seconds', '0');
    assert.equal(partial.json.status, 'partial'); assert.equal(partial.json.files.length, 1); assert.equal(partial.json.failed.length, 1);
    const keptPath = partial.json.files[0].path;
    asset2 = true;
    const done = await run(dir, base, 'resume', '--skill', 'aihub-image', '--record', record, '--wait-seconds', '0');
    assert.equal(done.json.status, 'delivered'); assert.equal(done.code, 0); assert.equal(done.json.files.length, 2);
    assert.equal(done.json.files[0].path, keptPath); assert.equal(posts, 1);
    const job = await readJob(record);
    job.submission = { state: 'submitting' };
    await writeJob(record, job);
    const interrupted = await run(dir, base, 'resume', '--skill', 'aihub-image', '--record', record);
    assert.equal(interrupted.json.status, 'submission_unknown'); assert.equal(posts, 1);
    await withJobLock(record, async () => {
      const locked = await run(dir, base, 'resume', '--skill', 'aihub-image', '--record', record);
      assert.match(locked.json.error, /in use/); assert.equal(posts, 1);
      assert.equal(locked.code, 2); assert.equal(locked.json.status, 'recovery_failed');
      assert.equal(locked.json.record, record);
    });
  } finally { server.closeAllConnections(); server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('generation rejects conflicting models and media before submission', () => {
  assert.throws(() => validateGeneration('image', 'gpt-image-2', { model: 'other', prompt: 'x' }), /conflicts/);
  assert.throws(() => validateGeneration('video', 'gpt-image-2', { prompt: 'x' }), /belongs/);
  assert.throws(() => validateGeneration('image', 'gpt-image-2', {}), /Missing required/);
  assert.throws(() => validateGeneration('image', 'gpt-4o-image', { prompt: 'x', image_urls: [42] }), /items must have type string/);
});

test('confirmed model aliases resolve and excluded workflows fail before submission', () => {
  for (const model of [
    'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst',
    'seedance-2.5-text-to-video', 'seedance-2.5-image-to-video',
    'seedance-2.5-reference-to-video', 'lipsync-2-pro', 'sync-3', 'fabric-1.0-fast',
    'seedance-2.0-text-to-video', 'seedance-2.0-image-to-video', 'seedance-2.0-reference-to-video',
    'seedance-2.0-fast-text-to-video', 'seedance-2.0-fast-image-to-video', 'seedance-2.0-fast-reference-to-video',
  ]) assert.doesNotThrow(() => modelEntry(model));
  assert.throws(() => modelEntry('sora-2-character'), /explicitly excluded/);
  assert.throws(() => modelEntry('veed-subtitles'), /outside the selected C scope/);
  assert.throws(() => modelEntry('topaz-upscale-video'), /upscaling and interpolation \(B10\) are explicitly excluded/);
  assert.throws(() => modelEntry('veo-3.1'), /Video generation defaults to Seedance 2.5/);
});

test('CLI rejects invalid Seedance 2.5 inputs before HTTP and never falls back to a visible 2.0 model', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aihub-model-validation-'));
  let requests = 0; let posts = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.method === 'POST') posts++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'seedance-2.0-text-to-video' }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const params = join(dir, 'request.json');
  const command = () => run(dir, base, 'generate', '--skill', 'aihub-video', '--media', 'video', '--model', 'seedance-2.5-text-to-video', '--params-file', params, '--output-dir', dir);
  try {
    await writeFile(params, JSON.stringify({ prompt: 'A moving blue circle', image_url: 'https://example.test/first.png' }));
    const invalid = await command();
    assert.equal(invalid.json.status, 'not_submitted'); assert.match(invalid.json.error, /image_url is not supported/);
    assert.equal(requests, 0);
    await writeFile(params, JSON.stringify({ prompt: 'A moving blue circle' }));
    const unavailable = await command();
    assert.equal(unavailable.json.status, 'not_submitted'); assert.match(unavailable.json.error, /exact model ID is not present/);
    assert.equal(requests, 1); assert.equal(posts, 0);
  } finally { server.closeAllConnections(); server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('legacy Seedance 2.0 records and task IDs remain recoverable without model lookup or resubmission', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aihub-legacy-video-'));
  const record = join(dir, 'legacy-task.json');
  const calls: Array<[string | undefined, string | undefined]> = [];
  const server = createServer((req, res) => {
    calls.push([req.method, req.url]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'legacy-task', model: 'seedance-2.0-fast-text-to-video', status: 'processing', progress: 42 }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await writeJob(record, {
      schema_version: 1, local_id: 'legacy', created_at: '2026-09-24', updated_at: '2026-09-24',
      skill: 'aihub-video', media: 'video', model: 'seedance-2.0-fast-text-to-video',
      service_url: base, credential_id: credentialId(key), output_dir: join(dir, 'files'),
      submission: { state: 'known', task: { id: 'legacy-task', status: 'pending' } }, files: [], failed: [],
    });
    const resumed = await run(dir, base, 'resume', '--skill', 'aihub-video', '--record', record, '--wait-seconds', '0');
    assert.equal(resumed.json.status, 'waiting'); assert.equal(resumed.json.task_id, 'legacy-task');
    assert.equal(resumed.json.model, 'seedance-2.0-fast-text-to-video'); assert.equal(resumed.json.progress, 42);
    const adopted = await run(dir, base, 'task', '--skill', 'aihub-video', '--task-id', 'legacy-task', '--media', 'video', '--output-dir', dir, '--wait-seconds', '0');
    assert.equal(adopted.json.status, 'waiting'); assert.equal(adopted.json.model, 'seedance-2.0-fast-text-to-video');
    assert.deepEqual(calls, [['GET', '/v1/tasks/legacy-task'], ['GET', '/v1/tasks/legacy-task']]);
  } finally { server.closeAllConnections(); server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('normal result output preserves task-specific metadata', () => {
  const output = result({
    schema_version: 1, local_id: 'local', created_at: 'now', updated_at: 'now',
    skill: 'aihub-video', media: 'video', model: 'seedance-2.0-text-to-video',
    service_url: 'https://example.test', credential_id: 'key', output_dir: '/tmp/files',
    submission: { state: 'known', task: {
      id: 'task', status: 'completed', model: 'seedance-2.0-text-to-video', seed: 17,
      degraded_reason: 'fallback', results: [{ url: 'https://example.test/result.mp4', resolution: '720p' }],
    } }, files: [{ url: 'https://example.test/result.mp4', path: '/tmp/files/result.mp4', bytes: 1, mime_type: 'video/mp4' }], failed: [],
  }, '/tmp/task.json');
  assert.deepEqual(output.result_metadata, { seed: 17, degraded_reason: 'fallback', resolution: '720p' });
});

test('CLI upload validates one source, transfers the local bytes, and never repeats an uncertain POST', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'aihub-upload-cli-'));
  const bytes = Buffer.from([0, 1, 2, 255, 128, 42]);
  const source = join(dir, 'reference.bin');
  const input = join(dir, 'upload.json');
  await writeFile(source, bytes);
  let base = '';
  let mode: 'ok' | 'disconnect' | '502' = 'ok';
  let requests = 0;
  const posts: Array<{ path: string | undefined; authorization: string | undefined; body: Record<string, unknown> }> = [];
  const server = createServer((req, res) => {
    requests++;
    if (req.method === 'GET' && req.url === '/files/uploaded.bin') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length });
      res.end(bytes);
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      posts.push({ path: req.url, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> });
      if (mode === 'disconnect') { res.destroy(); return; }
      if (mode === '502') { res.writeHead(502).end('{"error":{"message":"gateway failed after upload"}}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'uploaded-file', filename: 'reference.bin', url: `${base}/files/uploaded.bin`, size: bytes.length, created: 1 }));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const command = () => run(dir, base, 'upload', '--skill', 'aihub-image', '--input-file', input);
  try {
    await t.test('missing or multiple sources are rejected before any HTTP request', async () => {
      for (const invalid of [
        {}, { path: source, url: `${base}/source.bin` }, { path: source, base64: bytes.toString('base64') },
        { url: `${base}/source.bin`, base64: bytes.toString('base64') },
        { path: source, url: `${base}/source.bin`, base64: bytes.toString('base64') },
      ]) {
        await writeFile(input, JSON.stringify(invalid));
        const outcome = await command();
        assert.equal(outcome.code, 1);
        assert.equal(outcome.json.status, 'not_submitted');
        assert.match(outcome.json.error, /exactly one upload source/);
        assert.equal(requests, 0);
      }
    });
    await t.test('relative local file reaches the actual upload route with its bytes and filename', async () => {
      await writeFile(input, JSON.stringify({ path: 'reference.bin' }));
      const outcome = await command();
      assert.equal(outcome.code, 0);
      assert.equal(outcome.json.status, 'ok');
      assert.equal(outcome.json.id, 'uploaded-file');
      assert.equal(outcome.json.url, `${base}/files/uploaded.bin`);
      assert.equal(outcome.json.size, bytes.length);
      assert.equal(posts.length, 1);
      assert.equal(posts[0]!.path, '/v1/files/upload/base64');
      assert.equal(posts[0]!.authorization, `Bearer ${key}`);
      assert.equal(posts[0]!.body.file_name, 'reference.bin');
      assert.deepEqual(Buffer.from(String(posts[0]!.body.file_data), 'base64'), bytes);
      const file = await fetch(outcome.json.url, { signal: AbortSignal.timeout(2_000) });
      assert(file.ok);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
    });
    for (const failure of ['disconnect', '502'] as const) {
      await t.test(`upload ${failure} returns submission_unknown after only one POST`, async () => {
        mode = failure;
        const before = posts.length;
        await writeFile(input, JSON.stringify({ path: 'reference.bin' }));
        const outcome = await command();
        assert.equal(outcome.code, 2);
        assert.equal(outcome.json.status, 'submission_unknown');
        assert.equal(posts.length - before, 1);
        assert.equal(outcome.json.url, undefined);
      });
    }
  } finally {
    server.closeAllConnections(); server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI handles completed and failed submission responses without querying or submitting again', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'aihub-terminal-cli-'));
  const png = join(dir, 'fixture.png');
  await exec('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=16x16', '-frames:v', '1', '-y', png]);
  const image = await readFile(png);
  const params = join(dir, 'request.json');
  await writeFile(params, JSON.stringify({ prompt: 'A blue square' }));
  let base = '';
  let state: 'completed' | 'failed' = 'completed';
  let posts = 0;
  let taskQueries = 0;
  let downloads = 0;
  const server = createServer((req, res) => {
    const json = (value: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.url === '/v1/models') return json({ data: [{ id: 'gpt-image-2' }] });
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      posts++;
      req.resume();
      req.on('end', () => json({ id: `terminal-${state}`, status: state, model: 'gpt-image-2',
        ...(state === 'completed' ? { results: [{ url: `${base}/result.png` }] } : { error: { code: 'fixture_failure', message: 'Generation failed.' } }) }));
      return;
    }
    if (req.url?.startsWith('/v1/tasks/')) { taskQueries++; return json({ error: { message: 'Terminal task should not be queried.' } }, 400); }
    if (req.url === '/result.png') {
      downloads++;
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length }); res.end(image);
      return;
    }
    json({ error: { message: 'Unexpected fixture route.' } }, 404);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const command = () => run(dir, base, 'generate', '--skill', 'aihub-image', '--media', 'image', '--model', 'gpt-image-2', '--params-file', params, '--output-dir', dir, '--wait-seconds', '30');
  try {
    await t.test('completed response downloads and verifies the image before reporting delivery', async () => {
      const outcome = await command();
      assert.equal(outcome.code, 0);
      assert.equal(outcome.json.status, 'delivered');
      assert.equal(outcome.json.remote_status, 'completed');
      assert.equal(outcome.json.task_id, 'terminal-completed');
      assert.equal(outcome.json.files.length, 1);
      assert.equal(outcome.json.files[0].mime_type, 'image/png');
      assert.deepEqual(await readFile(outcome.json.files[0].path), image);
      const saved = await readJob(outcome.json.record);
      assert(saved.submission.state === 'known' && saved.submission.task.id === 'terminal-completed');
      assert.equal(posts, 1); assert.equal(taskQueries, 0); assert.equal(downloads, 1);
    });
    await t.test('failed response retains the task and remote error without claiming delivery', async () => {
      state = 'failed';
      const outcome = await command();
      assert.equal(outcome.code, 1);
      assert.equal(outcome.json.status, 'remote_failed');
      assert.equal(outcome.json.remote_status, 'failed');
      assert.equal(outcome.json.task_id, 'terminal-failed');
      assert.equal(outcome.json.error.code, 'fixture_failure');
      assert.equal(outcome.json.files.length, 0);
      const saved = await readJob(outcome.json.record);
      assert(saved.submission.state === 'known' && saved.submission.task.status === 'failed');
      assert.equal(posts, 2); assert.equal(taskQueries, 0); assert.equal(downloads, 1);
    });
  } finally {
    server.closeAllConnections(); server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('E1 rejects pure text before contacting the LLM model registry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aihub-understanding-'));
  const params = join(dir, 'request.json');
  await writeFile(params, JSON.stringify({ model: 'gemini-3.1-pro-preview', prompt: 'hello', content: [{ type: 'text', text: 'only text' }] }));
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.writeHead(500).end(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const outcome = await run(dir, base, 'understand', '--skill', 'aihub-understanding', '--params-file', params, '--output-dir', dir);
    assert.equal(outcome.code, 1);
    assert.equal(outcome.json.status, 'not_submitted');
    assert.match(outcome.json.error, /纯文本/);
    assert.equal(requests, 0);
    await writeFile(params, JSON.stringify({ model: 'gemini-3.1-pro-preview', prompt: 'describe', content: [{ type: 'image_url', image_url: 'https://example.test/image.png' }] }));
    const malformed = await run(dir, base, 'understand', '--skill', 'aihub-understanding', '--params-file', params, '--output-dir', dir);
    assert.equal(malformed.code, 1);
    assert.match(malformed.json.error, /内容块必须是/);
    assert.equal(requests, 0);
  } finally { server.closeAllConnections(); server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('E2 submits doc2x and delivers a validated ZIP without ffprobe', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aihub-document-'));
  const params = join(dir, 'request.json');
  await writeFile(params, JSON.stringify({ pdf_url: 'https://example.test/input.pdf', page_count: 1, convert_mode: 'md' }));
  const zip = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  let base = ''; let posts = 0; let body: Record<string, unknown> | undefined;
  const server = createServer((req, res) => {
    const json = (value: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.method === 'GET' && req.url === '/v1/models') return json({ data: [{ id: 'doc2x-v3' }] });
    if (req.method === 'POST' && req.url === '/v1/run/generations') {
      posts++;
      const chunks: Buffer[] = []; req.on('data', c => chunks.push(c)); req.on('end', () => { body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>; json({ id: 'doc-task', status: 'completed', model: 'doc2x-v3', results: [{ url: `${base}/result.zip` }] }); });
      return;
    }
    if (req.method === 'GET' && req.url === '/result.zip') { res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': zip.length }); res.end(zip); return; }
    json({ error: { message: 'unexpected fixture route' } }, 404);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const outcome = await run(dir, base, 'generate', '--skill', 'aihub-document', '--media', 'document', '--model', 'doc2x-v3', '--params-file', params, '--output-dir', dir);
    assert.equal(outcome.code, 0);
    assert.equal(outcome.json.status, 'delivered');
    assert.equal(outcome.json.files[0].mime_type, 'application/zip');
    assert.deepEqual(await readFile(outcome.json.files[0].path), zip);
    assert.equal(posts, 1);
    assert.equal(body?.model, 'doc2x-v3');
  } finally { server.closeAllConnections(); server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('D2 Gemini native music uses the separate endpoint and validates inline audio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aihub-native-music-'));
  const wav = join(dir, 'fixture.wav');
  await exec('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-y', wav]);
  const audio = (await readFile(wav)).toString('base64');
  const params = join(dir, 'request.json');
  await writeFile(params, JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'short piano phrase' }] }], generationConfig: { responseModalities: ['AUDIO'] } }));
  let pathSeen = '';
  const server = createServer((req, res) => {
    pathSeen = req.url ?? '';
    if (req.method === 'POST' && req.url === '/v1beta/models/lyria-3-pro-preview:generateContent') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: audio } }] } }] }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const outcome = await run(dir, base, 'native-music', '--skill', 'aihub-music', '--model', 'lyria-3-pro-preview', '--params-file', params, '--output-dir', dir);
    assert.equal(outcome.code, 0);
    assert.equal(outcome.json.status, 'delivered');
    assert.equal(outcome.json.files[0].mime_type, 'audio/wav');
    assert.deepEqual(await readFile(outcome.json.files[0].path), Buffer.from(audio, 'base64'));
    assert.equal(pathSeen, '/v1beta/models/lyria-3-pro-preview:generateContent');
  } finally { server.closeAllConnections(); server.close(); await rm(dir, { recursive: true, force: true }); }
});
