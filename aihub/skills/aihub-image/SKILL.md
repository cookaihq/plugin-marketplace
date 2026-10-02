---
name: aihub-image
version: 0.9.2
description: v0.9.2｜Generate or edit images through AIhub with configured model priorities and recoverable fallback. Without configuration, use GPT Image 2.5 Flare for speed or Sunburst for detail. Resume existing image tasks and deliver checked files.
compatibility: Codex and WorkBuddy; Node.js 18 or newer, ffprobe on PATH, AIhub API access.
---

# AIhub 图片任务

本 Skill 只处理 A1 文生图和 A2 图片编辑/参考图生成。图片增强、材质与 PBR 贴图、Profile 创建不属于本版入口。Gemini 原生图片协议如账号提供，按对应图片任务处理，不归入通用语言模型接口。

## 选择图片模型

选择优先级是：用户本次明确指定型号 → `AIHUB_IMAGE_MODELS` 有序配置 → 下表的内置规则。指定型号固定执行并关闭 fallback，仍须通过账号可见性和参数检查。没有模型配置时，草稿标签不能覆盖明确的细节优先要求，例如“精细草稿、不赶时间”选 Sunburst：

| 用户需求 | 默认模型 |
| --- | --- |
| 明确速度优先，或未明确细节优先的草稿、多轮试图、常规任务 | `gpt-image-2.5-flare` |
| 明确要求细节保真、精修，且速度不是首要目标 | `gpt-image-2.5-sunburst` |
| 同时强调最快速度与最高细节，无法判断优先级 | 先确认速度或细节哪项优先，再选择 |

两款都用于文生图和图片编辑。有无参考图、透明背景或 `mask_url` 不决定型号；`quality` 是独立输出参数，不能用它代替型号选择。上述速度与细节取向是本地模型定位和已确认的选择策略，尚无严格的同条件 A/B 实测结论，不承诺固定速度差或画质提升。

## 执行流程

先读取 [共用 CLI 与恢复流程](../../references/cli.md) 和 [任务 JSON、模型配置与切换](../../references/model-selection.md)，再按以下顺序操作：

1. 用户已有 `run.json` 时执行 `continue`；旧 `task.json` 或任务 ID 使用 `resume` / `task`，只查询和下载原任务。
2. 新任务执行 `doctor`，把用户原文写入 `original_request`，A1 选择 `operation=image-generate`，A2 选择 `image-edit`。Agent 只填写需求和素材用途；仅用户明确指定时才填 `model`，内置速度/细节偏好填 `image_priority`。
3. 本地素材先上传，把实际 URL 写入 `inputs.images`，遮罩写入 `inputs.mask`。输出条件写入 `requirements`。运行 `plan`，结合 `describe` 核对每个候选的独立参数；不能套用旧 `gpt-image-2` 的尺寸契约。精准像素尺寸与遮罩外逐像素保持尚无真实效果验证，不能仅凭字段可提交作保证。
4. 运行 `run`。CLI 检查当前可见性并按保存的策略切换；后续使用返回的 `run_record` 继续。`confirmation_required` 时列出下一模型、请求参数和原因，得到用户明确确认后才传 `--confirm`，不能直接执行含 token 的 `next_action`。
5. 只有 `delivered` 表示文件全部通过程序检查；`partial` 先交付 `files` 并说明内层 `result.failed`。根据宿主能力查看实际图像，报告最终型号和已尝试型号。

```bash
AIHUB_PLUGIN_DIR="<实际 Plugin 目录>"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" doctor --skill aihub-image
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill aihub-image --media image
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" describe --skill aihub-image --model "gpt-image-2.5-flare"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" plan --skill aihub-image --request-file "/任务目录/image-request.json"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" run --skill aihub-image \
  --request-file "/任务目录/image-request.json" --output-dir "/任务目录/data/aihub" --wait-seconds 30
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" continue --skill aihub-image \
  --record "/任务目录/data/aihub/aihub-run-UUID/run.json" --wait-seconds 30
```

模型列表可见不等于生成渠道已通过验收。提交结果不明、仍在运行、查询/下载失败或画面不符合要求时，不触发替换生成；保留记录及已知任务 ID，按共用状态表继续。


## 结果检查与用户提示

新任务与交付前读取 [结果检查与错误反馈](../../references/result-checks.md)。保存原始需求及具体检查项，完成生成后读取 `result_check`：`pending` 时实际查看产物并通过 `review-submit` 提交证据；`auto` 下宿主缺少必要能力才使用 `review --provider aihub`，`host` 下明确报告无法检查。`checking` 查询原检查任务，不提交新请求。

检查开启时，每次完成检查都必须告诉用户：“如果想关闭结果检查，可以直接在对话中告诉我‘关闭结果检查’；也可以说‘仅本次关闭结果检查’。”通过、不符、证据不足或无法检查都要提示，不能只保留在 JSON 中。用户要求关闭时按参考说明执行，沿用已明确作用范围；范围不明再询问。关闭后仍执行文件检查。

`feedback.show_notice=true` 时提供报告路径与 Issue/管理员入口；公开只使用脱敏草稿，不自动发送。结果不符或检查失败不触发重新生成。
