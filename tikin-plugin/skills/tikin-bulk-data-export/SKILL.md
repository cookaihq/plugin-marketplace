---
name: tikin-bulk-data-export
version: 0.2.1
description: v0.2.1｜Fetch large social-media lists via tikin (posts, followers, search results, comments) with safe pagination, dedup, and CSV or JSON export. Use when the user wants all posts, a dataset, an export, or any large repeated pull from a supported platform or URL.
---

# Bulk Data Export

Paginate a list endpoint at scale, dedup, and write a clean dataset — safely and with a cost
estimate up front.

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
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/tikin/.env"
if [ -z "${TIKIN_API_KEY:-}" ] && [ -f "$CONFIG" ]; then set -a; . "$CONFIG"; set +a; fi
if [ -z "${TIKIN_API_KEY:-}" ]; then
  echo "Set up and validate TIKIN_API_KEY first (see tikin-setup)."
  exit 1
fi
BASE="${TIKIN_BASE_URL:-https://console.tikin.net}"
```

If the key is missing or invalid, invoke `tikin-setup`. If the user declines tikin, explain the
limitation and ask before selecting an alternative; do not silently fetch the original page.

## Step 1 — Estimate cost FIRST (mandatory)

Bulk pulls are the biggest cost spender. Before fetching, compute the call count and check your
balance:

```bash
# pages = ceil(target_rows / page_size)  → that many billed calls
curl -s --max-time 30 "$BASE/api/usage/token/" -H "Authorization: Bearer $TIKIN_API_KEY"
```

State the estimated calls and get the user's go-ahead before running.

## Step 2 — Paginate safely

- Use the platform's cursor (`max_cursor` / `pagination_token` / `continuation_token` / `cursor` /
  `cursor`+`index`) — see `tikin-rest-api` and the platform skill.
- **The budget is the smaller of the user's target row count and the default hard cap of 50 pages
  or 5,000 rows** (the default from `tikin-rest-api`'s **Reliability** section). A user target
  above the default cap does not lift it — confirm the larger budget with the user first, then
  state the raised number explicitly before running.
- Loop until whichever comes first: `has_more` is false, the user's target row count, or that cap.
- Add a short delay / concurrency cap ≤4 (QPS 10/sec). Retry transient errors (429/5xx/timeouts)
  per the **Reliability** section in `tikin-rest-api`: 3 attempts total, 1s then 2s backoff,
  honouring `Retry-After` on a 429, and never retrying 401/403/404/422.
- Retries do not consume the pagination budget; only pages actually retrieved do.
- **When the cap ends the loop, report it as `budget exhausted`** — rows fetched, pages fetched,
  whether `has_more` is still true, and the cursor to resume from. This is a distinct outcome from
  "the source ran out of data"; never present it as a complete export.
- Dedup by stable id (e.g. `aweme_id` / post id) as you go.

## Step 3 — Export

- **JSON:** write the deduped array to `output.json`.
- **CSV:** flatten the fields the user cares about (id, author, text, likes, comments, shares,
  timestamp, url) into `output.csv`.
- Report row count, pages fetched, duplicates removed, and the file path.

## Verification gate

1. Row count ≈ requested, and the stop reason is stated: source exhausted, user target reached, or
   `budget exhausted`.
2. No duplicate ids in the output.
3. File written and non-empty; CSV header matches columns.

## Red flags

- Skipping the cost estimate — never start a bulk pull without one.
- Ignoring the user's row cap / `has_more` (infinite loop, credit burn).
- Running with no cap at all because the user gave no target — the 50-page / 5,000-row default
  applies exactly then.
- Silent truncation — always report how many rows were actually fetched vs. requested, and say
  when the budget rather than the source ended the pull.
