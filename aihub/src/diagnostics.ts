import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ApiError, TaskResponse } from './apiClient.js';
import { credentialId, sanitized, type LoadedConfig } from './config.js';
import { assertOutsideInstallation, withJobLock, writePrivateRecord, writePrivateText } from './state.js';

type Stage = 'registry' | 'submission' | 'query' | 'upload' | 'remote_execution' | 'other';
interface FailureEvent {
  id: string; at: string; stage: Stage; http_status: number; code: string; ambiguous: boolean;
  request_id?: string; task_id?: string;
}
const context = new AsyncLocalStorage<FailureEvent[]>();
export function collectRequestErrors<T>(run: (events: FailureEvent[]) => Promise<T>): Promise<T> {
  const events: FailureEvent[] = [];
  return context.run(events, () => run(events));
}
const CODES = new Set(['model_unavailable', 'model_not_support_capability', 'content_policy_violation',
  'timeout', 'service_unavailable', 'network_error', 'ambiguous', 'invalid_response', 'insufficient_quota',
  'invalid_api_key', 'rate_limit_exceeded', 'authentication_error', 'permission_denied']);
function code(value: unknown): string { return typeof value === 'string' && CODES.has(value) ? value : 'unknown_error'; }
function identifier(value: unknown): string | undefined { return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value) ? value : undefined; }

/** Called for each failed HTTP attempt, including bounded read retries. No response bodies. */
export function observeRequestError(error: ApiError, method: string, path: string): void {
  if (!context.getStore() || error.type === 'validation' || ['deadline_exceeded', 'model_not_support_capability', 'content_policy_violation'].includes(error.code ?? '')) return;
  const stage: Stage = path.startsWith('/v1/tasks/') ? 'query' : method === 'GET' && (path.includes('/models') || path.includes('/configs/') || path === '/api/pricing') ? 'registry'
    : path.startsWith('/v1/files/') ? 'upload' : method === 'POST' ? 'submission' : 'other';
  const task = stage === 'query' ? identifier(decodeURIComponent(path.split('?')[0]!.split('/').at(-1)!)) : undefined;
  context.getStore()!.push({ id: randomUUID(), at: new Date().toISOString(), stage, http_status: error.status,
    code: code(error.code), ambiguous: error.ambiguous,
    ...(identifier(error.requestId) ? { request_id: identifier(error.requestId) } : {}), ...(task ? { task_id: task } : {}) });
}
export function observeTerminalTask(task: TaskResponse): void {
  if (task.status !== 'failed' || ['model_not_support_capability', 'content_policy_violation'].includes(task.error?.code ?? '')) return;
  // Polling the same terminal task must never create new failures.
  const id = 'task-' + createHash('sha256').update(task.id).digest('hex');
  context.getStore()?.push({ id, at: new Date().toISOString(), stage: 'remote_execution', http_status: 200,
    code: code(task.error?.code), ambiguous: false, ...(identifier(task.id) ? { task_id: identifier(task.id) } : {}) });
}

export const ISSUE_URL = 'https://github.com/cookaihq/plugin-marketplace/issues/new';
interface Diagnostic {
  schema_version: 1; kind: 'aihub-diagnostic'; events: FailureEvent[]; notice_at?: string;
  context?: { plugin_version: string; skill: string; task_status: string; models: string[];
    attempts: Array<{ model: string; submitted: boolean; state: string }> };
}
/** All fields sent to the public draft are constructed explicitly; raw logs are never copied. */
export async function feedback(cfg: LoadedConfig, output: Record<string, unknown>, events: FailureEvent[]): Promise<Record<string, unknown> | undefined> {
  const record = [output.run_record, output.source_record, output.record].find(value => typeof value === 'string') as string | undefined;
  if (!events.length && !record) return;
  const directory = record ? dirname(resolve(record)) : resolve('data/aihub', `diagnostic-${randomUUID()}`);
  const path = join(directory, 'diagnostic.json');
  assertOutsideInstallation(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return withJobLock(path, async () => {
    let saved: Diagnostic = { schema_version: 1, kind: 'aihub-diagnostic', events: [] };
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as Diagnostic;
      if (parsed.kind !== 'aihub-diagnostic' || !Array.isArray(parsed.events)) throw new Error('Invalid diagnostic record.');
      saved = parsed;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const secrets = [cfg.apiKey, credentialId(cfg.apiKey)];
    for (const event of events) if (!saved.events.some(item => item.id === event.id)) saved.events.push(sanitized(event, secrets));
    const count = saved.events.length;
    if (!count) return;
    const safeModel = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,100}$/.test(value) && !secrets.some(secret => value.includes(secret));
    const version = (JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
    const external = (output.external ?? (output.result_check as Record<string, unknown> | undefined)?.external) as { model?: string } | undefined;
    const models = [...new Set([...(Array.isArray(output.attempted_models) ? output.attempted_models : [output.model]), external?.model].filter(safeModel))];
    const statuses = ['delivered', 'failed', 'remote_failed', 'attempt_limit', 'not_submitted', 'unavailable', 'waiting', 'query_failed', 'submission_unknown', 'preflight_failed', 'matched', 'mismatched', 'inconclusive', 'checking'];
    const taskStatus = statuses.includes(String(output.status)) ? String(output.status) : 'unknown';
    const attempts = (Array.isArray(output.attempts) ? output.attempts : []).flatMap(a =>
      a && safeModel(a.model) && typeof a.submitted === 'boolean' && ['preflight', 'skipped', 'active', 'finished'].includes(a.state)
        ? [{ model: a.model as string, submitted: a.submitted as boolean, state: a.state as string }] : []);
    saved.context = { plugin_version: version, skill: cfg.skill, task_status: taskStatus,
      models: [...new Set([...(saved.context?.models ?? []), ...models])], attempts: attempts.length ? attempts : saved.context?.attempts ?? [] };
    const terminal = ['failed', 'remote_failed', 'attempt_limit', 'not_submitted'].includes(String(output.status)) ||
      ((output.status === 'unavailable' || (output.result_check as { status?: string } | undefined)?.status === 'unavailable') && events.length > 0);
    const account = saved.events.some(e => [401, 402, 403].includes(e.http_status));
    const required = count >= (cfg.feedback?.threshold ?? 3) || terminal || account;
    const showNotice = required && !saved.notice_at;
    const draftPath = join(directory, 'issue-draft.md');
    // Do not include service URLs, request/task IDs, paths, prompts, credential hashes or raw error strings.
    const rows = saved.events.map((e, i) => `| ${i + 1} | ${e.at} | ${e.stage} | ${e.http_status} | ${code(e.code)} | ${e.ambiguous ? 'yes' : 'no'} |`).join('\n');
    const advice = account ? '请先核对服务地址与账号、API Key 权限或余额；不要为达到错误阈值重复请求。'
      : '请联系当前 AIhub 服务管理员检查上游错误；若怀疑 Plugin 的安装、参数转换或恢复逻辑有问题，可提交仓库 Issue。';
    if (required) {
      const draft = `# AIhub 错误反馈草稿\n\nPlugin: ${version}\nSkill: ${cfg.skill}\n运行平台: ${process.platform}; Node: ${process.version}\n` +
        `尝试模型: ${saved.context.models.filter(safeModel).join(', ') || '未记录'}\n任务状态: ${taskStatus}\n` +
        `独立上游错误数: ${count}\n\n${advice}\n\n` +
        '| # | UTC 时间 | 阶段 | HTTP | 错误代码 | 提交是否不明 |\n| --- | --- | --- | --- | --- | --- |\n' + rows +
        `\n\n请补充复现步骤，并检查内容后再提交：${ISSUE_URL}\n` +
        '任务/请求 ID 只保留在私下诊断报告中，仅提供给对应服务管理员。该草稿未自动发送。\n';
      await writePrivateText(draftPath, draft);
      if (showNotice) saved.notice_at = new Date().toISOString();
    }
    await writePrivateRecord(path, saved);
    return { upstream_error_count: count, report_required: required, show_notice: showNotice,
      ...(required ? { diagnostic: path, issue_draft: draftPath, issue_url: ISSUE_URL, advice,
        support: cfg.feedback?.supportUrl ?? '联系当前 AIhub 服务管理员',
        privacy_notice: 'diagnostic.json 含定位所需任务/请求 ID，仅私下交给对应服务管理员；公开 Issue 使用已脱敏的 issue-draft.md。' } : {}) };
  });
}
