import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, unlink, rmdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const INSTALL_ROOT = fileURLToPath(new URL('../', import.meta.url));
export function assertOutsideInstallation(path) {
    const install = statSync(INSTALL_ROOT);
    // Inspect filesystem identities: path strings alone miss symlinks and case-insensitive aliases.
    let ancestor = resolve(path);
    for (;;) {
        try {
            ancestor = realpathSync(ancestor);
            break;
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            const parent = dirname(ancestor);
            if (parent === ancestor)
                throw error;
            ancestor = parent;
        }
    }
    for (;;) {
        const info = statSync(ancestor);
        if (info.dev === install.dev && info.ino === install.ino)
            throw new Error('Task records and outputs must be outside the Plugin installation. Pass --output-dir to a task directory.');
        const parent = dirname(ancestor);
        if (parent === ancestor)
            break;
        ancestor = parent;
    }
}
export async function writeJob(path, job) {
    assertOutsideInstallation(path);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temp, 'wx', 0o600);
    try {
        await handle.writeFile(JSON.stringify({ ...job, updated_at: new Date().toISOString() }, null, 2) + '\n');
        await handle.sync();
        await handle.close();
        await rename(temp, path);
    }
    catch (error) {
        await handle.close().catch(() => { });
        await unlink(temp).catch(() => { });
        throw error;
    }
}
export async function readJob(path) {
    const job = JSON.parse(await readFile(path, 'utf8'));
    if (job.schema_version !== 1 || !['image', 'video', 'audio', 'document', 'understanding'].includes(job.media) ||
        typeof job.skill !== 'string' || typeof job.service_url !== 'string' || typeof job.credential_id !== 'string' ||
        !isAbsolute(job.output_dir || '') || !Array.isArray(job.files) || !Array.isArray(job.failed) || !job.submission ||
        !['submitting', 'submission_unknown', 'not_submitted', 'known'].includes(job.submission.state)) {
        throw new Error('Invalid or unsupported AIhub task record.');
    }
    if (job.submission.state === 'known' && (!job.submission.task?.id || typeof job.submission.task.id !== 'string'))
        throw new Error('Task record has no remote task ID.');
    assertOutsideInstallation(path);
    assertOutsideInstallation(job.output_dir);
    return job;
}
/** Exclusive per-record work, including safe recovery after a dead local process. */
export async function withJobLock(path, run) {
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
            }
            catch (error) {
                if (!['EEXIST', 'ENOTEMPTY'].includes(error.code || ''))
                    throw error;
                let tokens;
                try {
                    tokens = await readdir(lockPath);
                }
                catch (e) {
                    if (e.code === 'ENOENT')
                        continue;
                    throw e;
                }
                if (tokens.length > 1 || (tokens[0] && !/^owner-\d+-[a-f0-9-]+$/.test(tokens[0])))
                    throw new Error(`Task lock is invalid; inspect ${lockPath}.`);
                const staleToken = tokens[0];
                if (staleToken) {
                    let pid;
                    try {
                        pid = JSON.parse(await readFile(join(lockPath, staleToken), 'utf8')).pid;
                    }
                    catch (e) {
                        if (e.code === 'ENOENT')
                            continue;
                        throw e;
                    }
                    if (!Number.isSafeInteger(pid) || pid <= 0)
                        throw new Error('Invalid task lock owner.');
                    try {
                        process.kill(pid, 0);
                        throw new Error(`Task record is in use by process ${pid}.`);
                    }
                    catch (probe) {
                        if (probe.code !== 'ESRCH')
                            throw probe;
                    }
                    // Delete this exact old token, never a newly acquired owner's token at the same path.
                    await unlink(join(lockPath, staleToken)).catch((e) => { if (e.code !== 'ENOENT')
                        throw e; });
                }
                await rmdir(lockPath).catch((e) => {
                    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code || ''))
                        throw e;
                });
            }
        }
        if (!locked)
            throw new Error('Could not acquire task record lock. Retry resume.');
        return await run();
    }
    finally {
        await rm(candidate, { recursive: true, force: true });
        if (locked) {
            await unlink(join(lockPath, token)).catch(() => { });
            await rmdir(lockPath).catch(() => { });
        }
    }
}
export function recordPath(outputDir, localId) {
    return join(resolve(outputDir), `aihub-${localId}`, 'task.json');
}
