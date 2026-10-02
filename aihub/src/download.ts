import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { link, mkdir, open, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const ATTEMPTS = 3;
// Large generated videos need more than the metadata request timeout. Both the
// whole asset operation and each transfer remain bounded, including retries.
const ASSET_BUDGET_MS = 15 * 60_000;
const TRANSFER_TIMEOUT_MS = 10 * 60_000;
const STALL_TIMEOUT_MS = 60_000;
const PROBE_TIMEOUT_MS = 120_000;
const MAX_RETRY_AFTER_MS = 60_000;
const IMAGE_FORMATS = new Set([
  "png_pipe", "apng", "jpeg_pipe", "webp_pipe", "gif", "gif_pipe", "bmp_pipe", "tiff_pipe",
]);
// Restrict ffprobe to self-contained formats. A downloaded HLS/concat/DASH
// document must not make the local validator open more URLs or local files.
const VIDEO_FORMATS = ["mov", "mp4", "m4a", "3gp", "3g2", "mj2", "matroska", "webm", "avi", "mpeg", "mpegts", "ogg", "flv"];
const AUDIO_FORMATS = ["mp3", "wav", "flac", "aac", "aiff", "amr", "ac3", "eac3", "opus"];
const PROBE_FORMATS = [...IMAGE_FORMATS, ...VIDEO_FORMATS, ...AUDIO_FORMATS].join(",");

export type DownloadMedia = "image" | "video" | "audio" | "document";
export interface DownloadedFile { url: string; path: string; bytes: number; mime_type: string }
export interface DownloadResult { files: DownloadedFile[]; failed: Array<{ url: string; error: string }> }

class DownloadFailure extends Error {
  constructor(message: string, readonly transient = false, readonly retryAfterMs?: number) {
    super(message);
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]+$/.test(code) ? code : undefined;
}

function classifyFailure(error: unknown): DownloadFailure {
  if (error instanceof DownloadFailure) return error;
  const transientCodes = new Set([
    "ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
    "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
    "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE", "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR",
  ]);
  for (let cause: unknown = error, depth = 0; cause && depth < 5; depth++) {
    if (cause instanceof Error && ["AbortError", "TimeoutError"].includes(cause.name)) {
      return new DownloadFailure("下载超时或传输停滞。", true);
    }
    const code = errorCode(cause);
    if (code && transientCodes.has(code)) return new DownloadFailure(`下载连接失败（${code}）。`, true);
    cause = typeof cause === "object" ? (cause as { cause?: unknown }).cause : undefined;
  }
  const code = errorCode(error);
  // Raw fetch/subprocess errors can embed signed URLs, credentials, or paths.
  return new DownloadFailure(code ? `下载或文件写入失败（${code}）。` : "下载或文件验证失败，请检查输出目录权限及文件格式。");
}

function installHint(): string {
  return process.platform === "darwin" ? "brew install ffmpeg" : process.platform === "win32" ? "winget install Gyan.FFmpeg" : "sudo apt-get install ffmpeg";
}

/** The CLI calls this before submitting a generated-media task. No installation occurs. */
export async function checkMediaTools(): Promise<void> {
  try {
    const { stdout } = await runFile("ffprobe", ["-version"], { timeout: 10_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
    if (!/^ffprobe version /m.test(stdout)) throw new Error("Unexpected executable");
  } catch (error) {
    const code = errorCode(error);
    throw new DownloadFailure(`ffprobe 无法运行${code ? `（${code}）` : ""}。请安装或修复 FFmpeg，并确保 ffprobe 在 PATH 中：${installHint()}`);
  }
}

interface MediaInfo { mime: string; extension: string }
interface ProbeResult {
  streams?: Array<{ codec_type?: string; width?: number; height?: number; disposition?: { attached_pic?: number } }>;
  format?: { format_name?: string };
}

function imageSignature(header: Buffer): MediaInfo | undefined {
  // These signatures and ffprobe format names are verified with actual FFmpeg
  // output for PNG, JPEG, WebP, GIF, BMP, and TIFF. Images are video streams in
  // ffprobe, so codec_type alone cannot distinguish them from generated video.
  if (header.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return { mime: "image/png", extension: ".png" };
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return { mime: "image/jpeg", extension: ".jpg" };
  if (["GIF87a", "GIF89a"].includes(header.subarray(0, 6).toString("ascii"))) return { mime: "image/gif", extension: ".gif" };
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return { mime: "image/webp", extension: ".webp" };
  if (header.subarray(0, 2).toString("ascii") === "BM") return { mime: "image/bmp", extension: ".bmp" };
  if (["49492a00", "4d4d002a"].includes(header.subarray(0, 4).toString("hex"))) return { mime: "image/tiff", extension: ".tiff" };
  return undefined;
}

/** Doc2X returns a ZIP archive. Validate the local file signature before exposing it. */
function documentInfo(header: Buffer): MediaInfo {
  if (!(header[0] === 0x50 && header[1] === 0x4b &&
        ((header[2] === 0x03 && header[3] === 0x04) ||
         (header[2] === 0x05 && header[3] === 0x06) ||
         (header[2] === 0x07 && header[3] === 0x08)))) {
    throw new DownloadFailure("文档结果不是有效的 ZIP 压缩包。");
  }
  return { mime: "application/zip", extension: ".zip" };
}

function mediaInfo(formats: Set<string>, media: DownloadMedia, declaredMime: string): MediaInfo {
  if (formats.has("mov") || formats.has("mp4")) return { mime: `${media}/mp4`, extension: media === "audio" ? ".m4a" : ".mp4" };
  if (formats.has("matroska") || formats.has("webm")) {
    const webm = declaredMime === `${media}/webm`;
    return { mime: webm ? `${media}/webm` : `${media}/x-matroska`, extension: webm ? ".webm" : media === "audio" ? ".mka" : ".mkv" };
  }
  const known: Record<string, MediaInfo> = {
    mp3: { mime: "audio/mpeg", extension: ".mp3" }, wav: { mime: "audio/wav", extension: ".wav" },
    flac: { mime: "audio/flac", extension: ".flac" }, aac: { mime: "audio/aac", extension: ".aac" },
    aiff: { mime: "audio/aiff", extension: ".aiff" }, amr: { mime: "audio/amr", extension: ".amr" },
    ac3: { mime: "audio/ac3", extension: ".ac3" }, eac3: { mime: "audio/eac3", extension: ".eac3" },
    avi: { mime: "video/x-msvideo", extension: ".avi" }, mpeg: { mime: "video/mpeg", extension: ".mpeg" },
    mpegts: { mime: "video/mp2t", extension: ".ts" }, flv: { mime: "video/x-flv", extension: ".flv" },
    ogg: { mime: `${media}/ogg`, extension: media === "audio" ? ".ogg" : ".ogv" },
  };
  for (const format of formats) {
    const info = known[format];
    if (info?.mime.startsWith(`${media}/`)) return info;
  }
  throw new DownloadFailure("文件格式不在当前支持的媒体校验范围内。");
}

async function validateMedia(path: string, media: DownloadMedia, declaredMime: string, deadline: number): Promise<MediaInfo> {
  const handle = await open(path, "r");
  const header = Buffer.alloc(16);
  try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
  if (media === "document") return documentInfo(header);
  const signature = imageSignature(header);
  let probe: ProbeResult;
  try {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new DownloadFailure("下载与验证总时间预算已耗尽。");
    const { stdout, stderr } = await runFile("ffprobe", [
      "-v", "error", "-protocol_whitelist", "file", "-format_whitelist", PROBE_FORMATS,
      "-show_entries", "stream=codec_type,width,height:stream_disposition=attached_pic:format=format_name",
      "-of", "json", path,
    ], { timeout: Math.min(PROBE_TIMEOUT_MS, remaining), killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
    if (stderr.trim()) throw new Error("Media parse errors");
    probe = JSON.parse(stdout) as ProbeResult;
  } catch (error) {
    if (error instanceof DownloadFailure) throw error;
    throw new DownloadFailure("ffprobe 无法完整解析文件头或媒体流，或验证超时；该文件未作为成功产物保存。");
  }
  const formats = new Set((probe.format?.format_name ?? "").split(","));
  const streams = probe.streams ?? [];
  const hasVideo = streams.some((stream) => stream.codec_type === "video" && !stream.disposition?.attached_pic && (stream.width ?? 0) > 0 && (stream.height ?? 0) > 0);
  const hasAudio = streams.some((stream) => stream.codec_type === "audio");
  const imageFormat = [...formats].some((format) => IMAGE_FORMATS.has(format));
  if (media === "image") {
    if (!signature || !imageFormat || !hasVideo) throw new DownloadFailure("文件不是受支持且可解析的图片（PNG/JPEG/WebP/GIF/BMP/TIFF）。");
    return signature;
  }
  if (signature || imageFormat || (media === "video" ? !hasVideo : !hasAudio || hasVideo)) {
    throw new DownloadFailure(`文件实际媒体类型与请求的 ${media} 不符。`);
  }
  return mediaInfo(formats, media, declaredMime);
}

function retryAfter(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const numeric = Number(value);
  const ms = Number.isFinite(numeric) ? numeric * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : undefined;
}

function fileStem(url: URL, index: number): string {
  let filename = basename(url.pathname);
  try { filename = decodeURIComponent(filename); } catch { /* Retain safe encoded characters below. */ }
  const stem = basename(filename, extname(filename)).replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return stem || `asset-${index + 1}`;
}

async function transfer(url: URL, outputDir: string, media: DownloadMedia, index: number, deadline: number): Promise<DownloadedFile> {
  const partPath = join(outputDir, `.aihub-${randomUUID()}.partial`);
  const ctrl = new AbortController();
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new DownloadFailure("下载与验证总时间预算已耗尽。");
  const totalTimer = setTimeout(() => ctrl.abort(), Math.min(TRANSFER_TIMEOUT_MS, remaining));
  let stallTimer = setTimeout(() => ctrl.abort(), STALL_TIMEOUT_MS);
  let bytes = 0;
  try {
    const response = await fetch(url, { signal: ctrl.signal, headers: { "Accept-Encoding": "identity" } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new DownloadFailure(`下载返回 HTTP ${response.status}。`, response.status === 429 || response.status >= 500, retryAfter(response.headers.get("retry-after")));
    }
    if (!response.body) throw new DownloadFailure("下载响应没有文件内容。");
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => ctrl.abort(), STALL_TIMEOUT_MS);
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>), meter,
      createWriteStream(partPath, { flags: "wx", mode: 0o600 }), { signal: ctrl.signal });
    clearTimeout(totalTimer);
    clearTimeout(stallTimer);
    if (bytes === 0) throw new DownloadFailure("下载文件为空。");
    // fetch decodes compressed responses; their Content-Length describes the
    // compressed representation and cannot be compared to written bytes.
    const encoding = response.headers.get("content-encoding");
    const length = response.headers.get("content-length");
    const declared = length === null ? undefined : Number(length);
    if ((!encoding || encoding === "identity") && declared !== undefined && Number.isFinite(declared) && bytes !== declared) {
      throw new DownloadFailure("下载文件长度与 Content-Length 不一致。", true);
    }
    const info = await validateMedia(partPath, media, (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase(), deadline);
    // link creates the destination atomically and refuses EEXIST. rename would
    // overwrite a user file if the name appeared between checking and moving.
    for (let suffix = 0; suffix < 3; suffix++) {
      const destination = join(outputDir, `${fileStem(url, index)}-${randomUUID()}${info.extension}`);
      try {
        await link(partPath, destination);
        return { url: url.href, path: destination, bytes, mime_type: info.mime };
      } catch (error) { if (errorCode(error) !== "EEXIST") throw error; }
    }
    throw new DownloadFailure("无法创建不覆盖已有文件的产物名称。");
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(stallTimer);
    await rm(partPath, { force: true });
  }
}

/** Download a structured JSON result such as Paraformer transcription output. */
export async function downloadJsonAssets(urls: string[], outputDir: string): Promise<DownloadResult> {
  const result: DownloadResult = { files: [], failed: [] };
  const directory = resolve(outputDir);
  try { await mkdir(directory, { recursive: true }); } catch (error) { throw classifyFailure(error); }
  for (const [index, rawUrl] of urls.entries()) {
    try {
      let url: URL;
      try { url = new URL(rawUrl); } catch { throw new DownloadFailure("下载 URL 无效。"); }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new DownloadFailure("下载 URL 必须使用 HTTP(S)，且不得包含用户名或密码。");
      }
      const deadline = Date.now() + ASSET_BUDGET_MS;
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new DownloadFailure("下载与验证总时间预算已耗尽。");
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(TRANSFER_TIMEOUT_MS, remaining)), headers: { "Accept-Encoding": "identity" } });
          if (!response.ok) {
            await response.body?.cancel();
            throw new DownloadFailure(`下载返回 HTTP ${response.status}。`, response.status === 429 || response.status >= 500, retryAfter(response.headers.get("retry-after")));
          }
          const text = await response.text();
          if (!text.trim()) throw new DownloadFailure("下载文件为空。");
          try { JSON.parse(text); } catch { throw new DownloadFailure("下载结果不是有效的 JSON。"); }
          const partPath = join(directory, `.aihub-${randomUUID()}.partial`);
          try {
            await writeFile(partPath, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
            for (let suffix = 0; suffix < 3; suffix++) {
              const destination = join(directory, `${fileStem(url, index)}-${randomUUID()}.json`);
              try {
                await link(partPath, destination);
                const bytes = Buffer.byteLength(text, "utf8");
                result.files.push({ url: rawUrl, path: destination, bytes, mime_type: "application/json" });
                break;
              } catch (error) {
                if (errorCode(error) !== "EEXIST") throw error;
              }
            }
          } finally { await rm(partPath, { force: true }); }
          break;
        } catch (error) {
          const failure = classifyFailure(error);
          if (!failure.transient || attempt + 1 >= ATTEMPTS) throw failure;
          const delay = failure.retryAfterMs ?? Math.min(1_000 * 2 ** attempt, MAX_RETRY_AFTER_MS);
          if (Date.now() + delay >= deadline) throw failure;
          await new Promise<void>(resolveDelay => setTimeout(resolveDelay, delay));
        }
      }
    } catch (error) {
      result.failed.push({ url: rawUrl, error: error instanceof DownloadFailure ? error.message : "下载或文件验证失败，请检查输出目录权限及文件格式。" });
    }
  }
  return result;
}

/** Validate a locally created result with the same media checks used for downloads. */
export async function validateLocalMedia(path: string, media: DownloadMedia): Promise<DownloadedFile> {
  const info = await validateMedia(path, media, '', Date.now() + PROBE_TIMEOUT_MS);
  const stat = await import('node:fs/promises').then(fs => fs.stat(path));
  return { url: '', path, bytes: stat.size, mime_type: info.mime };
}

/** Each URL succeeds or fails independently; existing user files are never replaced. */
export async function downloadAssets(urls: string[], outputDir: string, media: DownloadMedia): Promise<DownloadResult> {
  if (media !== "document") await checkMediaTools();
  const result: DownloadResult = { files: [], failed: [] };
  const directory = resolve(outputDir);
  try { await mkdir(directory, { recursive: true }); } catch (error) { throw classifyFailure(error); }
  for (const [index, rawUrl] of urls.entries()) {
    try {
      let url: URL;
      try { url = new URL(rawUrl); } catch { throw new DownloadFailure("下载 URL 无效。"); }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new DownloadFailure("下载 URL 必须使用 HTTP(S)，且不得包含用户名或密码。");
      const deadline = Date.now() + ASSET_BUDGET_MS;
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        try {
          const file = await transfer(url, directory, media, index, deadline);
          // Recovery matches files against the exact URL stored in the task.
          // URL.href normalization must not make a saved result look missing.
          result.files.push({ ...file, url: rawUrl });
          break;
        }
        catch (error) {
          const failure = classifyFailure(error);
          const delay = failure.retryAfterMs ?? 1000 * 2 ** attempt;
          if (!failure.transient || attempt === ATTEMPTS - 1 || Date.now() + delay >= deadline) throw failure;
          process.stderr.write(`[aihub:download] 第 ${attempt + 2}/${ATTEMPTS} 次尝试，等待 ${delay / 1000}s：${failure.message}\n`);
          await new Promise<void>((done) => setTimeout(done, delay));
        }
      }
    } catch (error) { result.failed.push({ url: rawUrl, error: classifyFailure(error).message }); }
  }
  return result;
}
