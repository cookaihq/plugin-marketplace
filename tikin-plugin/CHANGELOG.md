# Changelog

All notable changes to the tikin plugin are documented here.

## Unreleased

## 0.2.0

- Added a native Codex plugin manifest and Codex marketplace catalog alongside the Claude Code
  plugin distribution.
- Standardized all 17 skill identifiers and directory names under the `tikin-*` namespace, with
  `tikin-setup` as the installation, authentication, routing-configuration, and update entry point.
- Moved the dotenv fallback to `~/.config/tikin/.env` and added non-secret behavior settings at
  `~/.config/tikin/settings.json`.
- Added all-platform and per-platform `auto` or `confirm` routing. Fresh installs default to
  automatic tikin routing for every supported platform; confirmation is once per user task.
- Required supported social-media URLs to go through the corresponding tikin skill instead of
  being fetched directly from the source platform with a generic HTTP client.
- Added a non-blocking update check on the first tikin use in each agent session. Updates preserve
  user configuration, do not interrupt the current task, and take effect in the next session.
- Added browser-assisted API-key setup with user-controlled login and a safe local-input fallback.

## 0.1.0

Initial release.

- **Cross-agent by design:** skills follow the [Agent Skills](https://agentskills.io) open
  standard and work in Claude Code, Codex, and other skills-compatible agents. Install via
  `npx skills add`, the Claude Code plugin marketplace, or manual copy.
- 17 foundation, platform, and task skills, including a bundled endpoint-search CLI over more
  than 1,000 endpoints.
- Single REST path against `https://console.tikin.net` with a tikin API key; per-call prepaid
  billing; balance/usage via `GET /api/usage/token/`.
- Bundled endpoint index covering 1,000+ endpoints across the supported platforms.
