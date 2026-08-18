---
name: tikin-competitor-analysis
version: 0.2.1
description: v0.2.1｜Benchmark multiple social-media accounts via tikin — followers, engagement rate, posting cadence, top content, and growth signals. Use when the user asks to compare accounts or supplies supported profile URLs for a competitive analysis.
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
   metrics). Use the same post-count budget for every account so the comparison is fair.
3. **Build a comparison table**: followers, avg engagement, engagement rate, posts/week, top post,
   median views. One row per account.
4. **Rank and summarize**: who leads on reach vs. engagement vs. consistency; notable content
   strategies; gaps/opportunities.

## Cost awareness

Cost ≈ (1 profile + N post-pages) × number of accounts. Multiply it out and state the total before
running. Check balance/usage with
`curl -s --max-time 30 "$BASE/api/usage/token/" -H "Authorization: Bearer $TIKIN_API_KEY"`.

**Budget both dimensions.** With user-stated numbers, those are the budget; with no target, the
defaults are **10 accounts and 5 post-pages per account**, inside the overall 50-page / 5,000-item
cap from `tikin-rest-api`'s **Reliability** section. When a budget ends the run, report it as
`budget exhausted`: which accounts were fully covered, which were cut short, and which were not
fetched at all — never quietly drop accounts from the comparison table.

Transient errors (429/5xx/timeouts): follow the **Reliability** section in `tikin-rest-api` —
3 attempts total, 1s then 2s backoff, `Retry-After` wins on a 429, and 401/403/404/422 are never
retried.

## Verification gate

1. Every account resolved and has a non-empty post sample.
2. Same sample size/time window across accounts (note any account with fewer posts).
3. Rates within sane bounds.
4. Any account skipped or truncated by the budget is named in the report.

## Red flags

- Comparing accounts with wildly different sample sizes or date ranges — normalize first.
- Treating follower count alone as "winning" — lead with engagement rate.
