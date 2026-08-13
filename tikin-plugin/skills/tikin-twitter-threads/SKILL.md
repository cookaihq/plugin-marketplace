---
name: tikin-twitter-threads
description: Work with Twitter/X and Threads URLs and data via tikin — fetch tweet/post detail, user profiles, user timelines, followers/following, search timelines, comments/replies, and X trending topics. Use when the user provides an X/Twitter/Threads URL or the task targets either platform. Covers the Twitter-Web and Threads-Web APIs.
---

# Twitter / X & Threads (via tikin)

Coverage of Twitter/X and Threads (both microblog platforms). Exhaustive endpoints via the
`tikin-endpoint-discovery` skill: `tikin-find-endpoint "<goal>" --platform twitter` or
`--platform threads`.

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

**Coverage:** Twitter-Web, Threads-Web.

## Twitter / X endpoints

| Goal | Method + path | Key params |
|---|---|---|
| Tweet detail | `GET /api/v1/twitter/web/fetch_tweet_detail` | `tweet_id` |
| User profile | `GET /api/v1/twitter/web/fetch_user_profile` | `screen_name` \| `rest_id` |
| User tweets | `GET /api/v1/twitter/web/fetch_user_post_tweet` | `screen_name`, `cursor` |
| Search timeline | `GET /api/v1/twitter/web/fetch_search_timeline` | `keyword`, `search_type`, `cursor` |
| Tweet comments | `GET /api/v1/twitter/web/fetch_post_comments` | `tweet_id`, `cursor` |
| Trending | `GET /api/v1/twitter/web/fetch_trending` | `country` |
| Followers | `GET /api/v1/twitter/web/fetch_user_followers` | `screen_name`, `cursor` |
| Following | `GET /api/v1/twitter/web/fetch_user_followings` | `screen_name`, `cursor` |

## Threads endpoints

| Goal | Method + path | Key params |
|---|---|---|
| User info | `GET /api/v1/threads/web/fetch_user_info` | `username` |
| User posts | `GET /api/v1/threads/web/fetch_user_posts` | `user_id`, `end_cursor` |
| Search (top) | `GET /api/v1/threads/web/search_top` | `query`, `end_cursor` |
| Search (recent) | `GET /api/v1/threads/web/search_recent` | `query`, `end_cursor` |
| Post comments | `GET /api/v1/threads/web/fetch_post_comments` | `post_id`, `end_cursor` |

## Example

```bash
curl -s "$BASE/api/v1/twitter/web/fetch_search_timeline?keyword=ai&search_type=Top" \
  -H "Authorization: Bearer $TIKIN_API_KEY"
```

## Pagination

Twitter/X uses `cursor`; Threads uses `end_cursor`. Pass the value returned by the previous
response; stop when none is returned. **Each page is billed — cap it.**

## Hand off to task skills

- Analyze an account → `tikin-creator-analytics`
- Trending/search → `tikin-trend-research`, `tikin-social-listening`
- Comment/reply mining → `tikin-comments-analysis`
- Competitor benchmarking → `tikin-competitor-analysis`
- Large pulls → `tikin-bulk-data-export`

## Red flags

- Twitter user endpoints accept `screen_name` or `rest_id`; Threads user posts need the numeric
  `user_id` (resolve via `fetch_user_info` first).
- Don't mix the two cursor params — `cursor` (Twitter) vs `end_cursor` (Threads).
