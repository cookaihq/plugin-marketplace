---
name: tikin-creator-analytics
description: Analyze a creator or account via tikin — profile stats, recent post performance, engagement rate, posting cadence, and top content. Use when the user asks for creator performance or provides a supported profile/channel URL or handle.
---

# Creator Analytics

Profile a single account and summarize its performance. For comparing multiple accounts, use
`tikin-competitor-analysis`.

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

1. **Identify platform + handle** from the user's input (URL or @handle).
2. **Resolve the user** to the id the API needs (e.g. TikTok/Douyin `sec_user_id` via
   `handler_user_profile`; Twitter `screen_name`/`rest_id`; Instagram `username`). See the
   platform skill for the exact endpoint.
3. **Fetch the profile** (followers, following, total likes/posts, bio) — the user-info endpoint.
4. **Fetch recent posts** (e.g. last 30–100) via the user's post-list endpoint, paginating with
   the platform's cursor. **Cap the page count** and tell the user the cost.
5. **Compute metrics** from the posts:
   - Engagement rate ≈ avg(likes + comments + shares) / followers.
   - Posting cadence (posts/week from timestamps).
   - Top 5 posts by engagement; median vs. top performance.
   - Trend over time (rising/declining views).
6. **Deliver** a concise report: headline stats, engagement rate, cadence, top content, and 2–3
   observations.

## Endpoint pointers (per platform)

Use the `tikin-endpoint-discovery` skill (`tikin-find-endpoint "user info" --platform <slug>`
and `"user posts" --platform <slug>`), or
the platform skill: `tikin-tiktok`, `tikin-douyin`, `tikin-instagram`, `tikin-youtube`,
`tikin-twitter-threads`, `tikin-xiaohongshu`.

## Cost awareness

Profile = 1 call; each page of posts = 1 call. Estimate before running (1 + pages) and warn the
user before pulling many pages. Check balance/usage anytime:

```bash
curl -s "$BASE/api/usage/token/" -H "Authorization: Bearer $TIKIN_API_KEY"
```

## Verification gate

1. Profile resolved (non-empty follower/post counts).
2. Post list non-empty and timestamps parse.
3. Engagement math sanity-checked (rates between 0–100%).

## Red flags

- Reporting an engagement rate from too few posts — note the sample size.
- Forgetting to resolve `sec_user_id`/numeric id before the post-list call.
