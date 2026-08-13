---
name: tikin-trend-research
description: Discover trends via tikin — viral content, rising hashtags, hot sounds, and ranking boards across supported platforms. Use when the user asks what is trending, wants a regional or niche trend report, or provides a supported URL as trend context.
---

# Trend Research

Surface trending content, hashtags, sounds, and rankings, optionally scoped to a region or niche.

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

## Sources by platform

| Platform | What | Endpoint |
|---|---|---|
| TikTok | Popular trends | `GET /api/v1/tiktok/ads/get_popular_trends` (`period`, `country_code`) |
| TikTok | Trending hashtags | `GET /api/v1/tiktok/ads/get_trends_hashtag_list` |
| TikTok | Hot sounds | `GET /api/v1/tiktok/ads/get_sound_rank_list` |
| Twitter/X | Trending topics | `GET /api/v1/twitter/web/fetch_trending` (`country`) |

For niche trends, also run keyword/hashtag search on the relevant platform skill. For other
platforms' trend sources, use the `tikin-endpoint-discovery` skill
(`tikin-find-endpoint "<goal>" --platform <slug>`).

## Workflow

1. Clarify scope: platform(s), region/country, niche/keyword, time window.
2. Pull the relevant trend boards above (one call each).
3. Normalize into a single ranked list (rank, name, volume/score, example content, platform).
4. Deliver a trend report; optionally drill into a hot hashtag via `tikin-hashtag-research`.

## Cost awareness

Each board is 1 call. A multi-platform report is a handful of calls — cheap. Drilling into many
hashtags/posts multiplies calls; warn before deep dives.

## Verification gate

1. Each board returns a non-empty ranked list.
2. Region/period filters were actually applied (echo them in the report).

## Red flags

- Presenting Ads-API "trends" as organic virality without noting the source.
- Mixing regions/time windows in one ranked table without labeling them.
