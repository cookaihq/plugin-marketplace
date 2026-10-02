/** 模型目录：读取 Plugin 自带的 catalog.zh.json，不依赖调用方工作目录。 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeModelId } from "./modelId.js";

export interface ParamSpec {
  name: string;
  type: string | null;
  /** 所有请求变体都必填。示例请求只会填这类参数。 */
  required: boolean;
  /** 仅在部分 oneOf/anyOf 变体下必填（与其他变体的必填项互斥，不能同时传）。 */
  conditional?: boolean;
  enum?: (string | number | boolean)[];
  default?: unknown;
  description?: string;
  items?: string | null;
}

export interface CatalogEntry {
  file: string;
  operationId: string | null;
  method: string;
  path: string;
  title: string;
  summary: string | null;
  description: string | null;
  category: string;
  mediaType: string | null;
  models: string[];
  modelSource: "enum" | "const" | "default" | "none";
  requestContentTypes: string[];
  requiredParams: string[];
  /** 仅在某些请求变体下必填的参数（互斥项，不能同时照抄）。 */
  conditionalRequiredParams?: string[];
  params: string[];
  paramSpecs: ParamSpec[];
  registeredInDocsJson: boolean;
}

export interface Catalog {
  generatedAt: string;
  lang: string;
  specBaseUrl: string;
  specFileCount: number;
  entries: CatalogEntry[];
}

export type MediaType = "image" | "video" | "audio" | "document";

const CATALOG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "catalog",
  "catalog.zh.json",
);

let cached: Catalog | null = null;

export function loadCatalog(): Catalog {
  if (!cached) cached = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as Catalog;
  return cached;
}

/** 返回已收录的生成条目（image/video/audio/document），不代表当前 Key 可用。 */
export function generationEntries(): CatalogEntry[] {
  return genIndex().entries;
}

/**
 * 生成条目的索引，首次访问时构建一次。
 *
 * resolveEntry 会对 /v1/models 返回的每个 id 各查一次，因此按 model 预先建表。
 */
interface GenIndex {
  entries: CatalogEntry[];
  /** model → 该模型对应的、参数最丰富的条目。 */
  byModel: Map<string, CatalogEntry>;
}
let genIndexCache: GenIndex | null = null;
function genIndex(): GenIndex {
  if (genIndexCache) return genIndexCache;
  const entries = loadCatalog().entries.filter((e) => e.category === "generation");
  const byModel = new Map<string, CatalogEntry>();
  for (const e of entries) {
    for (const model of e.models) {
      // 一个模型可能出现在多个 spec 文件（系列文件 + 变体文件）；留参数最丰富的那条
      const cur = byModel.get(model);
      if (!cur || e.params.length > cur.params.length) byModel.set(model, e);
    }
  }
  genIndexCache = { entries, byModel };
  return genIndexCache;
}

/** 一个模型可能出现在多个 spec 文件（如系列文件 + 变体文件）；返回参数最丰富的那条。 */
export function findEntryByModel(model: string): CatalogEntry | undefined {
  return genIndex().byModel.get(model);
}

/**
 * 为一个 live id 找参数说明：先精确匹配，再按归一化 family 匹配。
 *
 * 例如源仓已记录的 `veo-3.1[4k]`、`google/veo-3.1[fast]` 可以取 `veo-3.1`
 * 的参数说明；能否提交仍须查询当前 Key 的 /v1/models。
 */
export function resolveEntry(
  modelId: string,
): { entry: CatalogEntry; catalogModel: string; match: "exact" | "family" } | undefined {
  const exact = findEntryByModel(modelId);
  if (exact) return { entry: exact, catalogModel: modelId, match: "exact" };

  const { base } = normalizeModelId(modelId);
  if (base === modelId) return undefined;
  const viaBase = findEntryByModel(base);
  if (viaBase) return { entry: viaBase, catalogModel: base, match: "family" };
  return undefined;
}

export interface ModelSummary {
  model: string;
  mediaType: string | null;
  title: string;
  summary: string | null;
  file: string;
}

/** 展开为「模型 → 摘要」列表（一个条目可含多个模型）。 */
export function listModelSummaries(opts: { mediaType?: MediaType; keyword?: string }): ModelSummary[] {
  const kw = opts.keyword?.toLowerCase();
  const seen = new Set<string>();
  const out: ModelSummary[] = [];
  for (const e of generationEntries()) {
    if (opts.mediaType && e.mediaType !== opts.mediaType) continue;
    for (const model of e.models) {
      if (seen.has(model)) continue;
      if (kw && !`${model} ${e.title} ${e.summary ?? ""}`.toLowerCase().includes(kw)) continue;
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
