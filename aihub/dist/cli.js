import { readFile } from 'node:fs/promises';
import { loadConfig, redact, sanitized } from './config.js';
import { checkMediaTools } from './download.js';
import { models, describe } from './models.js';
import { AihubmaxClient } from './apiClient.js';
import { generate, resume, adoptTask, upload, understand, nativeMusic, TaskPersistenceError } from './workflow.js';
const SKILLS = ['aihub-image', 'aihub-video', 'aihub-audio', 'aihub-music', 'aihub-understanding', 'aihub-document'];
const FLAGS = {
    doctor: [], models: ['media', 'keyword'], describe: ['model'],
    generate: ['media', 'model', 'params-file', 'output-dir', 'wait-seconds'],
    understand: ['model', 'params-file', 'output-dir', 'wait-seconds'],
    'native-music': ['model', 'params-file', 'output-dir'],
    music: ['model', 'params-file', 'output-dir'],
    resume: ['record', 'wait-seconds'], task: ['task-id', 'media', 'output-dir', 'wait-seconds'],
    upload: ['input-file'],
};
const HELP = `AIhub media Plugin CLI
Usage: node <plugin>/scripts/aihub.mjs COMMAND --skill NAME [options]
Skills: ${SKILLS.join(', ')}
Commands:
  doctor
  models [--media image|video|audio|document|understanding] [--keyword TEXT]
  describe --model ID
  generate --media TYPE --model ID --params-file JSON --output-dir DIR [--wait-seconds 0..600]
  understand --model ID --params-file JSON --output-dir DIR [--wait-seconds 0..600]
  native-music --model lyria-3-pro-preview --params-file JSON --output-dir DIR
  resume --record task.json [--wait-seconds 0..600]
  task --task-id ID --media TYPE --output-dir DIR [--wait-seconds 0..600]
  upload --input-file JSON
Global configuration is read automatically from ~/.config/aihub/, then ~/.config/<skill-name>/.env.
Configuration: process environment > project .env.<skill-name> > .env.local > .env
  > Plugin <skill-name>/.env.local > <skill-name>/.env > .env.<skill-name> > .env.local > .env
  > standalone ~/.config/<skill-name>/.env (only fills missing or empty fields).
Use --no-global-config to skip both global directories; --use-global-config remains a compatible no-op.
Do not combine --no-global-config with --use-global-config. Only the current Skill's standalone .env is read.
JSON output; exit 0 = success or known running task, 1 = definite failure, 2 = needs recovery.
generate defaults to no waiting; resume/task default to 30 seconds. Resume never creates a task.
`;
function parse(argv) {
    const command = argv[0];
    if (!(command in FLAGS))
        throw new Error('Unknown command. Use --help.');
    const flags = {};
    for (let i = 1; i < argv.length; i++) {
        const token = argv[i];
        if (!token.startsWith('--'))
            throw new Error('Expected a named option. Use --help.');
        const key = token.slice(2);
        if (![...FLAGS[command], 'skill', 'use-global-config', 'no-global-config'].includes(key) || key in flags)
            throw new Error(`Unknown or duplicate option: --${key}`);
        if (key === 'use-global-config' || key === 'no-global-config')
            flags[key] = true;
        else {
            const value = argv[++i];
            if (!value || value.startsWith('--'))
                throw new Error(`Missing value for --${key}`);
            flags[key] = value;
        }
    }
    if (flags['use-global-config'] && flags['no-global-config'])
        throw new Error('Do not combine --use-global-config with --no-global-config.');
    return { command, flags };
}
function required(flags, key) {
    if (typeof flags[key] !== 'string' || !flags[key])
        throw new Error(`Missing --${key}`);
    return flags[key];
}
function media(flags) {
    const value = required(flags, 'media');
    if (!['image', 'video', 'audio', 'document', 'understanding'].includes(value))
        throw new Error('--media must be image, video, audio, document or understanding.');
    return value;
}
function wait(flags, fallback) {
    const value = flags['wait-seconds'] === undefined ? fallback : Number(flags['wait-seconds']);
    if (!Number.isInteger(value) || value < 0 || value > 600)
        throw new Error('--wait-seconds must be an integer from 0 to 600.');
    return value;
}
async function jsonFile(path) {
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error('The input JSON file must contain an object.');
    return data;
}
export async function main(argv) {
    if (!argv.length || argv[0] === '--help' || argv[0] === 'help') {
        process.stdout.write(HELP);
        return 0;
    }
    let cfg;
    let output;
    let parsed;
    try {
        parsed = parse(argv);
        const { command, flags } = parsed;
        const skill = required(flags, 'skill');
        if (!SKILLS.includes(skill))
            throw new Error(`--skill must be one of ${SKILLS.join(', ')}.`);
        // describe reads only bundled data; it can run before credentials are configured.
        if (command === 'describe')
            output = { schema_version: 1, ...describe(required(flags, 'model')) };
        else {
            cfg = loadConfig({ skill, useGlobalConfig: flags['no-global-config'] !== true });
            if (command === 'doctor') {
                await checkMediaTools();
                output = { schema_version: 1, status: 'ok', skill, node: process.version, media_tools: 'available', service_url: cfg.baseUrl, config_sources: cfg.sources, note: 'Local preflight only; key authentication and generation channel availability have not been tested.' };
            }
            else if (command === 'models')
                output = { schema_version: 1, ...await models(new AihubmaxClient(cfg), flags.media ? media(flags) : undefined, flags.keyword) };
            else if (command === 'generate') {
                const kind = media(flags);
                if (skill !== `aihub-${kind}` && !(kind === 'audio' && (skill === 'aihub-music' || skill === 'aihub-audio')))
                    throw new Error('--skill must match the requested media.');
                output = await generate(cfg, { media: kind, model: required(flags, 'model'), params: await jsonFile(required(flags, 'params-file')), outputDir: required(flags, 'output-dir'), waitSeconds: wait(flags, 0) });
            }
            else if (command === 'understand') {
                if (skill !== 'aihub-understanding')
                    throw new Error('--skill must be aihub-understanding.');
                const input = await jsonFile(required(flags, 'params-file'));
                if (typeof input.model !== 'string' || typeof input.prompt !== 'string' || !Array.isArray(input.content))
                    throw new Error('understand params-file requires model, prompt and content array.');
                output = await understand(cfg, { model: input.model, prompt: input.prompt, content: input.content, outputDir: required(flags, 'output-dir'), waitSeconds: wait(flags, 30), systemPrompt: typeof input.system_prompt === 'string' ? input.system_prompt : undefined, maxTokens: typeof input.max_tokens === 'number' ? input.max_tokens : undefined, temperature: typeof input.temperature === 'number' ? input.temperature : undefined });
            }
            else if (command === 'native-music' || command === 'music') {
                if (skill !== 'aihub-music')
                    throw new Error('--skill must be aihub-music.');
                output = await nativeMusic(cfg, { model: required(flags, 'model'), body: await jsonFile(required(flags, 'params-file')), outputDir: required(flags, 'output-dir') });
            }
            else if (command === 'resume')
                output = await resume(cfg, required(flags, 'record'), wait(flags, 30));
            else if (command === 'task') {
                const kind = media(flags);
                if (skill !== `aihub-${kind}`)
                    throw new Error('--skill must match the requested media.');
                output = await adoptTask(cfg, required(flags, 'task-id'), kind, required(flags, 'output-dir'), wait(flags, 30));
            }
            else
                output = await upload(cfg, await jsonFile(required(flags, 'input-file')));
        }
        if (cfg)
            output = sanitized(output, [cfg.apiKey]);
    }
    catch (error) {
        const recovering = parsed?.command === 'resume' || parsed?.command === 'task';
        output = error instanceof TaskPersistenceError ? error.output()
            : { schema_version: 1, status: recovering ? 'recovery_failed' : 'not_submitted',
                ...(recovering && typeof parsed?.flags.record === 'string' ? { record: parsed.flags.record } : {}),
                ...(recovering && typeof parsed?.flags['task-id'] === 'string' ? { task_id: parsed.flags['task-id'] } : {}),
                error: redact(error instanceof Error ? error.message : String(error), cfg ? [cfg.apiKey] : []) };
        if (cfg)
            output = sanitized(output, [cfg.apiKey]);
    }
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    if (['ok', 'delivered', 'submitted', 'waiting'].includes(String(output.status)))
        return 0;
    if (['not_submitted', 'remote_failed'].includes(String(output.status)))
        return 1;
    return 2;
}
