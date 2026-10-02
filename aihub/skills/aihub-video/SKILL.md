---
name: aihub-video
version: 0.7.0
description: v0.7.0｜Generate videos through AIhub using Seedance 2.5 text, first-frame image, or multimodal reference inputs. Also handle C1 video lip sync and C2 image-and-audio digital humans. Check task-specific limits, resume existing tasks, and deliver checked video files.
compatibility: Codex and WorkBuddy; Node.js 18 or newer, ffprobe on PATH, AIhub API access.
---

# AIhub 视频与数字人任务

本 Skill 默认使用 Seedance 2.5 生成视频，并提供 C1/C2 音画同步数字人入口。B1–B9 是本期任务目标，不表示 Seedance 2.5 已通过这九类任务的真实验收。

## 选择视频模型

用户明确指定型号时优先按指定型号执行，但型号必须满足素材用途和输入参数要求，不能为了使用该型号丢弃素材。未指定时按下表选择：

| 输入及用途 | 默认模型与参数 |
| --- | --- |
| 只有文字，无参考素材 | `seedance-2.5-text-to-video`，传 `prompt` |
| 一张图片明确作为首帧，例如让这张图动起来 | `seedance-2.5-image-to-video`，传 `image_url` 和 `prompt` |
| 图片用于人物、场景或风格参考，或使用多图、参考视频、参考音频 | `seedance-2.5-reference-to-video`，传 `prompt` 及所需的 `image_urls`、`video_urls`、`audio_urls` |
| 只有一张图片，但用途不明确 | 先确认是固定首帧还是参考素材，再选择 |

三个型号的差别是输入用途，没有已核实的 2.5 Fast 型号，不按速度或质量虚构变体。默认选择失败、模型不可见或参数不支持时，报告具体原因，不自动回退 Seedance 2.0 或其他模型。

C1 视频唇形同步默认使用 `lipsync-2`；C2 人像图片和音频驱动数字人默认使用 `omnihuman-1.5`，不因输入包含音频就改用 Seedance。C2 只有旁白文字时先取得音频，再按模型要求传 `audio_url`，不能把文字当作音频 URL。`lipsync-2-pro`、`sync-3`、`fabric-1.0`、`fabric-1.0-fast` 和 `creatify-aurora` 仅在模型查询确认可用且用户明确选择时使用。

## 输入与效果边界

- 三个 Seedance 2.5 型号都接受 `480p`、`720p`、`1080p`；时长为 `4–30` 的整数秒，`1080p` 只接受 `5`、`10`、`30` 秒。默认参数为 `720p`、`9:16`、`5` 秒；用户指定的条件不兼容时先说明冲突，不能静默改分辨率或时长。
- 图生视频要求一张首帧图片的远程 `image_url`；参考生视频要求 `image_urls`、`video_urls`、`audio_urls` 中至少一项为非空列表。不得把本地路径作为远程 URL，也不从 Seedance 2.0 复制尾帧、音频开关或素材数量限制。
- 严格首尾帧（B3）、保留原片的编辑（B6）、延长续写（B7）、精确动作控制（B8）与首尾转场（B9）尚无已核实的 2.5 专用契约。先说明与用户目标的差异；只有用户接受参考素材重新生成的结果后，才按参考生成执行，不能把它报告为原任务已获支持。

视频高清放大、视频插帧、Sora 角色创建、字幕生成/导入/翻译/样式、提示词驱动 HeyGen 视频不属于本版入口。模型列表中被拒绝的模型不会提交请求。Gemini 原生媒体协议按对应媒体任务处理，不归入通用语言模型接口。

先读取 [共用 CLI 与恢复流程](../../references/cli.md)，再按以下顺序操作：

1. 用户已有记录或任务 ID 时，只执行 `resume` 或 `task` 查询原任务。
2. 新任务先按上面的素材用途规则确定精确型号，再执行 `doctor` 和 `models --media video` 核对该型号是否可见；不可见就报告，不改选其他可见型号。使用 `describe --model` 读取该型号的参数；目录说明与模型可见性都不证明线上生成已通过验证。
3. 需要本地图片、视频或音频时，先按共用上传流程取得远程 URL。参数 JSON 写入用户任务目录，调用 `generate --media video`。
4. 用有界 `resume` 查询同一任务。只有 `delivered` 表示程序已完成媒体文件校验；根据宿主能力检查视频内容、起止画面、时长、音轨和任务特有的动作/同步结果。
5. 结果中的 `seed`、`degraded_reason` 等信息会在 CLI 的 `result_metadata` 中返回；不要把它们当作独立业务 Skill。失败时保留任务 ID，不自动换模型或重复提交。

```bash
AIHUB_PLUGIN_DIR="<实际 Plugin 目录>"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" doctor --skill aihub-video
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill aihub-video --media video --keyword "seedance"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" describe --skill aihub-video --model "seedance-2.5-text-to-video"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" generate --skill aihub-video --media video \
  --model "seedance-2.5-text-to-video" --params-file "/任务目录/video-params.json" --output-dir "/任务目录/outputs"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" resume --skill aihub-video \
  --record "/任务目录/outputs/aihub-UUID/task.json" --wait-seconds 30
```
