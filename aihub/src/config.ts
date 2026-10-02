import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export interface Config { baseUrl: string; apiKey: string }
export interface LoadedConfig extends Config {
  skill: string;
  sources: Record<'AIHUB_API_KEY' | 'AIHUB_BASE_URL', string>;
}
const KEYS = ['AIHUB_API_KEY', 'AIHUB_BASE_URL'] as const;
// Stable Plugin manifest name; independent of the installation directory or host Agent.
const PLUGIN_NAME = 'aihub';
// Retained from the source client's configuration. This is the API root, not /v1.
const DEFAULT_BASE_URL = 'https://api.aihubmax.com';

export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(AIHUB_API_KEY|AIHUB_BASE_URL)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]!] = value;
  }
  return values;
}

function readEnv(path: string): Record<string, string> {
  try { return parseEnv(readFileSync(path, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Cannot read configuration file: ${path}`);
  }
}

export function loadConfig(options: {
  skill: string; useGlobalConfig?: boolean; cwd?: string;
  env?: NodeJS.ProcessEnv; homeDirectory?: string;
}): LoadedConfig {
  const { skill, useGlobalConfig = true, cwd = process.cwd(), env = process.env, homeDirectory = homedir() } = options;
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(skill)) throw new Error('A valid caller Skill name is required.');
  const layers: Array<{ name: string; values: Record<string, string | undefined> }> = [{ name: 'environment', values: env }];
  for (const name of [`.env.${skill}`, '.env.local', '.env']) {
    const path = join(cwd, name);
    layers.push({ name: path, values: readEnv(path) });
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
    for (const path of paths) layers.push({ name: path, values: readEnv(path) });
  }
  const values: Record<string, string> = {};
  const sources = {} as LoadedConfig['sources'];
  for (const key of KEYS) {
    for (const layer of layers) {
      if (layer.values[key]?.trim()) {
        values[key] = layer.values[key]!;
        sources[key] = layer.name;
        break;
      }
    }
  }
  if (!values.AIHUB_API_KEY) throw new Error(`Missing AIHUB_API_KEY. Set it in the process environment, the calling project's .env.${skill}, .env.local or .env, or ~/.config/${PLUGIN_NAME}/.env (shared) / .env.${skill} (Skill-specific). Global configuration is ${useGlobalConfig ? 'enabled automatically' : 'disabled by --no-global-config'}. When enabled, ~/.config/${skill}/.env is the lowest-priority global fallback after all Plugin files.`);
  if (!values.AIHUB_BASE_URL) { values.AIHUB_BASE_URL = DEFAULT_BASE_URL; sources.AIHUB_BASE_URL = 'built-in default'; }
  let url: URL;
  try { url = new URL(values.AIHUB_BASE_URL); } catch { throw new Error('AIHUB_BASE_URL must be an absolute HTTP(S) API root.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('AIHUB_BASE_URL must use HTTP(S), without embedded credentials, query or fragment.');
  }
  return { skill, baseUrl: url.toString().replace(/\/+$/, ''), apiKey: values.AIHUB_API_KEY, sources };
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
