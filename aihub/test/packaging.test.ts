import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

test('published Plugin runs outside the checkout without node_modules or original MCP', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'aihub-package-'));
  const plugin = join(temp, 'aihub');
  try {
    for (const part of ['package.json', 'scripts', 'dist', 'catalog', 'skills', 'references', '.codex-plugin', '.claude-plugin', '.codebuddy-plugin', 'LICENSE']) {
      await cp(resolve(part), join(plugin, part), { recursive: true });
    }
    for (const model of ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst',
      'seedance-2.5-text-to-video', 'seedance-2.5-image-to-video', 'seedance-2.5-reference-to-video']) {
      const media = model.startsWith('seedance-') ? 'video' : 'image';
      const { stdout } = await exec(process.execPath, [join(plugin, 'scripts/aihub.mjs'), 'describe', '--skill', `aihub-${media}`, '--model', model], { cwd: temp, timeout: 10_000 });
      const output = JSON.parse(stdout);
      assert.equal(output.status, 'ok'); assert.equal(output.media, media);
      assert.equal(output.model, model); assert.equal(output.catalog_model, model);
      assert.equal(output.endpoint, `POST /v1/${media === 'image' ? 'images' : 'videos'}/generations`);
      assert.ok(output.params.some((p: { name: string }) => p.name === 'prompt'));
      const fields = new Map<string, { enum?: string[]; default?: unknown }>(output.params.map((p: { name: string }) => [p.name, p]));
      if (model.startsWith('gpt-image-2.5-')) {
        assert.ok(fields.get('quality')?.enum?.includes('max'));
        assert.ok(fields.get('background')?.enum?.includes('transparent'));
      } else if (model === 'gpt-image-2') {
        assert.ok(!fields.get('quality')?.enum?.includes('max'));
        assert.ok(!fields.get('background')?.enum?.includes('transparent'));
      } else {
        assert.equal(fields.get('model')?.default, model);
        assert.ok(!fields.has('generate_audio')); assert.ok(!fields.has('last_frame_url'));
        if (model.endsWith('-image-to-video')) {
          assert.ok(output.required_params.includes('image_url'));
          assert.ok(!fields.has('image_urls'));
        }
        if (model.endsWith('-reference-to-video')) {
          assert.ok(fields.has('image_urls')); assert.ok(fields.has('video_urls')); assert.ok(fields.has('audio_urls'));
          assert.ok(!fields.has('image_url'));
        }
      }
    }
    const fixtureHome = join(temp, 'user');
    const config = join(fixtureHome, '.config', 'aihub');
    const ordinary = join(fixtureHome, '.config', 'aihub-image', '.env');
    await mkdir(join(config, 'aihub-image'), { recursive: true });
    await mkdir(join(fixtureHome, '.config', 'aihub-image'), { recursive: true });
    await writeFile(join(config, '.env'), 'AIHUB_API_KEY=fixture-shared-key\nAIHUB_BASE_URL=https://fixture.invalid');
    await writeFile(join(config, '.env.aihub-image'), 'AIHUB_API_KEY=fixture-image-key');
    await writeFile(ordinary, 'AIHUB_API_KEY=fixture-ordinary-key\nAIHUB_BASE_URL=https://ordinary.invalid');
    // Only the child process uses this isolated user directory; never read the tester's credentials.
    const env = { ...process.env, HOME: fixtureHome, USERPROFILE: fixtureHome, AIHUB_API_KEY: '', AIHUB_BASE_URL: '' };
    const fixtureKeys = ['fixture-shared-key', 'fixture-image-key', 'fixture-directory-key', 'fixture-ordinary-key', 'fixture-project-key'];
    const checkNoKeys = (output: string) => {
      for (const key of fixtureKeys) assert.ok(!output.includes(key), 'CLI output must not expose fixture credentials');
    };
    const command = async (...args: string[]) => {
      try {
        const { stdout, stderr } = await exec(process.execPath, [join(plugin, 'scripts/aihub.mjs'), ...args], { cwd: temp, env, timeout: 10_000 });
        checkNoKeys(stdout + stderr);
        return JSON.parse(stdout);
      } catch (error) {
        const output = error as { stdout?: string; stderr?: string };
        checkNoKeys((output.stdout ?? '') + (output.stderr ?? ''));
        throw error;
      }
    };
    const doctor = (skill: string, ...flags: string[]) => command('doctor', '--skill', skill, ...flags);
    assert.equal((await doctor('aihub-video')).config_sources.AIHUB_API_KEY, join(config, '.env'));
    assert.equal((await doctor('aihub-image')).config_sources.AIHUB_API_KEY, join(config, '.env.aihub-image'));
    assert.equal((await doctor('aihub-image', '--use-global-config')).config_sources.AIHUB_API_KEY, join(config, '.env.aihub-image'));
    await writeFile(join(config, 'aihub-image', '.env'), 'AIHUB_API_KEY=fixture-directory-key');
    assert.equal((await doctor('aihub-image')).config_sources.AIHUB_API_KEY, join(config, 'aihub-image', '.env'));
    await assert.rejects(doctor('aihub-image', '--no-global-config'), (error: unknown) => {
      const output = JSON.parse((error as { stdout: string }).stdout);
      assert.equal(output.status, 'not_submitted');
      assert.match(output.error, /disabled by --no-global-config/);
      return true;
    });
    await assert.rejects(doctor('aihub-image', '--no-global-config', '--use-global-config'), (error: unknown) => {
      assert.match(JSON.parse((error as { stdout: string }).stdout).error, /Do not combine/);
      return true;
    });

    await rm(join(config, '.env.aihub-image'));
    await rm(join(config, 'aihub-image', '.env'));
    await writeFile(join(config, '.env'), 'AIHUB_API_KEY=""\nAIHUB_BASE_URL=https://fixture.invalid');
    const partial = await doctor('aihub-image');
    assert.equal(partial.service_url, 'https://fixture.invalid');
    assert.deepEqual(partial.config_sources, { AIHUB_API_KEY: ordinary, AIHUB_BASE_URL: join(config, '.env') });
    assert.deepEqual((await doctor('aihub-image', '--use-global-config')).config_sources, partial.config_sources);

    await rm(config, { recursive: true });
    const fallback = await doctor('aihub-image');
    assert.equal(fallback.status, 'ok');
    assert.equal(fallback.service_url, 'https://ordinary.invalid');
    assert.deepEqual(fallback.config_sources, { AIHUB_API_KEY: ordinary, AIHUB_BASE_URL: ordinary });
    await assert.rejects(doctor('aihub-image', '--no-global-config'), (error: unknown) => {
      assert.match(JSON.parse((error as { stdout: string }).stdout).error, /disabled by --no-global-config/);
      return true;
    });

    // The packaged CLI must skip unreadable files in both global directory forms.
    await rm(ordinary);
    await mkdir(ordinary);
    const unreadablePlugin = join(config, '.env');
    await mkdir(unreadablePlugin, { recursive: true });
    const project = join(temp, '.env.local');
    await writeFile(project, 'AIHUB_API_KEY=fixture-project-key\nAIHUB_BASE_URL=https://project.invalid');
    for (const path of [unreadablePlugin, ordinary]) {
      await assert.rejects(doctor('aihub-image'), (error: unknown) => {
        assert.equal(JSON.parse((error as { stdout: string }).stdout).error, `Cannot read configuration file: ${path}`);
        return true;
      });
      const disabled = await doctor('aihub-image', '--no-global-config');
      assert.equal(disabled.service_url, 'https://project.invalid');
      assert.deepEqual(disabled.config_sources, { AIHUB_API_KEY: project, AIHUB_BASE_URL: project });
      await rm(path, { recursive: true });
    }
    await assert.rejects(command('doctor'), (error: unknown) => {
      assert.equal(JSON.parse((error as { stdout: string }).stdout).error, 'Missing --skill');
      return true;
    });
    await assert.rejects(doctor('unknown-skill'), (error: unknown) => {
      assert.match(JSON.parse((error as { stdout: string }).stdout).error, /--skill must be one of/);
      return true;
    });
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('package, lockfile, Plugin manifests, marketplace and every Skill share one public version', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version);
  for (const manifest of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.codebuddy-plugin/plugin.json']) {
    const data = JSON.parse(await readFile(manifest, 'utf8'));
    assert.equal(data.name, pkg.name); assert.equal(data.version, pkg.version);
  }
  const marketplace = JSON.parse(await readFile('../.codebuddy-plugin/marketplace.json', 'utf8'));
  assert.equal(marketplace.plugins.find((item: { name: string }) => item.name === pkg.name)?.version, pkg.version);
  const requirements = JSON.parse(await readFile('references/credentials.json', 'utf8'));
  assert.equal(requirements.consumer.kind, 'plugin');
  assert.equal(requirements.consumer.name, pkg.name);
  assert.deepEqual([...requirements.consumer.skills].sort(), (await readdir('skills')).sort());
  for (const name of await readdir('skills')) {
    const text = await readFile(join('skills', name, 'SKILL.md'), 'utf8');
    assert.equal(/^name: (.+)$/m.exec(text)?.[1], name);
    assert.equal(/^version: (.+)$/m.exec(text)?.[1], pkg.version);
    assert.ok(text.includes(`description: v${pkg.version}｜`));
  }
});
