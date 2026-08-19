# plugin-marketplace

A Claude Code plugin marketplace.

## Add the marketplace

```
/plugin marketplace add cookaihq/plugin-marketplace
```

## Plugins

| Plugin | What it does | Install |
|---|---|---|
| [**brain-hands**](brain-hands/) | Keeps your smartest (most expensive) model as the brain - planning, decomposing, reviewing - and dispatches implementation to a cheaper executor subagent. | `/plugin install brain-hands@plugin-marketplace` |
| [**tikin-plugin**](tikin-plugin/) | Social-media data for AI agents via tikin: download media and fetch posts, profiles, comments, search results, trends and analytics across TikTok, Douyin, Instagram, YouTube, Twitter/X, Threads, Xiaohongshu and more. | `/plugin install tikin-plugin@plugin-marketplace` |

Each plugin's own README documents its behaviour, configuration and update path.

## 版本与 Release

各目标的当前版本与对应 Release（本节由 `harness/repo-harness/release-on-push.sh --table` 生成，升版本的提交须同步更新，约定见外层仓 `docs/adr/0009`）：

<!-- release-table:begin -->
| 目标 | 版本 | Release |
|---|---|---|
| brain-hands | 0.1.3 | [brain-hands/v0.1.3](https://github.com/cookaihq/plugin-marketplace/releases/tag/brain-hands%2Fv0.1.3) |
| tikin-plugin | 0.2.1 | [tikin-plugin/v0.2.1](https://github.com/cookaihq/plugin-marketplace/releases/tag/tikin-plugin%2Fv0.2.1) |
<!-- release-table:end -->
