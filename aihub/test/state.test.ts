import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withJobLock } from '../src/state.js';

const stateUrl = new URL('../src/state.js', import.meta.url).href;
type Outcome = { type: 'entered' } | { type: 'rejected'; error: string };
interface Worker {
  child: ChildProcess;
  ready: Promise<void>;
  outcome: Promise<Outcome>;
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

/** Exercise the real lock implementation in separate processes with IPC barriers. */
function worker(record: string): Worker {
  const script = `
import { withJobLock } from ${JSON.stringify(stateUrl)};
const command = () => new Promise(resolve => process.once('message', resolve));
const start = command();
process.send({ type: 'ready' });
await start;
try {
  await withJobLock(${JSON.stringify(record)}, async () => {
    const release = command();
    process.send({ type: 'entered' });
    await release;
  });
} catch (error) {
  process.send({ type: 'rejected', error: error.message });
}
process.disconnect();
`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let errors = '';
  child.stderr?.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  let outcomeResolve!: (outcome: Outcome) => void;
  let outcomeReject!: (error: Error) => void;
  let isReady = false;
  let hasOutcome = false;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const outcome = new Promise<Outcome>((resolve, reject) => { outcomeResolve = resolve; outcomeReject = reject; });
  child.on('message', (message: { type?: string; error?: string }) => {
    if (message.type === 'ready') { isReady = true; readyResolve(); }
    if (message.type === 'entered' || message.type === 'rejected') {
      hasOutcome = true;
      outcomeResolve(message.type === 'entered' ? { type: 'entered' } : { type: 'rejected', error: message.error ?? '' });
    }
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', error => { readyReject(error); outcomeReject(error); reject(error); });
    child.once('close', (code, signal) => {
      const error = new Error(`Lock worker exited before its expected event: ${code ?? signal}. ${errors}`);
      if (!isReady) readyReject(error);
      if (!hasOutcome) outcomeReject(error);
      resolve({ code, signal });
    });
  });
  // Test failures must not leave children waiting indefinitely on IPC.
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  void closed.then(() => clearTimeout(timer), () => clearTimeout(timer));
  return { child, ready, outcome, closed };
}

async function stop(workers: Worker[]): Promise<void> {
  for (const item of workers) if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill('SIGKILL');
  await Promise.allSettled(workers.map(item => item.closed));
}

async function abandonLock(record: string, workers: Worker[]): Promise<number> {
  const owner = worker(record);
  workers.push(owner);
  await owner.ready;
  owner.child.send('start');
  assert.deepEqual(await owner.outcome, { type: 'entered' });
  assert(owner.child.pid);
  const pid = owner.child.pid;
  owner.child.kill('SIGKILL');
  assert.equal((await owner.closed).signal, 'SIGKILL');
  // Establish actual runtime state rather than assuming an arbitrary PID is dead.
  assert.throws(() => process.kill(pid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH');
  return pid;
}

test('a real killed owner leaves a lock that the next invocation can recover', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aihub-dead-owner-'));
  const workers: Worker[] = [];
  try {
    const record = join(directory, 'task.json');
    await abandonLock(record, workers);
    let visits = 0;
    await withJobLock(record, async () => { visits++; });
    await withJobLock(record, async () => { visits++; });
    assert.equal(visits, 2, 'recovery and subsequent normal acquisition must both succeed');
  } finally {
    await stop(workers);
    await rm(directory, { recursive: true, force: true });
  }
});

test('simultaneous stale-lock recovery has exactly one live owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aihub-lock-race-'));
  const workers: Worker[] = [];
  try {
    // Repeat independent races; all contenders begin from the same real dead owner.
    for (let round = 0; round < 3; round++) {
      const record = join(directory, `task-${round}.json`);
      await abandonLock(record, workers);
      const contenders = Array.from({ length: 6 }, () => worker(record));
      workers.push(...contenders);
      await Promise.all(contenders.map(item => item.ready));
      for (const item of contenders) item.child.send('start');
      const outcomes = await Promise.all(contenders.map(item => item.outcome));
      const winners = outcomes.flatMap((outcome, index) => outcome.type === 'entered' ? [index] : []);
      assert.equal(winners.length, 1, `round ${round}: only one process may enter before it is released`);
      for (const outcome of outcomes) {
        if (outcome.type === 'rejected') assert.match(outcome.error, /in use|Could not acquire/);
      }
      const winner = contenders[winners[0]!]!;
      // A further contender must still see the live winner after the losing recovery attempts.
      await assert.rejects(withJobLock(record, async () => { throw new Error('Concurrent entry'); }), /in use/);
      winner.child.send('release');
      const exits = await Promise.all(contenders.map(item => item.closed));
      assert(exits.every(exit => exit.code === 0));
      await withJobLock(record, async () => undefined);
    }
  } finally {
    await stop(workers);
    await rm(directory, { recursive: true, force: true });
  }
});
