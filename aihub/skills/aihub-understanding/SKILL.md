---
name: aihub-understanding
version: 0.7.0
description: v0.7.0｜Understand image, audio, video, or file content through AIhub llm-custom models and return resumable text results.
---

# AIhub Understanding

E1 只接受媒体内容块，不能提交纯文本请求。`params-file` 必须包含 `model`、`prompt` 和 `content`；内容元素使用 OpenAI Chat 形态的 `image_url`、`audio_url`、`video_url` 或 `file_url` 对象，例如 `{"type":"image_url","image_url":{"url":"https://..."}}`。程序会把 `prompt` 转为同一条消息中的 `text` 内容块。

```bash
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill aihub-understanding --media audio
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" understand --skill aihub-understanding --params-file request.json --output-dir ./output --wait-seconds 30
```

命令先读取 `/v1/configs/llm_generations_models`，检查模型 ID 与媒体能力；能力不匹配时直接返回 422 风格错误，不自动换模型。完成后返回 `text`，任务记录可用 `resume` 继续查询。
