---
name: tikin-bulk-data-export
description: Fetch large social-media lists via tikin (posts, followers, search results, comments) with safe pagination, dedup, and CSV or JSON export. Use when the user wants all posts, a dataset, an export, or any large repeated pull from a supported platform or URL.
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
curl -s "$BASE/api/usage/token/" -H "Authorization: Bearer $TIKIN_API_KEY"
```

State the estimated calls and get the user's go-ahead before running.

## Step 2 — Paginate safely

- Use the platform's cursor (`max_cursor` / `pagination_token` / `continuation_token` / `cursor` /
  `cursor`+`index`) — see `tikin-rest-api` and the platform skill.
- Loop until `has_more` is false **or** the user's target row count is reached (hard cap).
- Add a short delay / concurrency cap ≤4 (QPS 10/sec). Retry transient 429/5xx with backoff.
- Dedup by stable id (e.g. `aweme_id` / post id) as you go.

## Step 3 — Export

- **JSON:** write the deduped array to `output.json`.
- **CSV:** flatten the fields the user cares about (id, author, text, likes, comments, shares,
  timestamp, url) into `output.csv`.
- Report row count, pages fetched, duplicates removed, and the file path.

## Verification gate

1. Row count ≈ requested (note if the source ran out early).
2. No duplicate ids in the output.
3. File written and non-empty; CSV header matches columns.

## Red flags

- Skipping the cost estimate — never start a bulk pull without one.
- Ignoring the user's row cap / `has_more` (infinite loop, credit burn).
- Silent truncation — always report how many rows were actually fetched vs. requested.
