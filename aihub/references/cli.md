# 共用 CLI、配置与任务恢复

WorkBuddy 的 Plugin 安装、查询或更新按 [workbuddy-install.md](workbuddy-install.md) 使用当前应用的原生套件管理；给用户手动操作步骤时按该说明同时展示随包截图，指明“技能 → 套件 → 市场名称右侧的＋”。禁止另起 CodeBuddy CLI（包括帮助或校验命令）。下面的 `scripts/aihub.mjs` 是业务程序，使用 AIhub 配置；它不管理宿主插件安装。

六个 Skill 共用 Plugin 根目录下的 `scripts/aihub.mjs`。先按“首次配置、缺项与配置修复”核对来源；以下命令中的 `AIHUB_PLUGIN_DIR` 必须替换为实际安装目录，`AIHUB_CALLER` 固定为当前 Skill 的名称：`aihub-image`、`aihub-video`、`aihub-audio`、`aihub-music`、`aihub-understanding` 或 `aihub-document`。当前工作目录是用户任务目录，决定项目配置从哪里读取。

```bash
AIHUB_PLUGIN_DIR="<实际 Plugin 目录>"
AIHUB_CALLER="aihub-image"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" doctor --skill "${AIHUB_CALLER}"
```

程序使用 Node.js 18 或更新版本；媒体文件检查需要 `ffprobe`。`doctor` 只检查本机运行条件和配置来源，不请求 AIhub，也不证明 Key 有效或生成渠道可用。`generate` 在提交前也会检查媒体工具。macOS 缺少 `ffprobe` 时安装命令是 `brew install ffmpeg`，程序不会自动安装系统工具。发行产物包含编译后的 JavaScript 和模型目录，安装者不需要运行 `npm install`，也不需要原 MCP 服务。

## 首次配置、缺项与配置修复

业务声明见 [credentials.json](credentials.json)：`aihub` 的六个 Skill 共用 Key 与服务地址，二者必须属于同一服务/账号。先直接运行配置检查，不安装或调用 Secret Book 就能检查：

```bash
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" config-check --skill "${AIHUB_CALLER}"
```

`config-check` 通过真实加载器输出 `secret-book.config-inspection/v1`：当前目录、每层文件、字段来源、缺项/格式问题和变化校验值，不输出配置值，不联网，也不要求 ffprobe。退出 `3` 表示需要配置，不能当作检查成功。普通命令缺 Key 或 URL 非法时也带 `configuration` 来源报告。`doctor` 进一步检查本机运行工具；它仍不验证线上鉴权。

1. 正常任务已有可读配置时直接调用 AIhub。只有用户要求首次配置/更改，或缺配置、有依据发现配置错误时，报告字段、来源和依据，引导“修改本机配置 / 从 secret-book 选择配置并保存”。沿用用户明确选择；手填分支不依赖安装 Secret Book。
2. 选择 secret-book 后读取实际安装的 Skill 及 [声明](credentials.json)。需要 2.3.0+；未安装、版本不足或平台不支持时说明具体情况，按其安装流程或用户选择改为手填。由它处理当前 Agent 规则检查、飞书登录、令牌表、候选记录、实际 key 和确认；这里不复制完整流程。
3. 在同一工作目录和启动环境运行 `config-check`，把不含值的报告保存到任务临时目录，交给 Secret Book 的 `configure --requirements <Plugin>/references/credentials.json --inspection <报告> --agent <当前Agent> --key <需新增或修复字段> ...`。首次新增默认个人全局共享；已有项目/Skill 专用选择则沿用。修复已有文件字段必须原处替换；进程环境来源先定位实际注入配置，不能另写全局文件。声明将 Key 与 URL 关联，未经确认不覆盖另一项已有值。
4. 确认并写入后，直接重新运行 `config-check` 和 `doctor`，报告完整写入路径、实际生效来源和本机验证范围。需要验证线上认证时可运行已有只读 `models`，明确这只检查模型查询接口；不得用生成任务换取“配置完成”。
5. 后续所有 `node ...` 命令直接运行。密钥从本机文件读取，表中轮换不自动同步。临时令牌、仅本轮、不落盘等明确例外才允许显式临时注入；不使用已废弃的 `run --requirements` 启动 AIhub。

401 返回 `authentication_rejected` 提示核对 Key/服务/账号组合，**不等同于已证明 Key 文本错误**。402、403、429、网络异常分别核对额度、权限、限流和连接，不据此换 Key。配置修复不授权重发提交结果不明或有副作用的请求；恢复仍核对原服务和密钥指纹。已运行的进程需要重新加载配置时，明确检查加载是否完成。

## 配置来源

`AIHUB_API_KEY` 唯一必填，`AIHUB_BASE_URL` 可选。另支持当前 Skill 的 `AIHUB_<类型>_MODELS`、`AIHUB_MODEL_FALLBACK_POLICY` 和 `AIHUB_MODEL_MAX_ATTEMPTS`，完整名称与语义见 [模型配置](model-selection.md#可选配置)。`AIHUB_RESULT_CHECK_*`、`AIHUB_ERROR_REPORT_THRESHOLD` 与 `AIHUB_SUPPORT_URL` 见 [结果检查与错误反馈](result-checks.md)。每个变量独立按以下顺序使用首个非空值，模型列表整体替换、不跨层合并：

1. 当前进程环境变量。
2. 当前工作目录 `.env.<skill-name>`，其中名称取本次 `--skill` 值。
3. 当前工作目录 `.env.local`。
4. 当前工作目录 `.env`。
5. 自动读取 `~/.config/aihub/<skill-name>/.env.local`。
6. `~/.config/aihub/<skill-name>/.env`。
7. `~/.config/aihub/.env.<skill-name>`。
8. `~/.config/aihub/.env.local`。
9. `~/.config/aihub/.env`。
10. `~/.config/<skill-name>/.env`，只补齐以上来源中缺失或为空的字段。

`<skill-name>` 必须是当前调用方的真实名称，与其 `SKILL.md` frontmatter `name` 一致。Plugin 名固定为 manifest 的 `aihub`，不随安装目录、Agent 或版本变化。缺项、空值及空子目录继续回退；Plugin 目录存在或其中已有部分字段，也不阻断其他缺项读取第 10 层。文件存在但无法读取时明确报错。不向父目录搜索，不读取普通 Skill 目录的 `.env.local`，不扫描兄弟 Skill、旧产品别名目录、其他 Plugin 或任意 `.env.*`。普通字段分别取值，须确认最终密钥属于最终服务地址。所有配置命令都要求有效的 `--skill`，未提供调用方时在读取配置前报错。

首次新增配置时，个人全局配置是 AIhub 已确认的默认方案，共享配置保存到 `~/.config/aihub/.env`。需要一个 Skill 使用不同值时可写根 `.env.<skill-name>`，只有明确需要时才创建对应子目录。写入前确认具体作用域并保留已有内容；仅提供凭证或允许读取不代表授权持久化。首次选择项目保存使用调用工作目录的 `.env.local`；修复已有字段写回其实际来源文件。写入 Secret 前检查未跟踪且被忽略。

全局读取由加载器自动执行，正常调用不加参数。`--no-global-config` 关闭本次命令的全部六个全局层，同时跳过 Plugin 目录和普通 Skill 目录；`--use-global-config` 仅为旧命令兼容，不再是必填项，两者同时传入报冲突。正常请求不需要逐次向用户征求读取全局文件的许可。`doctor` 报告每个字段的最终来源，包括普通 Skill 回退文件的实际路径，但不验证账号鉴权或生成通道。

已有 `~/.config/aihub-image/.env` 等当前 Skill 配置无需迁移即可作为末层来源。同一用户下，同名 Skill 的独立分发与 Plugin 分发可能共用这一文件；Plugin 配置优先。迁移只是可选整理操作，须先列出准确源与目标，让用户确认后再写入；相同配置可合并到共享文件，不同配置分别放到 `.env.<skill-name>` 或已选定的 Skill 子目录。默认写入位置仍在 Plugin 目录，加载器不创建、复制、移动或删除配置。用户文件夹由 Node `os.homedir()` 定位，Windows 原生与 WSL 使用各自用户目录；具体平台路径见随包 README。

`AIHUB_BASE_URL` 是 API 根地址，默认 `https://api.aihubmax.com`。它不是某一生成 endpoint；不要追加 `/v1/images/generations` 等路径。配置缺失或鉴权失败时明确报告，不能换用其他服务或账号。

`.env` 文件只解析 `KEY=value`、单引号或双引号包裹的值、整行注释和空行；同名项取最后一次，不执行 shell 展开或命令替换。不要用 `source` 加载配置，不把 API Key 放入命令行参数、参数 JSON、任务记录或聊天回复。

## 模型与参数

新任务先读 [任务 JSON、模型配置与切换](model-selection.md)，使用 `plan` / `run` / `continue`。选择顺序是本次用户明确型号、当前 Skill 配置列表、内置任务选型；Agent 不应先选内置型号再写入 `model`，否则会覆盖用户的配置。`plan` 不联网，`run` 在提交前检查当前可见性。只有模型清单可见不能证明通道或效果可用。

```bash
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill "${AIHUB_CALLER}" --media image
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill "${AIHUB_CALLER}" --media video --keyword "<搜索词>"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" describe --skill "${AIHUB_CALLER}" --model "<线上模型 ID>"
```

`--media` 可取 `image`、`video`、`audio`、`document`；E1 使用 `models --media understanding` 查询独立的 LLM 注册表。`models` 的 `preferred` 仍是随包目录推荐；生效的列表和策略以 `model_selection` 为准，具体任务候选以 `plan` 为准。没有配置时按 [图片 Skill](../skills/aihub-image/SKILL.md#选择图片模型) 或 [视频 Skill](../skills/aihub-video/SKILL.md#选择视频模型) 的规则选择；C1/C2 保留各自专用用途。

`describe` 离线读取随包模型目录说明字段，无需 API Key。只有 `catalog_only` 中的目录记录不能证明模型在线可用，`availability_known: false` 或 `status: availability_unknown` 应报告可用性未知。提交时保留线上 `models` 中的原始模型 ID，不能把规范化名称当作线上 ID。新流程只在已配置且适用的候选间按保存的策略切换；不得自动追加旧版本或其他模型。Plugin 会在提交前拒绝图片增强/材质/Profile、视频高清放大（B10）/插帧/Topaz、Sora 角色、字幕、提示词数字人和声音创建模型。

以下为保留的单模型底层入口，供旧任务流程或用户明确选择尚无自动参数转换的型号使用，**不读取配置列表来换模型**。D1 的 `speech-2.8-hd`（TTS）、`paraformer-v2`（ASR）和 D2 的 `lyria-3-pro` 使用 `generate --media audio`；`lyria-3-pro-preview` 使用 `native-music`。E1 先查询独立 LLM 注册表再调用 `understand`，必须含媒体内容块，纯文本请求属于 F 组并拒绝。E2 使用 `generate --media document`，结果 ZIP 只做文件签名和非空检查。

```bash
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill aihub-understanding --media understanding
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" understand --skill aihub-understanding \
  --params-file "/任务目录/understanding.json" --output-dir "/任务目录/outputs" --wait-seconds 30
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" native-music --skill aihub-music \
  --model lyria-3-pro-preview --params-file "/任务目录/gemini-music.json" --output-dir "/任务目录/outputs"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" generate --skill aihub-document --media document \
  --model doc2x-v3 --params-file "/任务目录/document.json" --output-dir "/任务目录/outputs" --wait-seconds 30
```

根据 `describe` 选定用户实际需要的请求变体。必须字段与条件必填字段不是同一集合；互斥输入不得同时填写。Seedance 2.5 参考生视频的 `image_urls`、`video_urls`、`audio_urls` 是可混合的参考素材列表，要求至少一项非空，不属于三选一。它的文生和首帧图生型号分别有独立输入契约，不能为了通过校验丢弃用户素材。三个型号均为整数 `4–30` 秒，`1080p` 仅接受 `5`、`10`、`30` 秒；不静默改用户的时长或分辨率。

图片型号和 `quality` 分开选择；参考图、透明背景或 `mask_url` 不自动决定 Flare/Sunburst。参数保存在用户任务目录的 JSON 文件中；旧 `generate` 的模型 ID 通过 `--model` 传入，不在参数 JSON 重复填写；旧 `understand` 则在其参数 JSON 中填写 `model`、`prompt`、`content`。新 `run` 使用另一套任务 JSON，不能混用两者。不在 shell 命令里拼接 prompt 或媒体 URL。参数名、枚举、尺寸和音色从该模型说明取得，不照搬其他模型。

## 上传输入文件

先完成 `doctor`。当所选模型需要远程输入，而用户只提供本地文件时，写一个上传 JSON 文件并调用：

```bash
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" upload --skill "${AIHUB_CALLER}" \
  --input-file "/任务目录/upload-input.json"
```

JSON 中 `path`、`url`、`base64` 必须且只能选一个；可选 `file_name`。本地文件须非空且不超过 20 MiB，较大输入可使用模型支持且远端可访问的 URL。本地文件示例：

```json
{
  "path": "/任务目录/reference.png",
  "file_name": "reference.png"
}
```

读取上传结果中的实际文件地址，再按所选生成模型说明填入参数。不要猜测上传响应 URL 或把文件系统路径作为公开 URL。上传或生成请求若返回结果不明，不自动再次上传或生成。

## 旧单模型提交与继续查询

本节保留 `task.json` 的恢复契约。新任务的 `run.json` 和可确认切换使用 [多模型执行流程](model-selection.md#执行与继续)，不能把 `continue` 描述为只查询：它可能按保存策略提交下一候选。

```bash
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" generate --skill "${AIHUB_CALLER}" \
  --media image --model "<线上模型 ID>" \
  --params-file "/任务目录/params.json" --output-dir "/任务目录/outputs"
```

`generate` 默认不轮询尚未完成的任务。程序先保存任务记录，拿到任务 ID 后立即写回记录；提交直接返回完成状态时，当次命令会下载并检查文件后返回。响应包含 `record` 时保留其绝对路径；尚未完成交付时，下一步使用该记录恢复：

```bash
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" resume --skill "${AIHUB_CALLER}" \
  --record "/任务目录/outputs/aihub-UUID/task.json" --wait-seconds 30
```

`resume` 默认等待预算为 30 秒；`generate`、`resume`、`task` 的单次 `--wait-seconds` 最高 600 秒。该值控制远端任务等待，不表示全部媒体下载也必须在同一时长完成。下载有独立的超时与重试限制。

一次等待到期且状态仍是 `waiting` 时，可根据用户任务继续下一次有界等待；中断或本轮无法继续时交付记录路径与当前任务 ID。不能把等待到期当成远端失败，更不能重新生成。

只有用户提供任务 ID 而没有记录时，使用同一 AIhub 环境和账号导入任务：

```bash
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" task --skill "${AIHUB_CALLER}" \
  --task-id "<现有任务 ID>" --media image --output-dir "/任务目录/outputs" --wait-seconds 30
```

`task` 查询已有任务并创建可恢复记录，不提交新生成请求。`resume` 使用记录中的任务信息；不要修改记录来绕过配置身份检查。配置路径变更不改变任务身份；恢复时仍须保持原 Skill、服务地址与密钥。需要本次禁用全局配置时使用 `--no-global-config`。

## 读取结果并决定下一步

程序输出结构化 JSON。`doctor`、`describe`、`plan`、成功的 `models` 和 `upload` 使用 `status: ok`。下表适用于旧单模型入口和新 run 的内层 `result`；新 run 顶层状态见 [多模型状态表](model-selection.md#执行与继续)。应读取 JSON 状态，不仅看进程退出码。

| `status` | 含义与下一步 |
| --- | --- |
| `submitted` | 已拿到远端任务并保存记录；用 `resume` 查询同一任务。 |
| `waiting` | 远端任务尚未完成，本次等待预算已结束；继续恢复或交付恢复路径。 |
| `query_failed` | 本次查询失败；保留原任务，用 `resume` 重试查询。 |
| `recovery_failed` | 恢复命令的配置、记录读取或锁检查失败；保留已有 `record` 或 `task_id`，修复本地错误后重试恢复。该状态不表示原任务未创建，不能重新生成。 |
| `persistence_failed` | 远端任务已知，但本地记录保存失败；保留 `task_id`、`record`、`remote_status` 和 `record_saved: false`。按 `next_action: task` 的参数，在修复存储问题后用 `task` 恢复已有任务，不能重新 `generate`。 |
| `submission_unknown` | 无法确认提交是否生效；报告结果不明并保留记录，不能自动重新生成。 |
| `not_submitted` | 本次提交未成功；根据错误修正输入或配置后再决定是否提交。 |
| `remote_failed` | 远端任务已失败；旧单模型入口只报告 ID 和原因。新 run 由保存策略和结构化错误分类决定是否切换，Agent 不自行重发。 |
| `download_pending` | 已有结果待下载；恢复原记录。 |
| `download_failed` | 全部下载或校验失败；保留结果信息，用 `resume` 继续下载。 |
| `partial` | 只有部分文件下载并校验成功；交付 `files`，列出 `failed`，继续恢复原记录。 |
| `delivered` | 全部结果文件已下载并通过程序检查；新 run 同时返回独立的 `result_check`，按 [检查流程](result-checks.md) 完成后交付结论与文件。 |

结果为空、错误页或无效媒体不能作为成功文件交付。程序检查非空、适用的响应长度、实际媒体类型和 `ffprobe` 可解析性；这不等于逐帧解码，也不证明视觉或音频内容符合用户要求。语义检查默认开启，由宿主读取实际媒体并执行 `review-submit`；`auto` 模式下宿主能力不足时执行 `review --provider aihub`。完成检查必须转述 `user_notice`，告知可通过对话关闭；不能只保存到 JSON。旧单任务记录缺少原始需求时报告无法检查，不能用生成 prompt 冒充。任务特有的 `seed`、`lyrics`、`degraded_reason`、`map_type`、`result_type`、`duration` 和 `resolution` 等字段会在 CLI 结果的 `result_metadata` 中返回；完整远端任务仍保存在 `task.json`，这些字段不是单独的业务能力。

## 文件位置与保留

旧单模型命令在 `--output-dir` 下创建独立目录：

```text
outputs/
└── aihub-UUID/
    ├── task.json
    └── files/
```

程序写入 `task.json` 供下一次 `resume` 读取；下载成功的媒体或文档 ZIP 放在 `files/`；E1 文本理解结果同时保存为 `files/result-<local-id>.txt`。恢复时继续使用该目录，不把已成功文件重新生成。任务记录、输入 JSON 和生成文件均放在用户任务目录，不能写入 Plugin 安装目录。

新 `run` 默认在调用项目 `data/aihub/aihub-run-UUID/` 保存 `run.json`；异步候选各自的 `task.json` 和 `files/` 位于其 `attempt-N/aihub-UUID/` 下。原生音乐也保存 run 与返回文件，但没有可查询任务 ID，提交不明时不能自动重发。旧 `native-music` 直接保存返回文件，没有上述任务记录。

交付后的 `review.json`、远端检查的 `review-task/`、错误定位的 `diagnostic.json` 和脱敏 `issue-draft.md` 均放在同一 run 目录。查看 `feedback.show_notice` 决定是否转述一次错误反馈；该报告不自动发送，也不改变生成或检查状态。完整命令、报告格式与对话开关操作见 [结果检查与错误反馈](result-checks.md)。

程序不自动删除任务目录。用户决定何时归档或删除；删除 `task.json` 会失去该记录提供的恢复入口。任务记录可能含 prompt、输入或结果 URL，应和生成文件一起按用户的访问范围保存。

交付时提供可点击的实际文件路径；远程宿主有已授权的附件能力时可用它交付。只有任务 ID、URL 或 `submitted` 状态不算完成媒体交付。
