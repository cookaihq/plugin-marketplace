---
name: tikin-youtube
description: Work with YouTube URLs and data via tikin — fetch video info, downloadable stream URLs, captions/subtitles, comments and replies, channel info, and run general/shorts search. Use when the user provides a YouTube URL or the task targets YouTube. Covers the YouTube Web-V2 API.
---

# YouTube (via tikin)

Deep coverage of YouTube via the Web-V2 API. Exhaustive endpoints via the
`tikin-endpoint-discovery` skill: `tikin-find-endpoint "<goal>" --platform youtube`.

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

**Coverage:** YouTube-Web-V2. (The older YouTube-Web API is de-scoped — reach it via discovery.)

## Key endpoints

| Goal | Method + path | Key params |
|---|---|---|
| Video info | `GET /api/v1/youtube/web_v2/get_video_info` | `video_id`, `language_code` |
| Video info by URL | `GET /api/v1/youtube/web_v2/get_video_info_v2` | `video_url` |
| Download streams | `GET /api/v1/youtube/web_v2/get_video_streams_v2` | `video_id` \| `video_url` |
| Captions/subtitles | `GET /api/v1/youtube/web_v2/get_video_captions` | `video_id`, `language_code`, `format` |
| Video comments | `GET /api/v1/youtube/web_v2/get_video_comments` | `video_id`, `sort_by`, `continuation_token` |
| Comment replies | `GET /api/v1/youtube/web_v2/get_video_comment_replies` | `continuation_token` |
| Channel id (from URL) | `GET /api/v1/youtube/web_v2/get_channel_id` | `channel_url` |
| Channel info | `GET /api/v1/youtube/web_v2/get_channel_description` | `channel_id`, `continuation_token` |
| General search | `GET /api/v1/youtube/web_v2/get_general_search` | `search_query`, `upload_time` |
| Shorts search | `GET /api/v1/youtube/web_v2/get_shorts_search` | `search_query`, `upload_time` |

## Example

```bash
curl -s "$BASE/api/v1/youtube/web_v2/get_video_info?video_id=dQw4w9WgXcQ" \
  -H "Authorization: Bearer $TIKIN_API_KEY"
```

## Pagination

Comments, replies, channel feeds, and the `*_v2` search endpoints use `continuation_token` — pass
the token from the previous response; stop when none is returned. **Each page is billed — cap it.**

## Hand off to task skills

- Download videos / captions → `tikin-social-media-downloader`
- Analyze a channel → `tikin-creator-analytics`
- Comment mining → `tikin-comments-analysis`
- Search/listening → `tikin-social-listening`
- Large pulls → `tikin-bulk-data-export`

## Red flags

- Use `get_video_streams_v2` for downloadable media URLs; `get_video_info` is metadata only.
- A `video_id` is the 11-char id; pass full URLs to the `*_v2` variants.
