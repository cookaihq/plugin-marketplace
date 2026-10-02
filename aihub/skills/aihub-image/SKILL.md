---
name: aihub-image
version: 0.7.0
description: v0.7.0｜Generate or edit images through AIhub for A1 text-to-image and A2 reference-image editing. Use GPT Image 2.5 Flare by default or for speed; use Sunburst for explicit detail priority when speed is secondary. Resume existing AIhub image tasks and deliver verified files.
compatibility: Codex and WorkBuddy; Node.js 18 or newer, ffprobe on PATH, AIhub API access.
---

# AIhub 图片任务

本 Skill 只处理 A1 文生图和 A2 图片编辑/参考图生成。图片增强、材质与 PBR 贴图、Profile 创建不属于本版入口。Gemini 原生图片协议如账号提供，按对应图片任务处理，不归入通用语言模型接口。

## 选择图片模型

选择优先级是：用户明确指定型号 → 明确的速度/细节优先级 → 草稿、多轮或无细节要求时默认 Flare。草稿标签不能覆盖明确的细节优先要求，例如“精细草稿、不赶时间”选 Sunburst。指定型号仍须通过账号可见性和输入参数检查。未指定时按下表选择：

| 用户需求 | 默认模型 |
| --- | --- |
| 明确速度优先，或未明确细节优先的草稿、多轮试图、常规任务 | `gpt-image-2.5-flare` |
| 明确要求细节保真、精修，且速度不是首要目标 | `gpt-image-2.5-sunburst` |
| 同时强调最快速度与最高细节，无法判断优先级 | 先确认速度或细节哪项优先，再选择 |

两款都用于文生图和图片编辑。有无参考图、透明背景或 `mask_url` 不决定型号；`quality` 是独立输出参数，不能用它代替型号选择。上述速度与细节取向是本地模型定位和已确认的选择策略，尚无严格的同条件 A/B 实测结论，不承诺固定速度差或画质提升。

## 执行流程

先读取 [共用 CLI 与恢复流程](../../references/cli.md)，再按以下顺序操作：

1. 用户已有任务记录或任务 ID 时，只执行 `resume` 或 `task` 查询原任务，不重新生成。
2. 新任务先按上面的需求规则确定精确型号，再执行 `doctor` 和 `models --media image` 核对该型号是否可见；不可见就报告，不改选其他可见型号。
3. 用 `describe --model` 读取线上原始模型 ID 对应的参数。A1 只传 `prompt` 及所需输出选项；A2 传 `image_urls` 和编辑提示词，遮罩编辑按模型说明校验 `mask_url` 和参考图。默认 2.5 型号读取各自当前目录，不能套用旧 `gpt-image-2` 的字段或尺寸限制；用户显式指定旧型号则读取该型号的说明。精准像素尺寸与遮罩外逐像素保持尚未得到真实效果验证，不能仅凭字段可提交作保证。当前账号看不到精确 ID 时不提交。
4. 本地参考图不能直接作为远程 URL 时，按共用上传流程上传，使用上传响应中的 URL。参数 JSON 写入用户任务目录，再调用 `generate --media image`。
5. 只有状态为 `delivered` 的文件可作为程序已验证的图片交付；`partial` 只交付 `files` 中的文件并说明 `failed`。根据宿主能力查看实际图像内容。

```bash
AIHUB_PLUGIN_DIR="<实际 Plugin 目录>"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" doctor --skill aihub-image
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" models --skill aihub-image --media image
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" describe --skill aihub-image --model "gpt-image-2.5-flare"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" generate --skill aihub-image --media image \
  --model "gpt-image-2.5-flare" --params-file "/任务目录/image-params.json" --output-dir "/任务目录/outputs"
node "${AIHUB_PLUGIN_DIR}/scripts/aihub.mjs" resume --skill aihub-image \
  --record "/任务目录/outputs/aihub-UUID/task.json" --wait-seconds 30
```

模型列表可见不等于生成渠道已通过验收；提交、等待、下载或内容检查失败时，保留原任务 ID，不自动换模型重试。
