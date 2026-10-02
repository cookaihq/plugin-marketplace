/** 模型目录：读取 Plugin 自带的 catalog.zh.json，不依赖调用方工作目录。 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeModelId } from "./modelId.js";
const CATALOG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "catalog", "catalog.zh.json");
let cached = null;
export function loadCatalog() {
    if (!cached)
        cached = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
    return cached;
}
/** 返回已收录的生成条目（image/video/audio/document），不代表当前 Key 可用。 */
export function generationEntries() {
    return genIndex().entries;
}
let genIndexCache = null;
function genIndex() {
    if (genIndexCache)
        return genIndexCache;
    const entries = loadCatalog().entries.filter((e) => e.category === "generation");
    const byModel = new Map();
    for (const e of entries) {
        for (const model of e.models) {
            // 一个模型可能出现在多个 spec 文件（系列文件 + 变体文件）；留参数最丰富的那条
            const cur = byModel.get(model);
            if (!cur || e.params.length > cur.params.length)
                byModel.set(model, e);
        }
    }
    genIndexCache = { entries, byModel };
    return genIndexCache;
}
/** 一个模型可能出现在多个 spec 文件（如系列文件 + 变体文件）；返回参数最丰富的那条。 */
export function findEntryByModel(model) {
    return genIndex().byModel.get(model);
}
/**
 * 为一个 live id 找参数说明：先精确匹配，再按归一化 family 匹配。
 *
 * 例如源仓已记录的 `veo-3.1[4k]`、`google/veo-3.1[fast]` 可以取 `veo-3.1`
 * 的参数说明；能否提交仍须查询当前 Key 的 /v1/models。
 */
export function resolveEntry(modelId) {
    const exact = findEntryByModel(modelId);
    if (exact)
        return { entry: exact, catalogModel: modelId, match: "exact" };
    const { base } = normalizeModelId(modelId);
    if (base === modelId)
        return undefined;
    const viaBase = findEntryByModel(base);
    if (viaBase)
        return { entry: viaBase, catalogModel: base, match: "family" };
    return undefined;
}
/** 展开为「模型 → 摘要」列表（一个条目可含多个模型）。 */
export function listModelSummaries(opts) {
    const kw = opts.keyword?.toLowerCase();
    const seen = new Set();
    const out = [];
    for (const e of generationEntries()) {
        if (opts.mediaType && e.mediaType !== opts.mediaType)
            continue;
        for (const model of e.models) {
            if (seen.has(model))
                continue;
            if (kw && !`${model} ${e.title} ${e.summary ?? ""}`.toLowerCase().includes(kw))
                continue;
            seen.add(model);
            out.push({
                model,
                mediaType: e.mediaType,
                title: e.title,
                summary: e.summary,
                file: e.file,
            });
        }
    }
    return out.sort((a, b) => a.model.localeCompare(b.model));
}
