---
name: tikin-instagram
version: 0.3.0
description: v0.3.0｜Work with Instagram URLs and data via tikin — fetch user info and posts, search users/reels/hashtags/music/locations, pull post comments and replies, and hashtag feeds. Use when the user provides an Instagram URL or the task targets Instagram. Covers the Instagram V2 API.
---

# Instagram (via tikin)

Deep coverage of Instagram via the V2 API. Exhaustive endpoints via the
`tikin-endpoint-discovery` skill: `tikin-find-endpoint "<goal>" --platform instagram`.

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
    --skill tikin-instagram run -- "$@"
}
```

Resolve `TIKIN_SETUP_DIR` from the installed `tikin-setup` Skill before using the command.
Run API examples through `tikin_run` in the same shell as this definition. The helper reads
`TIKIN_API_KEY` and `TIKIN_BASE_URL` independently from process environment →
`$PWD/.env.tikin-instagram` → `$PWD/.env.local` → `$PWD/.env` → the existing
`${XDG_CONFIG_HOME:-$HOME/.config}/tikin/.env` fallback. Empty values fall through. Project files are read only in the
invocation directory; other Skills' dedicated files are not read. File contents are literal, never
sourced as shell code. Resolved values are passed only to the child command and are not printed.

If the key is missing or invalid, invoke `tikin-setup`. If the user declines tikin, explain the
limitation and ask before selecting an alternative; do not silently fetch the original page.

**Coverage:** Instagram-V2. (V1 and V3 are de-scoped — reach them via discovery.)

## Key endpoints

| Goal | Method + path | Key params |
|---|---|---|
| User info | `GET /api/v1/instagram/v2/fetch_user_info` | `username` \| `user_id` |
| User posts | `GET /api/v1/instagram/v2/fetch_user_posts` | `username` \| `user_id`, `pagination_token` |
| User reels | `GET /api/v1/instagram/v2/fetch_user_reels` | `username` \| `user_id`, `pagination_token` |
| User stories | `GET /api/v1/instagram/v2/fetch_user_stories` | `username` \| `user_id` |
| Post info | `GET /api/v1/instagram/v2/fetch_post_info` | `code_or_url` |
| Search users | `GET /api/v1/instagram/v2/search_users` | `keyword` |
| General search | `GET /api/v1/instagram/v2/general_search` | `keyword`, `pagination_token` |
| Search reels | `GET /api/v1/instagram/v2/search_reels` | `keyword`, `pagination_token` |
| Search hashtags | `GET /api/v1/instagram/v2/search_hashtags` | `keyword` |
| Hashtag posts | `GET /api/v1/instagram/v2/fetch_hashtag_posts` | `keyword`, `feed_type`, `pagination_token` |
| Post comments | `GET /api/v1/instagram/v2/fetch_post_comments` | `code_or_url`, `sort_by`, `pagination_token` |
| Comment replies | `GET /api/v1/instagram/v2/fetch_comment_replies` | `code_or_url`, `comment_id`, `pagination_token` |
| Shortcode → media id | `GET /api/v1/instagram/v2/shortcode_to_media_id` | `shortcode` |

## Example

```bash
tikin_run sh <<'TIKIN_COMMAND'
BASE="${TIKIN_BASE_URL:-https://console.tikin.net}"
curl -s --max-time 30 "$BASE/api/v1/instagram/v2/fetch_user_posts?username=instagram" \
  -H "Authorization: Bearer $TIKIN_API_KEY"
TIKIN_COMMAND
```

## Pagination

Everything uses `pagination_token` — pass the token returned by the previous response; stop when
none is returned.

**Each page is billed — every loop needs a budget.** With a user target, that target is the budget;
with no target, stop at the default 50 pages / 5,000 items from `tikin-rest-api`'s **Reliability**
section. When the budget ends the loop, report it as `budget exhausted` — pages and items fetched,
whether more remains, and the token to resume from — instead of presenting a partial pull as
complete.

Transient errors (429/5xx/timeouts): follow the **Reliability** section in `tikin-rest-api` —
3 attempts total, 1s then 2s backoff, `Retry-After` wins on a 429, and 401/403/404/422 are never
retried.

## Hand off to task skills

- Download posts/reels → `tikin-social-media-downloader`
- Analyze an account → `tikin-creator-analytics`
- Hashtag work → `tikin-hashtag-research`
- Comment mining → `tikin-comments-analysis`
- Listening across keywords → `tikin-social-listening`
- Large pulls → `tikin-bulk-data-export`

## Red flags

- Post-level endpoints take `code_or_url` (the shortcode or full post URL), not the numeric id —
  convert with `shortcode_to_media_id` if needed.
