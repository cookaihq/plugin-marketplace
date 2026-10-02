import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import { setImmediate as immediate } from "node:timers/promises";
import test from "node:test";
import { AihubmaxClient, ApiError, PollBudgetExceededError } from "../src/apiClient.js";
import { loadCatalog, resolveEntry } from "../src/catalog.js";

async function withGateway(listener: RequestListener, run: (client: AihubmaxClient) => Promise<void>) {
  const server = createServer(listener);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    await run(new AihubmaxClient({ baseUrl: `http://127.0.0.1:${address.port}`, apiKey: "sk-test-secret" }));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function failure(status: number, retryAfter?: string): Response {
  return new Response(JSON.stringify({ error: { message: "temporary failure" } }), {
    status, headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
  });
}

test("query 5xx retries exactly three attempts", async () => {
  let hits = 0;
  await withGateway((request, response) => {
    assert.equal(request.headers.authorization, "Bearer sk-test-secret");
    hits++;
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "unavailable" } }));
  }, async (client) => {
    await assert.rejects(client.getTask("t1"), (error: unknown) => error instanceof ApiError && error.status === 502);
    assert.equal(hits, 3);
  });
});

test("paid submissions are not repeated after 5xx, 429, or a closed connection", async (t) => {
  for (const status of [502, 429, "disconnect"] as const) {
    await t.test(String(status), async () => {
      let hits = 0;
      await withGateway((request, response) => {
        hits++;
        request.resume();
        request.on("end", () => {
          if (status === "disconnect") response.destroy();
          else response.writeHead(status).end(JSON.stringify({ error: { message: "not known" } }));
        });
      }, async (client) => {
        await assert.rejects(client.submitGeneration("/v1/images/generations", { model: "fixture", prompt: "x" }),
          (error: unknown) => error instanceof ApiError && error.ambiguous && !error.retryable);
        assert.equal(hits, 1);
      });
    });
  }
});

test("authentication failure is terminal, including polling, and the key is redacted", async () => {
  let hits = 0;
  await withGateway((_request, response) => {
    hits++;
    response.writeHead(401).end(JSON.stringify({ error: { message: `${"x".repeat(395)}sk-test-secret` } }));
  }, async (client) => {
    await assert.rejects(client.pollTask("paid-task", 20), (error: unknown) => {
      assert(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.equal(error.ambiguous, false);
      assert(!error.message.includes("sk-test-secret"));
      assert(!error.message.includes("sk-te"), "truncation must not expose a key fragment");
      return true;
    });
    assert.equal(hits, 1);
  });
});

test("successful HTTP with an unusable submission response preserves ambiguity", async (t) => {
  for (const body of ["<html>portal</html>", "", "{}", '{"id":"t1","status":"unknown"}']) {
    await t.test(body || "empty", async () => {
      let hits = 0;
      await withGateway((_request, response) => {
        hits++;
        response.end(body);
      }, async (client) => {
        await assert.rejects(client.submitGeneration("/v1/images/generations", { model: "fixture" }),
          (error: unknown) => error instanceof ApiError && error.ambiguous && error.code === "invalid_response");
        assert.equal(hits, 1);
      });
    });
  }
});

test("Retry-After is finite, capped at 60 seconds, and fallback delay is one second", async (t) => {
  for (const [header, delay] of [["3600", 60_000], ["Infinity", 1_000], ["NaN", 1_000], ["0", 0]] as const) {
    await t.test(header, async (subtest) => {
      let hits = 0;
      const logs: unknown[][] = [];
      subtest.mock.method(console, "error", (...args: unknown[]) => logs.push(args));
      subtest.mock.method(globalThis, "fetch", async () => {
        hits++;
        return hits === 1 ? failure(429, header) : new Response('{"data":[]}');
      });
      subtest.mock.timers.enable({ apis: ["setTimeout"] });
      const client = new AihubmaxClient({ baseUrl: "https://fixture.invalid", apiKey: "sk-test-secret" });
      const pending = client.listLiveModels();
      await immediate();
      assert.equal(hits, 1);
      if (delay > 0) {
        subtest.mock.timers.tick(delay - 1);
        await immediate();
        assert.equal(hits, 1);
        subtest.mock.timers.tick(1);
      } else {
        subtest.mock.timers.tick(0);
      }
      assert.equal((await pending).size, 0);
      assert.equal(hits, 2);
      // Node's first MockTimers activation also writes an ExperimentalWarning
      // through console.error. Count application retry diagnostics separately.
      const retryLogs = logs.filter((args) => String(args[0]).startsWith("[aihub] "));
      assert.equal(retryLogs.length, 1);
      assert(String(retryLogs[0]?.[0]).includes(`${delay / 1000}s`));
    });
  }
});

test("deadline prevents an early retry when Retry-After exceeds the remaining budget", async () => {
  let hits = 0;
  await withGateway((_request, response) => {
    hits++;
    response.writeHead(429, { "Retry-After": "3600" }).end('{}');
  }, async (client) => {
    const started = Date.now();
    await assert.rejects(client.getTask("t1", false, { deadline: started + 200 }), ApiError);
    assert.equal(hits, 1);
    assert(Date.now() - started < 800);
  });
});

test("polling has a strict wall-clock budget and retains the latest task", async () => {
  let hits = 0;
  await withGateway((_request, response) => {
    hits++;
    response.end('{"id":"paid-task","status":"processing","progress":30}');
  }, async (client) => {
    const started = Date.now();
    await assert.rejects(client.pollTask("paid-task", 0.15), (error: unknown) => {
      assert(error instanceof PollBudgetExceededError);
      assert.equal(error.code, "poll_budget_exhausted");
      assert.equal(error.taskId, "paid-task");
      assert.equal(error.lastTask?.progress, 30);
      return true;
    });
    const elapsed = Date.now() - started;
    assert(elapsed >= 140 && elapsed < 800, `elapsed ${elapsed}ms`);
    assert.equal(hits, 1, "must not query again after sleeping to the deadline");
  });
});

test("a stalled query cannot exceed the polling deadline", async () => {
  let hits = 0;
  await withGateway(() => { hits++; }, async (client) => {
    const started = Date.now();
    await assert.rejects(client.pollTask("paid-task", 0.1), PollBudgetExceededError);
    assert(Date.now() - started < 800);
    assert.equal(hits, 1);
  });
});

test("only proven pre-send failures can retry a non-idempotent POST", async (t) => {
  for (const [cause, expectedHits, ambiguous] of [
    [Object.assign(new Error("refused"), { code: "ECONNREFUSED" }), 2, false],
    [Object.assign(new Error("connect timed out"), { code: "ETIMEDOUT", syscall: "connect" }), 1, true],
    [new TypeError("fetch failed"), 1, true],
  ] as const) {
    await t.test(cause.message, async (subtest) => {
      let hits = 0;
      subtest.mock.method(console, "error", () => undefined);
      subtest.mock.method(globalThis, "fetch", async () => {
        hits++;
        if (hits === 1) throw new TypeError("fetch failed", { cause });
        return new Response('{"id":"t1","status":"pending"}');
      });
      subtest.mock.timers.enable({ apis: ["setTimeout"] });
      const client = new AihubmaxClient({ baseUrl: "https://fixture.invalid", apiKey: "sk-test-secret" });
      const result = client.submitGeneration("/v1/images/generations", { model: "fixture" })
        .then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
      await immediate();
      if (expectedHits === 2) subtest.mock.timers.tick(1_000);
      const outcome = await result;
      assert.equal(hits, expectedHits);
      if (ambiguous) assert(outcome.error instanceof ApiError && outcome.error.ambiguous);
      else assert.equal(outcome.value?.id, "t1");
    });
  }
});

test("catalog resolution keeps the live variant ID separate from its parameter family", () => {
  const catalog = loadCatalog();
  assert.equal(catalog.specBaseUrl, "https://docs.aihubmax.com/openapi/zh/");
  assert(!("sourceDir" in catalog));
  const resolved = resolveEntry("google/veo-3.1[fast]");
  assert.equal(resolved?.catalogModel, "veo-3.1");
  assert.equal(resolved?.match, "family");
  assert.equal(resolved?.entry.path, "/v1/videos/generations");
});
