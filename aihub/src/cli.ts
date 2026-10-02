import { readFile } from 'node:fs/promises';
import { loadConfig, inspectConfig, ConfigurationError, redact, sanitized, RESULT_CHECK_DEFAULTS, type LoadedConfig } from './config.js';
import { checkMediaTools } from './download.js';
import { models, describe } from './models.js';
import { AihubmaxClient, ApiError } from './apiClient.js';
import { generate, resume, adoptTask, upload, understand, nativeMusic, TaskPersistenceError } from './workflow.js';
import type { Media } from './state.js';
import { selectionPlan } from './selection.js';
import { startRun, continueRun } from './runs.js';
import { collectRequestErrors, feedback } from './diagnostics.js';
import { reviewTask, DISABLE_CHECK_HINT } from './review.js';

const SKILLS = ['aihub-image', 'aihub-video', 'aihub-audio', 'aihub-music', 'aihub-understanding', 'aihub-document'];
const FLAGS: Record<string, string[]> = {
  doctor: [], 'config-check': [], models: ['media', 'keyword'], describe: ['model'],
  generate: ['media', 'model', 'params-file', 'output-dir', 'wait-seconds'],
  understand: ['model', 'params-file', 'output-dir', 'wait-seconds'],
  'native-music': ['model', 'params-file', 'output-dir'],
  music: ['model', 'params-file', 'output-dir'],
  resume: ['record', 'wait-seconds'], task: ['task-id', 'media', 'output-dir', 'wait-seconds'],
  upload: ['input-file'],
  plan: ['request-file'],
  run: ['request-file', 'output-dir', 'wait-seconds'],
  continue: ['record', 'confirm', 'wait-seconds'],
  review: ['record', 'provider', 'wait-seconds', 'recheck'],
  'review-submit': ['record', 'review-file', 'review-token'],
};
const HELP = `AIhub media Plugin CLI
Usage: node <plugin>/scripts/aihub.mjs COMMAND --skill NAME [options]
Skills: ${SKILLS.join(', ')}
Commands:
  config-check (local configuration sources; no network or media tools)
  doctor
  plan --request-file JSON
  run --request-file JSON [--output-dir DIR] [--wait-seconds 0..600]
  continue --record run.json [--confirm TOKEN] [--wait-seconds 0..600]
  review --record run.json [--provider host|aihub] [--wait-seconds 0..600] [--recheck]
  review-submit --record run.json --review-file JSON --review-token TOKEN
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
JSON output; exit 0 = success or known running task, 1 = definite failure, 2 = needs recovery,
3 = config-check found missing, invalid or unreadable configuration.
generate defaults to no waiting; resume/task default to 30 seconds. Resume never creates a task.
run defaults to data/aihub/ and no waiting. continue resumes the saved plan and may submit
the next compatible model under its saved fallback policy. --confirm is only for a user's
explicit approval of the pending model and parameters. plan performs no network requests.
Optional model configuration: AIHUB_<IMAGE|VIDEO|AUDIO|MUSIC|UNDERSTANDING|DOCUMENT>_MODELS
(ordered comma-separated exact IDs), AIHUB_MODEL_FALLBACK_POLICY=auto|confirm|off|preflight_only,
AIHUB_MODEL_MAX_ATTEMPTS (positive integer, includes first model). Only AIHUB_API_KEY is required.
Result checks: AIHUB_RESULT_CHECK_ENABLED=1|0 (default 1), AIHUB_RESULT_CHECK_PROVIDER=auto|host|aihub
(default auto: the Skill uses actual host media tools first), AIHUB_RESULT_CHECK_MODELS
(ordered IDs; default gemini-3.8-flash; preflight selection only, one external review submission).
Feedback: AIHUB_ERROR_REPORT_THRESHOLD (positive integer, default 3), AIHUB_SUPPORT_URL (optional).
Review failures never regenerate media. Completed checks include a reminder that users can
disable checks through conversation. No Issue or administrator message is sent automatically.
`;

function parse(argv: string[]) {
  const command = argv[0]!;
  if (!(command in FLAGS)) throw new Error('Unknown command. Use --help.');
  const flags: Record<string, string | boolean> = {};
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('--')) throw new Error('Expected a named option. Use --help.');
    const key = token.slice(2);
    if (![...FLAGS[command]!, 'skill', 'use-global-config', 'no-global-config'].includes(key) || key in flags) throw new Error(`Unknown or duplicate option: --${key}`);
    if (key === 'use-global-config' || key === 'no-global-config' || key === 'recheck') flags[key] = true;
    else {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      flags[key] = value;
    }
  }
  if (flags['use-global-config'] && flags['no-global-config']) throw new Error('Do not combine --use-global-config with --no-global-config.');
  return { command, flags };
}
function required(flags: Record<string, string | boolean>, key: string): string {
  if (typeof flags[key] !== 'string' || !flags[key]) throw new Error(`Missing --${key}`);
  return flags[key] as string;
}
function media(flags: Record<string, string | boolean>): Media {
  const value = required(flags, 'media');
  if (!['image', 'video', 'audio', 'document', 'understanding'].includes(value)) throw new Error('--media must be image, video, audio, document or understanding.');
  return value as Media;
}
function wait(flags: Record<string, string | boolean>, fallback: number): number {
  const value = flags['wait-seconds'] === undefined ? fallback : Number(flags['wait-seconds']);
  if (!Number.isInteger(value) || value < 0 || value > 600) throw new Error('--wait-seconds must be an integer from 0 to 600.');
  return value;
}
async function jsonFile(path: string): Promise<Record<string, unknown>> {
  const data: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The input JSON file must contain an object.');
  return data as Record<string, unknown>;
}

export async function main(argv: string[]): Promise<number> {
  return collectRequestErrors(events => mainWithDiagnostics(argv, events));
}
async function mainWithDiagnostics(argv: string[], events: Parameters<typeof feedback>[2]): Promise<number> {
  if (!argv.length || argv[0] === '--help' || argv[0] === 'help') { process.stdout.write(HELP); return 0; }
  let cfg: LoadedConfig | undefined;
  let output: Record<string, unknown>;
  let parsed: ReturnType<typeof parse> | undefined;
  try {
    parsed = parse(argv);
    const { command, flags } = parsed;
    const skill = required(flags, 'skill');
    if (!SKILLS.includes(skill)) throw new Error(`--skill must be one of ${SKILLS.join(', ')}.`);
    // describe reads only bundled data; it can run before credentials are configured.
    if (command === 'config-check') output = { ...inspectConfig({ skill, useGlobalConfig: flags['no-global-config'] !== true }) };
    else if (command === 'describe') output = { schema_version: 1, ...describe(required(flags, 'model')) };
    else {
      cfg = loadConfig({ skill, useGlobalConfig: flags['no-global-config'] !== true });
      if (command === 'doctor') {
        await checkMediaTools();
        output = { schema_version: 1, status: 'ok', skill, node: process.version, media_tools: 'available', service_url: cfg.baseUrl, config_sources: cfg.sources, model_selection: cfg.modelSelection,
          result_check: cfg.resultCheck, error_feedback: cfg.feedback, note: 'Local preflight only; key authentication and generation channel availability have not been tested.' };
      } else if (command === 'plan') output = { schema_version: 1, status: 'ok', ...selectionPlan(cfg, await jsonFile(required(flags, 'request-file'))), model_selection: cfg.modelSelection };
      else if (command === 'run') output = await startRun(cfg, await jsonFile(required(flags, 'request-file')), typeof flags['output-dir'] === 'string' ? flags['output-dir'] : 'data/aihub', wait(flags, 0));
      else if (command === 'continue') output = await continueRun(cfg, required(flags, 'record'), wait(flags, 30), flags.confirm as string | undefined);
      else if (command === 'review' || command === 'review-submit') {
        if (flags.provider && !['host', 'aihub'].includes(String(flags.provider))) throw new Error('--provider must be host or aihub.');
        output = await reviewTask(cfg, required(flags, 'record'), command === 'review-submit'
          ? { report: await jsonFile(required(flags, 'review-file')), reviewToken: required(flags, 'review-token') }
          : { provider: flags.provider as 'host' | 'aihub' | undefined, waitSeconds: wait(flags, 30), recheck: flags.recheck === true });
      }
      else if (command === 'models') output = { schema_version: 1, ...await models(new AihubmaxClient(cfg), flags.media ? media(flags) : undefined, flags.keyword as string | undefined), model_selection: cfg.modelSelection };
      else if (command === 'generate') {
        const kind = media(flags);
        if (skill !== `aihub-${kind}` && !(kind === 'audio' && (skill === 'aihub-music' || skill === 'aihub-audio'))) throw new Error('--skill must match the requested media.');
        output = await generate(cfg, { media: kind, model: required(flags, 'model'), params: await jsonFile(required(flags, 'params-file')), outputDir: required(flags, 'output-dir'), waitSeconds: wait(flags, 0) });
      } else if (command === 'understand') {
        if (skill !== 'aihub-understanding') throw new Error('--skill must be aihub-understanding.');
        const input = await jsonFile(required(flags, 'params-file'));
        if (typeof input.model !== 'string' || typeof input.prompt !== 'string' || !Array.isArray(input.content)) throw new Error('understand params-file requires model, prompt and content array.');
        output = await understand(cfg, { model: input.model, prompt: input.prompt, content: input.content as Array<Record<string, unknown>>, outputDir: required(flags, 'output-dir'), waitSeconds: wait(flags, 30), systemPrompt: typeof input.system_prompt === 'string' ? input.system_prompt : undefined, maxTokens: typeof input.max_tokens === 'number' ? input.max_tokens : undefined, temperature: typeof input.temperature === 'number' ? input.temperature : undefined });
      } else if (command === 'native-music' || command === 'music') {
        if (skill !== 'aihub-music') throw new Error('--skill must be aihub-music.');
        output = await nativeMusic(cfg, { model: required(flags, 'model'), body: await jsonFile(required(flags, 'params-file')), outputDir: required(flags, 'output-dir') });
      } else if (command === 'resume') output = await resume(cfg, required(flags, 'record'), wait(flags, 30));
      else if (command === 'task') {
        const kind = media(flags);
        if (skill !== `aihub-${kind}` && !(kind === 'audio' && skill === 'aihub-music')) throw new Error('--skill must match the requested media.');
        output = await adoptTask(cfg, required(flags, 'task-id'), kind, required(flags, 'output-dir'), wait(flags, 30));
      } else output = await upload(cfg, await jsonFile(required(flags, 'input-file')));
    }
    if (cfg) output = sanitized(output, [cfg.apiKey]);
  } catch (error) {
    const recovering = ['resume', 'task', 'continue', 'review', 'review-submit'].includes(parsed?.command ?? '');
    output = error instanceof TaskPersistenceError ? error.output()
      : { schema_version: 1, status: recovering ? 'recovery_failed' : 'not_submitted',
          ...(recovering && typeof parsed?.flags.record === 'string' ? { record: parsed.flags.record } : {}),
          ...(recovering && typeof parsed?.flags['task-id'] === 'string' ? { task_id: parsed.flags['task-id'] } : {}),
          error: redact(error instanceof Error ? error.message : String(error), cfg ? [cfg.apiKey] : []) };
    if (error instanceof ConfigurationError) output.configuration = error.inspection;
    if (cfg && error instanceof ApiError) output.failure = { http_status: error.status, ambiguous: error.ambiguous };
    if (cfg) output = sanitized(output, [cfg.apiKey]);
  }
  if (cfg && output.status === 'delivered') {
    const enabled = (cfg.resultCheck ?? RESULT_CHECK_DEFAULTS).enabled;
    try {
      output.result_check = typeof output.run_record === 'string'
        ? await reviewTask(cfg, output.run_record)
        : { status: enabled ? 'unavailable' : 'disabled', reason: '旧单任务记录没有保存用户原始需求，无法据此证明需求匹配。新任务请使用 plan/run。', ...(enabled ? { user_notice: DISABLE_CHECK_HINT } : {}) };
    } catch {
      output.result_check = { status: enabled ? 'unavailable' : 'disabled', reason: '检查记录或文件绑定无法验证；生成文件仍可交付。', ...(enabled ? { user_notice: DISABLE_CHECK_HINT } : {}) };
    }
  }
  if (cfg) {
    try {
      const diagnostic = await feedback(cfg, output, events);
      if (diagnostic) output.feedback = diagnostic;
    } catch { output.feedback_warning = '无法保存错误报告；保留原任务结果与已知任务 ID。'; }
    output = sanitized(output, [cfg.apiKey]);
  }
  const failure = output.failure ?? (output.result as Record<string, unknown> | undefined)?.failure;
  if (cfg && (failure as { http_status?: number } | undefined)?.http_status === 401) {
    output.configuration_issue = { reason: 'authentication_rejected', http_status: 401,
      keys: ['AIHUB_API_KEY', 'AIHUB_BASE_URL'], sources: cfg.sources,
      next_step: 'Check the key and its service/account. Offer to edit the effective local file or use secret-book to repair it. Do not replay a business request automatically.' };
  }
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  if (output.status === 'configuration_required') return 3;
  if (['ok', 'delivered', 'submitted', 'waiting', 'matched', 'mismatched', 'inconclusive', 'unavailable', 'disabled', 'pending', 'checking'].includes(String(output.status))) return 0;
  if (['not_submitted', 'remote_failed', 'failed', 'no_compatible_model', 'attempt_limit'].includes(String(output.status))) return 1;
  return 2;
}
