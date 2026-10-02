---
name: aihub-music
version: 0.9.0
description: v0.9.0｜Generate AIhub music with lyria-3-pro async tasks or the separate Gemini-native lyria-3-pro-preview protocol, then save verified audio files.
---

# AIhub Music

先读取 [共用 CLI](../../references/cli.md) 和 [任务 JSON、模型配置与切换](../../references/model-selection.md)。新任务默认选 `operation=music-async`，没有模型配置时用 `lyria-3-pro`。用户选择 Gemini 原生音乐时选 `music-native`，内置型号为 `lyria-3-pro-preview`，不能静默切换协议或用短片段型号替代完整音乐。

保存 `original_request` 和提交提示词 `prompt`，仅用户本次指定型号才填 `model`。其余情况由 CLI 读取 `AIHUB_MUSIC_MODELS`，按已选协议筛选候选并逐一构造参数。异步音乐可将图片参考放入 `inputs.images`、负面提示词放入 `requirements.negative_prompt`；原生音乐尚无可验证的额外参数/参考素材转换，不能删除用户要求后提交。先执行 `doctor`、`plan`，核对后 `run`。

```bash
AIHUB_PLUGIN_DIR="<实际 Plugin 目录>"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" doctor --skill aihub-music
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill aihub-music --media audio
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" plan --skill aihub-music --request-file "/任务目录/music-request.json"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" run --skill aihub-music --request-file "/任务目录/music-request.json" --output-dir "/任务目录/data/aihub" --wait-seconds 30
```

已有 `run.json` 用 `continue`；旧异步 `task.json` 用 `resume`。原生音乐的 `inlineData` 直接保存音频，新流程会保存 run 记录，但没有可查询的远端任务 ID，提交结果不明时不自动重发。`confirmation_required` 时用户确认下一模型及参数后才传 `--confirm`，不能直接执行含 token 的 `next_action`。只交付通过文件检查的音频，说明实际试听范围和尝试过的模型；内容不符或下载失败不触发替换生成。


## 结果检查与用户提示

新任务与交付前读取 [结果检查与错误反馈](../../references/result-checks.md)。保存原始需求及具体检查项，完成生成后读取 `result_check`：`pending` 时实际查看产物并通过 `review-submit` 提交证据；`auto` 下宿主缺少必要能力才使用 `review --provider aihub`，`host` 下明确报告无法检查。`checking` 查询原检查任务，不提交新请求。

检查开启时，每次完成检查都必须告诉用户：“如果想关闭结果检查，可以直接在对话中告诉我‘关闭结果检查’；也可以说‘仅本次关闭结果检查’。”通过、不符、证据不足或无法检查都要提示，不能只保留在 JSON 中。用户要求关闭时按参考说明执行，沿用已明确作用范围；范围不明再询问。关闭后仍执行文件检查。

`feedback.show_notice=true` 时提供报告路径与 Issue/管理员入口；公开只使用脱敏草稿，不自动发送。结果不符或检查失败不触发重新生成。
