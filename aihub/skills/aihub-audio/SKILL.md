---
name: aihub-audio
version: 0.9.2
description: v0.9.2｜Run AIhub D1 audio and speech workflows for speech-2.8-hd text-to-speech, paraformer-v2 transcription, explicit voice cloning, and resumable task delivery.
compatibility: Codex and WorkBuddy; Node.js 18 or newer, ffprobe on PATH, AIhub API access.
---

# AIhub 音频与语音任务

D1 处理文本转语音、语音识别/转写和用户明确要求的声音克隆。用户本次指定模型时固定执行；否则读取 `AIHUB_AUDIO_MODELS`，分别筛选 TTS、ASR 或克隆型号，不跨用途替换。没有配置时使用 `speech-2.8-hd`、`paraformer-v2` 或 `voice-clone`。音乐属于 `aihub-music`，素材理解属于 `aihub-understanding`。

先读取 [共用 CLI](../../references/cli.md) 和 [任务 JSON、模型配置与切换](../../references/model-selection.md)。已有 `run.json` 用 `continue`；旧 `task.json` / 任务 ID 用 `resume` / `task` 查询原任务。

新任务先执行 `doctor`。保存 `original_request`，选择 `audio-tts`、`audio-transcribe` 或 `audio-clone`。TTS 将待朗读文本写入 `prompt`，按 `describe` 选择音色等 `requirements`；转写/克隆的实际音频 URL 写入 `inputs.audios`，本地文件先上传。仅用户本次指定型号才填 `model`。先 `plan` 检查每个候选，再 `run`；不能为了换模型改变指定音色、语言或丢弃输入。

```bash
AIHUB_PLUGIN_DIR="<实际 Plugin 目录>"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" doctor --skill aihub-audio
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill aihub-audio --media audio
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" describe --skill aihub-audio --model "<线上模型 ID>"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" plan --skill aihub-audio --request-file "/任务目录/audio-request.json"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" run --skill aihub-audio \
  --request-file "/任务目录/audio-request.json" --output-dir "/任务目录/data/aihub" --wait-seconds 30
```

用返回的 `run_record` 继续任务。`confirmation_required` 必须展示下一模型与参数，用户同意后才传 `--confirm`；不能直接执行含 token 的 `next_action`。只交付已检查的文件及实际转写结果，报告最终模型和尝试摘要。声音克隆不保证返回可下载音频，按服务实际结果说明。提交结果不明、查询/下载失败或试听不符合要求不触发替换生成。


## 结果检查与用户提示

新任务与交付前读取 [结果检查与错误反馈](../../references/result-checks.md)。保存原始需求及具体检查项，完成生成后读取 `result_check`：`pending` 时实际查看产物并通过 `review-submit` 提交证据；`auto` 下宿主缺少必要能力才使用 `review --provider aihub`，`host` 下明确报告无法检查。`checking` 查询原检查任务，不提交新请求。

检查开启时，每次完成检查都必须告诉用户：“如果想关闭结果检查，可以直接在对话中告诉我‘关闭结果检查’；也可以说‘仅本次关闭结果检查’。”通过、不符、证据不足或无法检查都要提示，不能只保留在 JSON 中。用户要求关闭时按参考说明执行，沿用已明确作用范围；范围不明再询问。关闭后仍执行文件检查。

`feedback.show_notice=true` 时提供报告路径与 Issue/管理员入口；公开只使用脱敏草稿，不自动发送。结果不符或检查失败不触发重新生成。
