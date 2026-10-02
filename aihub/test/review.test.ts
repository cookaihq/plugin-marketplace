import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { loadConfig, inspectConfig } from '../src/config.js';
const exec = promisify(execFile);
const generator = 'gpt-image-2.5-flare';
const checker = 'gemini-3.8-flash';

async function fixture(audio = false) {
  const dir = await mkdtemp(join(tmpdir(), 'aihub-review-'));
  const file = join(dir, audio ? 'tone.wav' : 'red.png');
  await exec('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', audio ? 'sine=frequency=440:duration=1' : 'color=c=red:s=16x16',
    ...(audio ? [] : ['-frames:v', '1']), '-y', file]);
  const bytes = await readFile(file);
  const state = { generationPosts: 0, reviewPosts: 0, uploads: 0, queries: 0, modelQueries: 0,
    reviewMode: 'complete', reportMode: 'matched', errorStatus: 0, queryFail: false, visible: true,
    lastBody: {} as any, report: {} as any };
  let base = '';
  const server = createServer(async (req, res) => {
    const json = (value: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.url === '/v1/models') return json({ data: [{ id: generator }] });
    if (req.url === '/v1/configs/llm_generations_models') {
      state.modelQueries++;
      return json({ data: [{ id: 'text-only', capabilities: [] }, ...(state.visible ? [{ id: checker, capabilities: ['vision', 'audio', 'video', 'file'] }] : [])] });
    }
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      if (req.url === '/v1/files/upload/base64') {
        state.uploads++;
        assert.deepEqual(Buffer.from(body.file_data, 'base64'), bytes, 'review uploads the actual delivered file');
        return json({ id: 'uploaded-artifact', filename: body.file_name, url: `${base}/asset`, size: bytes.length, created: 0 });
      }
      if (req.url === '/v1/llm/generations') {
        state.reviewPosts++; state.lastBody = body;
        if (state.errorStatus) { res.setHeader('x-request-id', 'private-review-request'); return json({ error: { code: 'service_unavailable', message: 'fixture-review-secret https://private.invalid/?signature=hidden original prompt' } }, state.errorStatus); }
        const input = JSON.parse(body.messages[0].content[0].text);
        state.report = reportFor(input, state.reportMode, audio);
        return json({ id: 'private-review-task', model: checker, status: state.reviewMode === 'pending' ? 'pending' : 'completed',
          results: [{ text: state.reviewMode === 'invalid' ? 'not JSON' : JSON.stringify(state.report) }] });
      }
      state.generationPosts++;
      if (req.url?.startsWith('/v1beta/')) return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: bytes.toString('base64') } }] } }] });
      return json({ id: 'private-generation-task', model: generator, status: 'completed', results: [{ url: `${base}/asset` }] });
    }
    if (req.url?.startsWith('/v1/tasks/')) {
      state.queries++;
      if (state.queryFail) return json({ error: { code: 'permission_denied', message: 'no access' } }, 403);
      return json({ id: 'private-review-task', model: checker, status: state.reviewMode === 'pending' ? 'processing' : 'completed', results: [{ text: JSON.stringify(state.report) }] });
    }
    res.writeHead(200, { 'Content-Type': audio ? 'audio/wav' : 'image/png', 'Content-Length': bytes.length }); res.end(bytes);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = join(dir, 'request.json');
  await writeFile(request, JSON.stringify({ operation: audio ? 'music-native' : 'image-generate', original_request: audio ? '生成一段音乐' : '生成纯红色正方形，不要文字',
    prompt: audio ? 'A short tone' : 'Red square', review_requirements: [{ id: 'content', text: audio ? '确实含有音频' : '纯红色且无文字', priority: 'required' }] }));
  const call = async (env: Record<string, string>, ...args: string[]) => {
    let stdout: string;
    try { ({ stdout } = await exec(process.execPath, [resolve('scripts/aihub.mjs'), ...args, '--skill', audio ? 'aihub-music' : 'aihub-image', '--no-global-config'],
      { cwd: dir, env: { ...process.env, AIHUB_API_KEY: 'fixture-review-secret', AIHUB_BASE_URL: base,
        AIHUB_RESULT_CHECK_ENABLED: '1', AIHUB_RESULT_CHECK_PROVIDER: 'auto', AIHUB_RESULT_CHECK_MODELS: '', AIHUB_ERROR_REPORT_THRESHOLD: '3', ...env }, timeout: 20_000 })); }
    catch (error) { stdout = (error as { stdout: string }).stdout; }
    assert.ok(!stdout!.includes('fixture-review-secret'));
    return JSON.parse(stdout!);
  };
  return { dir, file, request, state, call, start: (env: Record<string, string> = {}) => call(env, 'run', '--request-file', request, '--output-dir', dir),
    close: async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(dir, { recursive: true, force: true }); } };
}
function reportFor(review: any, verdict = 'matched', audio = false): any {
  const ids = review.artifacts.map((a: any) => a.id);
  return { findings: review.requirements.map((r: any) => ({ requirement_id: r.id, verdict, evidence: ids.map((asset_id: string) => ({ asset_id,
    observation: audio ? '听到持续的音调' : '画面为红色正方形，没有可见文字', location: audio ? '0–1 秒' : '整张图片' })) })),
    coverage: [...ids, ...(review.sources ?? []).map((s: any) => s.id)].map(asset_id => ({ asset_id, complete: true, note: '实际观察全部素材', ...(audio ? { time_ranges: [[0, 1]], audio_checked: true } : {}) })) };
}
async function submit(f: Awaited<ReturnType<typeof fixture>>, result: any, report: any) {
  const path = join(f.dir, 'host-report.json'); await writeFile(path, JSON.stringify(report));
  return f.call({}, 'review-submit', '--record', result.run_record, '--review-token', result.result_check.review_token, '--review-file', path);
}
function notice(result: any) { assert.match(result.user_notice, /对话.*关闭结果检查/); }

test('default host review preserves Chinese requirements, binds real files and reminds on each completed delivery', async () => {
  const f = await fixture();
  try {
    const done = await f.start(); const review = done.result_check;
    assert.equal(done.status, 'delivered'); assert.equal(review.status, 'pending');
    assert.equal(review.original_request, '生成纯红色正方形，不要文字');
    assert.equal(review.artifacts[0].measurements.width, 16); assert.equal(review.artifacts[0].sha256.length, 64);
    assert.equal((await stat(review.review_record)).mode & 0o777, 0o600);
    const checked = await submit(f, done, reportFor(review));
    assert.equal(checked.status, 'matched'); notice(checked);
    const again = await f.call({}, 'continue', '--record', done.run_record);
    assert.equal(again.status, 'delivered'); notice(again.result_check);
    notice(await f.call({}, 'review', '--record', done.run_record));
    assert.equal(f.state.generationPosts, 1); assert.equal(f.state.reviewPosts, 0);
  } finally { await f.close(); }
});

test('disabled semantic checks make no review requests or reminders; optional config uses the actual field source', async () => {
  const f = await fixture();
  try {
    const done = await f.start({ AIHUB_RESULT_CHECK_ENABLED: '0', AIHUB_RESULT_CHECK_PROVIDER: 'aihub' });
    assert.equal(done.result_check.status, 'disabled'); assert.equal(done.result_check.user_notice, undefined);
    assert.equal(f.state.reviewPosts + f.state.modelQueries, 0);
    assert.equal(JSON.parse(await readFile(done.result_check.review_record, 'utf8')).status, 'disabled');
    const enabled = await f.call({}, 'review', '--record', done.run_record);
    assert.equal(enabled.status, 'pending'); assert.equal(f.state.reviewPosts + f.state.modelQueries, 0);
    await writeFile(join(f.dir, '.env.local'), 'AIHUB_API_KEY=synthetic\nAIHUB_RESULT_CHECK_MODELS=other,gemini-3.8-flash\nAIHUB_RESULT_CHECK_ENABLED=0');
    const options = { skill: 'aihub-image', cwd: f.dir, useGlobalConfig: false, env: {} };
    const cfg = loadConfig(options);
    assert.deepEqual(cfg.resultCheck?.models, ['other', checker]); assert.equal(cfg.resultCheck?.enabled, false);
    assert.equal(inspectConfig(options).fields.AIHUB_RESULT_CHECK_ENABLED?.source, join(f.dir, '.env.local'));
    assert.deepEqual(loadConfig({ ...options, env: { AIHUB_RESULT_CHECK_MODELS: checker } }).resultCheck?.models, [checker]);
    for (const [key, value] of [['AIHUB_RESULT_CHECK_ENABLED', 'true'], ['AIHUB_RESULT_CHECK_PROVIDER', 'fast'], ['AIHUB_RESULT_CHECK_MODELS', 'a,a'], ['AIHUB_ERROR_REPORT_THRESHOLD', '0'], ['AIHUB_SUPPORT_URL', 'https://u:pw@host/']]) {
      const invalid = inspectConfig({ ...options, env: { [key!]: value! } });
      assert.equal(invalid.status, 'configuration_required'); assert.ok(invalid.problems.some(p => p.key === key));
    }
  } finally { await f.close(); }
});

test('AIhub uses the first capable configured reviewer, uploads actual bytes, and submits once until explicit recheck', async () => {
  const f = await fixture();
  try {
    const cfg = { AIHUB_RESULT_CHECK_PROVIDER: 'aihub', AIHUB_RESULT_CHECK_MODELS: `text-only,${checker}` };
    const done = await f.start(cfg);
    assert.equal(done.result_check.status, 'matched'); notice(done.result_check);
    assert.equal(f.state.lastBody.model, checker); assert.equal(f.state.reviewPosts, 1); assert.equal(f.state.uploads, 1);
    await f.call(cfg, 'continue', '--record', done.run_record);
    await f.call(cfg, 'review', '--record', done.run_record);
    assert.equal(f.state.reviewPosts, 1);
    const rechecked = await f.call(cfg, 'review', '--record', done.run_record, '--recheck');
    assert.equal(rechecked.status, 'matched'); notice(rechecked);
    assert.equal(f.state.reviewPosts, 2); assert.equal(f.state.generationPosts, 1);
  } finally { await f.close(); }
});

test('review resumes its task after query errors and never submits a second review or generation', async () => {
  const f = await fixture();
  try {
    f.state.reviewMode = 'pending';
    const cfg = { AIHUB_RESULT_CHECK_PROVIDER: 'aihub' };
    const done = await f.start(cfg); assert.equal(done.result_check.status, 'checking');
    const disabled = await f.call({ ...cfg, AIHUB_RESULT_CHECK_ENABLED: '0' }, 'review', '--record', done.run_record);
    assert.equal(disabled.status, 'disabled'); assert.equal(disabled.user_notice, undefined);
    assert.equal((await f.call(cfg, 'review', '--record', done.run_record, '--wait-seconds', '0')).status, 'checking');
    assert.equal(f.state.reviewPosts, 1);
    const denied = await f.call(cfg, 'review', '--record', done.run_record, '--recheck');
    assert.equal(denied.status, 'recovery_failed');
    f.state.queryFail = true;
    const failed = await f.call(cfg, 'review', '--record', done.run_record, '--wait-seconds', '0');
    assert.equal(failed.status, 'checking'); assert.equal(failed.feedback.show_notice, true);
    f.state.queryFail = false; f.state.reviewMode = 'complete';
    const complete = await f.call(cfg, 'review', '--record', done.run_record, '--wait-seconds', '0');
    assert.equal(complete.status, 'matched'); notice(complete);
    assert.equal(f.state.reviewPosts, 1); assert.equal(f.state.generationPosts, 1);
  } finally { await f.close(); }
});

test('uncertain review submission remains unavailable with reminder and private diagnostic; never resubmits', async () => {
  const f = await fixture();
  try {
    f.state.errorStatus = 503;
    const cfg = { AIHUB_RESULT_CHECK_PROVIDER: 'aihub' };
    const done = await f.start(cfg);
    assert.equal(done.status, 'delivered'); assert.equal(done.result_check.status, 'unavailable'); notice(done.result_check);
    assert.equal(done.feedback.show_notice, true);
    const draft = await readFile(done.feedback.issue_draft, 'utf8');
    const privateReport = await readFile(done.feedback.diagnostic, 'utf8');
    for (const secret of ['fixture-review-secret', 'signature=hidden', 'private-review-request', 'private-generation-task', 'original prompt', f.dir]) assert.ok(!draft.includes(secret));
    assert.ok(privateReport.includes('private-review-request')); assert.ok(!privateReport.includes('fixture-review-secret'));
    const again = await f.call(cfg, 'review', '--record', done.run_record);
    assert.equal(again.feedback.show_notice, false); notice(again);
    assert.equal((await f.call(cfg, 'review', '--record', done.run_record, '--recheck')).status, 'recovery_failed');
    assert.equal(f.state.reviewPosts, 1); assert.equal(f.state.generationPosts, 1);
  } finally { await f.close(); }
});

test('invalid, mismatching and unavailable review results are separate from delivered files and all include reminders', async () => {
  for (const scenario of ['invalid', 'mismatched', 'invisible', 'host-unavailable']) {
    const f = await fixture();
    try {
      if (scenario === 'invalid') f.state.reviewMode = 'invalid';
      if (scenario === 'mismatched') f.state.reportMode = 'mismatched';
      if (scenario === 'invisible') f.state.visible = false;
      const done = await f.start({ AIHUB_RESULT_CHECK_PROVIDER: scenario === 'host-unavailable' ? 'host' : 'aihub' });
      const review = scenario === 'host-unavailable' ? await submit(f, done, { unavailable_reason: '当前宿主无法查看图片' }) : done.result_check;
      assert.equal(done.status, 'delivered');
      assert.equal(review.status, scenario === 'invalid' ? 'inconclusive' : scenario === 'mismatched' ? 'mismatched' : 'unavailable');
      notice(review); assert.equal(f.state.generationPosts, 1);
    } finally { await f.close(); }
  }
});

test('missing evidence, unknown items, edited requirements and changed files cannot produce a passing report', async () => {
  const f = await fixture();
  try {
    const done = await f.start();
    const report = reportFor(done.result_check);
    report.findings[0].evidence = [];
    assert.equal((await submit(f, done, report)).status, 'recovery_failed');
    const unknown = reportFor(done.result_check); unknown.findings[0].requirement_id = 'invented';
    assert.equal((await submit(f, done, unknown)).status, 'recovery_failed');
    const original = await readFile(done.result_check.review_record, 'utf8');
    const altered = JSON.parse(original); altered.requirements[0].text = '只要能打开文件就通过';
    await writeFile(done.result_check.review_record, JSON.stringify(altered));
    assert.equal((await submit(f, done, reportFor(done.result_check))).status, 'recovery_failed');
    await writeFile(done.result_check.review_record, original);
    const bytes = await readFile(done.files[0].path); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; await writeFile(done.files[0].path, bytes);
    const stale = await submit(f, done, reportFor(done.result_check));
    assert.equal(stale.status, 'recovery_failed'); assert.match(stale.error, /stale/);
  } finally { await f.close(); }
});

test('deterministic mismatch prevents a semantic pass; incomplete audio coverage stays inconclusive', async () => {
  const image = await fixture();
  try {
    const request = JSON.parse(await readFile(image.request, 'utf8')); request.requirements = { output_format: 'jpeg' };
    await writeFile(image.request, JSON.stringify(request));
    const done = await image.start({ AIHUB_RESULT_CHECK_PROVIDER: 'aihub' });
    assert.equal(done.status, 'delivered'); assert.equal(done.result_check.status, 'mismatched'); notice(done.result_check);
    assert.equal(image.state.reviewPosts, 0);
  } finally { await image.close(); }
  const audio = await fixture(true);
  try {
    const done = await audio.start(); const report = reportFor(done.result_check, 'matched', true);
    report.coverage[0].time_ranges = [[0, 0.2]];
    const partial = await submit(audio, done, report);
    assert.equal(partial.status, 'inconclusive'); notice(partial);
    assert.equal(audio.state.generationPosts, 1);
  } finally { await audio.close(); }
});
