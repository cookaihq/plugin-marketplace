---
name: tikin-comments-analysis
description: Pull and analyze comments from a supported post or video URL via tikin — sentiment breakdown, recurring themes, top comments, and notable questions or complaints. Use when the user asks to analyze comments, summarize discussion, or provides a social-media post URL.
---

# Comments Analysis

Mine a single post's comment section for sentiment and themes.

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

## Workflow

1. **Identify the post** (platform + id/URL).
2. **Fetch comments**, paginating to a target count (cap it):
   - TikTok: `app/v3/fetch_video_comments` (`aweme_id`, `cursor`). Douyin: `app/v3/fetch_video_comments` (`aweme_id`, `cursor`).
   - Instagram: `v2/fetch_post_comments` (+ `fetch_comment_replies`).
   - YouTube: `web_v2/get_video_comments` (+ `get_video_comment_replies`).
   - Twitter: `web/fetch_post_comments`. Xiaohongshu: `app_v2/get_note_comments`.
3. **Optional fast keywords:** TikTok `analytics/fetch_comment_keywords` (`item_id`) gives a
   comment keyword summary directly.
4. **Analyze:** sentiment breakdown, top themes with example quotes, most-liked comments, and any
   recurring questions/complaints.
5. **Deliver** a summary with cited example comments.

## Cost awareness

Each comment page (and reply page) is a billed call. Cap pages; warn for viral posts with huge
threads. Check balance/usage with
`curl -s "$BASE/api/usage/token/" -H "Authorization: Bearer $TIKIN_API_KEY"`.

## Verification gate

1. Comments fetched and tied to the right post.
2. Themes/sentiment backed by quoted comments.
3. Report the sample size (comments analyzed vs. total).

## Red flags

- Summarizing 50 comments on a 50k-comment post as representative — disclose the sample.
- Unbounded reply pagination.
