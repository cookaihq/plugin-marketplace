import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, type LoadedConfig } from '../src/config.js';
import { selectionPlan } from '../src/selection.js';

const cfg = (skill: string, models?: string[]): LoadedConfig => ({ skill, apiKey: 'fixture', baseUrl: 'https://fixture.invalid',
  sources: { AIHUB_API_KEY: 'fixture', AIHUB_BASE_URL: 'fixture' }, modelSelection: { policy: 'auto', models, sources: {} } });

test('model lists use caller-specific layering, replace lower lists and disclose sources', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aihub-selection-'));
  const home = join(dir, 'user'); const project = join(dir, 'project');
  await mkdir(project); await mkdir(join(home, '.config', 'aihub'), { recursive: true });
  const shared = join(home, '.config', 'aihub', '.env');
  const image = join(project, '.env.aihub-image');
  try {
    await writeFile(shared, 'AIHUB_API_KEY=fixture\nAIHUB_IMAGE_MODELS=a,b\nAIHUB_VIDEO_MODELS=c,d\nAIHUB_MODEL_FALLBACK_POLICY=confirm');
    await writeFile(image, 'AIHUB_IMAGE_MODELS=e,f\nAIHUB_MODEL_MAX_ATTEMPTS=2');
    const options = { cwd: project, homeDirectory: home, env: {} };
    const selected = loadConfig({ ...options, skill: 'aihub-image' });
    assert.deepEqual(selected.modelSelection?.models, ['e', 'f']);
    assert.equal(selected.modelSelection?.policy, 'confirm');
    assert.equal(selected.modelSelection?.maxAttempts, 2);
    assert.equal(selected.modelSelection?.sources.AIHUB_IMAGE_MODELS, image);
    assert.deepEqual(loadConfig({ ...options, skill: 'aihub-video' }).modelSelection?.models, ['c', 'd']);
    await writeFile(image, 'AIHUB_IMAGE_MODELS=" "');
    assert.deepEqual(loadConfig({ ...options, skill: 'aihub-image' }).modelSelection?.models, ['a', 'b']);
    assert.deepEqual(loadConfig({ ...options, skill: 'aihub-image', env: { AIHUB_IMAGE_MODELS: 'g' } }).modelSelection?.models, ['g']);
    const onlyKey = loadConfig({ ...options, skill: 'aihub-image', useGlobalConfig: false, env: { AIHUB_API_KEY: 'fixture' } });
    assert.equal(onlyKey.baseUrl, 'https://api.aihubmax.com');
    assert.equal(onlyKey.modelSelection?.policy, 'auto'); assert.equal(onlyKey.modelSelection?.models, undefined);
    for (const env of [{ AIHUB_IMAGE_MODELS: 'a,a' }, { AIHUB_IMAGE_MODELS: 'a,,b' }, { AIHUB_MODEL_FALLBACK_POLICY: 'unknown' }, { AIHUB_MODEL_MAX_ATTEMPTS: '0' }, { AIHUB_MODEL_MAX_ATTEMPTS: '1.5' }]) {
      assert.throws(() => loadConfig({ ...options, skill: 'aihub-image', useGlobalConfig: false, env: { AIHUB_API_KEY: 'fixture', ...env } }));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('explicit user models are fixed, configured order wins, builtin defaults remain task-specific', () => {
  const request = { operation: 'image-generate', original_request: 'A red cat', prompt: 'A red cat', image_priority: 'detail' };
  assert.equal(selectionPlan(cfg('aihub-image'), request).candidates[0]?.model, 'gpt-image-2.5-sunburst');
  const configured = cfg('aihub-image', ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);
  assert.equal(selectionPlan(configured, request).candidates[0]?.model, 'gpt-image-2.5-flare');
  const fixed = selectionPlan(configured, { ...request, model: 'gpt-image-2.5-sunburst' });
  assert.equal(fixed.policy, 'off'); assert.equal(fixed.source, 'user'); assert.equal(fixed.candidates.length, 1);
  assert.equal(selectionPlan(cfg('aihub-image'), { ...request, image_priority: 'speed' }).candidates.length, 1);
});

test('different video purposes and speech tasks never become interchangeable fallbacks', () => {
  const plan = selectionPlan(cfg('aihub-video', ['seedance-2.5-text-to-video', 'seedance-2.5-image-to-video', 'seedance-2.5-reference-to-video']), {
    operation: 'video-start-frame', original_request: 'Animate this as the first frame', prompt: 'Move forward', inputs: { images: ['https://fixture.invalid/frame.png'] },
  });
  assert.deepEqual(plan.candidates.map(c => c.model), ['seedance-2.5-image-to-video']);
  assert.equal(plan.candidates[0]?.params?.image_url, 'https://fixture.invalid/frame.png');
  assert.equal(plan.excluded.length, 2);
  const transcribe = selectionPlan(cfg('aihub-audio', ['speech-2.8-hd', 'paraformer-v2']), {
    operation: 'audio-transcribe', original_request: 'Transcribe this recording', inputs: { audios: ['https://fixture.invalid/recording.mp3'] },
  });
  assert.deepEqual(transcribe.candidates.map(c => c.model), ['paraformer-v2']);
  assert.deepEqual(transcribe.candidates[0]?.params?.file_urls, ['https://fixture.invalid/recording.mp3']);
});

test('every candidate is independently validated without dropping inputs or lowering requirements', () => {
  const plan = selectionPlan(cfg('aihub-video', ['seedance-2.5-image-to-video', 'seedance-2.0-image-to-video']), {
    operation: 'video-start-frame', original_request: '20 seconds', prompt: 'Move forward',
    inputs: { images: ['https://fixture.invalid/frame.png'] }, requirements: { duration: 20 },
  });
  assert.equal(plan.candidates[0]?.params?.duration, 20);
  assert.match(plan.candidates[1]?.rejection ?? '', /duration/);
  assert.equal(plan.candidates[1]?.params, undefined);
  const extra = selectionPlan(cfg('aihub-video'), { operation: 'video-start-frame', original_request: 'Use both frames', prompt: 'Move',
    inputs: { images: ['https://fixture.invalid/1.png', 'https://fixture.invalid/2.png'] } });
  assert.match(extra.candidates[0]?.rejection ?? '', /exactly one/);
  const unsupported = selectionPlan(cfg('aihub-image'), { operation: 'image-generate', original_request: 'Unknown quality field', prompt: 'x', requirements: { imaginary_quality: 'max' } });
  assert.match(unsupported.candidates[0]?.rejection ?? '', /imaginary_quality/);
});

test('unknown mappings, protocol changes and raw local paths are not silently accepted', () => {
  const unknown = selectionPlan(cfg('aihub-image', ['gpt-image-2']), { operation: 'image-generate', original_request: 'cat', prompt: 'cat' });
  assert.match(unknown.candidates[0]?.rejection ?? '', /verified/);
  const music = selectionPlan(cfg('aihub-music', ['lyria-3-pro-preview', 'lyria-3-pro']), { operation: 'music-async', original_request: 'music', prompt: 'music' });
  assert.deepEqual(music.candidates.map(c => c.model), ['lyria-3-pro']);
  assert.throws(() => selectionPlan(cfg('aihub-image'), { operation: 'image-edit', original_request: 'edit', prompt: 'edit', inputs: { images: ['/local/image.png'] } }), /remote HTTP/);
});
