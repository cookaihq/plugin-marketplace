import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, unlink, rmdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TaskResponse } from './apiClient.js';

export type Media = 'image' | 'video' | 'audio' | 'document' | 'understanding';
export interface SavedFile { url: string; path: string; bytes: number; mime_type: string }
export interface FailureInfo { http_status: number; code?: string; type?: string; request_id?: string; ambiguous: boolean }
export type Submission =
  | { state: 'submitting' }
  | { state: 'submission_unknown'; error: string }
  | { state: 'not_submitted'; error: string }
  | { state: 'known'; task: TaskResponse };
export interface Job {
  schema_version: 1; local_id: string; created_at: string; updated_at: string;
  skill: string; media: Media; model: string; service_url: string; credential_id: string;
  output_dir: string; submission: Submission; files: SavedFile[];
  failed: Array<{ url: string; error: string }>; text?: string; last_error?: string;
  failure?: FailureInfo;
}

const INSTALL_ROOT = fileURLToPath(new URL('../', import.meta.url));
export function assertOutsideInstallation(path: string): void {
  const install = statSync(INSTALL_ROOT);
  // Inspect filesystem identities: path strings alone miss symlinks and case-insensitive aliases.
  let ancestor = resolve(path);
  for (;;) {
    try { ancestor = realpathSync(ancestor); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  for (;;) {
    const info = statSync(ancestor);
    if (info.dev === install.dev && info.ino === install.ino) throw new Error('Task records and outputs must be outside the Plugin installation. Pass --output-dir to a task directory.');
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
}

export async function writeJob(path: string, job: Job): Promise<void> {
  await writePrivateRecord(path, { ...job, updated_at: new Date().toISOString() });
}

export async function writePrivateRecord(path: string, value: unknown): Promise<void> {
  await writePrivateText(path, JSON.stringify(value, null, 2) + '\n');
}

export async function writePrivateText(path: string, value: string): Promise<void> {
  assertOutsideInstallation(path);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(value);
    await handle.sync();
    await handle.close();
    await rename(temp, path);
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export async function readJob(path: string): Promise<Job> {
  const job = JSON.parse(await readFile(path, 'utf8')) as Job;
  if (job.schema_version !== 1 || !['image', 'video', 'audio', 'document', 'understanding'].includes(job.media) ||
      typeof job.skill !== 'string' || typeof job.service_url !== 'string' || typeof job.credential_id !== 'string' ||
      !isAbsolute(job.output_dir || '') || !Array.isArray(job.files) || !Array.isArray(job.failed) || !job.submission ||
      !['submitting', 'submission_unknown', 'not_submitted', 'known'].includes(job.submission.state)) {
    throw new Error('Invalid or unsupported AIhub task record.');
  }
  if (job.submission.state === 'known' && (!job.submission.task?.id || typeof job.submission.task.id !== 'string')) throw new Error('Task record has no remote task ID.');
  assertOutsideInstallation(path);
  assertOutsideInstallation(job.output_dir);
  return job;
}

/** Exclusive per-record work, including safe recovery after a dead local process. */
export async function withJobLock<T>(path: string, run: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  const token = `owner-${process.pid}-${randomUUID()}`;
  const candidate = `${lockPath}-${randomUUID()}`;
  await mkdir(candidate, { mode: 0o700 });
  const owner = await open(join(candidate, token), 'wx', 0o600);
  await owner.writeFile(JSON.stringify({ pid: process.pid }));
  await owner.close();
  let locked = false;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Publish a populated directory atomically. rename cannot replace another populated lock.
        await rename(candidate, lockPath);
        locked = true;
        break;
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
        let tokens: string[];
        try { tokens = await readdir(lockPath); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
        if (tokens.length > 1 || (tokens[0] && !/^owner-\d+-[a-f0-9-]+$/.test(tokens[0]))) throw new Error(`Task lock is invalid; inspect ${lockPath}.`);
        const staleToken = tokens[0];
        if (staleToken) {
          let pid: number;
          try { pid = (JSON.parse(await readFile(join(lockPath, staleToken), 'utf8')) as { pid: number }).pid; }
          catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
          if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid task lock owner.');
          try { process.kill(pid, 0); throw new Error(`Task record is in use by process ${pid}.`); }
          catch (probe) { if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') throw probe; }
          // Delete this exact old token, never a newly acquired owner's token at the same path.
          await unlink(join(lockPath, staleToken)).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
        }
        await rmdir(lockPath).catch((e: NodeJS.ErrnoException) => {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code || '')) throw e;
        });
      }
    }
    if (!locked) throw new Error('Could not acquire task record lock. Retry resume.');
    return await run();
  } finally {
    await rm(candidate, { recursive: true, force: true });
    if (locked) {
      await unlink(join(lockPath, token)).catch(() => {});
      await rmdir(lockPath).catch(() => {});
    }
  }
}

export function recordPath(outputDir: string, localId: string): string {
  return join(resolve(outputDir), `aihub-${localId}`, 'task.json');
}
