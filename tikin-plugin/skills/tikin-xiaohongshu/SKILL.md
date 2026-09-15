---
name: tikin-xiaohongshu
version: 0.3.0
description: v0.3.0｜Work with Xiaohongshu / RedNote (小红书) URLs and data via tikin — fetch image and video note details, user info and posted notes, search notes/users/products/images, and pull note comments and sub-comments. Use when the user provides a Xiaohongshu URL/share text or the task targets Xiaohongshu. Covers the Xiaohongshu App-V2 API.
---

# Xiaohongshu / RedNote / 小红书 (via tikin)

Coverage via the App-V2 API. Exhaustive endpoints via the `tikin-endpoint-discovery` skill:
`tikin-find-endpoint "<goal>" --platform xiaohongshu`.

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
    --skill tikin-xiaohongshu run -- "$@"
}
```

Resolve `TIKIN_SETUP_DIR` from the installed `tikin-setup` Skill before using the command.
Run API examples through `tikin_run` in the same shell as this definition. The helper reads
`TIKIN_API_KEY` and `TIKIN_BASE_URL` independently from process environment →
`$PWD/.env.tikin-xiaohongshu` → `$PWD/.env.local` → `$PWD/.env` → the existing
`${XDG_CONFIG_HOME:-$HOME/.config}/tikin/.env` fallback. Empty values fall through. Project files are read only in the
invocation directory; other Skills' dedicated files are not read. File contents are literal, never
sourced as shell code. Resolved values are passed only to the child command and are not printed.

If the key is missing or invalid, invoke `tikin-setup`. If the user declines tikin, explain the
limitation and ask before selecting an alternative; do not silently fetch the original page.

**Coverage:** Xiaohongshu-App-V2. (Web V1/V2/V3 and App V1 are de-scoped — reach them via discovery.)

## Key endpoints

| Goal | Method + path | Key params |
|---|---|---|
| Video note detail | `GET /api/v1/xiaohongshu/app_v2/get_video_note_detail` | `note_id`, `share_text` |
| Image note detail | `GET /api/v1/xiaohongshu/app_v2/get_image_note_detail` | `note_id`, `share_text` |
| User info | `GET /api/v1/xiaohongshu/app_v2/get_user_info` | `user_id`, `share_text` |
| User's notes | `GET /api/v1/xiaohongshu/app_v2/get_user_posted_notes` | `user_id`, `cursor` |
| Search notes | `GET /api/v1/xiaohongshu/app_v2/search_notes` | `keyword`, `page`, `sort_type`, `note_type` |
| Search users | `GET /api/v1/xiaohongshu/app_v2/search_users` | `keyword`, `page` |
| Search products | `GET /api/v1/xiaohongshu/app_v2/search_products` | `keyword`, `page` |
| Search images | `GET /api/v1/xiaohongshu/app_v2/search_images` | `keyword`, `page` |
| Note comments | `GET /api/v1/xiaohongshu/app_v2/get_note_comments` | `note_id`, `cursor`, `index` |
| Note sub-comments | `GET /api/v1/xiaohongshu/app_v2/get_note_sub_comments` | `note_id`, `comment_id`, `cursor` |

## Example

```bash
tikin_run sh <<'TIKIN_COMMAND'
BASE="${TIKIN_BASE_URL:-https://console.tikin.net}"
curl -s --max-time 30 "$BASE/api/v1/xiaohongshu/app_v2/search_notes?keyword=护肤&page=1&sort_type=general" \
  -H "Authorization: Bearer $TIKIN_API_KEY"
TIKIN_COMMAND
```

## Pagination

Note/comment lists use `cursor` (+`index` for comments); search uses `page`. Loop until the
response signals no more results.

**Each page is billed — every loop needs a budget.** With a user target, that target is the budget;
with no target, stop at the default 50 pages / 5,000 items from `tikin-rest-api`'s **Reliability**
section. When the budget ends the loop, report it as `budget exhausted` — pages and items fetched,
whether more remains, and the cursor/page to resume from — instead of presenting a partial pull as
complete.

Transient errors (429/5xx/timeouts): follow the **Reliability** section in `tikin-rest-api` —
3 attempts total, 1s then 2s backoff, `Retry-After` wins on a 429, and 401/403/404/422 are never
retried.

## Hand off to task skills

- Download note media → `tikin-social-media-downloader`
- Analyze a creator → `tikin-creator-analytics`
- Search/product/keyword research → `tikin-hashtag-research`, `tikin-social-listening`
- Comment mining → `tikin-comments-analysis`
- Large pulls → `tikin-bulk-data-export`

## Red flags

- Many App-V2 endpoints accept a `share_text` (the shared note text/URL) as an alternative to ids
  — pass whichever you have.
- Comment paging needs both `cursor` and `index`.
