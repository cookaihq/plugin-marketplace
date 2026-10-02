# WorkBuddy 安装、更新与排障（给 Agent）

在 WorkBuddy 中安装、更新或查询 AIhub Plugin 前阅读本文件。使用 **WorkBuddy 当前运行实例的原生套件管理入口**。不要在终端另起 `codebuddy`、`cbc` 或 WorkBuddy 安装目录中的 CLI；这个限制也包含帮助、列表、校验和更新命令。Codex 使用自己的 Plugin 入口。

## 为什么不能另起 CLI

WorkBuddy 5.6.2 附带的 CLI 2.147.0 有两条不同的路径：插件配置读取 `CODEBUDDY_CONFIG_DIR`，未设置时回到用户目录下 `.codebuddy`；启动诊断代码则直接创建用户目录下的 `.codebuddy/diagnostics`，不读取该变量。单独设置 `WORKBUDDY_CONFIG_DIR` 不能修正插件路径，同时设置两个变量也不能阻止诊断目录创建。headless 和 lite 两种 bundle 均包含后者；不要用环境变量包装器代替原生安装入口。

以上来自 macOS 上同版安装包的源码与隔离启动验证，Windows 原生完整安装尚未验收。这里只修正 AIhub 的安装流程，不修改 WorkBuddy 程序、关闭其诊断功能或声称已修复上游内部路径。

## 安装步骤

1. 先阅读下载来源中的 `aihub/README.md` 和本说明；无需先安装 Plugin，也无需运行宿主 CLI 探测环境。
2. 在 WorkBuddy 界面打开 **专家·技能·连接器 → 顶部“技能” → “套件”**。“套件”在“SkillHub”右侧。macOS 5.6.2 已实际核对，Windows 的同一入口已由用户截图确认；其他版本按实际可见界面定位，不臆造按钮或命令。
3. 检查现有市场。若已有 `plugin-marketplace`，核对其来源并复用。没有时点击 **市场名称一行最右侧的圆形“＋”**（图中在 `codebuddy-plugins-official` 右侧），打开标题为“添加市场”的窗口。页面上的入口只显示“＋”，不要让用户寻找写着“添加市场”的按钮。填写 `https://github.com/cookaihq/plugin-marketplace`，由 WorkBuddy 原生管理器提交。仅在 GitHub 网络故障时改用 `https://cnb.cool/zhidateam/tannt/plugin-marketplace.git`；先检查上次是否已添加成功，避免重复注册。权限、登录和仓库不存在不当作网络故障。
4. 从该市场选择 **aihub** 并安装完整 Plugin，安装对象为 `aihub@plugin-marketplace`。保留已有安装范围和设置；不要仅上传六个 `SKILL.md`，它们依赖同包的 `scripts/`、`dist/`、`catalog/` 和 `references/`。
5. 通过同一原生入口检查安装结果，再在 WorkBuddy 新会话或其支持的刷新入口中检查 Skill 发现与调用。安装和业务验收分别报告，不能仅凭清单存在就说功能已验证。

![WorkBuddy 添加市场入口：顶部技能 → 套件 → 市场名称右侧的圆形＋](images/workbuddy-add-marketplace.png)

图示来自用户提供的 Windows 截图。按 **“技能 → 套件 → 市场名称右侧的＋”** 操作；“添加市场”是点击后的窗口标题。技能卡片上的“＋”和右上角“添加技能”是其他入口。

Agent 有可用的原生插件管理工具或 UI 操作能力时直接执行上述流程。使用工具前读取其实际 schema，确认操作属于当前 WorkBuddy；不猜测工具名、端口或内部 RPC。没有这类能力时，给用户上述步骤和截图，说明尚未完成安装，不回退到终端 CLI，也不手写插件注册表。用户反馈控件不存在时，先核对当前页面和版本，不反复要求点击未确认的控件。

## 给用户操作步骤时同时展示截图

当回复需要用户手动添加市场、定位入口，或解释“找不到添加市场”时，**最终回复必须同时展示上面的截图和操作路径**。不能只让用户打开本说明、只输出图片文件路径，或用文字“见截图”代替实际图片。

- 图片随完整 Plugin 分发，位置是 `aihub/references/images/workbuddy-add-marketplace.png`；相对本说明为 `images/workbuddy-add-marketplace.png`。安装前已取得来源目录时也可使用其中的同一文件，无需先安装 AIhub。
- 先确认图片可读取。在支持本地 Markdown 图片的宿主中，将已确认的实际绝对路径用于 `![WorkBuddy 添加市场入口：技能 → 套件 → 右侧＋](<图片绝对路径>)`，不要把文档相对路径或占位符直接复制到回复。
- WorkBuddy 提供 `present_files` 时，读取当前工具 schema；按宿主的展示规则，把随包图片复制到当前任务允许展示的输出目录，再呈现为可预览的图片卡片，最终文字仍附下方路径说明。不要为截图新建网站或上传到其他服务。当前没有可用图片展示能力时，给出可打开的本地图片链接并明确说明未能内嵌展示。
- 图片缺失或显示失败时明确报告，并保留准确的文字步骤；不要声称已经展示。不得编造图片公网 URL。

配套回复文字：

> 打开“专家·技能·连接器”，点击顶部“技能”，再点击“套件”（在 SkillHub 右侧），最后点击市场名称一行最右侧的圆形“＋”。点击后才会出现“添加市场”窗口。

## 查询、更新与配置目录

查询已有安装、刷新市场和更新 AIhub 均使用同一 WorkBuddy 原生套件管理入口。更新完整 Plugin，六个 Skill 随包一起更新。网络中断或结果不明时先从原生入口重新读取状态，再决定是否重试；不要从另一套配置的空列表推断“尚未安装”。

原生管理器负责创建、读取和更新当前 WorkBuddy 的插件记录与缓存。排障时可以只读核对实际目录：在 WorkBuddy 的设置中查看系统缓存目录，结合宿主提供的 `WORKBUDDY_CONFIG_DIR` 和已有自定义位置确认。Windows 原生默认是 `%USERPROFILE%\.workbuddy`，macOS 默认是 `~/.workbuddy`；已有自定义位置优先，不为安装另建根目录。`CODEBUDDY_CONFIG_DIR` 单独存在可能属于独立 CodeBuddy，不能据此认定 WorkBuddy 的位置；WSL 的用户目录也不能代表 Windows WorkBuddy 的目录。

若先前已经出现 `.codebuddy`，先只读核对其中是诊断文件还是另一套插件安装记录。保留整个目录及用户原有数据；它可能属于独立 CodeBuddy，不能自动删除、覆盖、建立跨目录链接或搬迁。无法确定当前 WorkBuddy 目录时报告候选，让用户明确后再操作。

## 验收与边界

- 原生入口显示正确来源的 AIhub、实际版本和安装状态；存在其他市场和插件时，其记录保留。
- 新会话能够发现并显式调用 `aihub-image`、`aihub-video`、`aihub-audio`、`aihub-music`、`aihub-understanding`、`aihub-document`。未运行的业务请求明确标记未验证。
- 比对安装前后目录状态，确认本次安装没有另建 `.codebuddy`。若宿主仍自行创建，记录 WorkBuddy 版本、操作入口和目录内容，作为上游问题报告；不要改用另一个 CLI 重装或删除目录掩盖结果。

`.codebuddy-plugin/` 是仓库与 Plugin 的清单目录，与用户目录下 `.codebuddy/` 无关，保留原名。AIhub API Key 的个人配置仍是 `~/.config/aihub/.env`；业务程序 `scripts/aihub.mjs` 继续读取 AIhub 配置，不参与宿主插件安装。
