# Contributing to the tikin Plugin

Thanks for helping improve the tikin agent plugin! This plugin is a thin connector over
[tikin](https://tikin.net)'s REST API — most contributions are new/updated **skills** (Markdown)
and small helper scripts. Skills follow the [Agent Skills](https://agentskills.io) open standard
and work in Claude Code, Codex, and other skills-compatible agents.

## Project layout

```
skills/tikin-<name>/SKILL.md                         one folder per skill
skills/tikin-setup/scripts/tikin-config              safe local configuration helper
skills/tikin-endpoint-discovery/scripts/tikin-find-endpoint     endpoint search CLI
skills/tikin-endpoint-discovery/references/endpoint-index.json  bundled index
.claude-plugin/                                      Claude Code manifests
.codex-plugin/plugin.json                            Codex plugin manifest
.agents/plugins/marketplace.json                     Codex marketplace catalog
```

## Quick start for contributors

```bash
git clone <your-fork-url> && cd tikin-plugin
export TIKIN_API_KEY="your_key"          # only needed to call the API, not to edit skills
claude --plugin-dir .                    # load the plugin locally to test
```

## Adding or editing a skill

- One folder per skill under `skills/`, each with a `SKILL.md` that opens with YAML frontmatter
  (`name`, `description`). Keep skills short and action-oriented.
- Every skill directory and frontmatter `name` must be identical and start with `tikin-`.
  Platform skills use `tikin-<platform>`; task skills use `tikin-<task>`.
- Every skill assumes a single REST base (`$BASE`, default `https://console.tikin.net`) and a
  `TIKIN_API_KEY` bearer token. Do not hardcode keys.
- A skill's runtime gate resolves the key uniformly: env var wins, else it sources the
  `~/.config/tikin/.env` dotenv fallback (`${XDG_CONFIG_HOME:-$HOME/.config}/tikin/.env`). Keep
  the resolver semantics consistent; endpoint discovery may still search its offline index
  without a key.
- Reference endpoints by their exact path/method/params — find them with the
  `tikin-endpoint-discovery` skill's `scripts/tikin-find-endpoint`.

## Routing contract

`tikin-setup` owns the non-secret routing file at
`${XDG_CONFIG_HOME:-$HOME/.config}/tikin/settings.json` (normally
`~/.config/tikin/settings.json`). Its schema is:

```json
{
  "routing": {
    "default": "auto",
    "platforms": {}
  }
}
```

Only `auto` and `confirm` are valid policy values. Platform entries override the global default,
and the default for a fresh install is all-platform `auto`. A `confirm` decision is made once per
user task, not once per request or page. Explicit instructions in the current user request take
precedence over saved settings.

When a user supplies a supported TikTok, Douyin, Instagram, YouTube, Twitter/X, Threads, or
Xiaohongshu URL, route it to the matching `tikin-*` platform or task skill. Never use `curl`,
WebFetch, or another generic fetcher directly on that social-media page. Calls to the tikin API
and downloads from a final media URL returned by tikin remain allowed. If a user declines tikin,
report the limitation instead of silently falling back to the source platform.

## Release consistency

Keep the version synchronized across the Claude and Codex plugin manifests and marketplace
metadata. The first tikin use in each agent session performs a non-blocking update check: update
only tikin, preserve `~/.config/tikin/.env` and `settings.json`, continue the current task with the
loaded version, and activate an update in the next session. Update failures must not block normal
use.

Before opening a pull request, run:

```bash
./scripts/validate-skills.sh
```

## Endpoint index

The bundled index at `skills/tikin-endpoint-discovery/references/endpoint-index.json` ships with
the plugin and is refreshed by the maintainers on new releases when the API surface changes.

## License

By contributing, you agree your contributions are licensed under the MIT License.
