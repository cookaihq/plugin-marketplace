# plugin-marketplace

A plugin marketplace for Claude Code and Codex. Each plugin documents its supported hosts.

## Add the marketplace

```
/plugin marketplace add cookaihq/plugin-marketplace
```

## Plugins

| Plugin | What it does | Install |
|---|---|---|
| [**brain-hands**](brain-hands/) | Keeps your smartest (most expensive) model as the brain - planning, decomposing, reviewing - and dispatches implementation to a cheaper executor subagent. | `/plugin install brain-hands@plugin-marketplace` |
| [**tikin-plugin**](tikin-plugin/) | Social-media data for AI agents via tikin: download media and fetch posts, profiles, comments, search results, trends and analytics across TikTok, Douyin, Instagram, YouTube, Twitter/X, Threads, Xiaohongshu and more. | `/plugin install tikin-plugin@plugin-marketplace` |
| [**aihub**](aihub/) | AIhub image, video, audio, music, multimodal understanding and document workflows for Codex and WorkBuddy; resume tasks and deliver verified results. | `/plugin install aihub@plugin-marketplace` |

Each plugin's own README documents its behaviour, configuration and update path.

AIhub is also available as a native Codex plugin:

```bash
codex plugin marketplace add cookaihq/plugin-marketplace
codex plugin add aihub@plugin-marketplace
```

Start a new session after installation. See [AIhub](aihub/) for runtime requirements and API configuration.

## 版本与 Release

各目标的当前版本与对应 Release（本节由 `harness/repo-harness/release-on-push.sh --table` 生成，升版本的提交须同步更新，约定见外层仓 `docs/adr/0009`）：

<!-- release-table:begin -->
| 目标 | 版本 | Release |
|---|---|---|
| aihub | 0.9.0 | [aihub/v0.9.0](https://github.com/cookaihq/plugin-marketplace/releases/tag/aihub%2Fv0.9.0) |
| brain-hands | 0.1.3 | [brain-hands/v0.1.3](https://github.com/cookaihq/plugin-marketplace/releases/tag/brain-hands%2Fv0.1.3) |
| tikin-plugin | 0.3.0 | [tikin-plugin/v0.3.0](https://github.com/cookaihq/plugin-marketplace/releases/tag/tikin-plugin%2Fv0.3.0) |
<!-- release-table:end -->
