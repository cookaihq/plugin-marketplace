---
name: tikin-comments-analysis
version: 0.3.0
description: v0.3.0｜Pull and analyze comments from a supported post or video URL via tikin — sentiment breakdown, recurring themes, top comments, and notable questions or complaints. Use when the user asks to analyze comments, summarize discussion, or provides a social-media post URL.
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
TIKIN_SETUP_DIR="<installed tikin-setup directory>"
tikin_run() {
  uv run --project "${TIKIN_SETUP_DIR}" "${TIKIN_SETUP_DIR}/scripts/tikin-config" \
    --skill tikin-comments-analysis run -- "$@"
}
```

Resolve `TIKIN_SETUP_DIR` from the installed `tikin-setup` Skill before using the command.
Run API examples through `tikin_run` in the same shell as this definition. The helper reads
`TIKIN_API_KEY` and `TIKIN_BASE_URL` independently from process environment →
`$PWD/.env.tikin-comments-analysis` → `$PWD/.env.local` → `$PWD/.env` → the existing
`${XDG_CONFIG_HOME:-$HOME/.config}/tikin/.env` fallback. Empty values fall through. Project files are read only in the
invocation directory; other Skills' dedicated files are not read. File contents are literal, never
sourced as shell code. Resolved values are passed only to the child command and are not printed.

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

Each comment page (and reply page) is a billed call. Warn for viral posts with huge threads. Check
balance/usage with
`tikin_run sh -c 'BASE="${TIKIN_BASE_URL:-https://console.tikin.net}"; curl -s --max-time 30 "$BASE/api/usage/token/" -H "Authorization: Bearer $TIKIN_API_KEY"'`.

**Every comment and reply loop needs a budget.** With a user target comment count, that target is
the budget; with no target, stop at the default 50 pages / 5,000 comments from `tikin-rest-api`'s
**Reliability** section — counted across the comment and reply loops combined, not per loop. When
the budget ends the pull, report it as `budget exhausted`: comments fetched, pages fetched, and
whether more remain.

Transient errors (429/5xx/timeouts): follow the **Reliability** section in `tikin-rest-api` —
3 attempts total, 1s then 2s backoff, `Retry-After` wins on a 429, and 401/403/404/422 are never
retried.

## Verification gate

1. Comments fetched and tied to the right post.
2. Themes/sentiment backed by quoted comments.
3. Report the sample size (comments analyzed vs. total) and whether the budget capped the pull.

## Red flags

- Summarizing 50 comments on a 50k-comment post as representative — disclose the sample.
- Unbounded reply pagination.
- Presenting a budget-capped sample as if the whole thread was read.
