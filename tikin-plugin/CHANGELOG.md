# Changelog

All notable changes to the tikin plugin are documented here.

## Unreleased

## 0.3.0

- Added per-Skill project configuration: process environment → `.env.<skill-name>` →
  `.env.local` → `.env` → the existing tikin home configuration. Values resolve independently,
  empty values fall through, and project files are read only in the invocation directory.
- Replaced shell sourcing in all operational Skills with the bundled `tikin-config --skill
  <name> run -- <command>` helper. Dotenv files contain literal values; credentials are passed
  to the child command without being printed. API workflows use the existing `tikin-setup`
  uv runtime, with no new Python dependencies.
- `status` and `validate` now use the same selected Skill configuration as API commands.
  Existing home fallback, routing preferences, and authentication behavior remain available.

## 0.2.1

- Gave every documented `curl` call an explicit time limit: `--max-time 30` for JSON reads and
  `--max-time 300` for media downloads. A call with no limit can hang a whole task.
- Added a **Reliability** section to `tikin-rest-api` as the single source of truth for timeouts,
  failure classification, retry budget, and pagination budgets. The other 16 skills reference it
  instead of restating their own numbers.
- Defined the retry policy concretely: 3 attempts in total with a 1s then 2s backoff for transient
  failures (429, 5xx, timeouts, connection errors), honouring `Retry-After` on a 429; 401, 403,
  404, and 422 are never retried.
- Replaced the qualitative "cap it" pagination guidance with quantified budgets. With no user
  target, the default is 50 pages or 5,000 items, plus tighter per-skill defaults where the task
  warrants them. A budget-capped pull is now reported as `budget exhausted` — how much was
  fetched, whether more remains, and the cursor to resume from — instead of being presented as
  complete.
- `tikin-config` now retries transient key-validation failures on that same schedule and logs each
  retry without the key; 401 and 403 still fail immediately. Its `validate --timeout` default is
  30s, matching the `--max-time 30` that **Reliability** mandates for JSON calls against `$BASE`;
  the previous 10s cap classified slow-but-healthy responses as transient failures.
- Pinned the runtime for both bundled Python CLIs. `tikin-setup` and `tikin-endpoint-discovery`
  each carry a `pyproject.toml`, `uv.lock` and `.python-version` (3.13), run from their own
  `.venv`, and re-exec themselves onto that interpreter (rebuilding it from the lockfile with
  `uv sync --no-dev` when missing) instead of using whatever `python3` the PATH resolves to.
  Documented invocations now use `uv run --project <this-skill-dir>`; uv >= 0.8 is required.
  The README now states this per skill instead of claiming the whole plugin needs only `curl`
  and `python3`.
- `tests/test_tikin_config.py` launches `tikin-config` on that prebuilt `.venv` interpreter rather
  than on `sys.executable`, so the suite no longer triggers the script's own bootstrap mid-test.
  Without a prebuilt runtime it builds one via `uv sync --no-dev`, and on a machine with no uv at
  all it skips with the exact build command instead of failing every test.
- Removed the inline `python3 -c` URL-encoding helper from `tikin-social-media-downloader` in
  favour of curl's own `-G --data-urlencode`.

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
