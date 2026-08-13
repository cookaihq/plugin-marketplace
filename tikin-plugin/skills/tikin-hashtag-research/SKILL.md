---
name: tikin-hashtag-research
description: Research a hashtag or keyword via tikin — popularity signals, top and recent content, and related hashtags across supported platforms. Use when the user asks about a hashtag, related tags, content ideas, or supplies a supported hashtag URL.
---

# Hashtag Research

Assess a hashtag/keyword and surface its top content and related tags.

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

1. **Pick platform(s)** and the hashtag/keyword.
2. **Pull signals + content:**
   - TikTok: `ads/get_trends_hashtag_detail` (`hashtag_id`) and `ads/get_trends_hashtag_list`;
     pull videos under a hashtag with `app/v3/fetch_hashtag_video_list` (`ch_id`).
   - Douyin: `search/fetch_general_search_v2` (POST) for hashtag/keyword content.
   - Instagram: `v2/search_hashtags` + `v2/fetch_hashtag_posts`.
   - Xiaohongshu: `app_v2/search_notes` (keyword).
   - Discover exact paths via the `tikin-endpoint-discovery` skill (`tikin-find-endpoint "hashtag" --platform <slug>`).
3. **Summarize**: estimated popularity/volume, top posts (engagement), recent momentum, and a list
   of related/co-occurring hashtags pulled from the top posts.
4. **Recommend** a tag set for the user's niche.

## Cost awareness

Detail/list calls are 1 each; pulling top-posts pages multiplies calls. Cap and warn for deep pulls.

## Verification gate

1. Hashtag resolved (or clearly report "no data / low volume").
2. Top posts are actually tagged with the hashtag.
3. Related tags derived from real co-occurrence, not guessed.

## Red flags

- Inventing volume numbers — only report what the API returns; otherwise say "not available".
- Recommending banned/irrelevant tags.
