import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, parseEnv, sanitized } from '../src/config.js';

test('Plugin global files are automatic, with project, Skill and process overrides', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aihub-config-'));
  const project = join(dir, 'project');
  const home = join(dir, 'user');
  await mkdir(project);
  const plugin = join(home, '.config', 'aihub');
  const ordinary = join(home, '.config', 'aihub-image');
  await mkdir(join(plugin, 'aihub-image'), { recursive: true });
  await mkdir(ordinary, { recursive: true });
  try {
    const options = { skill: 'aihub-image', cwd: project, homeDirectory: home, env: {} };
    await writeFile(join(ordinary, '.env'), 'AIHUB_API_KEY=ordinary-key\nAIHUB_BASE_URL=https://ordinary.invalid');
    await writeFile(join(plugin, '.env'), 'AIHUB_API_KEY=shared-home-key\nAIHUB_BASE_URL=https://fixture.invalid');
    for (const skill of ['aihub-image', 'aihub-video', 'aihub-audio', 'aihub-music', 'aihub-understanding', 'aihub-document']) {
      assert.equal(loadConfig({ ...options, skill }).apiKey, 'shared-home-key');
    }
    // Add increasingly specific sources, then remove them to check both override and fallback.
    const overrides = [
      [join(plugin, '.env.local'), 'shared-local-key'],
      [join(plugin, '.env.aihub-image'), 'flat-image-key'],
      [join(plugin, 'aihub-image', '.env'), 'image-directory-key'],
      [join(plugin, 'aihub-image', '.env.local'), 'image-directory-local-key'],
      [join(project, '.env'), 'project-key'],
      [join(project, '.env.local'), 'project-local-key'],
      [join(project, '.env.aihub-image'), 'project-image-key'],
    ] as const;
    for (const [path, key] of overrides) {
      await writeFile(path, `AIHUB_API_KEY=${key}\nAIHUB_BASE_URL=""`);
      const config = loadConfig(options);
      assert.equal(config.apiKey, key);
      assert.equal(config.sources.AIHUB_API_KEY, path);
      assert.equal(config.baseUrl, 'https://fixture.invalid');
      assert.equal(config.sources.AIHUB_BASE_URL, join(plugin, '.env'));
    }
    assert.equal(loadConfig({ ...options, env: { AIHUB_API_KEY: 'process-key' } }).apiKey, 'process-key');
    assert.equal(loadConfig({ ...options, skill: 'aihub-video' }).apiKey, 'project-local-key');
    for (let i = overrides.length - 1; i >= 0; i--) {
      await writeFile(overrides[i]![0], 'AIHUB_API_KEY=""');
      assert.equal(loadConfig(options).apiKey, i ? overrides[i - 1]![1] : 'shared-home-key');
      await rm(overrides[i]![0]);
    }
    assert.equal(loadConfig(options).apiKey, 'shared-home-key', 'an empty Skill directory must not hide shared values');
    assert.equal(loadConfig({ ...options, useGlobalConfig: true }).apiKey, 'shared-home-key');
    assert.throws(() => loadConfig({ ...options, useGlobalConfig: false }), /Missing AIHUB_API_KEY/);
    assert.equal(loadConfig({ ...options, useGlobalConfig: false, env: { AIHUB_API_KEY: 'process-only' } }).baseUrl, 'https://api.aihubmax.com');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ordinary Skill globals fill missing fields when Plugin files are absent, partial or empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aihub-config-fallback-'));
  const project = join(dir, 'project');
  const home = join(dir, 'user');
  const plugin = join(home, '.config', 'aihub');
  const ordinary = join(home, '.config', 'aihub-image', '.env');
  await mkdir(project);
  await mkdir(join(home, '.config', 'aihub-image'), { recursive: true });
  try {
    const options = { skill: 'aihub-image', cwd: project, homeDirectory: home, env: {} };
    await writeFile(ordinary, 'AIHUB_API_KEY=ordinary-key\nAIHUB_BASE_URL=https://ordinary.invalid');
    const fallback = loadConfig(options);
    assert.equal(fallback.apiKey, 'ordinary-key');
    assert.equal(fallback.baseUrl, 'https://ordinary.invalid');
    assert.deepEqual(fallback.sources, { AIHUB_API_KEY: ordinary, AIHUB_BASE_URL: ordinary });

    await mkdir(join(plugin, 'aihub-image'), { recursive: true });
    assert.deepEqual(loadConfig(options), fallback, 'empty Plugin and Skill directories must not stop fallback');
    const shared = join(plugin, '.env');
    await writeFile(shared, 'AIHUB_BASE_URL=https://plugin.invalid');
    const missingKey = loadConfig(options);
    assert.equal(missingKey.apiKey, 'ordinary-key');
    assert.equal(missingKey.baseUrl, 'https://plugin.invalid');
    assert.deepEqual(missingKey.sources, { AIHUB_API_KEY: ordinary, AIHUB_BASE_URL: shared });

    await writeFile(shared, 'AIHUB_API_KEY=plugin-key\nAIHUB_BASE_URL=""');
    const emptyUrl = loadConfig(options);
    assert.equal(emptyUrl.apiKey, 'plugin-key');
    assert.equal(emptyUrl.baseUrl, 'https://ordinary.invalid');
    assert.deepEqual(emptyUrl.sources, { AIHUB_API_KEY: shared, AIHUB_BASE_URL: ordinary });

    await writeFile(shared, 'AIHUB_API_KEY=" "\nAIHUB_BASE_URL=""');
    assert.deepEqual(loadConfig(options), fallback, 'empty values must not hide the ordinary Skill file');
    assert.throws(() => loadConfig({ ...options, useGlobalConfig: false }), /Missing AIHUB_API_KEY/);
    await rm(ordinary);
    assert.throws(() => loadConfig(options), /Missing AIHUB_API_KEY/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Skill globals ignore other files, sibling Skills, aliases, Plugin names and parent directories', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aihub-config-isolation-'));
  const project = join(dir, 'project');
  const home = join(dir, 'user');
  const plugin = join(home, '.config', 'aihub');
  await mkdir(project);
  await mkdir(join(plugin, 'aihub-image'), { recursive: true });
  await mkdir(join(home, '.config', 'aihub-image'), { recursive: true });
  await mkdir(join(home, '.config', 'aihub-video'), { recursive: true });
  await mkdir(join(home, '.config', 'aihub-video-legacy'), { recursive: true });
  await mkdir(join(home, '.config', 'other-plugin'), { recursive: true });
  try {
    await writeFile(join(dir, '.env'), 'AIHUB_API_KEY=parent-key');
    await writeFile(join(home, '.config', 'aihub-video', '.env.local'), 'AIHUB_API_KEY=ignored-local-key');
    await writeFile(join(home, '.config', 'aihub-video', '.env.backup'), 'AIHUB_API_KEY=ignored-backup-key');
    await writeFile(join(home, '.config', 'aihub-image', '.env'), 'AIHUB_API_KEY=other-skill-key');
    await writeFile(join(home, '.config', 'aihub-video-legacy', '.env'), 'AIHUB_API_KEY=alias-key');
    await writeFile(join(home, '.config', 'other-plugin', '.env'), 'AIHUB_API_KEY=other-plugin-key');
    await writeFile(join(plugin, 'aihub-image', '.env'), 'AIHUB_API_KEY=image-directory-key');
    await writeFile(join(plugin, '.env.aihub-image'), 'AIHUB_API_KEY=image-file-key');
    await writeFile(join(plugin, '.env.backup'), 'AIHUB_API_KEY=backup-key');
    await writeFile(join(project, '.env.aihub-image'), 'AIHUB_API_KEY=image-project-key');
    const options = { skill: 'aihub-video', cwd: project, homeDirectory: home, env: {} };
    assert.throws(() => loadConfig(options), /Missing AIHUB_API_KEY/);
    const ordinary = join(home, '.config', 'aihub-video', '.env');
    await writeFile(ordinary, 'AIHUB_API_KEY=video-key');
    assert.equal(loadConfig(options).apiKey, 'video-key');
    assert.equal(loadConfig(options).sources.AIHUB_API_KEY, ordinary);
    await writeFile(join(plugin, '.env'), 'AIHUB_API_KEY=shared-key');
    assert.equal(loadConfig(options).apiKey, 'shared-key');
    assert.throws(() => loadConfig({ ...options, skill: '../other-plugin' }), /valid caller Skill/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unreadable global files fail clearly, and disabling globals skips them entirely', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aihub-config-errors-'));
  const home = join(dir, 'user');
  const paths = [join(home, '.config', 'aihub', '.env'), join(home, '.config', 'aihub-image', '.env')];
  // A directory at a file path is an actual read failure in either global directory.
  for (const path of paths) await mkdir(path, { recursive: true });
  try {
    const options = { skill: 'aihub-image', cwd: dir, homeDirectory: home, env: { AIHUB_API_KEY: 'process-key' } };
    for (const path of paths) {
      assert.throws(() => loadConfig(options), { message: `Cannot read configuration file: ${path}` });
      assert.equal(loadConfig({ ...options, useGlobalConfig: false }).apiKey, 'process-key');
      await rm(path, { recursive: true });
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('dotenv is literal, uses last duplicate, and only reads declared variables', () => {
  assert.deepEqual(parseEnv('# comment\nAIHUB_API_KEY=first\nAIHUB_API_KEY="$(echo literal)${TEST}"\nPATH=/bad\nAIHUB_BASE_URL = \'https://example.invalid\''), {
    AIHUB_API_KEY: '$(echo literal)${TEST}', AIHUB_BASE_URL: 'https://example.invalid',
  });
});

test('sanitization handles quotes, nested values and remote credential fields', () => {
  const key = 'key-"with-quotes';
  assert.deepEqual(sanitized({ message: `Echo ${key}`, nested: [{ authorization: 'Bearer other', api_key: key }] }, [key]), {
    message: 'Echo [redacted]', nested: [{ authorization: '[redacted]', api_key: '[redacted]' }],
  });
});
