---
name: tikin-social-listening
description: Monitor mentions across supported social platforms via tikin — collect posts, classify sentiment, cluster themes, and deliver a cited digest. Use for brand sentiment, keyword monitoring, social listening, or supported URLs that should seed a listening query.
---

# Social Listening

Collect mentions of a brand/keyword across platforms, then analyze sentiment and themes.

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

1. **Define the query**: brand/keyword(s), platforms to cover, time window, target volume
   (e.g. ~100 mentions).
2. **Search each platform** using its search endpoint (one query → paginate to the target volume):
   - TikTok `app/v3/fetch_video_search_result`, Douyin `search/fetch_general_search_v2` (POST body),
     Instagram `v2/general_search`, Twitter `web/fetch_search_timeline`, YouTube
     `web_v2/get_general_search`, Xiaohongshu `app_v2/search_notes`.
   - Find exact paths via the `tikin-endpoint-discovery` skill (`tikin-find-endpoint "search" --platform <slug>`).
3. **Collect** posts/comments into one list (author, text, platform, url, timestamp, engagement).
4. **Classify sentiment** (positive / neutral / negative) per mention — reason over the text.
5. **Cluster themes** (recurring topics, complaints, praise) and pull representative quotes.
6. **Deliver a digest**: volume, sentiment breakdown, top themes with cited example posts (link
   each claim to a source URL), and 2–3 recommendations.

## Cost awareness — IMPORTANT

This is the most call-heavy skill: every search page on every platform is a billed call.
**State an estimated call count before running** (pages × platforms), cap pages per platform,
and check your balance/usage first:

```bash
curl -s "$BASE/api/usage/token/" -H "Authorization: Bearer $TIKIN_API_KEY"
```

## Verification gate

1. Mentions actually match the query (filter false positives).
2. Every theme/claim in the digest cites a real source URL.
3. Sentiment labels are justified by the quoted text.

## Red flags

- Unbounded multi-platform pagination — runs up credits fast; always cap and warn.
- Reporting sentiment without citations.
- Counting unrelated keyword collisions as mentions.
