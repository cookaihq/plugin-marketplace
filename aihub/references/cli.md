# 共用 CLI、配置与任务恢复

六个 Skill 共用 Plugin 根目录下的 `scripts/aihub.mjs`。先按“首次配置与凭证管理方式”核对来源；以下命令中的 `AIHUB_PLUGIN_DIR` 必须替换为实际安装目录，`AIHUB_CALLER` 固定为当前 Skill 的名称：`aihub-image`、`aihub-video`、`aihub-audio`、`aihub-music`、`aihub-understanding` 或 `aihub-document`。当前工作目录是用户任务目录，决定项目配置从哪里读取。

```bash
AIHUB_PLUGIN_DIR="<实际 Plugin 目录>"
AIHUB_CALLER="aihub-image"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" doctor --skill "${AIHUB_CALLER}"
```

程序使用 Node.js 18 或更新版本；媒体文件检查需要 `ffprobe`。`doctor` 只检查本机运行条件和配置来源，不请求 AIhub，也不证明 Key 有效或生成渠道可用。`generate` 在提交前也会检查媒体工具。macOS 缺少 `ffprobe` 时安装命令是 `brew install ffmpeg`，程序不会自动安装系统工具。发行产物包含编译后的 JavaScript 和模型目录，安装者不需要运行 `npm install`，也不需要原 MCP 服务。

## 首次配置与凭证管理方式

业务所需配置以随包 [credentials.json](credentials.json) 为声明：Plugin 名 `aihub`、六个子 Skill、密钥必填、服务根地址可选且有默认值。AIhub 负责声明参数与检查业务结果；令牌表初始化、候选记录、实际 key 展示、确认及接入保存由 secret-book 统一负责，不在六个 Skill 各复制一套流程。

1. 先沿用用户明确的管理方式。当前 Agent 已安装支持业务接入的 secret-book 时，通过其 `connection --requirements <Plugin>/references/credentials.json --skill <当前 Skill>` 查询已保存选择。此查询只读本机，不访问飞书。用户请求首次配置、变更管理方式，或确实缺配置且没有既有选择时，提供“secret-book / 自行填写 .env”选择。普通任务已经能按原读取顺序取得完整配置、又没有 secret-book 接入时直接使用，不为引入新方式重新询问。无 secret-book 时不影响直接用文件，已有文件不擅自迁移。
2. 选择 secret-book 时读取该 Skill 的实际安装说明与版本（至少 2.3.0）。未安装、不支持当前系统或版本不足时说明具体情况，引导安装/更新或由用户选择文件；不把旧 `run --auto` 当作等价替代。交给它本声明、真实 Plugin/Skill 身份及用户选择的作用范围，默认建议六个 Skill 跨项目共享，首次确认后才能取用。不在 AIhub 文案内重复飞书身份、查表和绑定细节。
3. 选择文件时按下节的个人全局方案填写；secret-book 已安装且支持接入时，用 `connect --requirements ... --scope global --mode env` 记录用户选择（只改非 Secret 接入元数据），随后直接运行 AIhub。只为某个项目或 Skill 切换时用对应 scope / skill。没有安装 secret-book 时不要求为手填文件安装它。
4. 配置完成先执行 `doctor`。报告管理方式和实际配置来源；secret-book 注入的业务字段在 AIhub 中显示为 `environment`，应同时报告由哪条已确认记录提供。密钥不上屏。`doctor` 成功不代表鉴权成功，不用生成请求作为配置验证。

选择 secret-book 后，所有需要配置的 `doctor/models/upload/generate/task/resume/understand/native-music` 命令都通过它启动。每次启动都是新的环境注入，不能认为第一次配置永久修改了进程环境。示例（路径均换成当前 Agent 的实际安装目录）：

```bash
SECRET_BOOK_DIR="<实际 secret-book 安装目录>"
AIHUB_PLUGIN_DIR="<实际 Plugin 目录>"
AIHUB_CALLER="aihub-image"
uv run --project "${SECRET_BOOK_DIR}" "${SECRET_BOOK_DIR}/scripts/secret_book.py" \
  run --requirements "${AIHUB_PLUGIN_DIR}/references/credentials.json" --skill "${AIHUB_CALLER}" -- \
  node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" doctor --skill "${AIHUB_CALLER}"
```

以下章节及各 Skill 中的 `node ...` 示例是实际业务命令；使用 secret-book 时，把完整命令放在上述 `--` 后。`describe` 无需凭证，可直接运行。接入失效、缺 key、账号变化时交回 secret-book 重新核对；选择 `.env` 后不得因失败擅自切换管理方式。secret-book 只提供凭证，不决定重发生成请求；AIhub 的中断恢复和请求结果不明规则继续适用。

## 配置来源

识别的业务变量为 `AIHUB_API_KEY` 和 `AIHUB_BASE_URL`。每个变量独立按以下顺序使用首个非空值：

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

自行填写文件时，个人全局配置是 AIhub 已确认的默认方案，共享配置保存到 `~/.config/aihub/.env`。需要一个 Skill 使用不同值时可写根 `.env.<skill-name>`，只有明确需要时才创建对应子目录。写入前确认具体作用域并保留已有内容；仅提供凭证或允许读取不代表授权持久化。项目保存仍使用调用工作目录的 `.env.local`，写入 Secret 前检查未跟踪且被忽略。

全局读取由加载器自动执行，正常调用不加参数。`--no-global-config` 关闭本次命令的全部六个全局层，同时跳过 Plugin 目录和普通 Skill 目录；`--use-global-config` 仅为旧命令兼容，不再是必填项，两者同时传入报冲突。正常请求不需要逐次向用户征求读取全局文件的许可。`doctor` 报告每个字段的最终来源，包括普通 Skill 回退文件的实际路径，但不验证账号鉴权或生成通道。

已有 `~/.config/aihub-image/.env` 等当前 Skill 配置无需迁移即可作为末层来源。同一用户下，同名 Skill 的独立分发与 Plugin 分发可能共用这一文件；Plugin 配置优先。迁移只是可选整理操作，须先列出准确源与目标，让用户确认后再写入；相同配置可合并到共享文件，不同配置分别放到 `.env.<skill-name>` 或已选定的 Skill 子目录。默认写入位置仍在 Plugin 目录，加载器不创建、复制、移动或删除配置。用户文件夹由 Node `os.homedir()` 定位，Windows 原生与 WSL 使用各自用户目录；具体平台路径见随包 README。

`AIHUB_BASE_URL` 是 API 根地址，默认 `https://api.aihubmax.com`。它不是某一生成 endpoint；不要追加 `/v1/images/generations` 等路径。配置缺失或鉴权失败时明确报告，不能换用其他服务或账号。

`.env` 文件只解析 `KEY=value`、单引号或双引号包裹的值、整行注释和空行；同名项取最后一次，不执行 shell 展开或命令替换。不要用 `source` 加载配置，不把 API Key 放入命令行参数、参数 JSON、任务记录或聊天回复。

## 模型与参数

```bash
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill "${AIHUB_CALLER}" --media image
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill "${AIHUB_CALLER}" --media video --keyword "<搜索词>"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" describe --skill "${AIHUB_CALLER}" --model "<线上模型 ID>"
```

`--media` 可取 `image`、`video`、`audio`、`document`；E1 使用 `models --media understanding` 查询独立的 LLM 注册表。`models` 查询 AIhub 当前凭证可见的模型列表；可见不保证其生成渠道能成功执行。结果会标出 `preferred`，图片优先 `gpt-image-2.5-flare` / `gpt-image-2.5-sunburst`，视频优先 Seedance 2.5 的文生、首帧图生与参考生视频三个型号。该标记只列默认候选，Agent 仍须按 [图片 Skill](../skills/aihub-image/SKILL.md#选择图片模型) 或 [视频 Skill](../skills/aihub-video/SKILL.md#选择视频模型) 的规则作最终选择；C1/C2 保留各自专用模型。

`describe` 离线读取随包模型目录说明字段，无需 API Key。只有 `catalog_only` 中的目录记录不能证明模型在线可用，`availability_known: false` 或 `status: availability_unknown` 应报告可用性未知。提交时保留线上 `models` 中的原始模型 ID，不能把规范化后用于目录匹配的名称当作线上 ID。没有可用的默认型号或参数不兼容时报告原因，不自动切换旧版本或其他模型。Plugin 会在提交前拒绝图片增强/材质/Profile、视频高清放大（B10）/插帧/Topaz、Sora 角色、字幕、提示词数字人和声音创建模型。

D1 首轮默认模型是 `speech-2.8-hd`（TTS）和 `paraformer-v2`（ASR）；D2 的 `lyria-3-pro` 使用普通 `generate --media audio`，`lyria-3-pro-preview` 使用独立 `native-music` 命令。E1 先用 `models --media understanding` 查询 `/v1/configs/llm_generations_models`，再使用 `understand`；请求必须含 `image_url`、`audio_url`、`video_url` 或 `file_url` 内容块，纯文本请求属于 F 组并拒绝。E2 的 `doc2x-v3` 使用 `generate --media document`，结果 ZIP 只做 ZIP 签名和非空检查。

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

图片型号和 `quality` 分开选择；参考图、透明背景或 `mask_url` 不自动决定 Flare/Sunburst。参数保存在用户任务目录的 JSON 文件中；模型 ID 只通过 `--model` 传入，不在参数 JSON 里重复填写。不在 shell 命令里拼接用户 prompt 或媒体 URL。参数名、枚举、尺寸和音色等值均从该模型说明取得，不照搬其他模型。

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

## 提交与继续查询

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

程序输出结构化 JSON。`doctor`、`describe`、成功的 `models` 和 `upload` 使用 `status: ok`。下表适用于生成与恢复结果，使用 `schema_version`、`status`，并按结果提供 `record`、`task_id`、`files`、`failed`、`error`。应读取 JSON 状态，不仅看进程退出码。

| `status` | 含义与下一步 |
| --- | --- |
| `submitted` | 已拿到远端任务并保存记录；用 `resume` 查询同一任务。 |
| `waiting` | 远端任务尚未完成，本次等待预算已结束；继续恢复或交付恢复路径。 |
| `query_failed` | 本次查询失败；保留原任务，用 `resume` 重试查询。 |
| `recovery_failed` | 恢复命令的配置、记录读取或锁检查失败；保留已有 `record` 或 `task_id`，修复本地错误后重试恢复。该状态不表示原任务未创建，不能重新生成。 |
| `persistence_failed` | 远端任务已知，但本地记录保存失败；保留 `task_id`、`record`、`remote_status` 和 `record_saved: false`。按 `next_action: task` 的参数，在修复存储问题后用 `task` 恢复已有任务，不能重新 `generate`。 |
| `submission_unknown` | 无法确认提交是否生效；报告结果不明并保留记录，不能自动重新生成。 |
| `not_submitted` | 本次提交未成功；根据错误修正输入或配置后再决定是否提交。 |
| `remote_failed` | 远端任务已失败；报告任务 ID 与原因，不自动换模型重试生成。 |
| `download_pending` | 已有结果待下载；恢复原记录。 |
| `download_failed` | 全部下载或校验失败；保留结果信息，用 `resume` 继续下载。 |
| `partial` | 只有部分文件下载并校验成功；交付 `files`，列出 `failed`，继续恢复原记录。 |
| `delivered` | 全部结果文件已下载并通过程序检查；结合宿主可用能力检查内容，再交付文件。 |

结果为空、错误页或无效媒体不能作为成功文件交付。程序检查非空、适用的响应长度、实际媒体类型和 `ffprobe` 可解析性；这不等于逐帧解码，也不证明视觉或音频内容符合用户要求。内容检查需要使用宿主实际提供的图片、视频或音频查看能力；没有该能力时明确说明已做哪些检查。任务特有的 `seed`、`lyrics`、`degraded_reason`、`map_type`、`result_type`、`duration` 和 `resolution` 等字段会在 CLI 结果的 `result_metadata` 中返回；完整远端任务仍保存在 `task.json`，这些字段不是单独的业务能力。

## 文件位置与保留

每次新任务在 `--output-dir` 下创建独立目录：

```text
outputs/
└── aihub-UUID/
    ├── task.json
    └── files/
```

程序写入 `task.json` 供下一次 `resume` 读取；下载成功的媒体或文档 ZIP 放在 `files/`；E1 文本理解结果同时保存为 `files/result-<local-id>.txt`。恢复时继续使用该目录，不把已成功文件重新生成。任务记录、输入 JSON 和生成文件均放在用户任务目录，不能写入 Plugin 安装目录。

程序不自动删除任务目录。用户决定何时归档或删除；删除 `task.json` 会失去该记录提供的恢复入口。任务记录可能含 prompt、输入或结果 URL，应和生成文件一起按用户的访问范围保存。

交付时提供可点击的实际文件路径；远程宿主有已授权的附件能力时可用它交付。只有任务 ID、URL 或 `submitted` 状态不算完成媒体交付。
