---
name: tikin-xiaohongshu
description: Work with Xiaohongshu / RedNote (小红书) URLs and data via tikin — fetch image and video note details, user info and posted notes, search notes/users/products/images, and pull note comments and sub-comments. Use when the user provides a Xiaohongshu URL/share text or the task targets Xiaohongshu. Covers the Xiaohongshu App-V2 API.
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
curl -s "$BASE/api/v1/xiaohongshu/app_v2/search_notes?keyword=护肤&page=1&sort_type=general" \
  -H "Authorization: Bearer $TIKIN_API_KEY"
```

## Pagination

Note/comment lists use `cursor` (+`index` for comments); search uses `page`. Loop until the
response signals no more results. **Each page is billed — cap it.**

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
