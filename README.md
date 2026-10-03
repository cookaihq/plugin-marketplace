# plugin-marketplace

This marketplace provides **brain-hands for Claude Code**. AIhub and tikin have moved to
[AIhub Marketplace](https://github.com/cookaihq/aihub-marketplace), where they are named
**aihub-studio** and **tikin-social**. The new repository is also available on
[CNB](https://cnb.cool/zhidateam/tannt/aihub-marketplace).

## Install brain-hands

Copy this prompt into Claude Code:

```text
Install the complete brain-hands Plugin in this Claude Code session. Prefer https://github.com/cookaihq/plugin-marketplace; if GitHub has a network failure, use https://cnb.cool/zhidateam/tannt/plugin-marketplace.git. Read brain-hands/README.md, preserve existing settings, and use Claude Code's native Plugin manager. Report installation, Skill discovery and invocation separately.
```

| Plugin | What it does | Supported host |
|---|---|---|
| [**brain-hands**](brain-hands/) | Keeps planning and review with the selected reasoning model and dispatches implementation to an executor subagent. | Claude Code |

Start a new session after installation. See [brain-hands/README.md](brain-hands/README.md)
for model routing, configuration and updates. Existing brain-hands installations continue to
use `brain-hands@plugin-marketplace`.

This marketplace currently lists no Plugins for Codex or WorkBuddy. Use the new marketplace
below for AIhub Studio or tikin Social; a marketplace entry alone does not establish runtime
compatibility with a host or operating system.

## Install AIhub Studio or tikin Social

For a new installation, use [AIhub Marketplace's installation guide](https://github.com/cookaihq/aihub-marketplace#readme)
and read the corresponding Plugin's runtime requirements and supported-host notes:

- [AIhub Studio](https://github.com/cookaihq/aihub-marketplace/blob/main/aihub-studio/README.md):
  images, video, audio, music, multimodal understanding and document processing; 6 `aihub-*` Skills.
- [tikin Social](https://github.com/cookaihq/aihub-marketplace/blob/main/tikin-social/README.md):
  social-media data, downloads and analysis; 17 `tikin-*` Skills.

Copy this prompt into Codex or WorkBuddy, keeping only the Plugin names you need:

```text
Install the complete aihub-studio and tikin-social Plugins from AIhub Marketplace. Prefer https://github.com/cookaihq/aihub-marketplace; if GitHub has a network failure, use https://cnb.cool/zhidateam/tannt/aihub-marketplace.git. Read the marketplace and Plugin READMEs, use this host's native Plugin manager, and preserve existing settings. Report installation, Skill discovery and invocation separately.
```

Install only the Plugin or Plugins you need. For WorkBuddy, follow the new marketplace's
illustrated instructions and use the running application's native suite manager. The initial
entry is the circular **+** beside marketplace names under **技能 → 套件**; “添加市场” is
the dialog title after clicking it. Do not launch a separate CodeBuddy CLI for installation,
listing, validation or updates. Claude Code users should follow the supported-host notes in
each Plugin README; AIhub Studio does not claim completed Claude Code adaptation.

## Migrate an existing AIhub or tikin installation

| Old installation | New installation |
|---|---|
| `aihub@plugin-marketplace` | `aihub-studio@aihub-marketplace` |
| `tikin-plugin@plugin-marketplace` or `tikin-plugin@tikin-plugins` | `tikin-social@aihub-marketplace` |

Refreshing this old marketplace does not rename an installed Plugin or install its replacement.
Use this order:

1. Read the new Plugin README, install the new Plugin, and prepare its configuration. Keep the
   old installation and files until you have checked the source, target and existing settings.
2. Disable the old AIhub or tikin Plugin in the host's Plugin manager, so two installations do
   not provide the same Skill names simultaneously. Preserve brain-hands and unrelated Plugins.
3. Start a new session and check the new Plugin's identity, version and actual Skill sources.
   Verify configuration and the task you intend to use through that new installation.
4. Once verification succeeds, uninstall the old Plugin if desired. Remove old configuration
   only after a separate explicit decision.

The 6 `aihub-*` and 17 `tikin-*` Skill names and the `AIHUB_*` / `TIKIN_*` API fields retain
their names. Plugin configuration locations change to `~/.config/aihub-studio/` and
`~/.config/tikin-social/`. Old AIhub files under `~/.config/aihub/` and old tikin files under
`~/.config/tikin/` or `$XDG_CONFIG_HOME/tikin/` are not read or copied automatically. tikin's
`.env` credentials and `settings.json` routing preferences need separate review. Follow the new
Plugin README before explicitly choosing which files or settings to migrate; never overwrite
an existing destination without resolving conflicts. Ordinary per-Skill configuration and
project configuration follow the new Plugin's documented precedence.

The older [`tikin-plugins` forwarding marketplace](https://github.com/cookaihq/tikin-agent-plugin)
remains fixed at tikin-plugin **0.3.0**. It does not deliver tikin-social updates. The final
old-name releases remain available as historical snapshots:
[AIhub 0.9.2](https://github.com/cookaihq/plugin-marketplace/releases/tag/aihub%2Fv0.9.2) and
[tikin-plugin 0.3.0](https://github.com/cookaihq/plugin-marketplace/releases/tag/tikin-plugin%2Fv0.3.0).

## 版本与 Release

This table lists the Plugin currently maintained in this marketplace.

<!-- release-table:begin -->
| 目标 | 版本 | Release |
|---|---|---|
| brain-hands | 0.1.3 | [brain-hands/v0.1.3](https://github.com/cookaihq/plugin-marketplace/releases/tag/brain-hands%2Fv0.1.3) |
<!-- release-table:end -->
