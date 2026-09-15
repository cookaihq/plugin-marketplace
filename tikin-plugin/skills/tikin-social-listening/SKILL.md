---
name: tikin-social-listening
version: 0.3.0
description: v0.3.0｜Monitor mentions across supported social platforms via tikin — collect posts, classify sentiment, cluster themes, and deliver a cited digest. Use for brand sentiment, keyword monitoring, social listening, or supported URLs that should seed a listening query.
---

# Social Listening

Collect mentions of a brand/keyword across platforms, then analyze sentiment and themes.

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
    --skill tikin-social-listening run -- "$@"
}
```

Resolve `TIKIN_SETUP_DIR` from the installed `tikin-setup` Skill before using the command.
Run API examples through `tikin_run` in the same shell as this definition. The helper reads
`TIKIN_API_KEY` and `TIKIN_BASE_URL` independently from process environment →
`$PWD/.env.tikin-social-listening` → `$PWD/.env.local` → `$PWD/.env` → the existing
`${XDG_CONFIG_HOME:-$HOME/.config}/tikin/.env` fallback. Empty values fall through. Project files are read only in the
invocation directory; other Skills' dedicated files are not read. File contents are literal, never
sourced as shell code. Resolved values are passed only to the child command and are not printed.

If the key is missing or invalid, invoke `tikin-setup`. If the user declines tikin, explain the
limitation and ask before selecting an alternative; do not silently fetch the original page.

## Workflow

1. **Define the query**: brand/keyword(s), platforms to cover, time window, target volume
   (e.g. ~100 mentions).
2. **Search each platform** using its search endpoint (one query → paginate to the target volume):
   - TikTok `app/v3/fetch_video_search_result`, Douyin `search/fetch_general_search_v2` (POST body),
     Instagram `v2/general_search`, Twitter `web/fetch_search_timeline`, YouTube
     `web_v2/get_general_search`, Xiaohongshu `app_v2/search_notes`.
   - Find exact paths via the `tikin-endpoint-discovery` skill (`tikin-find-endpoint "search" --platform <slug>`).
3. **Collect** posts/comments into one list (author, text, platform, url, timestamp, engagement).
4. **Classify sentiment** (positive / neutral / negative) per mention — reason over the text.
5. **Cluster themes** (recurring topics, complaints, praise) and pull representative quotes.
6. **Deliver a digest**: volume, sentiment breakdown, top themes with cited example posts (link
   each claim to a source URL), and 2–3 recommendations.

## Cost awareness — IMPORTANT

This is the most call-heavy skill: every search page on every platform is a billed call.
**State an estimated call count before running** (pages × platforms) and check your balance/usage
first:

```bash
tikin_run sh <<'TIKIN_COMMAND'
BASE="${TIKIN_BASE_URL:-https://console.tikin.net}"
curl -s --max-time 30 "$BASE/api/usage/token/" -H "Authorization: Bearer $TIKIN_API_KEY"
TIKIN_COMMAND
```

**Budget every platform loop separately, and the run as a whole.** With a user target mention
count, that target is the budget; with no target, stop at **10 pages per platform** and at the
overall 50-page / 5,000-item default from `tikin-rest-api`'s **Reliability** section, whichever
comes first. When a budget ends a loop, report it as `budget exhausted` per platform: pages and
mentions fetched, whether more remain, and the cursor to resume from. A digest built on a
budget-capped sample must say so — the volume number is a floor, not a total.

Transient errors (429/5xx/timeouts): follow the **Reliability** section in `tikin-rest-api` —
3 attempts total, 1s then 2s backoff, `Retry-After` wins on a 429, and 401/403/404/422 are never
retried. One platform failing all 3 attempts does not abort the run: mark that platform as not
covered and continue with the rest.

## Verification gate

1. Mentions actually match the query (filter false positives).
2. Every theme/claim in the digest cites a real source URL.
3. Sentiment labels are justified by the quoted text.
4. Per-platform coverage stated: complete, budget-capped, or failed.

## Red flags

- Unbounded multi-platform pagination — runs up credits fast; always budget and warn.
- Reporting a budget-capped volume count as the true total.
- Reporting sentiment without citations.
- Counting unrelated keyword collisions as mentions.
