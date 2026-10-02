# 结果检查与错误反馈

六个 Skill 的新任务都使用本流程。`delivered` 只代表文件交付成功；`result_check.status` 单独表示需求检查结果。检查模块只调用理解接口，不调用生成接口，也不因为内容不符、检查失败或文件被修改而重新生成。

## 配置

以下均可省略，与当前 Skill 的 Key 使用相同读取层级，列表取最高非空层的完整值：

| 配置 | 默认值 | 行为 |
| --- | --- | --- |
| `AIHUB_RESULT_CHECK_ENABLED` | `1` | `0` 关闭语义检查；原有文件格式与可解析性检查继续运行。只接受 `0`/`1`。 |
| `AIHUB_RESULT_CHECK_PROVIDER` | `auto` | `auto` 由 Skill 先检查宿主实际媒体能力，能力不足才调用 AIhub；`host` 只用宿主；`aihub` 直接用 AIhub。 |
| `AIHUB_RESULT_CHECK_MODELS` | `gemini-3.8-flash` | 逗号分隔精确 ID。提交前按当前 LLM 注册表的可见性和媒体能力选择首个适用项，提交后不自动换检查模型。 |
| `AIHUB_ERROR_REPORT_THRESHOLD` | `3` | 同一任务累计独立上游错误的提示阈值，必须为正整数。 |
| `AIHUB_SUPPORT_URL` | 无 | 当前服务管理员的 HTTP(S) 支持入口，不含账号、密码、查询参数或片段。 |

`config-check` 返回这些字段的实际来源和格式错误；`doctor` 同时返回生效的检查与反馈设置。仍只有 `AIHUB_API_KEY` 必填。Jev 未接入，也不需要 TypeSafe 凭证。

## 保存需求和生成后的检查

1. 新任务 JSON 的 `original_request` 保存用户原文；`review_requirements` 可把它拆成具体项，每项为 `{"id":"subject","text":"只有一只橘猫","priority":"required"}`，偏好用 `preference`。程序始终增加完整原文检查项，不能只检查 Agent 自行选择的一小部分要求。用户批准改变需求时，`requirement_revisions` 按时间保存 `{"request":"修改后的完整需求","user_confirmation":"用户同意修改的原话"}`；只记录真实同意，不能为了让结果通过而修改原任务记录。
2. `run/continue` 下载成功后在 `run.json` 旁创建 `review.json`，保存原文、当前需求、检查项、产物 SHA-256、实际尺寸/时长/音轨、可提取的文本。程序先检查可测条件；有明确不符合直接报告 `mismatched`，不再消耗模型额度确认已知差异。时长允许最多 0.05 秒的容器时间舍入误差；宽高比数值误差须小于 0.01，明确像素尺寸严格相等。未定义数值规则的质量等要求由逐项媒体检查说明证据。
3. `auto/host` 通常返回 `pending`。Agent 使用当前会话实际可用的图片、音频、视频和文档工具打开产物，并核对编辑参考图、原录音或原 PDF。只有真正观察的范围才能写为完整。CLI 无法发现宿主工具，不能把 `pending` 当作检查完成。
4. 宿主能检查时，将真实观察写为下节 JSON，通过 `review-submit` 提交。宿主缺少必要能力且配置为 `auto` 时执行 `review --provider aihub`；若为 `host`，提交 `{"unavailable_reason":"缺少哪种实际读取能力"}`，不伪造观察结果。
5. `aihub` 路径先查 `/v1/configs/llm_generations_models`，再上传产物本身，通过 `/v1/llm/generations` 读取媒体和需求。输出文本直接放在检查提示中，并带理解/转写/转换所需的原媒体。该过程会把结果与原需求发送给 AIhub，并额外消耗额度。单次检查对全部产物共提交一次理解请求；上传请求另外记录，原始媒体输入仍使用生成任务保存的 URL。
6. Agent 读取结果与逐项证据，同时交付文件和检查结论。**当检查开启，每次完成检查后，无论通过、不符、证据不足或无法检查，都向用户转述 `user_notice`：如果想关闭结果检查，可以直接在对话中告诉我“关闭结果检查”；也可以说“仅本次关闭结果检查”。**不能只把提示留在 JSON 或文件里。`disabled` 不重复提示。

```bash
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" review --skill "${AIHUB_CALLER}" \
  --record "/任务目录/data/aihub/aihub-run-UUID/run.json"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" review-submit --skill "${AIHUB_CALLER}" \
  --record "/任务目录/data/aihub/aihub-run-UUID/run.json" \
  --review-file "/任务目录/实际检查报告.json" --review-token "<review 返回的 token>"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" review --skill "${AIHUB_CALLER}" \
  --record "/任务目录/data/aihub/aihub-run-UUID/run.json" --provider aihub --wait-seconds 30
```

图片报告示例，仅在实际观察后填写；全部检查项都必须出现：

```json
{
  "findings": [{
    "requirement_id": "original-request",
    "verdict": "matched",
    "evidence": [{"asset_id": "artifact-1", "observation": "主体只有一只橘猫，围巾为红色", "location": "图片中央"}]
  }],
  "coverage": [{"asset_id": "artifact-1", "complete": true, "note": "已查看整张图片"}]
}
```

额外需求 ID 为 `user-<id>`。证据引用 `review` 返回的产物/原素材 ID，不能编造 ID。每个被声明完整检查的素材都应有具体证据。音频/视频 coverage 还需 `time_ranges: [[0,5]]` 和实际检查音轨后的 `audio_checked: true`；抽帧不能写成连续完整观察，未观察片段必须披露，覆盖不足保持 `inconclusive`。不能仅靠 prompt、文件名或生成模型自述作证据。

| 检查状态 | 对用户的含义 |
| --- | --- |
| `matched` | 所有检查项符合，已报告完整素材覆盖；仍是 AI 判断，不是绝对正确性保证。 |
| `mismatched` | 程序或实际媒体证据发现差异，说明具体要求和实际结果，由用户决定是否修改或重做。 |
| `inconclusive` | 覆盖、证据或报告格式不足，无法判断所有要求是否满足。 |
| `unavailable` | 无法读取实际产物、模型不可用、检查请求失败等；交付已有文件并说明原因。 |
| `disabled` | 用户关闭语义检查，只报告实际执行的文件检查。 |
| `pending` / `checking` | 等待宿主报告 / 远端检查尚未结束，继续原检查流程。 |

## 恢复和限制

检查 token 同时绑定本次检查、需求版本、检查项和产物哈希；文件变化、报告过期、未知检查项或无证据的“通过”会被拒绝。继续生成任务时会返回保存的检查结论，不会再次提交检查。`checking` 通过 `review` 查询原任务；检查提交结果不明时不得重发。明确要求重新检查且前次已结束时才传 `review --recheck`，旧记录保存为 `review-history-*.json`；它可能产生新的检查费用，不能把该参数加到默认恢复命令中。

AIhub 检查上传实际产物以对应本地哈希，单个产物沿用 20 MiB 上传限制；超过时报告 unavailable，不能偷偷缩小/截断后声称完整检查。当前文档读取支持 ZIP 中的 Markdown、文本、LaTeX 及 DOCX 正文提取，最多 512 个 ZIP 条目、32 MiB 压缩文件、2 MiB 被读取文本。压缩包仅在内存中读取，不解包任意路径到磁盘。正文提取不能证明页面布局、嵌入图片和公式保真，AIhub 文档检查因此不会仅凭正文给出整体 `matched`；宿主可实际打开/渲染后提交相应证据。

旧 `generate/understand/native-music/resume/task` 记录缺少用户原始需求，程序返回 `unavailable` 和关闭提示，不能把旧 prompt 当原始需求补写。六个 Skill 的新任务必须用 `plan/run`。`review.json`、任务记录和报告保留在调用项目任务目录，供跨轮恢复，不写安装目录；由用户决定何时删除。

## 用户通过对话关闭或开启

- 用户说“仅本次关闭结果检查”：后续本次 AIhub 命令通过进程环境传 `AIHUB_RESULT_CHECK_ENABLED=0`，不写配置文件；本次恢复命令也沿用。用户说“恢复结果检查”时用 `1`。
- 用户明确要求长期关闭、当前项目关闭或只对一个 Skill 关闭：Agent 运行 `config-check` 找实际来源，按用户已选范围将该字段写成 `0`，保留其它字段。长期共享默认路径是 `~/.config/aihub/.env`；当前项目使用 `.env.local`。已有更高优先级字段时说明它覆盖什么，并修改用户授权范围内真正生效的位置，不能另写低优先级文件后声称已关闭。写入含 Secret 的文件时继续遵守原有未跟踪/已忽略检查；不展示 Key。
- 用户只说“关闭结果检查”且范围未确定：询问“仅本次、当前项目，还是以后六个 AIhub Skill 都关闭”，沿用已明确的范围，不再次确认。完成后回读 `config-check` / `doctor`，告知作用范围、实际来源和已生效的 `0`。不要要求用户自己手改文件。

关闭检查不会取消已提交的远端检查任务，也不代表费用退还；保留其记录，之后开启可查询原任务。

## 错误反馈

CLI 对实际失败的 HTTP 尝试计数，包括客户端有界重试；同一远端任务的终止失败只计一次。正常运行/等待、本地输入错误、能力不匹配、内容拒绝、用户取消和质量不符不计上游故障。默认累计 3 次提示一次；有上游错误且任务最终失败时，即使少于 3 次也提示；鉴权、余额和权限问题立即给出处理建议。后续 fallback 成功时仍交付成功结果，不把它说成任务失败。

收到 `feedback.show_notice=true` 时告诉用户错误次数、下一步、报告路径和可用入口。`diagnostic.json` 只保存声明的定位字段，含任务/请求 ID，仅私下提供给对应服务管理员；`issue-draft.md` 默认排除原始 ID、提示词、素材与输出链接/路径、凭证及指纹、原始响应。Plugin 安装、参数转换或恢复问题可引导到 <https://github.com/cookaihq/plugin-marketplace/issues/new>；服务/账号/通道问题引导到配置的支持入口，没有入口时只说联系当前服务管理员，不虚构联系方式。无法确定归属时明确说明。

这些文件仅保存于本地，不自动提交 Issue 或给管理员发消息。Agent 先让用户检查草稿，得到明确发送指令后才可执行对外发送。报告保存失败不改变原任务结果，也不改变 fallback 策略或提交次数。
