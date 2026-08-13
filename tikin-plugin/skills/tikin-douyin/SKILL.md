---
name: tikin-douyin
description: Work with Douyin (抖音) URLs and data via tikin — fetch videos, user profiles and post lists, video comments, and run video/user/general search via Douyin's dedicated search series. Use when the user provides a Douyin URL or the task targets Douyin. Covers App-V3 and the Douyin Search series.
---

# Douyin / 抖音 (via tikin)

Deep coverage of Douyin. Exhaustive endpoints via the `tikin-endpoint-discovery` skill:
`tikin-find-endpoint "<goal>" --platform douyin`.

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

**Coverage:** App-V3 (video/user/comments) and the dedicated Douyin **Search** series.
(Douyin-Web, Douyin-Creator, Douyin-Index, Xingtu, and Billboard are de-scoped — reach them via
discovery.)

> **Search note:** Douyin has its own specialized search series (`/douyin/search/...`, POST with a
> JSON body). Prefer it over the App-V3 search endpoints.

## Key endpoints

| Goal | Method + path | Key params |
|---|---|---|
| One video | `GET /api/v1/douyin/app/v3/fetch_one_video_v2` | `aweme_id` |
| Video by share URL | `GET /api/v1/douyin/app/v3/fetch_one_video_by_share_url` | `share_url` |
| User profile | `GET /api/v1/douyin/app/v3/handler_user_profile` | `sec_user_id` |
| User's videos | `GET /api/v1/douyin/app/v3/fetch_user_post_videos` | `sec_user_id`, `max_cursor`, `count` |
| Video comments | `GET /api/v1/douyin/app/v3/fetch_video_comments` | `aweme_id`, `cursor`, `count` |
| Video search | `POST /api/v1/douyin/search/fetch_video_search_v2` | body: `keyword`, `cursor`, `sort_type`, `publish_time` |
| User search | `POST /api/v1/douyin/search/fetch_user_search_v2` | body: `keyword`, `cursor` |
| General search | `POST /api/v1/douyin/search/fetch_general_search_v2` | body: `keyword`, `cursor`, `sort_type` |

## Example

```bash
# Video search — POST with a JSON body
curl -s -X POST "$BASE/api/v1/douyin/search/fetch_video_search_v2" \
  -H "Authorization: Bearer $TIKIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"keyword": "美食"}'

# One video by id
curl -s "$BASE/api/v1/douyin/app/v3/fetch_one_video_v2?aweme_id=7637462264047710705" \
  -H "Authorization: Bearer $TIKIN_API_KEY"
```

## Pagination

App-V3 user/video lists use `max_cursor` + `count`; comments use `cursor` + `count`; the Search
series pages via a `cursor` field in the JSON body. Loop on the returned cursor/`has_more`.
**Cap pages — each is billed.**

## Hand off to task skills

- Download videos → `tikin-social-media-downloader`
- Analyze an account → `tikin-creator-analytics`
- Competitor benchmarking → `tikin-competitor-analysis`
- Hashtag/keyword work → `tikin-hashtag-research`
- Comment mining → `tikin-comments-analysis`
- Large pulls → `tikin-bulk-data-export`

## Red flags

- The Search series is **POST with a JSON body** (`keyword`, `cursor`) — not GET query params.
- User endpoints need `sec_user_id`; resolve it first if you only have a share URL/nickname.
