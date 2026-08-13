---
name: tikin-tiktok
description: Work with TikTok URLs and data via tikin — fetch videos, user profiles and post lists, run search, pull trends/ads insights, creator analytics, comment keywords, and shop search. Use when the user provides a TikTok URL or the task targets TikTok. Covers the App-V3, Ads, Creator, Analytics, and Shop APIs.
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
curl -s "$BASE/api/v1/tiktok/app/v3/fetch_user_post_videos?sec_user_id=SEC_UID&count=20&max_cursor=0" \
  -H "Authorization: Bearer $TIKIN_API_KEY"
```

## Pagination

User/video lists use `max_cursor` (start `0`) + `count`; search uses `offset` + `count`; comments
and hashtag video lists use `cursor` + `count`. Read the next cursor and `has_more` from the
response; loop until exhausted. **Each page is billed — cap it.**

## Hand off to task skills

- Download videos → `tikin-social-media-downloader`
- Analyze an account → `tikin-creator-analytics`
- Trends/hashtags/sounds → `tikin-trend-research`, `tikin-hashtag-research`
- Comment mining → `tikin-comments-analysis`
- Large list pulls → `tikin-bulk-data-export`

## Red flags

- Need `sec_user_id` (not the @handle) for user endpoints — resolve via `handler_user_profile` with `unique_id` first.
- Unbounded `max_cursor` loops burn credits.
