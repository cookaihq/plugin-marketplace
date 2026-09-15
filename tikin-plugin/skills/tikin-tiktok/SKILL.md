---
name: tikin-tiktok
version: 0.3.0
description: v0.3.0｜Work with TikTok URLs and data via tikin — fetch videos, user profiles and post lists, run search, pull trends/ads insights, creator analytics, comment keywords, and shop search. Use when the user provides a TikTok URL or the task targets TikTok. Covers the App-V3, Ads, Creator, Analytics, and Shop APIs.
---

# TikTok (via tikin)

Deep coverage of TikTok. For exhaustive endpoints use `tikin-endpoint-discovery`
(`tikin-find-endpoint "<goal>" --platform tiktok`). For outcomes (download, analyze a creator,
trends), hand off to the task skills noted below.

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
    --skill tikin-tiktok run -- "$@"
}
```

Resolve `TIKIN_SETUP_DIR` from the installed `tikin-setup` Skill before using the command.
Run API examples through `tikin_run` in the same shell as this definition. The helper reads
`TIKIN_API_KEY` and `TIKIN_BASE_URL` independently from process environment →
`$PWD/.env.tikin-tiktok` → `$PWD/.env.local` → `$PWD/.env` → the existing
`${XDG_CONFIG_HOME:-$HOME/.config}/tikin/.env` fallback. Empty values fall through. Project files are read only in the
invocation directory; other Skills' dedicated files are not read. File contents are literal, never
sourced as shell code. Resolved values are passed only to the child command and are not printed.

If the key is missing or invalid, invoke `tikin-setup`. If the user declines tikin, explain the
limitation and ask before selecting an alternative; do not silently fetch the original page.

**Coverage:** App-V3, Ads, Creator, Analytics, Shop-Web. (TikTok-Web is de-scoped — reach it via discovery.)

## Key endpoints

| Goal | Method + path | Key params |
|---|---|---|
| One video | `GET /api/v1/tiktok/app/v3/fetch_one_video` | `aweme_id` |
| Video by share URL | `GET /api/v1/tiktok/app/v3/fetch_one_video_by_share_url` | `share_url` |
| User profile | `GET /api/v1/tiktok/app/v3/handler_user_profile` | `sec_user_id` \| `unique_id` |
| User's videos | `GET /api/v1/tiktok/app/v3/fetch_user_post_videos` | `sec_user_id`, `max_cursor`, `count` |
| Video search | `GET /api/v1/tiktok/app/v3/fetch_video_search_result` | `keyword`, `offset`, `count`, `sort_type`, `publish_time` |
| User search | `GET /api/v1/tiktok/app/v3/fetch_user_search_result` | `keyword`, `offset`, `count` |
| Video comments | `GET /api/v1/tiktok/app/v3/fetch_video_comments` | `aweme_id`, `cursor`, `count` |
| Hashtag video list | `GET /api/v1/tiktok/app/v3/fetch_hashtag_video_list` | `ch_id`, `cursor`, `count` |
| Popular trends | `GET /api/v1/tiktok/ads/get_popular_trends` | `period`, `country_code`, `page`, `limit` |
| Trending hashtags | `GET /api/v1/tiktok/ads/get_trends_hashtag_list` | `time_range`, `country_code`, `page` |
| Hashtag detail | `GET /api/v1/tiktok/ads/get_trends_hashtag_detail` | `hashtag_id`, `country_code` |
| Sound rank | `GET /api/v1/tiktok/ads/get_sound_rank_list` | `period`, `rank_type`, `page` |
| Search creators | `GET /api/v1/tiktok/ads/search_creators` | `keyword`, `sort_by`, `creator_country` |
| Creator video analytics | `POST /api/v1/tiktok/creator/get_video_analytics_summary` | JSON body |
| Comment keywords | `GET /api/v1/tiktok/analytics/fetch_comment_keywords` | `item_id` |
| Product detail | `GET /api/v1/tiktok/shop/web/fetch_product_detail_v3` | `product_id`, `region` |

## Example

```bash
tikin_run sh <<'TIKIN_COMMAND'
BASE="${TIKIN_BASE_URL:-https://console.tikin.net}"
curl -s --max-time 30 "$BASE/api/v1/tiktok/app/v3/fetch_user_post_videos?sec_user_id=SEC_UID&count=20&max_cursor=0" \
  -H "Authorization: Bearer $TIKIN_API_KEY"
TIKIN_COMMAND
```

## Pagination

User/video lists use `max_cursor` (start `0`) + `count`; search uses `offset` + `count`; comments
and hashtag video lists use `cursor` + `count`. Read the next cursor and `has_more` from the
response; loop until exhausted.

**Each page is billed — every loop needs a budget.** With a user target, that target is the budget;
with no target, stop at the default 50 pages / 5,000 items from `tikin-rest-api`'s **Reliability**
section. When the budget ends the loop, report it as `budget exhausted` — pages and items fetched,
whether `has_more` is still true, and the cursor to resume from — instead of presenting a partial
pull as complete.

Transient errors (429/5xx/timeouts): follow the **Reliability** section in `tikin-rest-api` —
3 attempts total, 1s then 2s backoff, `Retry-After` wins on a 429, and 401/403/404/422 are never
retried.

## Hand off to task skills

- Download videos → `tikin-social-media-downloader`
- Analyze an account → `tikin-creator-analytics`
- Trends/hashtags/sounds → `tikin-trend-research`, `tikin-hashtag-research`
- Comment mining → `tikin-comments-analysis`
- Large list pulls → `tikin-bulk-data-export`

## Red flags

- Need `sec_user_id` (not the @handle) for user endpoints — resolve via `handler_user_profile` with `unique_id` first.
- Unbounded `max_cursor` loops burn credits.
