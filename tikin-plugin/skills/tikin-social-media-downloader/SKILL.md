---
name: tikin-social-media-downloader
description: Download video, audio, or images (no-watermark where available) from a social-media URL or list of URLs. Use when the user pastes a TikTok/Douyin/Instagram/YouTube/Twitter/Xiaohongshu link and wants the media file, or says "download this video", "save without watermark", "grab the audio". Dispatches to the right per-platform tikin endpoint.
---

# Social Media Downloader

Turn a post URL into a saved media file by routing it to the correct platform endpoint, extracting
the media URL from the response, and downloading it.

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

## Step 1 — Detect the platform from the URL and pick the endpoint

| Platform | Endpoint | Input | Media field |
|---|---|---|---|
| TikTok | `GET /api/v1/tiktok/app/v3/fetch_one_video_by_share_url` | `share_url` | no-watermark `play_addr` / `download_addr` `url_list` |
| TikTok (by id) | `GET /api/v1/tiktok/app/v3/fetch_one_video` | `aweme_id` | `url_list` |
| Douyin | `GET /api/v1/douyin/app/v3/fetch_one_video_by_share_url` | `share_url` | video `url_list` |
| Douyin (by id) | `GET /api/v1/douyin/app/v3/fetch_one_video_v2` | `aweme_id` | video `url_list` |
| YouTube | `GET /api/v1/youtube/web_v2/get_video_streams_v2` | `video_id` \| `video_url` | stream URLs (pick resolution) |
| Instagram | `GET /api/v1/instagram/v2/fetch_post_info` | `code_or_url` | media URL(s) |
| Xiaohongshu | `GET /api/v1/xiaohongshu/app_v2/get_video_note_detail` (video) / `get_image_note_detail` (images) | `note_id` | video / image URLs |
| Twitter/X | `GET /api/v1/twitter/web/fetch_tweet_detail` | `tweet_id` | media `url_list` |

For TikTok/Douyin, the `*_by_share_url` endpoints take the raw URL directly — no need to extract an
id. For the others, pull the id/code from the URL (or resolve it via the platform skill).

## Step 2 — Call the endpoint

```bash
# TikTok by share URL (simplest — pass the URL straight through)
URL="https://www.tiktok.com/@nasa/video/7650608519288245534"
curl -s "$BASE/api/v1/tiktok/app/v3/fetch_one_video_by_share_url?share_url=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$URL")" \
  -H "Authorization: Bearer $TIKIN_API_KEY" -o /tmp/media.json

# YouTube streams
curl -s "$BASE/api/v1/youtube/web_v2/get_video_streams_v2?video_id=dQw4w9WgXcQ" \
  -H "Authorization: Bearer $TIKIN_API_KEY" -o /tmp/media.json
```

## Step 3 — Extract the media URL, then download

Parse the response for the highest-quality (no-watermark, for TikTok/Douyin) media URL — usually a
`url_list` array or a stream URL. Use Python's standard `json` module for structured parsing;
do not introduce a `jq` dependency unless it is already available and the user prefers it. Then
save the returned media URL:

```bash
curl -L "<media_url_from_response>" -o video.mp4
file video.mp4   # confirm it's a real media container
```

## Batch downloads

Loop over a URL list, **one at a time with a small delay** (respect QPS 10/sec). Each parse is one
billed call — warn the user for large batches and hand off to `tikin-bulk-data-export` for big jobs.

## Verification gate

1. Response is `code: 200` and contains a non-empty media URL.
2. Downloaded file is non-empty and the expected type (`file video.mp4` shows a video container).
3. Not an auth/credit error.

## Red flags

- Claiming a download succeeded without checking the file is non-empty/valid.
- Using the wrong platform endpoint for a URL — detect the platform first.
- Unbounded batch loops (credit burn + rate limits).
- Re-hosting/redistributing copyrighted media — respect platform ToS and the user's rights.
