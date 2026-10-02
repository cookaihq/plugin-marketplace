# 模型配置与可恢复的多模型执行

六个 Skill 的新任务使用 `plan` → `run` → `continue`。Agent 保存用户需求及素材用途，共用 CLI 读取当前 Skill 的配置，分别构造候选模型的参数，再按策略执行。旧 `generate`、`understand`、`native-music` 仍是指定单模型的入口；旧 `resume` / `task` 只查询和下载原任务。配置与上传方式见 [共用 CLI](cli.md)。

## 可选配置

只有 `AIHUB_API_KEY` 必填。`AIHUB_BASE_URL` 未配置时使用代码默认 `https://api.aihubmax.com`。下列变量沿用相同的环境变量、项目文件、Plugin 全局文件、当前 Skill 普通全局文件的读取顺序：

| Skill | 有序模型列表 |
| --- | --- |
| aihub-image | `AIHUB_IMAGE_MODELS` |
| aihub-video | `AIHUB_VIDEO_MODELS` |
| aihub-audio | `AIHUB_AUDIO_MODELS` |
| aihub-music | `AIHUB_MUSIC_MODELS` |
| aihub-understanding | `AIHUB_UNDERSTANDING_MODELS` |
| aihub-document | `AIHUB_DOCUMENT_MODELS` |

列表用逗号分隔精确模型 ID，顺序就是优先级。首个非空来源整体替换低优先级列表，不合并、不追加内置模型。空项、重复 ID 报错。只解析当前 Skill 的模型列表；未配置时沿用对应 Skill 的内置选型，仅产生一个候选。本次用户明确指定模型时固定该模型，忽略配置列表并关闭 fallback。Agent 自己选出的推荐型号不能写成用户指定。

```dotenv
AIHUB_IMAGE_MODELS=gpt-image-2.5-flare,gpt-image-2.5-sunburst
AIHUB_MODEL_FALLBACK_POLICY=auto
AIHUB_MODEL_MAX_ATTEMPTS=2
```

| `AIHUB_MODEL_FALLBACK_POLICY` | 行为 |
| --- | --- |
| `auto`（默认） | 按序跳过能力不匹配或不可见候选；可确认的模型失败后尝试下一候选。 |
| `confirm` | 首个适用候选之后，每次实际切换到另一模型前暂停，列出模型及参数，取得用户确认后继续。预检跳过首个候选也算切换。 |
| `off` | 只尝试任务用途匹配的首个候选；其不可见、能力不符或失败时停止。 |
| `preflight_only` | 尚未提交生成时可以跳过不兼容或不可见候选；提交过一次生成请求后不再切换。 |

`AIHUB_MODEL_MAX_ATTEMPTS` 是可选正整数，包含首个模型。默认等于适用候选数；预检跳过、查询和下载不计数。每个候选最多提交一次，不循环列表。全局策略可在当前 Skill 的专用文件中覆盖；`doctor` 和 `models` 的 `model_selection` 提供实际值与来源。

## 任务 JSON

请求文件由 Agent 写在调用项目的任务目录中。`original_request` 保留用户原文，`prompt` 是提交给模型的提示词；后者不能代替前者。只在用户本次明确指定型号时填 `model`。

```json
{
  "operation": "image-generate",
  "original_request": "生成一张正方形插画：戴红围巾的橘猫坐在窗边，不要文字。速度优先。",
  "prompt": "正方形插画，一只戴红围巾的橘猫坐在窗边，画面简洁，无文字。",
  "image_priority": "speed",
  "requirements": {"resolution": "1024x1024"}
}
```

`inputs` 只接受远程 HTTP(S) URL；本地文件先通过 `upload` 取得真实 URL。列表字段为 `images`、`videos`、`audios`、`files`；`mask` 是单个 URL。省略未使用字段，不放空列表。`requirements` 保存用户要求的输出参数，未知字段、无法保留的输入和参数冲突都会拒绝该候选，不能为了切换删除要求。

结果检查项单独使用 `review_requirements`（`id`、`text`、`priority=required|preference`），不发送为生成模型参数；用户批准的完整需求变更保存到 `requirement_revisions`（`request`、`user_confirmation`）。字段格式、默认开启的检查流程与每次结束后的关闭提示见 [结果检查与错误反馈](result-checks.md)。没有拆分项时仍检查完整用户原文，生成 prompt 不能代替原文。

| `operation` | 输入和用途 | 当前已验证的自动参数转换 |
| --- | --- | --- |
| `image-generate` / `image-edit` | 提示词；编辑另需 `inputs.images`，可选 `mask` | GPT Image 2.5 Flare / Sunburst；`resolution`、`quality`、`background`、`output_format`、`num_outputs` |
| `video-text` | 文字 | Seedance 2.5、2.0 / Fast 对应文生型号 |
| `video-start-frame` | 一张固定首帧 `inputs.images` | 对应图生型号；不把参考图改作首帧 |
| `video-reference` | 参考图、视频或音频 | 对应参考生型号；2.0 只自动接入图片参考，视频/音频严格限制尚缺可验证的素材元数据 |
| `video-lipsync` | 一个视频和一个音频 | `lipsync-2`；`active_speaker`、`sync_mode`、`temperature` |
| `video-avatar` | 一张图片和一个音频，可选提示词 | `omnihuman-1.5`；`advanced`、`turbo_mode` |
| `audio-tts` | 提示词中的待朗读文本 | `speech-2.8-hd` / `speech-2.8-turbo`；`voice_setting`、`audio_setting`、`voice_modify`、`pronunciation_dict`、`language_boost` |
| `audio-transcribe` | `inputs.audios` | `paraformer-v2`；`channel_id`、`diarization`、`language_hints`、`recognition` |
| `audio-clone` | 一个音频，须用户明确要求克隆 | `voice-clone`；`accuracy`、`need_volume_normalization`、`noise_reduction`、`preview_model`、`preview_text`；不承诺返回可下载音频 |
| `music-async` | 提示词，可选图片参考 | `lyria-3-pro`；`negative_prompt` |
| `music-native` | 提示词 | `lyria-3-pro-preview`；不接收额外要求或参考素材，不与异步音乐静默互换 |
| `understanding` | 提示词及至少一种媒体输入 | 从线上 LLM 注册表检查精确 ID 和所需媒体能力；`system_prompt`、`max_tokens`、`temperature` |
| `document` | 一个 PDF 的 `inputs.files` | `doc2x-v3`；`page_count`、`convert_mode`、`filename`、`formula_mode`、`merge_cross_page_forms` |

视频的基础要求为 `duration`、`resolution`、`aspect_ratio`。未指定时固定为 5 秒、720p、9:16，再分别构造候选请求，避免各模型默认值不同。2.0 可额外设置 `seed`、`generate_audio`，但这两个字段不能无依据地传给 2.5。字段的枚举、条件必填和限制继续以 `describe` 及 CLI 校验为准。

配置一个模型 ID 不代表已接入其参数转换。CLI 先按任务用途筛选，再逐个检查；TTS 不能替代转写、首帧图生不能替代参考生成。不兼容型号会列出原因。有目录说明但尚无自动转换的型号，只能在用户明确选择且按其契约准备参数后使用旧单模型入口；不能借此绕过已经保存的多模型任务或确认要求。

## 执行与继续

```bash
AIHUB_PLUGIN_DIR="<实际 Plugin 目录>"
AIHUB_CALLER="aihub-image"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" plan --skill "${AIHUB_CALLER}" --request-file "/任务目录/request.json"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" run --skill "${AIHUB_CALLER}" --request-file "/任务目录/request.json" --wait-seconds 30
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" continue --skill "${AIHUB_CALLER}" --record "/任务目录/data/aihub/aihub-run-UUID/run.json" --wait-seconds 30
```

`plan` 只读配置和随包契约，不联网；先检查输出的 `candidates` 与 `excluded` 是否忠实于用户需求。`run` 默认写调用项目的 `data/aihub/`，也可传 `--output-dir`。在 Git 项目中开始写任务文件前确认输出目录被忽略。`run.json` 保存原始需求、候选请求、策略、尝试历史和确认；每次异步尝试在其 `attempt-N/aihub-UUID/` 下保存自己的 `task.json` 和 `files/`。

`continue` 读取已保存计划，不用新配置替换候选或策略；仍核对原 Skill、服务地址和密钥。每次调用的轮询预算由全部候选共享，最高 600 秒。进程中断后仍然恢复原任务；原生音乐无可查询任务 ID，提交结果不明时不能自动重发。

当 `status=confirmation_required` 时，Agent 向用户展示 `confirmation.model`、`params` 和失败原因，取得对这次切换的明确确认后，才可运行 `continue --record ... --confirm <confirmation.token>`。**输出的 `next_action` 含确认 token 不代表用户已经同意，不能直接执行。** 更改请求需要另建任务，不能编辑记录绕过确认。

| 新流程状态 | 下一步 |
| --- | --- |
| `delivered` | 读取独立的 `result_check`，按其状态完成检查；交付 `files`、实际型号、尝试摘要、检查结论和开启检查时的关闭提示。 |
| `confirmation_required` | 等用户确认当前候选后再提交。 |
| `submitted` / `waiting` / `query_failed` / `download_failed` / `partial` | 用 `continue` 恢复原任务；部分成功先交付已通过检查的文件。 |
| `preflight_failed` | 修复预检问题后继续；模型清单查询失败不等于某模型不可用。 |
| `submission_unknown` / `persistence_failed` | 保留全部记录及已知任务 ID；先核对原提交或按内层 `result.next_action` 恢复，不能再生成。 |
| `failed` / `no_compatible_model` / `attempt_limit` | 当前计划停止。报告 `attempts`、`excluded` 和已知任务 ID；不自动另建 run 来绕过限制。 |

只有明确的模型不可用/能力不支持错误可切换：已结束任务的 `model_unavailable`、`model_not_support_capability`，或确定未受理的 HTTP 422 同类错误。已结束且未返回结构化错误的任务也可按策略切换。鉴权、余额、内容拒绝、未知服务错误、超时和提交结果不明不触发自动切换；查询失败、下载失败、画面或音频不符合需求也不触发重新生成。真实服务返回的分类不明确时停止并报告，不能根据文字猜测可安全重发。
