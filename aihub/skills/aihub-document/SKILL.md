---
name: aihub-document
version: 0.7.0
description: v0.7.0｜Convert PDFs with AIhub doc2x-v3 into Markdown, LaTeX, or DOCX ZIP results and validate the downloaded document package.
---

# AIhub Document

E2 只使用 `doc2x-v3`，默认 `convert_mode` 为 `md`。参数 JSON 至少包含 `model`、`pdf_url`、`page_count`；可选 `convert_mode` 为 `md`、`tex` 或 `docx`。

```bash
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill aihub-document --media document
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" generate --skill aihub-document --media document --model doc2x-v3 --params-file request.json --output-dir ./output --wait-seconds 30
```

任务结果中的 ZIP URL 会下载到任务目录，至少校验 ZIP 文件签名后才报告成功；不会用 `ffprobe` 代替文档包校验。
