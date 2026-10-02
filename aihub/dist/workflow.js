import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { AihubmaxClient, ApiError, PollBudgetExceededError } from './apiClient.js';
import { credentialId, sanitized } from './config.js';
import { checkMediaTools, downloadAssets, downloadJsonAssets, validateLocalMedia } from './download.js';
import { validateGeneration } from './models.js';
import { assertOutsideInstallation, readJob, recordPath, withJobLock, writeJob } from './state.js';
function cleanError(error, cfg) {
    return sanitized(error instanceof Error ? error.message : String(error), [cfg.apiKey]);
}
export function failureInfo(error, cfg) {
    return sanitized(error instanceof ApiError ? { http_status: error.status, code: error.code,
        type: error.type, request_id: error.requestId, ambiguous: error.ambiguous }
        : { http_status: 0, ambiguous: true }, [cfg.apiKey]);
}
export class TaskPersistenceError extends Error {
    job;
    record;
    constructor(job, record, message) {
        super(message);
        this.job = job;
        this.record = record;
        this.name = 'TaskPersistenceError';
    }
    output() {
        const output = result(this.job, this.record, 'persistence_failed');
        if (this.job.submission.state === 'known') {
            output.next_action = { command: 'task', args: ['--skill', this.job.skill, '--task-id', this.job.submission.task.id,
                    '--media', this.job.media, '--output-dir', dirname(dirname(this.record))] };
        }
        return { ...output, error: this.message, record_saved: false };
    }
}
const RESULT_METADATA_KEYS = [
    'lyrics', 'seed', 'degraded_reason', 'map_type', 'result_type',
    'profile_id', 'character_id', 'voice_id', 'duration', 'resolution',
];
const STRUCTURED_AUDIO_MODELS = new Set(['paraformer-v2', 'paraformer-8k-v2', 'cohere-transcribe', 'scribe-v2']);
const LLM_SUBMIT_TIMEOUT_MS = 120_000;
/** Keep task-specific fields visible without exposing the full remote response. */
function resultMetadata(task) {
    const metadata = {};
    for (const key of RESULT_METADATA_KEYS) {
        const value = task[key];
        if (value !== undefined && value !== null)
            metadata[key] = value;
    }
    for (const item of task.results ?? []) {
        if (!item || typeof item !== 'object' || Array.isArray(item))
            continue;
        const record = item;
        for (const key of RESULT_METADATA_KEYS) {
            const value = record[key];
            if (value !== undefined && value !== null && metadata[key] === undefined)
                metadata[key] = value;
        }
    }
    return Object.keys(metadata).length ? metadata : undefined;
}
function newJob(cfg, media, model, outputDir) {
    const id = randomUUID();
    const record = recordPath(outputDir, id);
    assertOutsideInstallation(record);
    const now = new Date().toISOString();
    return { record, job: { schema_version: 1, local_id: id, created_at: now, updated_at: now,
            skill: cfg.skill, media, model, service_url: cfg.baseUrl, credential_id: credentialId(cfg.apiKey),
            output_dir: join(dirname(record), 'files'), submission: { state: 'submitting' }, files: [], failed: [] } };
}
export function result(job, record, statusOverride) {
    const sub = job.submission;
    let status;
    if (sub.state !== 'known')
        status = sub.state === 'submitting' ? 'submission_unknown' : sub.state;
    else if (sub.task.status === 'failed')
        status = 'remote_failed';
    else if (sub.task.status !== 'completed')
        status = job.last_error ? 'query_failed' : 'waiting';
    else if (job.media === 'understanding' && job.text !== undefined)
        status = 'delivered';
    else if (job.failed.length)
        status = job.files.length ? 'partial' : 'download_failed';
    else
        status = job.files.length ? 'delivered' : 'download_pending';
    const error = sub.state === 'known'
        ? sub.task.error ?? job.last_error
        : sub.state === 'submitting' ? 'The process stopped before submission was confirmed. Do not resubmit automatically.' : sub.error;
    const metadata = sub.state === 'known' ? resultMetadata(sub.task) : undefined;
    return { schema_version: 1, status: statusOverride ?? status, record, media: job.media, model: job.model,
        ...(job.failure ? { failure: job.failure } : {}),
        ...(sub.state === 'known' ? { task_id: sub.task.id, remote_status: sub.task.status, progress: sub.task.progress } : {}),
        ...(job.text !== undefined ? { text: job.text } : {}), files: job.files, failed: job.failed, ...(metadata ? { result_metadata: metadata } : {}), ...(error ? { error } : {}),
        ...(sub.state === 'known' && status !== 'remote_failed' && status !== 'delivered'
            ? { next_action: { command: 'resume', args: ['--skill', job.skill, '--record', record, '--wait-seconds', '30'] } }
            : {}) };
}
async function save(record, job, cfg) {
    try {
        await writeJob(record, sanitized(job, [cfg.apiKey]));
    }
    catch (error) {
        if (job.submission.state === 'known')
            throw new TaskPersistenceError(job, record, `Task is known, but its recovery record could not be saved: ${cleanError(error, cfg)}. Keep task_id; use task after repairing storage.`);
        throw error;
    }
}
async function finishTextResult(job, record, cfg) {
    if (job.media !== 'understanding' || job.text === undefined || job.submission.state !== 'known' || job.submission.task.status !== 'completed')
        return;
    await mkdir(job.output_dir, { recursive: true, mode: 0o700 });
    const bytes = Buffer.byteLength(job.text, 'utf8');
    const existing = job.files.find(file => file.mime_type === 'text/plain' && file.path.startsWith(resolve(job.output_dir)));
    if (existing) {
        try {
            const info = await stat(existing.path);
            if (info.isFile() && info.size === bytes)
                return;
        }
        catch { /* Recreate a missing text result below. */ }
    }
    const path = join(job.output_dir, `result-${job.local_id}.txt`);
    await writeFile(path, job.text, { encoding: 'utf8', mode: 0o600 });
    job.files = [{ url: `task://${job.submission.task.id}/text`, path, bytes, mime_type: 'text/plain' }];
    await save(record, job, cfg);
}
async function finishDownload(job, record, cfg) {
    if (job.submission.state !== 'known' || job.submission.task.status !== 'completed' || job.media === 'understanding')
        return;
    const urls = [...new Set((job.submission.task.results ?? []).flatMap(item => {
            if (!item || typeof item !== 'object' || Array.isArray(item))
                return [];
            const result = item;
            return ['url', 'image_url', 'video_url', 'audio_url']
                .flatMap(key => typeof result[key] === 'string' ? [result[key]] : []);
        }))];
    if (!urls.length) {
        job.failed = [{ url: '', error: 'The completed task contains no downloadable media URL.' }];
        await save(record, job, cfg);
        return;
    }
    // Keep verified successful files when retrying only failed or missing assets.
    const kept = [];
    for (const file of job.files) {
        try {
            const info = await stat(file.path);
            if (urls.includes(file.url) && info.isFile() && info.size === file.bytes && info.size > 0)
                kept.push(file);
        }
        catch { /* A removed file must be downloaded again. */ }
    }
    job.files = kept;
    const pending = urls.filter(url => !kept.some(file => file.url === url));
    if (pending.length) {
        if (job.media !== 'document')
            await checkMediaTools();
        const downloaded = await downloadAssets(pending, job.output_dir, job.media);
        job.files.push(...downloaded.files);
        job.failed = downloaded.failed;
    }
    else
        job.failed = [];
    await save(record, job, cfg);
}
function structuredResultUrls(task) {
    const urls = [];
    const visit = (value) => {
        if (!value || typeof value !== 'object')
            return;
        if (Array.isArray(value)) {
            for (const item of value)
                visit(item);
            return;
        }
        for (const [key, entry] of Object.entries(value)) {
            if ((key === 'transcription_url' || key === 'result_url') && typeof entry === 'string')
                urls.push(entry);
            else if (key !== 'file_url')
                visit(entry);
        }
    };
    visit(task.results);
    return [...new Set(urls)];
}
function firstStructuredText(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = firstStructuredText(item);
            if (found)
                return found;
        }
        return undefined;
    }
    const record = value;
    if (typeof record.text === 'string' && record.text.trim())
        return record.text;
    for (const entry of Object.values(record)) {
        const found = firstStructuredText(entry);
        if (found)
            return found;
    }
    return undefined;
}
async function finishStructuredAudio(job, record, cfg) {
    if (job.submission.state !== 'known' || job.submission.task.status !== 'completed')
        return;
    const urls = structuredResultUrls(job.submission.task);
    let downloaded;
    if (urls.length) {
        downloaded = await downloadJsonAssets(urls, job.output_dir);
    }
    else {
        await mkdir(job.output_dir, { recursive: true, mode: 0o700 });
        const path = join(job.output_dir, `transcription-${job.local_id}.json`);
        const body = JSON.stringify(job.submission.task.results ?? [], null, 2) + '\n';
        await writeFile(path, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        downloaded = { files: [{ url: `task://${job.submission.task.id}/results`, path, bytes: Buffer.byteLength(body), mime_type: 'application/json' }], failed: [] };
    }
    job.files = downloaded.files;
    job.failed = downloaded.failed;
    job.text = firstStructuredText(job.submission.task.results);
    if (!job.text) {
        for (const file of job.files) {
            try {
                const parsed = JSON.parse(await readFile(file.path, 'utf8'));
                job.text = firstStructuredText(parsed);
                if (job.text)
                    break;
            }
            catch { /* The JSON downloader already validates successful files. */ }
        }
    }
    await save(record, job, cfg);
}
async function finishResult(job, record, cfg) {
    if (job.media === 'understanding')
        await finishTextResult(job, record, cfg);
    else if (job.media === 'audio' && STRUCTURED_AUDIO_MODELS.has(job.model))
        await finishStructuredAudio(job, record, cfg);
    else
        await finishDownload(job, record, cfg);
}
async function queryAndDeliver(client, cfg, job, record, waitSeconds) {
    if (job.submission.state !== 'known')
        return result(job, record);
    const id = job.submission.task.id;
    delete job.last_error;
    try {
        const task = waitSeconds > 0
            ? await client.pollTask(id, waitSeconds, false, async (update) => {
                job.submission = { state: 'known', task: sanitized(update, [cfg.apiKey]) };
                await save(record, job, cfg);
            })
            : await client.getTask(id);
        job.submission = { state: 'known', task: sanitized(task, [cfg.apiKey]) };
        delete job.failure;
        if (task.model)
            job.model = task.model;
        if (job.media === 'understanding' && task.status === 'completed')
            job.text = extractText(task) ?? undefined;
        await save(record, job, cfg);
    }
    catch (error) {
        if (error instanceof TaskPersistenceError)
            throw error;
        if (error instanceof PollBudgetExceededError) {
            if (error.lastTask)
                job.submission = { state: 'known', task: sanitized(error.lastTask, [cfg.apiKey]) };
            await save(record, job, cfg);
            return { ...result(job, record, 'waiting'), wait_result: 'budget_exhausted' };
        }
        job.last_error = cleanError(error, cfg);
        job.failure = failureInfo(error, cfg);
        try {
            await save(record, job, cfg);
        }
        catch { /* Return the known task ID even if persistence fails. */ }
        return result(job, record, 'query_failed');
    }
    try {
        await finishResult(job, record, cfg);
    }
    catch (error) {
        if (error instanceof TaskPersistenceError)
            throw error;
        job.last_error = cleanError(error, cfg);
        try {
            await save(record, job, cfg);
        }
        catch { /* Remote task must stay visible to the caller. */ }
        return result(job, record, 'download_failed');
    }
    return result(job, record);
}
export async function generate(cfg, options) {
    const path = validateGeneration(options.media, options.model, options.params);
    assertOutsideInstallation(options.outputDir);
    if (options.media !== 'document')
        await checkMediaTools();
    const client = new AihubmaxClient(cfg);
    const live = await client.listLiveModels();
    if (!live.has(options.model))
        throw new Error('The exact model ID is not present in the current key model list. Run models and use its unchanged ID. No generation was submitted.');
    const { job, record } = newJob(cfg, options.media, options.model, options.outputDir);
    await save(record, job, cfg);
    await options.onRecord?.(record);
    process.stderr.write(`AIhub task record: ${record}\n`);
    return withJobLock(record, async () => {
        try {
            const task = await client.submitGeneration(path, { ...options.params, model: options.model });
            job.submission = { state: 'known', task: sanitized(task, [cfg.apiKey]) };
            await save(record, job, cfg);
        }
        catch (error) {
            if (error instanceof TaskPersistenceError)
                throw error;
            if (job.submission.state === 'known') {
                job.last_error = `Task accepted, but saving its ID failed: ${cleanError(error, cfg)}. Keep this task_id and use task to recover.`;
                return result(job, record, 'query_failed');
            }
            job.failure = failureInfo(error, cfg);
            job.submission = { state: error instanceof ApiError && !error.ambiguous ? 'not_submitted' : 'submission_unknown', error: cleanError(error, cfg) };
            try {
                await save(record, job, cfg);
            }
            catch { /* Still return the submission outcome. */ }
            return result(job, record);
        }
        if (job.submission.task.status === 'completed' || job.submission.task.status === 'failed') {
            try {
                await finishResult(job, record, cfg);
            }
            catch (error) {
                if (error instanceof TaskPersistenceError)
                    throw error;
                job.last_error = cleanError(error, cfg);
                return result(job, record, 'download_failed');
            }
            return result(job, record);
        }
        if (!options.waitSeconds)
            return result(job, record, 'submitted');
        return queryAndDeliver(client, cfg, job, record, options.waitSeconds);
    });
}
export async function resume(cfg, recordInput, waitSeconds) {
    const record = resolve(recordInput);
    assertOutsideInstallation(record);
    return withJobLock(record, async () => {
        const job = await readJob(record);
        if (job.skill !== cfg.skill || job.service_url !== cfg.baseUrl || job.credential_id !== credentialId(cfg.apiKey)) {
            throw new Error('This record belongs to a different Skill, API address or key. Restore its original configuration; to query with a deliberately changed key, use task with the known task ID.');
        }
        if (job.submission.state !== 'known')
            return result(job, record);
        return queryAndDeliver(new AihubmaxClient(cfg), cfg, job, record, waitSeconds);
    });
}
export async function adoptTask(cfg, id, media, outputDir, waitSeconds) {
    assertOutsideInstallation(outputDir);
    const client = new AihubmaxClient(cfg);
    let task;
    try {
        task = await client.getTask(id);
    }
    catch (error) {
        return { schema_version: 1, status: 'query_failed', task_id: id, error: cleanError(error, cfg), failure: failureInfo(error, cfg) };
    }
    const { job, record } = newJob(cfg, media, task.model ?? '', outputDir);
    job.submission = { state: 'known', task: sanitized(task, [cfg.apiKey]) };
    await save(record, job, cfg);
    return withJobLock(record, async () => {
        if (waitSeconds && task.status !== 'completed' && task.status !== 'failed')
            return queryAndDeliver(client, cfg, job, record, waitSeconds);
        try {
            await finishResult(job, record, cfg);
        }
        catch (error) {
            if (error instanceof TaskPersistenceError)
                throw error;
            job.last_error = cleanError(error, cfg);
            return result(job, record, 'download_failed');
        }
        return result(job, record);
    });
}
function extractText(task) {
    const first = Array.isArray(task.results) ? task.results[0] : undefined;
    if (typeof first === 'string')
        return first;
    if (!first || typeof first !== 'object')
        return null;
    const record = first;
    const choices = Array.isArray(record.choices) ? record.choices : [];
    const message = choices[0]?.message;
    const messageText = message && typeof message === 'object' ? message.content : undefined;
    if (typeof messageText === 'string')
        return messageText;
    if (typeof record.text === 'string')
        return record.text;
    if (typeof record.content === 'string')
        return record.content;
    return null;
}
export async function understand(cfg, options) {
    if (!options.content.length)
        throw new Error('understand 至少需要一个 image_url、audio_url、video_url 或 file_url 内容块。');
    if (!options.content.some((item) => ['image_url', 'audio_url', 'video_url', 'file_url'].includes(String(item.type))))
        throw new Error('understand 只接受图片、音频、视频或文件内容块；纯文本请求不属于 E1。');
    for (const item of options.content) {
        const type = String(item.type);
        if (!['image_url', 'audio_url', 'video_url', 'file_url'].includes(type))
            continue;
        const value = item[type];
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.url !== 'string') {
            throw new Error(`understand 的 ${type} 内容块必须是 {"url":"https://..."} 对象。`);
        }
    }
    const client = new AihubmaxClient(cfg);
    const available = await client.listLlmModels();
    const live = available.find((item) => item.id === options.model);
    if (!live)
        throw new Error(`模型 ${options.model} 不在 /v1/configs/llm_generations_models 返回的当前账号清单中。`);
    const needed = new Set(options.content.map((item) => String(item.type).replace('_url', '').replace('image', 'vision')));
    if (live.capabilities && [...needed].some((cap) => !live.capabilities.includes(cap)))
        throw new Error(`模型 ${options.model} 不具备所需多模态能力；不会静默切换模型。`);
    const body = { model: options.model, messages: [{ role: 'user', content: [{ type: 'text', text: options.prompt }, ...options.content] }] };
    if (options.systemPrompt)
        body.system_prompt = options.systemPrompt;
    if (options.maxTokens !== undefined)
        body.max_tokens = options.maxTokens;
    if (options.temperature !== undefined)
        body.temperature = options.temperature;
    const { job, record } = newJob(cfg, 'understanding', options.model, options.outputDir);
    await save(record, job, cfg);
    await options.onRecord?.(record);
    return withJobLock(record, async () => {
        try {
            const task = await client.submitGeneration('/v1/llm/generations', body, { timeoutMs: LLM_SUBMIT_TIMEOUT_MS });
            job.submission = { state: 'known', task: sanitized(task, [cfg.apiKey]) };
            await save(record, job, cfg);
        }
        catch (error) {
            if (error instanceof TaskPersistenceError)
                throw error;
            job.failure = failureInfo(error, cfg);
            job.submission = { state: error instanceof ApiError && !error.ambiguous ? 'not_submitted' : 'submission_unknown', error: cleanError(error, cfg) };
            await save(record, job, cfg).catch(() => { });
            return result(job, record);
        }
        if (job.submission.task.status === 'completed' || job.submission.task.status === 'failed') {
            if (job.submission.task.status === 'completed')
                job.text = extractText(job.submission.task) ?? undefined;
            try {
                await finishResult(job, record, cfg);
            }
            catch (error) {
                job.last_error = cleanError(error, cfg);
                return result(job, record, 'download_failed');
            }
            return result(job, record);
        }
        if (!options.waitSeconds)
            return result(job, record, 'submitted');
        return queryAndDeliver(client, cfg, job, record, options.waitSeconds);
    });
}
export async function nativeMusic(cfg, options) {
    if (options.model !== 'lyria-3-pro-preview')
        throw new Error('Gemini 原生音乐命令只接受模型 lyria-3-pro-preview；异步 lyria-3-pro 请使用 generate。');
    if (!Array.isArray(options.body.contents) || !options.body.contents.length)
        throw new Error('Gemini 原生音乐请求必须包含非空 contents。');
    const generationConfig = options.body.generationConfig;
    const modalities = generationConfig && typeof generationConfig === 'object' ? generationConfig.responseModalities : undefined;
    if (!Array.isArray(modalities) || !modalities.includes('AUDIO')) {
        throw new Error('Gemini 原生音乐请求的 generationConfig.responseModalities 必须包含 AUDIO。');
    }
    assertOutsideInstallation(options.outputDir);
    await checkMediaTools();
    await options.onSubmit?.();
    const response = await new AihubmaxClient(cfg).generateGeminiMusic(options.model, options.body);
    const parts = response.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
    const audio = parts.find((item) => item.inlineData?.data);
    if (!audio?.inlineData?.data)
        throw new Error('Gemini 音乐响应没有 inlineData 音频结果。');
    const mime = audio.inlineData.mimeType ?? 'audio/mpeg';
    const ext = mime === 'audio/wav' ? '.wav' : '.mp3';
    const dir = resolve(options.outputDir);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `lyria-${randomUUID()}${ext}`);
    const bytes = Buffer.from(audio.inlineData.data, 'base64');
    if (!bytes.length)
        throw new Error('Gemini 音乐 inlineData 为空。');
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    let file;
    try {
        file = await validateLocalMedia(path, 'audio');
    }
    catch (error) {
        await import('node:fs/promises').then(fs => fs.unlink(path)).catch(() => { });
        throw error;
    }
    const text = parts.find((item) => item.text)?.text;
    return { schema_version: 1, status: 'delivered', model: options.model, files: [file], ...(text ? { text } : {}) };
}
// Retained from the source upload guard: the endpoint accepts whole-file base64 JSON.
const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export async function upload(cfg, input) {
    const supplied = ['path', 'url', 'base64'].filter(key => input[key] !== undefined);
    if (supplied.length !== 1)
        throw new Error('Provide exactly one upload source: path, url or base64.');
    for (const key of supplied)
        if (typeof input[key] !== 'string' || !input[key])
            throw new Error(`${key} must be a nonempty string.`);
    if (input.file_name !== undefined && typeof input.file_name !== 'string')
        throw new Error('file_name must be a string.');
    const client = new AihubmaxClient(cfg);
    const name = input.file_name;
    try {
        let data;
        if (typeof input.url === 'string') {
            const url = new URL(input.url);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
                throw new Error('Upload URL must use HTTP(S) without embedded credentials.');
            data = await client.uploadUrl(input.url, name);
        }
        else if (typeof input.path === 'string') {
            const info = await stat(input.path);
            if (!info.isFile() || info.size > UPLOAD_MAX_BYTES || info.size === 0)
                throw new Error('Local upload must be a nonempty file no larger than 20 MiB. Use an accessible URL for larger files.');
            const bytes = await readFile(input.path);
            if (bytes.length > UPLOAD_MAX_BYTES)
                throw new Error('File changed while reading; upload exceeds 20 MiB.');
            data = await client.uploadBase64(bytes.toString('base64'), name ?? basename(input.path));
        }
        else {
            const base64 = input.base64;
            if (base64.length > Math.ceil(UPLOAD_MAX_BYTES / 3) * 4 + 256)
                throw new Error('Base64 upload exceeds the 20 MiB limit.');
            data = await client.uploadBase64(base64, name);
        }
        return { schema_version: 1, status: 'ok', ...data };
    }
    catch (error) {
        return { schema_version: 1, status: error instanceof ApiError && error.ambiguous ? 'submission_unknown' : 'not_submitted', error: cleanError(error, cfg), failure: failureInfo(error, cfg) };
    }
}
