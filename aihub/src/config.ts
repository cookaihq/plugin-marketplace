import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export interface Config { baseUrl: string; apiKey: string }
export type FallbackPolicy = 'auto' | 'confirm' | 'off' | 'preflight_only';
export interface ModelSelectionConfig {
  models?: string[];
  policy: FallbackPolicy;
  maxAttempts?: number;
  sources: Record<string, string>;
}
export interface LoadedConfig extends Config {
  skill: string;
  sources: Record<'AIHUB_API_KEY' | 'AIHUB_BASE_URL', string>;
  modelSelection?: ModelSelectionConfig;
  resultCheck?: ResultCheckConfig;
  feedback?: { threshold: number; supportUrl?: string; sources: Record<string, string> };
}
export interface ResultCheckConfig {
  enabled: boolean; provider: 'auto' | 'host' | 'aihub'; models: string[]; sources: Record<string, string>;
}
export const RESULT_CHECK_DEFAULTS: ResultCheckConfig = { enabled: true, provider: 'auto', models: ['gemini-3.8-flash'], sources: {} };
const BEHAVIOR_DEFAULTS: Record<string, string> = {
  AIHUB_RESULT_CHECK_ENABLED: '1', AIHUB_RESULT_CHECK_PROVIDER: 'auto', AIHUB_RESULT_CHECK_MODELS: 'gemini-3.8-flash',
  AIHUB_ERROR_REPORT_THRESHOLD: '3',
};
const BEHAVIOR_KEYS = [...Object.keys(BEHAVIOR_DEFAULTS), 'AIHUB_SUPPORT_URL'];
const KEYS = ['AIHUB_API_KEY', 'AIHUB_BASE_URL'] as const;
export const MODEL_KEYS: Record<string, string> = Object.fromEntries(
  ['image', 'video', 'audio', 'music', 'understanding', 'document'].map(kind => [`aihub-${kind}`, `AIHUB_${kind.toUpperCase()}_MODELS`]),
);
const SELECTION_KEYS = ['AIHUB_MODEL_FALLBACK_POLICY', 'AIHUB_MODEL_MAX_ATTEMPTS'];
const DECLARED_KEYS = new Set<string>([...KEYS, ...Object.values(MODEL_KEYS), ...SELECTION_KEYS, ...BEHAVIOR_KEYS]);
// Stable Plugin manifest name; independent of the installation directory or host Agent.
const PLUGIN_NAME = 'aihub';
// Retained from the source client's configuration. This is the API root, not /v1.
const DEFAULT_BASE_URL = 'https://api.aihubmax.com';

export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || !DECLARED_KEYS.has(match[1]!)) continue;
    let value = match[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]!] = value;
  }
  return values;
}

export interface ConfigOptions {
  skill: string; useGlobalConfig?: boolean; cwd?: string;
  env?: NodeJS.ProcessEnv; homeDirectory?: string;
}
export interface ConfigInspection {
  schema: 'secret-book.config-inspection/v1';
  status: 'ok' | 'configuration_required';
  consumer: { kind: 'plugin'; name: string }; skill: string; cwd: string;
  global_enabled: boolean;
  layers: Array<{ path: string; revision: string | null; error?: string }>;
  environment: Record<string, string | null>;
  fields: Record<string, { source: string; present: boolean; problem?: string }>;
  problems: Array<{ key?: string; source: string; reason: string }>;
}
export class ConfigurationError extends Error {
  constructor(message: string, public inspection: ConfigInspection) { super(message); }
}

function resolveConfiguration(options: ConfigOptions) {
  const { skill, useGlobalConfig = true, env = process.env } = options;
  const cwd = resolve(options.cwd ?? process.cwd());
  const homeDirectory = resolve(options.homeDirectory ?? homedir());
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(skill)) throw new Error('A valid caller Skill name is required.');
  const layers: Array<{ name: string; values: Record<string, string | undefined> }> = [{ name: 'environment', values: env }];
  const files: ConfigInspection['layers'] = [];
  const problems: ConfigInspection['problems'] = [];
  const addFile = (path: string) => {
    try {
      const bytes = readFileSync(path);
      files.push({ path, revision: createHash('sha256').update(bytes).digest('hex') });
      layers.push({ name: path, values: parseEnv(bytes.toString('utf8')) });
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      files.push({ path, revision: null, ...(!missing ? { error: 'unreadable' } : {}) });
      if (!missing) problems.push({ source: path, reason: 'unreadable' });
    }
  };
  for (const name of [`.env.${skill}`, '.env.local', '.env']) {
    addFile(join(cwd, name));
  }
  if (useGlobalConfig) {
    const pluginDirectory = join(homeDirectory, '.config', PLUGIN_NAME);
    const paths = [
      join(pluginDirectory, skill, '.env.local'),
      join(pluginDirectory, skill, '.env'),
      join(pluginDirectory, `.env.${skill}`),
      join(pluginDirectory, '.env.local'),
      join(pluginDirectory, '.env'),
      // Reuse the current Skill's standalone configuration only after all Plugin files.
      join(homeDirectory, '.config', skill, '.env'),
    ];
    for (const path of paths) addFile(path);
  }
  const values: Record<string, string> = {};
  const sources = {} as LoadedConfig['sources'];
  const selectionSources: Record<string, string> = {};
  const modelKey = MODEL_KEYS[skill];
  for (const key of [...KEYS, ...(modelKey ? [modelKey] : []), ...SELECTION_KEYS, ...BEHAVIOR_KEYS]) {
    for (const layer of layers) {
      if (layer.values[key]?.trim()) {
        values[key] = layer.values[key]!;
        if (key === 'AIHUB_API_KEY' || key === 'AIHUB_BASE_URL') sources[key] = layer.name;
        else selectionSources[key] = layer.name;
        break;
      }
    }
  }
  if (!values.AIHUB_BASE_URL) { values.AIHUB_BASE_URL = DEFAULT_BASE_URL; sources.AIHUB_BASE_URL = 'built-in default'; }
  const fields: ConfigInspection['fields'] = Object.fromEntries(KEYS.map(key => [key, {
    source: sources[key] ?? 'missing', present: Boolean(values[key]),
  }]));
  for (const key of BEHAVIOR_KEYS) {
    if (!values[key] && BEHAVIOR_DEFAULTS[key]) { values[key] = BEHAVIOR_DEFAULTS[key]!; selectionSources[key] = 'built-in default'; }
    fields[key] = { source: selectionSources[key] ?? 'missing', present: Boolean(values[key]) };
  }
  const invalid = (key: string, reason: string) => {
    fields[key]!.problem = reason;
    problems.push({ key, source: fields[key]!.source, reason });
  };
  if (!['0', '1'].includes(values.AIHUB_RESULT_CHECK_ENABLED!.trim())) invalid('AIHUB_RESULT_CHECK_ENABLED', 'expected_0_or_1');
  if (!['auto', 'host', 'aihub'].includes(values.AIHUB_RESULT_CHECK_PROVIDER!.trim())) invalid('AIHUB_RESULT_CHECK_PROVIDER', 'expected_auto_host_aihub');
  const reviewModels = values.AIHUB_RESULT_CHECK_MODELS!.split(',').map(item => item.trim());
  if (reviewModels.some(item => !item || /\s/.test(item)) || new Set(reviewModels).size !== reviewModels.length) invalid('AIHUB_RESULT_CHECK_MODELS', 'expected_distinct_model_ids');
  const threshold = values.AIHUB_ERROR_REPORT_THRESHOLD!.trim();
  if (!/^\d+$/.test(threshold) || !Number.isSafeInteger(Number(threshold)) || Number(threshold) < 1) invalid('AIHUB_ERROR_REPORT_THRESHOLD', 'expected_positive_integer');
  if (values.AIHUB_SUPPORT_URL) {
    try {
      const support = new URL(values.AIHUB_SUPPORT_URL);
      if (!['http:', 'https:'].includes(support.protocol) || support.username || support.password || support.search || support.hash) throw new Error();
    } catch { invalid('AIHUB_SUPPORT_URL', 'expected_http_url_without_credentials_query_or_fragment'); }
  }
  if (!values.AIHUB_API_KEY) {
    fields.AIHUB_API_KEY!.problem = 'missing';
    problems.push({ key: 'AIHUB_API_KEY', source: 'missing', reason: 'missing' });
  }
  let url: URL | undefined;
  try { url = new URL(values.AIHUB_BASE_URL); } catch { /* reported without the value */ }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    fields.AIHUB_BASE_URL!.problem = 'invalid_url';
    problems.push({ key: 'AIHUB_BASE_URL', source: sources.AIHUB_BASE_URL, reason: 'invalid_url' });
  }
  const inspection: ConfigInspection = {
    schema: 'secret-book.config-inspection/v1', status: problems.length ? 'configuration_required' : 'ok',
    consumer: { kind: 'plugin', name: PLUGIN_NAME }, skill, cwd, global_enabled: useGlobalConfig,
    layers: files, fields, problems,
    environment: Object.fromEntries([...KEYS, ...BEHAVIOR_KEYS].map(key => [key, env[key]?.trim() ? credentialId(env[key]!) : null])),
  };
  return { values, sources, selectionSources, modelKey, url, inspection };
}

/** Read the same layers as loadConfig, including failures. Never returns credential values. */
export function inspectConfig(options: ConfigOptions): ConfigInspection { return resolveConfiguration(options).inspection; }

export function loadConfig(options: ConfigOptions): LoadedConfig {
  const { values, sources, selectionSources, modelKey, url, inspection } = resolveConfiguration(options);
  const unreadable = inspection.problems.find(problem => problem.reason === 'unreadable');
  if (unreadable) throw new ConfigurationError(`Cannot read configuration file: ${unreadable.source}`, inspection);
  if (!values.AIHUB_API_KEY) throw new ConfigurationError(`Missing AIHUB_API_KEY. Global configuration is ${inspection.global_enabled ? 'enabled automatically' : 'disabled by --no-global-config'}. Run config-check to inspect the calling project's files and ~/.config/${PLUGIN_NAME}/.`, inspection);
  if (inspection.problems.length) throw new ConfigurationError(inspection.problems.map(p => `${p.key}: ${p.reason}`).join('; '), inspection);
  const policy = (values.AIHUB_MODEL_FALLBACK_POLICY?.trim() || 'auto') as FallbackPolicy;
  if (!['auto', 'confirm', 'off', 'preflight_only'].includes(policy)) throw new Error('AIHUB_MODEL_FALLBACK_POLICY must be auto, confirm, off or preflight_only.');
  let models: string[] | undefined;
  if (modelKey && values[modelKey]) {
    models = values[modelKey]!.split(',').map(model => model.trim());
    if (models.some(model => !model || /\s/.test(model)) || new Set(models).size !== models.length) {
      throw new Error(`${modelKey} must be a comma-separated list of distinct, nonempty exact model IDs.`);
    }
  }
  let maxAttempts: number | undefined;
  if (values.AIHUB_MODEL_MAX_ATTEMPTS) {
    const raw = values.AIHUB_MODEL_MAX_ATTEMPTS.trim();
    maxAttempts = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error('AIHUB_MODEL_MAX_ATTEMPTS must be a positive integer, including the first model.');
  }
  selectionSources.AIHUB_MODEL_FALLBACK_POLICY ??= 'built-in default';
  selectionSources.AIHUB_MODEL_MAX_ATTEMPTS ??= 'number of applicable candidates';
  if (modelKey) selectionSources[modelKey] ??= 'built-in task selection';
  const behaviorSources = Object.fromEntries(BEHAVIOR_KEYS.map(key => [key, selectionSources[key] ?? 'not configured']));
  for (const key of BEHAVIOR_KEYS) delete selectionSources[key];
  return { skill: options.skill, baseUrl: url!.toString().replace(/\/+$/, ''), apiKey: values.AIHUB_API_KEY, sources,
    resultCheck: { enabled: values.AIHUB_RESULT_CHECK_ENABLED!.trim() === '1', provider: values.AIHUB_RESULT_CHECK_PROVIDER!.trim() as ResultCheckConfig['provider'],
      models: values.AIHUB_RESULT_CHECK_MODELS!.split(',').map(item => item.trim()), sources: Object.fromEntries(Object.entries(behaviorSources).filter(([key]) => key.startsWith('AIHUB_RESULT_CHECK_'))) },
    feedback: { threshold: Number(values.AIHUB_ERROR_REPORT_THRESHOLD), ...(values.AIHUB_SUPPORT_URL ? { supportUrl: values.AIHUB_SUPPORT_URL.trim() } : {}),
      sources: Object.fromEntries(Object.entries(behaviorSources).filter(([key]) => !key.startsWith('AIHUB_RESULT_CHECK_'))) },
    modelSelection: { ...(models ? { models } : {}), policy, ...(maxAttempts ? { maxAttempts } : {}), sources: selectionSources } };
}

export function credentialId(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Use before logging or persisting remote data. Never put API keys in argv. */
export function redact(text: string, secrets: string[] = []): string {
  let clean = text;
  for (const secret of secrets) if (secret) clean = clean.split(secret).join('[redacted]');
  return clean.replace(/(https?:\/\/[^\s/:]+:)[^@\s]+@/g, '$1***@')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]');
}

export function sanitized<T>(value: T, secrets: string[]): T {
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') return redact(item, secrets);
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) =>
      [key, /^(api[_-]?key|authorization|password|secret|access_token)$/i.test(key) ? '[redacted]' : visit(entry)],
    ));
    return item;
  };
  return visit(value) as T;
}
