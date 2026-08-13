---
name: tikin-endpoint-discovery
description: Find the right tikin endpoint among 1,000+ across 16+ platforms. Use when you know the goal (e.g. "get a user's posts on Douyin") but not the exact API path, or when a platform has no dedicated skill (LinkedIn, Reddit, Bilibili, Weibo, WeChat, Kuaishou, Zhihu, Lemon8, etc.). Searches a bundled index and maps results to REST calls.
---

# tikin — Endpoint Discovery

tikin has 1,000+ endpoints. This skill finds the one you need, then hands off to `tikin-rest-api`.

## Runtime gate

On the first tikin use in each Agent session, follow the `tikin-setup` session update gate once
without blocking endpoint discovery. The bundled index remains searchable offline without a key.

When the user supplies a supported social-media URL, identify its platform and apply
`${XDG_CONFIG_HOME:-$HOME/.config}/tikin/settings.json` before making a tikin call. An explicit
user instruction wins over the stored platform override and global default. Ask once per task for
`confirm` platforms.

Never request the user-provided social-media content page with `curl`, WebFetch, or a generic
browser fetch. Parse identifiers locally or pass the original URL/share text to the selected tikin
endpoint. Before calling an endpoint, resolve and require the key:

```bash
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/tikin/.env"
if [ -z "${TIKIN_API_KEY:-}" ] && [ -f "$CONFIG" ]; then set -a; . "$CONFIG"; set +a; fi
if [ -z "${TIKIN_API_KEY:-}" ]; then
  echo "Index search works without a key; calling an endpoint requires tikin-setup."
  exit 1
fi
```

Calls to the configured tikin base URL are allowed. If the user declines tikin, explain the
limitation and ask before selecting an alternative; do not silently fetch the original page.

## Use the bundled search CLI

`scripts/tikin-find-endpoint` — bundled **inside this skill's directory** — searches a trimmed
index of every endpoint (method, path, tag, summary, params). Run it by path relative to this
skill's directory (it works from any cwd; no PATH setup needed):

```bash
# goal-based search, scoped to a platform
<this-skill-dir>/scripts/tikin-find-endpoint "one video" --platform tiktok
<this-skill-dir>/scripts/tikin-find-endpoint "user posts" --platform douyin
<this-skill-dir>/scripts/tikin-find-endpoint "comments" --platform youtube --method GET

# no platform filter — search everything
<this-skill-dir>/scripts/tikin-find-endpoint "trending hashtag"
```

(`<this-skill-dir>` = the directory containing this SKILL.md. Other skills refer to this tool
as `tikin-find-endpoint` for short — it always means this script.)

Output lines look like:
```
GET  /api/v1/tiktok/app/v3/fetch_one_video  [TikTok-App-V3-API]  params: aweme_id
```

The index lives at `references/endpoint-index.json` (beside the script, inside this skill),
ships with the skill, and is refreshed on new releases when the API surface changes.

## Map a result to a call

Given `GET /api/v1/{platform}/{api}/{action}`, call it via REST (see `tikin-rest-api`):

```bash
BASE="${TIKIN_BASE_URL:-https://console.tikin.net}"
curl -s "$BASE/api/v1/tiktok/app/v3/fetch_one_video?aweme_id=..." \
  -H "Authorization: Bearer $TIKIN_API_KEY"
```

## Platforms without a dedicated skill

For LinkedIn, Reddit, Bilibili, Weibo, WeChat, Kuaishou, Zhihu, Lemon8, Toutiao, Xigua,
and more, discovery + REST is the path — there are no dedicated platform skills.

## Red flags

- Guessing endpoint paths instead of searching the index (paths and param names are specific).
- Forgetting param names — the CLI prints them; pass them exactly.
