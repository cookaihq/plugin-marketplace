---
name: tikin-setup
description: Install, update, and configure tikin social-media skills or plugins. Use when the user first mentions tikin, needs to install or repair the tikin package, has a missing or invalid TIKIN_API_KEY, wants browser-assisted API-key creation, or wants to change per-platform auto/confirm routing settings.
---

# tikin Setup

Use this skill as the bootstrap entry point. Complete installation, authentication, and routing
configuration, then hand the user's task to the owning `tikin-*` skill.

## Local state

Resolve local state through `scripts/tikin-config`; do not parse or print secrets yourself.

```bash
python3 <this-skill-dir>/scripts/tikin-config init
python3 <this-skill-dir>/scripts/tikin-config status
```

The helper honors `XDG_CONFIG_HOME` and defaults to:

- `~/.config/tikin/.env` for `TIKIN_API_KEY` and optional `TIKIN_BASE_URL`.
- `~/.config/tikin/settings.json` for non-secret routing preferences.

The process environment wins over `.env`. `init` migrates the legacy unhidden dotenv file only
when `.env` does not already exist. Never expose a key in chat, tool output, logs, source files,
or commits.

## Install or repair

Detect the active host and existing installation from its CLI/configuration. Do not infer it from
directory or branch names. Before a first install or installation-scope change, tell the user what
will be written and get confirmation. Use exactly one matching path:

| Host | Install path |
|---|---|
| Codex plugin | If absent, run `codex plugin marketplace add cookaihq/tikin-agent-plugin`, then `codex plugin add tikin-plugin@tikin-plugins`. |
| Claude Code plugin | If absent, run `claude plugin marketplace add cookaihq/tikin-agent-plugin`, then `claude plugin install tikin-plugin@tikin-plugins --scope <scope>` with the confirmed `user`, `project`, or `local` scope. |
| Agent Skills client | Run `npx skills add cookaihq/tikin-agent-plugin --skill '*'` and select only the active agent and requested project/user scope. |

Do not install through several channels in the same host. If an old manual copy contains
unprefixed skill names, migrate to the managed channel and remove only obsolete tikin-owned
copies; never delete a user-modified or unrelated skill without confirmation.

Newly installed plugin components become available in a new chat or CLI session. Finish local
configuration in the current session, then tell the user when a new session is required.

## Session update gate

On the first tikin use in each Agent session, start one best-effort update check. Do not repeat it
for later tikin calls in the same session and do not block the user's current task.

1. Detect the channel that owns the current tikin installation.
2. Check only that channel and only tikin-owned components.
3. For Codex, record the installed version from `codex plugin list --marketplace tikin-plugins
   --json`, refresh with `codex plugin marketplace upgrade tikin-plugins`, then run `codex plugin
   add tikin-plugin@tikin-plugins`. Repeated `plugin add` is the idempotent reinstall/update path
   for Git-backed plugin sources; compare the before/after installed versions only when reporting
   whether an update occurred.
4. For Claude Code, read the owning installation's `scope` from `claude plugin list --json`, then
   use `claude plugin update tikin-plugin@tikin-plugins --scope <scope>`. Do not let the command's
   `user` default redirect an update for a `project`, `local`, or `managed` installation.
5. For Agent Skills, use the source-aware `npx skills` updater for installed `tikin-*` skills only.
6. If an update succeeds, keep using the already-loaded version for the current task and state
   that the new version applies in a new session.
7. If the network, updater, sandbox, or approval policy prevents the check, continue silently
   with the installed version; mention it only when the user asks about updates or setup health.

Never send the API key, user URLs, or task data during a version check. Never update unrelated
plugins or skills. Preserve `.env` and `settings.json` across updates.

## Validate or create an API key

Run the helper instead of treating a non-empty value as valid:

```bash
python3 <this-skill-dir>/scripts/tikin-config validate
```

If validation succeeds, continue. If the key is missing or invalid:

1. Look for a browser-control MCP, an in-app browser, Chrome control, or a browser-opening CLI.
2. Open `https://console.tikin.net` directly when one is available. Otherwise give the URL and
   wait while the user opens it.
3. Let the user complete sign-in, passwords, CAPTCHA, passkeys, and 2FA. Never enter, request, or
   inspect those credentials.
4. After the user is signed in, navigate through the visible UI to the API Keys page. Do not guess
   an undocumented URL path.
5. Explain that a new credential will be created and get confirmation once. Create the key with a
   descriptive label that the user approves.
6. Prefer the page's Copy action. Do not take a screenshot, DOM snapshot, or tool response that
   reveals the secret. Use automatic transfer only when the browser/CLI can copy the value without
   returning it to the model.
7. Pipe the clipboard into the helper without command-line interpolation, for example on macOS:

   ```bash
   pbpaste | python3 <this-skill-dir>/scripts/tikin-config set-key
   ```

   Use the equivalent clipboard reader on other operating systems. If no secret-safe transfer is
   available, ask the user to copy the key and provide it to `set-key` through a local hidden or
   non-echoing stdin prompt. Do not ask the user to paste it into chat.
8. Run `validate` again. Report only whether validation passed, not the key or response body.

If an invalid key comes from the process environment, explain that it overrides `.env`; do not
silently write a different file value that will remain shadowed.

## Configure routing

If `settings.json` is absent, `init` creates this default:

```json
{
  "routing": {
    "default": "auto",
    "platforms": {}
  }
}
```

Offer these choices during first setup and when the user asks to change preferences:

```bash
# All supported platforms use tikin automatically (default).
python3 <this-skill-dir>/scripts/tikin-config set-routing --default auto --clear-platforms

# Every supported platform requires confirmation.
python3 <this-skill-dir>/scripts/tikin-config set-routing --default confirm --clear-platforms

# Only selected platforms are automatic; all others require confirmation.
python3 <this-skill-dir>/scripts/tikin-config set-routing --default confirm --clear-platforms \
  --platform xiaohongshu=auto --platform douyin=auto
```

Supported policy slugs are `tiktok`, `douyin`, `instagram`, `youtube`, `twitter`, `threads`, and
`xiaohongshu`. A platform override wins over `routing.default`; an explicit instruction in the
current user request wins over both. In `confirm` mode, ask once per user task, group all affected
platforms/actions into that prompt, and do not ask again for pagination within the approved task.

## Route the task

| User outcome | Owning skill |
|---|---|
| Install, authentication, updates, routing settings | `tikin-setup` |
| Find an endpoint among 1,000+ | `tikin-endpoint-discovery` |
| Direct REST details | `tikin-rest-api` |
| Platform-specific work | `tikin-tiktok`, `tikin-douyin`, `tikin-instagram`, `tikin-youtube`, `tikin-twitter-threads`, `tikin-xiaohongshu` |
| Download, analytics, trends, listening, comparison, hashtags, comments, bulk export | The matching `tikin-*` task skill |

For a supported social-media URL, invoke the owning tikin skill. Never use `curl`, WebFetch, or a
generic browser fetch against the user-provided social-media content page. It is valid to parse an
ID locally, pass the original URL/share text to a tikin API endpoint, call the configured tikin
base URL, and download a final media URL returned by tikin. If the user declines tikin, explain
the limitation and ask before choosing an alternative; do not silently fetch the original page.

## Completion gate

Before handing off, confirm without revealing secrets that:

1. The intended package is installed or already present.
2. The key validates, or the task is stopped with a clear authentication next step.
3. `settings.json` is valid and the task's platform policy has been applied.
4. Any update result and new-session requirement are clear.
