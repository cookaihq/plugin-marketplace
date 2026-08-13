---
name: tikin-competitor-analysis
description: Benchmark multiple social-media accounts via tikin — followers, engagement rate, posting cadence, top content, and growth signals. Use when the user asks to compare accounts or supplies supported profile URLs for a competitive analysis.
---

# Competitor Analysis

Compare several accounts head-to-head. For a single account, use `tikin-creator-analytics`.

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

1. **Collect the account list** (handles/URLs) and the platform(s).
2. **For each account, run the `tikin-creator-analytics` workflow** (resolve → profile → recent posts →
   metrics). Use the same post-count cap for every account so the comparison is fair.
3. **Build a comparison table**: followers, avg engagement, engagement rate, posts/week, top post,
   median views. One row per account.
4. **Rank and summarize**: who leads on reach vs. engagement vs. consistency; notable content
   strategies; gaps/opportunities.

## Cost awareness

Cost ≈ (1 profile + N post-pages) × number of accounts. Multiply it out and state the total before
running; cap pages and account count. Check balance/usage with
`curl -s "$BASE/api/usage/token/" -H "Authorization: Bearer $TIKIN_API_KEY"`.

## Verification gate

1. Every account resolved and has a non-empty post sample.
2. Same sample size/time window across accounts (note any account with fewer posts).
3. Rates within sane bounds.

## Red flags

- Comparing accounts with wildly different sample sizes or date ranges — normalize first.
- Treating follower count alone as "winning" — lead with engagement rate.
