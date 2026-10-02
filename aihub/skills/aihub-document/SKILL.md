---
name: aihub-document
version: 0.9.1
description: v0.9.1｜Convert PDFs with AIhub doc2x-v3 into Markdown, LaTeX, or DOCX ZIP results and validate the downloaded document package.
---

# AIhub Document

先读取 [共用 CLI](../../references/cli.md) 和 [任务 JSON、模型配置与切换](../../references/model-selection.md)。E2 转换 PDF；用户本次指定型号时固定执行，否则读取 `AIHUB_DOCUMENT_MODELS`。未配置时用 `doc2x-v3`，当前只有这一型号完成自动参数转换，不能把任意已配置 ID 当成已接入。

新任务保存 `operation=document` 和 `original_request`，把 PDF 的实际远程 URL 写入 `inputs.files`（恰好一个），本地文件先上传。读取原 PDF 得到页数并写入 `requirements.page_count`；无法确定时询问，不猜页数。`requirements.convert_mode` 默认 `md`，也可为 `tex` 或 `docx`。只有用户本次明确指定模型时填 `model`。先 `doctor`、`plan` 检查候选请求，再 `run`。

```bash
AIHUB_PLUGIN_DIR="<实际 Plugin 目录>"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" doctor --skill aihub-document
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill aihub-document --media document
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" plan --skill aihub-document --request-file "/任务目录/document-request.json"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" run --skill aihub-document --request-file "/任务目录/document-request.json" --output-dir "/任务目录/data/aihub" --wait-seconds 30
```

已有 `run.json` 用 `continue`；旧 `task.json` / 任务 ID 用 `resume` / `task`。`confirmation_required` 时用户确认下一型号及参数后才传 `--confirm`，不能直接执行含 token 的 `next_action`。ZIP 下载后检查非空和文件签名，不能把它说成已验证包内文档内容；交付时提供实际文件并说明检查范围。提交结果不明、下载失败和内容缺失不触发替换生成。


## 结果检查与用户提示

新任务与交付前读取 [结果检查与错误反馈](../../references/result-checks.md)。保存原始需求及具体检查项，完成生成后读取 `result_check`：`pending` 时实际查看产物并通过 `review-submit` 提交证据；`auto` 下宿主缺少必要能力才使用 `review --provider aihub`，`host` 下明确报告无法检查。`checking` 查询原检查任务，不提交新请求。

检查开启时，每次完成检查都必须告诉用户：“如果想关闭结果检查，可以直接在对话中告诉我‘关闭结果检查’；也可以说‘仅本次关闭结果检查’。”通过、不符、证据不足或无法检查都要提示，不能只保留在 JSON 中。用户要求关闭时按参考说明执行，沿用已明确作用范围；范围不明再询问。关闭后仍执行文件检查。

`feedback.show_notice=true` 时提供报告路径与 Issue/管理员入口；公开只使用脱敏草稿，不自动发送。结果不符或检查失败不触发重新生成。
