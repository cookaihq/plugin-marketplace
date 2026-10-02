---
name: aihub-music
version: 0.7.0
description: v0.7.0｜Generate AIhub music with lyria-3-pro async tasks or the separate Gemini-native lyria-3-pro-preview protocol, then save verified audio files.
---

# AIhub Music

使用 `lyria-3-pro` 时走异步 AIhub 音频生成；使用 `lyria-3-pro-preview` 时必须走单独的 Gemini 原生 `native-music` 命令，不能把两个协议混用或静默切换。

```bash
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" doctor --skill aihub-music
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill aihub-music --media audio
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" generate --skill aihub-music --media audio --model lyria-3-pro --params-file request.json --output-dir ./output --wait-seconds 30
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" native-music --skill aihub-music --model lyria-3-pro-preview --params-file gemini-request.json --output-dir ./output
```

异步结果通过任务记录恢复；原生协议的 `inlineData` 会直接解码写入输出目录。
