# brain-hands

**让最聪明的模型当大脑，让便宜的模型当手。**

## 要解决的问题

顶级模型（Fable、Opus）最擅长理解需求、设计方案、审查结果——同时也是单位 token 最贵、订阅额度最紧的。但你问它一个问题，它往往直接「开干」：几十轮编辑-测试-重试循环，把你最稀缺的额度烧在便宜模型同样能干好的执行工作上。

硬拦截（plan mode、权限墙）能解决这个问题，但代价是失去灵活性：有些时候你**就是**想让聪明模型直接改一处代码。

## brain-hands 做什么

brain-hands 装的不是一堵墙，而是一份**角色协议**。当主会话运行的是 brain 档模型时：

- 它的职责是：理解需求、设计方案、拆分任务、写实施简报、验收结果。
- 执行类工作（功能实现、多文件修改、重构、调试循环）派给随插件安装的 **`hands` 执行子智能体**，跑在更便宜的模型上（默认 Opus）。执行阶段的 token 落在 executor 的额度上，不动大脑的额度。
- 内置例外保住灵活性：你说「你直接改」，大脑就亲自执行；一行小改动跳过派发；executor 连续失败两次由大脑接管；大型连续实施则建议你 `/model` 切换。

即使模型把一个提问误判成了任务，损失也是便宜的：它「开干」的方式是写简报、派发，而不是拿 brain 档额度去跑编辑循环。

三个机制，全部是 Claude Code plugin 的标准表面：

1. **SessionStart hook** 把协议注入每个会话（包括上下文压缩之后）——不动你的 `CLAUDE.md`。
2. **`hands` agent** 随插件分发，钉在 Opus。想换模型，在 `~/.claude/agents/` 放同名 agent 覆盖即可（用户级 agent 优先于 plugin agent，且不被插件更新冲掉）。
3. **`handoff` skill** 携带简报模板和派发清单。

## 安装

```
/plugin marketplace add cookaihq/plugin-marketplace
/plugin install brain-hands@plugin-marketplace
```

## 更新

第三方 marketplace（本仓属此类）**默认不自动更新**。两条路：

**手动**（默认）：

```
/plugin update brain-hands@plugin-marketplace
```

新版本在新会话中加载；当前会话要用新版，跑 `/reload-plugins`。

**自动**：`/plugin` → **Marketplaces** → `plugin-marketplace` → **Enable auto-update**。团队也可以在项目的 `.claude/settings.json` 里声明：

```json
{
  "extraKnownMarketplaces": {
    "plugin-marketplace": {
      "source": { "source": "github", "repo": "cookaihq/plugin-marketplace" },
      "autoUpdate": true
    }
  }
}
```

自动更新在会话启动后不久检查一次；正在运行的会话保持启动时加载的版本，直到 `/reload-plugins` 或开新会话。发布以 `plugin.json` 的 `version` 字段为门控——**让用户看到更新的是新版本号，不是新 commit**。

## 配置

- `BRAIN_HANDS_BRAIN_MODELS`——逗号分隔的模型名子串，命中即算 brain 档。默认 `fable`。例如 `BRAIN_HANDS_BRAIN_MODELS=fable,opus` 会让 Opus 会话也走派发——**但必须同时把 `hands` 覆盖到更便宜的模型**（见下一条）：用默认的 Opus executor，等于 Opus 给 Opus 写简报，一分不省还倒贴派发开销。
- **更换 executor 模型**：创建 `~/.claude/agents/hands.md`，`name: hands` 保持同名，`model:` 写你要的模型——用户级定义优先生效。

## 与工作流类插件组合（TDD、BMAD、spec 驱动流程）

工作流类 skill 定义**过程**；brain-hands 决定**谁来执行**。三种情况：

| skill 类型 | 例子 | 实际行为 |
|---|---|---|
| 思考类 | 领域建模、代码库设计、调研、grilling、BMAD 的 analyst/PM/architect | 大脑亲自跑——这正是你花钱买它的地方。 |
| 执行循环类 | TDD 红绿循环、原型搭建、BMAD 的 dev/QA | 打包成**一份简报**派出；hands 在自己的会话里加载该 skill、跑完整个循环。绝不逐步派发。 |
| 自派子智能体类 | 并行审查类 skill | `hands` 自身已在定义里钉死 executor 模型（默认 `model: opus`），派 hands 不传 `model` 就跑钉死的模型、不烧 brain 档额度——对 hands 不传才是默认正确做法，只有机械批量工作才降档覆盖并说明理由。除 hands 外的执行/审查类子智能体（含 skill 让你派的）没有钉死模型，必须显式传 `model` 参数——不指定就继承父模型（你的 brain 档模型），额度直接漏掉。此类工作禁用 fork 型子智能体。 |

## 手动安装（不用 plugin）

想要零依赖？把 [`scripts/inject-protocol.sh`](scripts/inject-protocol.sh) 里的协议文本（`CTX` 变量）复制进你的 `~/.claude/CLAUDE.md`，再在 `~/.claude/agents/` 建一个 executor agent。代价是失去自动更新和压缩后重注入。

## 边界，如实说

- 这是提示词层协议，不是强制机制。大脑模型以高——但非完美——的可靠性遵守它。措辞刻意选了「禁令 + 指名替代通道」（不得执行，派给 hands），而不是流程性要求（先确认再动手）——后者模型遵守得差得多。
- 仅支持 Claude Code。所用机制（plugin hooks、子智能体模型覆盖）在其他 agent CLI 中没有对应物。
- **省什么，省不了什么。** brain-hands 降低 brain 档额度的燃烧速率、延后撞到 brain 档专属上限。但它绕不开**跨模型共享**的订阅用量窗口（session / weekly 限额）：共享窗口耗尽后，切模型、派子智能体都无法恢复访问。撞到限额时 Claude Code 报错阻塞，不会静默降级——所以不存在「会话悄悄换了模型、协议还以为自己是大脑」的脏状态。在非 brain 档会话里，协议直接休眠：会话表现与未安装无异，`hands` agent 和 `handoff` skill 保留，可显式调用。
- **同模型派发陷阱。** 加进 `BRAIN_HANDS_BRAIN_MODELS` 的每个模型都必须比 executor 贵，否则派发是纯开销。`fable,opus` 配默认的 Opus `hands`，等于 Opus 给 Opus 写简报——额度一分不省，冷启动和写简报的成本照付。扩 brain 名单和覆盖 executor 模型（`~/.claude/agents/hands.md`）永远成对操作。

## 许可证

MIT — 见 [LICENSE](LICENSE)。
