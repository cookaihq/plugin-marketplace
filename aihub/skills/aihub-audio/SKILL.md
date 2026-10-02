---
name: aihub-audio
version: 0.7.0
description: v0.7.0｜Run AIhub D1 audio and speech workflows for speech-2.8-hd text-to-speech, paraformer-v2 transcription, explicit voice cloning, and resumable task delivery.
compatibility: Codex and WorkBuddy; Node.js 18 or newer, ffprobe on PATH, AIhub API access.
---

# AIhub 音频与音乐任务（现有入口）

D1 处理文本转语音、语音识别/转写和显式声音克隆。TTS 默认 `speech-2.8-hd`，ASR 默认 `paraformer-v2`；先查询当前账号模型清单，再保持返回的精确模型 ID。Gemini 原生音乐属于 `aihub-music`，文档处理属于 `aihub-document`，多模态理解属于 `aihub-understanding`。

先读取 [共用 CLI 与恢复流程](../../references/cli.md)。已有任务记录或任务 ID 时只恢复原任务；新任务先执行 `doctor` 和 `models --media audio`，再用 `describe --model` 读取实际模型参数。参数 JSON 写入用户任务目录，调用 `generate --media audio`，仅交付通过检查的 `files`。

```bash
AIHUB_PLUGIN_DIR="<实际 Plugin 目录>"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" doctor --skill aihub-audio
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill aihub-audio --media audio
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" describe --skill aihub-audio --model "<线上模型 ID>"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" generate --skill aihub-audio --media audio \
  --model "<线上模型 ID>" --params-file "/任务目录/audio-params.json" --output-dir "/任务目录/outputs"
```

提交、等待、下载或试听失败时，不自动重新提交；按共用状态表恢复原任务并说明宿主能完成的检查范围。
