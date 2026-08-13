# tikin Plugin

Social-media data for AI coding agents — download media and fetch posts, profiles, comments,
search, trends, and analytics across **TikTok, Douyin, Instagram, YouTube, Twitter/X, Threads,
Xiaohongshu**, and more, powered by [tikin](https://tikin.net).

Built on the [Agent Skills](https://agentskills.io) open standard — works in **Claude Code**,
**Codex**, and any skills-compatible agent. The plugin contains 17 consistently named
`tikin-*` skills across setup, REST integration, platform coverage, and task workflows.

## Quick start

1. **Install** the plugin or skills for your agent — see [Install](#install).
2. Start a new agent session and invoke `tikin-setup`.
3. Follow the setup flow. It verifies the installation and API key, creates the default routing
   settings, and configures local credentials without asking you to paste a key into chat.
4. Ask your agent something like *"Download this TikTok video"* or *"Analyze @nasa on Instagram"*.

If no valid key exists, `tikin-setup` prefers an available browser-control MCP or CLI. It opens
<https://console.tikin.net>, waits while you complete login, CAPTCHA, or 2FA, and then helps create
and configure a key. Authentication remains user-controlled. If the environment cannot transfer
the key safely, setup falls back to a hidden local input instead of exposing it in chat or logs.

## Install

The skills are self-contained [Agent Skills](https://agentskills.io) folders (the endpoint-search
tool ships inside the `tikin-endpoint-discovery` skill), so any compatible agent can use them.
Runtime requirements are just `curl` (tikin API and final media calls) and `python3` (the bundled
configuration and endpoint-search helpers) — no SDK, package install, or build step.

### Any agent — skills CLI

[`npx skills`](https://github.com/vercel-labs/skills) installs into every agent it detects
(Claude Code, Codex, Cursor, and more):

```bash
npx skills add cookaihq/tikin-agent-plugin
```

To run setup before a full install, invoke just the bootstrap skill:

```bash
npx skills use cookaihq/tikin-agent-plugin@tikin-setup --agent codex
```

### Claude Code — plugin marketplace

```bash
claude plugin marketplace add cookaihq/tikin-agent-plugin
claude plugin install tikin-plugin@tikin-plugins
```

Or test a local checkout: `claude --plugin-dir /path/to/tikin-plugin`.

### Codex — plugin marketplace

Codex can install the native plugin directly from this repository's marketplace:

```bash
codex plugin marketplace add cookaihq/tikin-agent-plugin
codex plugin add tikin-plugin@tikin-plugins
```

Start a new Codex session after installation so the bundled skills are discovered.

### Verify & update

- **skills CLI installs:** check with `npx skills list`, update with `npx skills update`.
- **Claude Code marketplace installs:** manage via the `/plugin` interface inside Claude Code.
- **Codex marketplace installs:** inspect with `codex plugin list`; refresh with `codex plugin
  marketplace upgrade tikin-plugins`, then reinstall/update with `codex plugin add
  tikin-plugin@tikin-plugins`.

On the first tikin use in each agent session, the skills perform a best-effort, non-blocking
version check. When an update is available, only tikin's installed plugin or skills are updated;
the current task continues with the loaded version and the update takes effect in the next
session. Offline checks, update failures, and insufficient permissions do not block the task or
modify local credentials and settings.

Sanity check in any agent: ask *"Find the tikin endpoint for one TikTok video"* — the
`tikin-endpoint-discovery` skill should search the bundled index and return
`GET /api/v1/tiktok/app/v3/fetch_one_video`.

## Configuration

tikin keeps credentials and behavior settings separate. Both paths honor `XDG_CONFIG_HOME`:

| File | Purpose |
|------|---------|
| `~/.config/tikin/.env` | Secrets such as `TIKIN_API_KEY`, plus `TIKIN_BASE_URL` when needed |
| `~/.config/tikin/settings.json` | Non-secret routing behavior |

An existing process environment variable takes precedence over the dotenv file. The default
routing configuration is:

```json
{
  "routing": {
    "default": "auto",
    "platforms": {}
  }
}
```

`routing.default` and each entry in `routing.platforms` accept only `auto` or `confirm`:

- `auto` routes a supported platform URL through tikin immediately.
- `confirm` asks once per user task before tikin is used.

Platform overrides take precedence over `routing.default`; a newly supported platform inherits
the default. This supports all-platform automatic routing, selected automatic platforms, or
confirmation for every platform. An explicit instruction in the current user request always
overrides the saved setting. Run `tikin-setup` again to change these choices.

Example: confirm before Xiaohongshu requests while other supported platforms remain automatic.

```json
{
  "routing": {
    "default": "auto",
    "platforms": {
      "xiaohongshu": "confirm"
    }
  }
}
```

## How it connects

tikin exposes a single **REST API** at `https://console.tikin.net`. You call it with your tikin
API key; tikin authenticates, meters usage (per-call, prepaid balance), and returns the data. One
key, one base URL, standard HTTP — no SDK or extra runtime required.

| Path | Owned by skill |
|------|----------------|
| REST best practices (auth, paths, pagination, cost) | `tikin-rest-api` |
| Find the right endpoint among 1,000+ | `tikin-endpoint-discovery` |

Supported TikTok, Douyin, Instagram, YouTube, Twitter/X, Threads, and Xiaohongshu URLs are routed
to the matching `tikin-*` platform or task skill. Skills must not use `curl`, WebFetch, or a
similar generic fetcher directly against the user-provided social-media page URL. They may call
the tikin API and may download a final media URL returned by tikin. If the user declines tikin,
the agent reports the limitation instead of silently fetching the source platform directly.

## Skills

### Foundation
| Skill | What it does |
|-------|--------------|
| `tikin-setup` | Install or repair tikin, configure a key and routing, and check for updates |
| `tikin-rest-api` | REST best practices: auth, paths, pagination, rate limits, cost |
| `tikin-endpoint-discovery` | Search 1,000+ endpoints with `tikin-find-endpoint` |

### Platforms
| Skill | Coverage |
|-------|----------|
| `tikin-tiktok` | Videos, users, search, ads/trends, creator analytics, shop |
| `tikin-douyin` | Videos, users, search series, comments |
| `tikin-instagram` | Users, posts, search, comments, hashtags (V2) |
| `tikin-youtube` | Video info, streams, captions, comments, search (Web-V2) |
| `tikin-twitter-threads` | Tweets/posts, profiles, timelines, search, trends |
| `tikin-xiaohongshu` | Note details, users, search, comments (App-V2) |

### Tasks
| Skill | Outcome |
|-------|---------|
| `tikin-social-media-downloader` | Download video/audio/images (no-watermark) from any URL |
| `tikin-creator-analytics` | Profile + engagement + cadence + top content for an account |
| `tikin-trend-research` | Trending content, rising hashtags, hot sounds, ranking boards |
| `tikin-social-listening` | Mentions → sentiment → themes → cited digest |
| `tikin-competitor-analysis` | Benchmark multiple accounts side by side |
| `tikin-hashtag-research` | Hashtag volume, top content, related tags |
| `tikin-comments-analysis` | Comment sentiment, themes, top comments for a post |
| `tikin-bulk-data-export` | Paginate large lists → dedup → CSV/JSON, with cost estimate |

## Examples

```text
You: Download https://www.tiktok.com/@nasa/video/7372484719365098283 without watermark
→ tikin-social-media-downloader routes the URL through tikin and saves the no-watermark MP4.

You: How is @nasa doing on Instagram?
→ tikin-creator-analytics pulls the profile + recent posts,
  then reports engagement rate & top content.

You: What's trending on TikTok in the US right now?
→ tikin-trend-research pulls popular trends, hashtags, and hot sounds for the US.
```

## Notes

- tikin bills per API call against your prepaid balance. Task skills warn before large pulls and
  cap pagination. Check your balance/usage anytime:
  ```bash
  curl "https://console.tikin.net/api/usage/token/" -H "Authorization: Bearer $TIKIN_API_KEY"
  ```
- Override the base URL with `TIKIN_BASE_URL` if you use a private deployment.

## Links

- Website <https://tikin.net> · Console <https://console.tikin.net> ·
  GitHub <https://github.com/cookaihq/tikin-agent-plugin>
- [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)

## License

MIT — see [LICENSE](LICENSE).
