---
name: tikin-rest-api
version: 0.3.0
description: v0.3.0｜Call the tikin REST API directly with curl/HTTP. Covers base URL, Bearer auth, the /api/v1/{platform}/... path scheme, pagination, rate limits, retries, error handling, and per-call cost/balance awareness. Use for any direct data call against tikin.
---

# tikin — REST API

Direct HTTP access to all 1,000+ tikin endpoints. Use `tikin-endpoint-discovery` to find the
right path, then call it here.

## Runtime gate

On the first tikin use in each Agent session, follow the `tikin-setup` session update gate once
without blocking this task. Before the first tikin API call for the current user task:

1. Determine every affected platform. Read
   `${XDG_CONFIG_HOME:-$HOME/.config}/tikin/settings.json` as JSON, defaulting to
   `{"routing":{"default":"auto","platforms":{}}}` when absent.
2. Resolve each policy from `routing.platforms[platform]`, then `routing.default`. An explicit
   instruction in the current user request wins over stored settings.
3. For any `confirm` platform, ask once for the whole task and group the affected
   platforms/actions. Do not ask again for pagination within the approved task.
4. Never request a supported user-provided social-media content URL with `curl`, WebFetch, or a
   generic browser fetch. Parse identifiers locally or pass the original URL/share text to tikin.
   Calls to the configured tikin base URL and downloads from final media URLs returned by tikin are
   allowed.
5. Resolve and require the key:

```bash
TIKIN_SETUP_DIR="<installed tikin-setup directory>"
tikin_run() {
  uv run --project "${TIKIN_SETUP_DIR}" "${TIKIN_SETUP_DIR}/scripts/tikin-config" \
    --skill tikin-rest-api run -- "$@"
}
```

Resolve `TIKIN_SETUP_DIR` from the installed `tikin-setup` Skill before using the command.
Run API examples through `tikin_run` in the same shell as this definition. The helper reads
`TIKIN_API_KEY` and `TIKIN_BASE_URL` independently from process environment →
`$PWD/.env.tikin-rest-api` → `$PWD/.env.local` → `$PWD/.env` → the existing
`${XDG_CONFIG_HOME:-$HOME/.config}/tikin/.env` fallback. Empty values fall through. Project files are read only in the
invocation directory; other Skills' dedicated files are not read. File contents are literal, never
sourced as shell code. Resolved values are passed only to the child command and are not printed.

If the key is missing or invalid, invoke `tikin-setup`. If the user declines tikin, explain the
limitation and ask before selecting an alternative; do not silently fetch the original page.

## Essentials

- **Base URL:** `https://console.tikin.net` (override with `TIKIN_BASE_URL`).
- **Auth header:** `Authorization: Bearer $TIKIN_API_KEY`.
- **Path scheme:** `/api/v1/{platform}/{api}/{action}` — e.g. `/api/v1/tiktok/app/v3/fetch_one_video`.
- **Most reads are GET** with query params; batch/multi endpoints are POST with a JSON body.

## Action — example calls

```bash
tikin_run sh <<'TIKIN_COMMAND'
BASE="${TIKIN_BASE_URL:-https://console.tikin.net}"

# TikTok: one video by id
curl -s --max-time 30 "$BASE/api/v1/tiktok/app/v3/fetch_one_video?aweme_id=7372484719365098283" \
  -H "Authorization: Bearer $TIKIN_API_KEY"

# Instagram: user info
curl -s --max-time 30 "$BASE/api/v1/instagram/v2/fetch_user_info?username=instagram" \
  -H "Authorization: Bearer $TIKIN_API_KEY"

# Douyin search (POST with a JSON body)
curl -s --max-time 30 -X POST "$BASE/api/v1/douyin/search/fetch_general_search_v1" \
  -H "Authorization: Bearer $TIKIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"keyword": "美食", "offset": 0, "count": 10}'

# Batch (POST) — some endpoints take a RAW JSON ARRAY body (not an object)
curl -s --max-time 30 -X POST "$BASE/api/v1/tiktok/app/v3/fetch_multi_video" \
  -H "Authorization: Bearer $TIKIN_API_KEY" -H "Content-Type: application/json" \
  -d '["7372484719365098283","7372484719365098284"]'
TIKIN_COMMAND
```

Every call carries `--max-time` — see [Reliability](#reliability) for the values and for what to do
when a call fails.

Paths, methods, and parameters are exactly as returned by `tikin-find-endpoint` (the
`tikin-endpoint-discovery` skill's bundled search CLI) — pass them through unchanged.

## Pagination (param name varies by platform)

| Platform | Cursor param | Notes |
|---|---|---|
| TikTok / Douyin | `max_cursor` / `cursor` | response returns next cursor + `has_more` |
| Instagram | `pagination_token` | pass the token from the previous response |
| YouTube | `continuation_token` | pass to `..._replies` / next-page endpoints |
| Twitter | `cursor` | from previous timeline response |
| Threads | `end_cursor` | from previous response |
| Xiaohongshu | `cursor` (+ `index`) | |

Loop until the response's `has_more` is false or no next cursor is returned. **Each page is a
billed call — every loop needs a budget** (see [Reliability](#reliability); hand off to
`tikin-bulk-data-export` for big jobs).

## Reliability

**This section is the single source of truth for timeouts, retries, and pagination budgets across
every tikin skill.** Other skills point here instead of restating the numbers.

### Timeouts — every call, no exceptions

| Call type | Flag |
|---|---|
| JSON read/search/batch against `$BASE` | `--max-time 30` |
| Media download from a URL tikin returned | `--max-time 300` |
| A file known to be larger than ~500 MB | raise the value explicitly and say so — never drop the flag |

Add `--connect-timeout 10` when you want the connect phase to fail faster than the whole call.
A `curl` invocation without a time limit can hang the whole task; there is no case where omitting
it is correct.

### Classify the failure before retrying

- **Transient — retry:** HTTP 429, any HTTP 5xx, connection timeouts, connection resets, TLS
  handshake failures, DNS resolution failures (`curl` exit codes 6, 7, 28, 35, 52, 56).
- **Deterministic — never retry, report and stop:** 401 / 403 (key missing, invalid, or not
  entitled → run `tikin-setup`), 404 (wrong path → re-run `tikin-find-endpoint`), 422 (bad
  parameters → fix them), and insufficient balance. Repeating these produces the same failure and
  burns time; give the user the concrete next step instead.

### Retry budget

- **3 attempts total** — the first call plus at most 2 retries.
- Exponential backoff: wait **1s** before the first retry, **2s** before the second.
- If a 429 response carries `Retry-After`, honour that value instead of the backoff.
- When you report a retry, say which attempt failed and why (status code or `curl` exit code).
  Never print the API key in that report.
- After 3 failed attempts, stop and report the last error — do not keep looping.

### Pagination budget

- **QPS 10/sec.** Add a small delay or a concurrency cap (≤4) in loops.
- When the user gave a target (row count, post count, time window), that target is the budget.
- **When the user gave no target, the default budget is 50 pages or 5,000 items, whichever comes
  first.** Retries do not count against it — only pages actually retrieved do.
- Stop the loop on whichever comes first: `has_more` is false / no next cursor, the user's target,
  or the default budget.
- **When the budget stops the loop, say so explicitly** — report it as `budget exhausted`, state
  how many pages and items were fetched, whether more data remains (`has_more` still true), and the
  cursor to resume from. Never truncate silently and never present a budget-capped pull as complete.

## Cost & balance awareness

tikin bills per call against your prepaid balance. Check balance/usage anytime:

```bash
tikin_run sh <<'TIKIN_COMMAND'
BASE="${TIKIN_BASE_URL:-https://console.tikin.net}"
curl -s --max-time 30 "$BASE/api/usage/token/" -H "Authorization: Bearer $TIKIN_API_KEY"
TIKIN_COMMAND
```

Prices vary per endpoint. Cap pagination and estimate a run's cost (pages × per-call price)
before bulk pulls.

## Verification gate

Before claiming success:
1. HTTP 200 and body is valid JSON.
2. Not an auth/balance error (401 / insufficient balance).
3. Expected fields present (e.g. a video fetch returns a play/download URL).

## Red flags

- Hardcoding the API key in code/commits — always read `$TIKIN_API_KEY`.
- A `curl` call with no `--max-time` — one hung connection stalls the whole task.
- Retrying a 401/403/404/422 — it will fail identically; fix the cause instead.
- Unbounded pagination loops (runs up cost).
- Reporting a budget-capped pull as if it were complete.
- Ignoring `has_more` / next-cursor and re-fetching page 1.
