import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AihubmaxClient, ApiError } from './apiClient.js';
import { credentialId, sanitized, type LoadedConfig } from './config.js';
import { selectionPlan, type Candidate, type SelectionPlan } from './selection.js';
import { assertOutsideInstallation, withJobLock, writePrivateRecord } from './state.js';
import { generate, resume, understand, nativeMusic, failureInfo, TaskPersistenceError } from './workflow.js';

interface Attempt {
  index: number; model: string; submitted: boolean;
  state: 'preflight' | 'skipped' | 'active' | 'finished';
  task_record?: string;
  result?: Record<string, unknown>;
}
export interface RunRecord {
  schema_version: 1; kind: 'aihub-run'; id: string; created_at: string;
  skill: string; service_url: string; credential_id: string;
  plan: SelectionPlan; plan_hash: string; cursor: number;
  status: string; attempts: Attempt[];
  confirmation?: { token: string; index: number; model: string; params: Record<string, unknown>; reason: string };
  approvals: string[];
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export async function readRun(cfg: LoadedConfig, record: string): Promise<RunRecord> {
  assertOutsideInstallation(record);
  const run = JSON.parse(await readFile(record, 'utf8')) as RunRecord;
  if (run.kind !== 'aihub-run' || run.schema_version !== 1 || !run.plan || !Array.isArray(run.attempts) || !Array.isArray(run.approvals) ||
    !Number.isInteger(run.cursor) || run.cursor < 0 || run.cursor > run.plan.candidates.length || run.plan_hash !== hash(run.plan)) throw new Error('Invalid or modified run plan. Create a new request instead of editing an active record.');
  if (run.skill !== cfg.skill || run.service_url !== cfg.baseUrl || run.credential_id !== credentialId(cfg.apiKey)) throw new Error('This run belongs to another Skill, service or credential. Restore its original configuration.');
  return run;
}
async function saveRun(cfg: LoadedConfig, record: string, run: RunRecord): Promise<void> {
  await writePrivateRecord(record, sanitized(run, [cfg.apiKey]));
}
function output(run: RunRecord, record: string): Record<string, unknown> {
  const last = run.attempts.at(-1)?.result;
  return { schema_version: 1, status: run.status, run_record: record,
    source: run.plan.source, fallback_policy: run.plan.policy,
    attempted_models: run.attempts.filter(a => a.submitted).map(a => a.model),
    attempts: run.attempts, excluded: run.plan.excluded,
    ...(last ? { result: last, files: last.files ?? [], model: last.model ?? run.attempts.at(-1)?.model, ...(last.task_id ? { task_id: last.task_id } : {}) } : {}),
    ...(run.confirmation ? { confirmation: run.confirmation } : {}),
    ...(!['delivered', 'failed', 'no_compatible_model', 'attempt_limit'].includes(run.status)
      ? { next_action: { command: 'continue', args: ['--skill', run.skill, '--record', record,
        ...(run.confirmation ? ['--confirm', run.confirmation.token] : []), '--wait-seconds', '30'] } } : {}),
  };
}

async function available(client: AihubmaxClient, candidate: Candidate): Promise<string | undefined> {
  if (candidate.protocol === 'native-music') return undefined; // Native model IDs have a separate protocol.
  if (candidate.protocol === 'understanding') {
    const model = (await client.listLlmModels()).find(row => row.id === candidate.model);
    if (!model) return 'Model is not visible in the current LLM capability registry.';
    const content = candidate.params!.content as Array<{ type: string }>;
    const capabilities = content.map(part => part.type.replace('_url', '').replace('image', 'vision'));
    if (!model.capabilities || capabilities.some(type => !model.capabilities!.includes(type))) return 'The model does not declare all required media capabilities.';
    return undefined;
  }
  return (await client.listLiveModels()).has(candidate.model) ? undefined : 'The exact model ID is not visible to the current account.';
}

/** A terminal task failure is distinct from a failed request, query or download. */
function disposition(result: Record<string, unknown>): 'next' | 'stop' | 'recover' | 'done' {
  if (result.status === 'delivered') return 'done';
  if (result.status === 'remote_failed') {
    // The task is terminal, but an explicit error may be account/input/policy-wide.
    // Gateway public_task_error maps exhausted model channels/credentials to model_unavailable.
    // Content policy, timeout and unclassified service errors must not be treated as model failures.
    const error = result.error as { code?: string } | undefined;
    return !error || ['model_not_support_capability', 'model_unavailable'].includes(error.code ?? '') ? 'next' : 'stop';
  }
  if (result.status === 'not_submitted') {
    const failure = result.failure as { http_status?: number; code?: string; ambiguous?: boolean } | undefined;
    return failure && !failure.ambiguous && failure.http_status === 422 && ['model_not_support_capability', 'model_unavailable'].includes(failure.code ?? '') ? 'next' : 'stop';
  }
  return 'recover';
}

export async function startRun(cfg: LoadedConfig, request: Record<string, unknown>, outputDir: string, waitSeconds: number) {
  const plan = sanitized(selectionPlan(cfg, request), [cfg.apiKey]);
  const id = randomUUID();
  const record = join(resolve(outputDir), `aihub-run-${id}`, 'run.json');
  assertOutsideInstallation(record);
  const run: RunRecord = { schema_version: 1, kind: 'aihub-run', id, created_at: new Date().toISOString(),
    skill: cfg.skill, service_url: cfg.baseUrl, credential_id: credentialId(cfg.apiKey),
    plan, plan_hash: hash(plan), cursor: 0, status: 'ready', attempts: [], approvals: [] };
  await saveRun(cfg, record, run);
  return continueRun(cfg, record, waitSeconds);
}

export async function continueRun(cfg: LoadedConfig, recordInput: string, waitSeconds: number, confirmation?: string): Promise<Record<string, unknown>> {
  const record = resolve(recordInput);
  assertOutsideInstallation(record);
  return withJobLock(record, async () => {
    const run = await readRun(cfg, record);
    const expectedToken = (index: number) => hash({ plan: run.plan_hash, index, candidate: run.plan.candidates[index] });
    if (run.confirmation && (run.confirmation.index !== run.cursor || run.confirmation.token !== expectedToken(run.cursor) ||
      run.confirmation.model !== run.plan.candidates[run.cursor]?.model ||
      hash(run.confirmation.params) !== hash(run.plan.candidates[run.cursor]?.params))) throw new Error('The saved confirmation no longer matches this candidate and request.');
    if (confirmation) {
      if (!run.confirmation || confirmation !== run.confirmation.token) throw new Error('Confirmation does not match the pending model and parameters.');
      run.approvals.push(confirmation);
      delete run.confirmation;
      run.status = 'ready';
      await saveRun(cfg, record, run);
    } else if (run.confirmation) return output(run, record);
    if (['delivered', 'failed', 'no_compatible_model', 'attempt_limit'].includes(run.status)) return output(run, record);

    const client = new AihubmaxClient(cfg);
    // One invocation has one shared wait budget; moving to another model does not reset it.
    const deadline = Date.now() + waitSeconds * 1000;
    const remainingWait = () => Math.max(0, Math.min(600, Math.floor((deadline - Date.now()) / 1000)));
    const finish = async (status: string) => { run.status = status; await saveRun(cfg, record, run); return output(run, record); };
    while (run.cursor < run.plan.candidates.length) {
      const candidate = run.plan.candidates[run.cursor]!;
      let attempt = run.attempts.find(row => row.index === run.cursor);
      if (attempt?.state === 'active') {
        if (attempt.task_record) {
          const childPath = relative(dirname(record), attempt.task_record);
          if (!isAbsolute(attempt.task_record) || !childPath || childPath === '..' || childPath.startsWith(`..${sep}`) || isAbsolute(childPath)) throw new Error('Attempt record must remain inside this run.');
          attempt.result = await resume(cfg, attempt.task_record, remainingWait());
        } else if (!attempt.result) {
          // A native request may have completed remotely before the process stopped.
          attempt.result = { status: 'submission_unknown', model: candidate.model, error: 'Native submission outcome is unknown; no automatic repeat or fallback.' };
        }
        const action = disposition(attempt.result!);
        await saveRun(cfg, record, run);
        if (action === 'done') { attempt.state = 'finished'; return finish('delivered'); }
        if (action === 'recover') return finish(String(attempt.result!.status));
        attempt.state = 'finished';
        if (action === 'stop') return finish('failed');
        run.cursor++;
        await saveRun(cfg, record, run);
        continue;
      }

      const submitted = run.attempts.filter(row => row.submitted).length;
      if (run.cursor > 0 && (run.plan.policy === 'off' || (run.plan.policy === 'preflight_only' && submitted > 0))) return finish('failed');
      if (submitted >= run.plan.max_attempts) return finish('attempt_limit');
      if (!attempt) {
        attempt = { index: run.cursor, model: candidate.model, submitted: false, state: 'preflight' };
        run.attempts.push(attempt);
      }
      let rejection = candidate.rejection;
      if (!rejection) {
        try { rejection = await available(client, candidate); }
        catch (error) {
          attempt.result = { status: 'preflight_failed', model: candidate.model, error: (error as Error).message, failure: failureInfo(error, cfg) };
          return finish('preflight_failed'); // Registry failure does not prove any individual model unavailable.
        }
      }
      if (rejection) {
        attempt.state = 'skipped';
        attempt.result = { status: 'incompatible_or_unavailable', model: candidate.model, reason: rejection };
        run.cursor++;
        await saveRun(cfg, record, run);
        continue;
      }

      const token = expectedToken(run.cursor);
      if (run.cursor > 0 && run.plan.policy === 'confirm' && !run.approvals.includes(token)) {
        run.confirmation = { token, index: run.cursor, model: candidate.model, params: candidate.params!,
          reason: 'The previous candidate could not complete this request. Confirm this exact replacement model and parameters before submitting.' };
        return finish('confirmation_required');
      }
      const onRecord = async (taskRecord: string) => {
        attempt!.task_record = taskRecord;
        attempt!.state = 'active';
        attempt!.submitted = true;
        await saveRun(cfg, record, run); // Must succeed before any generation POST.
      };
      const outputDir = join(dirname(record), `attempt-${run.cursor + 1}`);
      try {
        const params = candidate.params!;
        if (candidate.protocol === 'generation') {
          attempt.result = await generate(cfg, { media: candidate.media, model: candidate.model, params, outputDir, waitSeconds: remainingWait(), onRecord });
        } else if (candidate.protocol === 'understanding') {
          attempt.result = await understand(cfg, { model: candidate.model, prompt: params.prompt as string,
            content: params.content as Array<Record<string, unknown>>, outputDir, waitSeconds: remainingWait(),
            systemPrompt: params.system_prompt as string | undefined, maxTokens: params.max_tokens as number | undefined,
            temperature: params.temperature as number | undefined, onRecord });
        } else {
          attempt.result = await nativeMusic(cfg, { model: candidate.model, body: params, outputDir, onSubmit: async () => {
            attempt!.state = 'active'; attempt!.submitted = true;
            await saveRun(cfg, record, run);
          } });
        }
      } catch (error) {
        if (error instanceof TaskPersistenceError) {
          attempt.result = error.output();
          await saveRun(cfg, record, run);
          return finish('persistence_failed');
        }
        attempt.result = { status: attempt.submitted ? (error instanceof ApiError && !error.ambiguous ? 'not_submitted' : 'submission_unknown') : 'preflight_failed',
          model: candidate.model, error: (error as Error).message, failure: failureInfo(error, cfg) };
        await saveRun(cfg, record, run);
        return finish(String(attempt.result.status));
      }
      await saveRun(cfg, record, run);
      const action = disposition(attempt.result);
      if (action === 'done') { attempt.state = 'finished'; return finish('delivered'); }
      if (action === 'recover') return finish(String(attempt.result.status));
      attempt.state = 'finished';
      if (action === 'stop') return finish('failed');
      run.cursor++;
      await saveRun(cfg, record, run);
    }
    return finish(run.attempts.some(a => a.submitted) ? 'failed' : 'no_compatible_model');
  });
}
