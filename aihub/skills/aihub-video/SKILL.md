---
name: aihub-video
version: 0.9.0
description: v0.9.0｜Generate videos through AIhub using Seedance 2.5 text, first-frame image, or multimodal reference inputs. Also handle C1 video lip sync and C2 image-and-audio digital humans. Check task-specific limits, resume existing tasks, and deliver checked video files.
compatibility: Codex and WorkBuddy; Node.js 18 or newer, ffprobe on PATH, AIhub API access.
---

# AIhub 视频与数字人任务

本 Skill 在没有模型配置时使用 Seedance 2.5 生成视频，并提供 C1/C2 音画同步数字人入口。B1–B9 是本期任务目标，不表示 Seedance 2.5 已通过这九类任务的真实验收。

## 选择视频模型

用户本次明确指定型号时固定该型号并关闭 fallback；否则读取 `AIHUB_VIDEO_MODELS`，按任务用途筛选后保留配置顺序。没有配置时按下表选择。所有候选必须满足素材用途和输入要求，不能为了切换丢弃素材：

| 输入及用途 | 默认模型与参数 |
| --- | --- |
| 只有文字，无参考素材 | `seedance-2.5-text-to-video`，传 `prompt` |
| 一张图片明确作为首帧，例如让这张图动起来 | `seedance-2.5-image-to-video`，传 `image_url` 和 `prompt` |
| 图片用于人物、场景或风格参考，或使用多图、参考视频、参考音频 | `seedance-2.5-reference-to-video`，传 `prompt` 及所需的 `image_urls`、`video_urls`、`audio_urls` |
| 只有一张图片，但用途不明确 | 先确认是固定首帧还是参考素材，再选择 |

三个型号的差别是输入用途，没有已核实的 2.5 Fast 型号，不按速度或质量虚构变体。只有配置列表中的适用候选才可按策略切换，不自行追加 Seedance 2.0。2.0 的时长、分辨率和参考素材限制逐项独立检查，不能降低用户要求。

C1 视频唇形同步默认使用 `lipsync-2`；C2 人像图片和音频驱动数字人默认使用 `omnihuman-1.5`，不因输入包含音频就改用 Seedance。C2 只有旁白文字时先取得音频，再按模型要求传 `audio_url`，不能把文字当作音频 URL。`lipsync-2-pro`、`sync-3`、`fabric-1.0`、`fabric-1.0-fast` 和 `creatify-aurora` 仅在模型查询确认可用且用户明确选择时使用。

## 输入与效果边界

- 三个 Seedance 2.5 型号都接受 `480p`、`720p`、`1080p`；时长为 `4–30` 的整数秒，`1080p` 只接受 `5`、`10`、`30` 秒。默认参数为 `720p`、`9:16`、`5` 秒；用户指定的条件不兼容时先说明冲突，不能静默改分辨率或时长。
- 图生视频要求一张首帧图片的远程 `image_url`；参考生视频要求 `image_urls`、`video_urls`、`audio_urls` 中至少一项为非空列表。不得把本地路径作为远程 URL，也不从 Seedance 2.0 复制尾帧、音频开关或素材数量限制。
- 严格首尾帧（B3）、保留原片的编辑（B6）、延长续写（B7）、精确动作控制（B8）与首尾转场（B9）尚无已核实的 2.5 专用契约。先说明与用户目标的差异；只有用户接受参考素材重新生成的结果后，才按参考生成执行，不能把它报告为原任务已获支持。

视频高清放大、视频插帧、Sora 角色创建、字幕生成/导入/翻译/样式、提示词驱动 HeyGen 视频不属于本版入口。模型列表中被拒绝的模型不会提交请求。Gemini 原生媒体协议按对应媒体任务处理，不归入通用语言模型接口。

先读取 [共用 CLI 与恢复流程](../../references/cli.md) 和 [任务 JSON、模型配置与切换](../../references/model-selection.md)，再按以下顺序操作：

1. 用户已有 `run.json` 时用 `continue`；旧 `task.json` 或任务 ID 用 `resume` / `task` 查询原任务。
2. 新任务执行 `doctor`，保存 `original_request`。按素材用途选择 `video-text`、`video-start-frame`、`video-reference`、`video-lipsync` 或 `video-avatar`；只有用户本次明确指定才填 `model`。需要确认首帧/参考用途时先确认，不能靠模型是否可见来决定用途。
3. 本地素材先上传，实际 URL 写入 `inputs`。时长、分辨率和比例等写入 `requirements`。运行 `plan` 并结合每个型号的 `describe` 核对候选请求。目录与可见性均不证明线上生成效果已验证。
4. 运行 `run`，用保存的 `run_record` 有界 `continue`。`confirmation_required` 时展示下一型号、参数和原因；用户确认后才传 `--confirm`，不能直接执行含 token 的 `next_action`。
5. 只交付已通过文件检查的结果。根据宿主能力检查内容、起止画面、时长、音轨、动作/同步结果；报告实际型号和尝试摘要。`seed`、`degraded_reason` 等位于内层 `result.result_metadata`。提交不明、运行中、查询/下载失败和内容不符不触发替换生成。

```bash
AIHUB_PLUGIN_DIR="<实际 Plugin 目录>"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" doctor --skill aihub-video
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill aihub-video --media video --keyword "seedance"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" describe --skill aihub-video --model "seedance-2.5-text-to-video"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" plan --skill aihub-video --request-file "/任务目录/video-request.json"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" run --skill aihub-video \
  --request-file "/任务目录/video-request.json" --output-dir "/任务目录/data/aihub" --wait-seconds 30
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" continue --skill aihub-video \
  --record "/任务目录/data/aihub/aihub-run-UUID/run.json" --wait-seconds 30
```


## 结果检查与用户提示

新任务与交付前读取 [结果检查与错误反馈](../../references/result-checks.md)。保存原始需求及具体检查项，完成生成后读取 `result_check`：`pending` 时实际查看产物并通过 `review-submit` 提交证据；`auto` 下宿主缺少必要能力才使用 `review --provider aihub`，`host` 下明确报告无法检查。`checking` 查询原检查任务，不提交新请求。

检查开启时，每次完成检查都必须告诉用户：“如果想关闭结果检查，可以直接在对话中告诉我‘关闭结果检查’；也可以说‘仅本次关闭结果检查’。”通过、不符、证据不足或无法检查都要提示，不能只保留在 JSON 中。用户要求关闭时按参考说明执行，沿用已明确作用范围；范围不明再询问。关闭后仍执行文件检查。

`feedback.show_notice=true` 时提供报告路径与 Issue/管理员入口；公开只使用脱敏草稿，不自动发送。结果不符或检查失败不触发重新生成。
