---
name: tikin-twitter-threads
version: 0.3.0
description: v0.3.0｜Work with Twitter/X and Threads URLs and data via tikin — fetch tweet/post detail, user profiles, user timelines, followers/following, search timelines, comments/replies, and X trending topics. Use when the user provides an X/Twitter/Threads URL or the task targets either platform. Covers the Twitter-Web and Threads-Web APIs.
---

# Twitter / X & Threads (via tikin)

Coverage of Twitter/X and Threads (both microblog platforms). Exhaustive endpoints via the
`tikin-endpoint-discovery` skill: `tikin-find-endpoint "<goal>" --platform twitter` or
`--platform threads`.

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
    --skill tikin-twitter-threads run -- "$@"
}
```

Resolve `TIKIN_SETUP_DIR` from the installed `tikin-setup` Skill before using the command.
Run API examples through `tikin_run` in the same shell as this definition. The helper reads
`TIKIN_API_KEY` and `TIKIN_BASE_URL` independently from process environment →
`$PWD/.env.tikin-twitter-threads` → `$PWD/.env.local` → `$PWD/.env` → the existing
`${XDG_CONFIG_HOME:-$HOME/.config}/tikin/.env` fallback. Empty values fall through. Project files are read only in the
invocation directory; other Skills' dedicated files are not read. File contents are literal, never
sourced as shell code. Resolved values are passed only to the child command and are not printed.

If the key is missing or invalid, invoke `tikin-setup`. If the user declines tikin, explain the
limitation and ask before selecting an alternative; do not silently fetch the original page.

**Coverage:** Twitter-Web, Threads-Web.

## Twitter / X endpoints

| Goal | Method + path | Key params |
|---|---|---|
| Tweet detail | `GET /api/v1/twitter/web/fetch_tweet_detail` | `tweet_id` |
| User profile | `GET /api/v1/twitter/web/fetch_user_profile` | `screen_name` \| `rest_id` |
| User tweets | `GET /api/v1/twitter/web/fetch_user_post_tweet` | `screen_name`, `cursor` |
| Search timeline | `GET /api/v1/twitter/web/fetch_search_timeline` | `keyword`, `search_type`, `cursor` |
| Tweet comments | `GET /api/v1/twitter/web/fetch_post_comments` | `tweet_id`, `cursor` |
| Trending | `GET /api/v1/twitter/web/fetch_trending` | `country` |
| Followers | `GET /api/v1/twitter/web/fetch_user_followers` | `screen_name`, `cursor` |
| Following | `GET /api/v1/twitter/web/fetch_user_followings` | `screen_name`, `cursor` |

## Threads endpoints

| Goal | Method + path | Key params |
|---|---|---|
| User info | `GET /api/v1/threads/web/fetch_user_info` | `username` |
| User posts | `GET /api/v1/threads/web/fetch_user_posts` | `user_id`, `end_cursor` |
| Search (top) | `GET /api/v1/threads/web/search_top` | `query`, `end_cursor` |
| Search (recent) | `GET /api/v1/threads/web/search_recent` | `query`, `end_cursor` |
| Post comments | `GET /api/v1/threads/web/fetch_post_comments` | `post_id`, `end_cursor` |

## Example

```bash
tikin_run sh <<'TIKIN_COMMAND'
BASE="${TIKIN_BASE_URL:-https://console.tikin.net}"
curl -s --max-time 30 "$BASE/api/v1/twitter/web/fetch_search_timeline?keyword=ai&search_type=Top" \
  -H "Authorization: Bearer $TIKIN_API_KEY"
TIKIN_COMMAND
```

## Pagination

Twitter/X uses `cursor`; Threads uses `end_cursor`. Pass the value returned by the previous
response; stop when none is returned.

**Each page is billed — every loop needs a budget.** With a user target, that target is the budget;
with no target, stop at the default 50 pages / 5,000 items from `tikin-rest-api`'s **Reliability**
section. When the budget ends the loop, report it as `budget exhausted` — pages and items fetched,
whether more remains, and the cursor to resume from — instead of presenting a partial pull as
complete.

Transient errors (429/5xx/timeouts): follow the **Reliability** section in `tikin-rest-api` —
3 attempts total, 1s then 2s backoff, `Retry-After` wins on a 429, and 401/403/404/422 are never
retried.

## Hand off to task skills

- Analyze an account → `tikin-creator-analytics`
- Trending/search → `tikin-trend-research`, `tikin-social-listening`
- Comment/reply mining → `tikin-comments-analysis`
- Competitor benchmarking → `tikin-competitor-analysis`
- Large pulls → `tikin-bulk-data-export`

## Red flags

- Twitter user endpoints accept `screen_name` or `rest_id`; Threads user posts need the numeric
  `user_id` (resolve via `fetch_user_info` first).
- Don't mix the two cursor params — `cursor` (Twitter) vs `end_cursor` (Threads).
