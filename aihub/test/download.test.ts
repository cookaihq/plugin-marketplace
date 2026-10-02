import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { checkMediaTools, downloadAssets, downloadJsonAssets } from "../src/download.js";

const runFile = promisify(execFile);
let root: string;
let server: Server;
let base: string;
const fixtures: Record<string, Buffer> = {};
const hits = new Map<string, number>();

before(async () => {
  await checkMediaTools();
  root = await mkdtemp(join(tmpdir(), "aihub-download-test-"));
  // Deterministic programs produce real media fixtures; no API/model is called.
  await runFile("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=16x16", "-frames:v", "1", join(root, "fixture.png")]);
  await runFile("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=16x16:r=10", "-t", "0.2", "-c:v", "mpeg4", join(root, "fixture.mp4")]);
  await runFile("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=8000", "-t", "0.1", join(root, "fixture.wav")]);
  for (const ext of ["png", "mp4", "wav"]) fixtures[ext] = await readFile(join(root, `fixture.${ext}`));
  server = createServer((request, response) => {
    const route = new URL(request.url!, "http://localhost").pathname;
    const count = (hits.get(route) ?? 0) + 1;
    hits.set(route, count);
    if (route === "/missing.png") {
      response.writeHead(404).end("token=do-not-print-this-response-body");
    } else if (route === "/retry.png" && count < 3 || route === "/unavailable.png") {
      response.writeHead(503, { "Retry-After": "0" }).end("do-not-print-upstream-errors");
    } else if (route === "/empty.png") {
      response.writeHead(200, { "Content-Type": "image/png", "Content-Length": 0 }).end();
    } else if (route === "/compressed.png") {
      const compressed = gzipSync(fixtures.png!);
      response.writeHead(200, { "Content-Type": "image/png", "Content-Encoding": "gzip", "Content-Length": compressed.length }).end(compressed);
    } else if (route === "/invalid.png") {
      response.writeHead(200, { "Content-Type": "image/png" }).end("<html>not an image</html>");
    } else if (route === "/broken.png") {
      response.writeHead(200, { "Content-Type": "image/png", "Content-Length": fixtures.png!.length + 100 });
      response.write(fixtures.png!.subarray(0, 8));
      setImmediate(() => response.destroy());
    } else if (route === "/playlist.mp4") {
      response.writeHead(200, { "Content-Type": "video/mp4" }).end(`#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${base}/never-request-this.ts\n#EXT-X-ENDLIST\n`);
    } else if (route === "/transcript.json") {
      const body = JSON.stringify({ transcripts: [{ text: "结构化转写结果" }] })!;
      response.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }).end(body);
    } else {
      const ext = route === "/clip.mp4" ? "mp4" : route === "/audio.wav" ? "wav" : "png";
      const body = fixtures[ext]!;
      // The advertised type and URL suffix must not override actual bytes.
      response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": body.length }).end(body);
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
  if (root) await rm(root, { recursive: true, force: true });
});

test("real images are validated, independently named, and do not overwrite user files", async () => {
  const directory = await mkdtemp(join(root, "collision-"));
  const prior = join(directory, "image.png");
  await writeFile(prior, "keep existing user file");
  const url = `${base}/image.png?caption=你好`;
  const [one, two] = await Promise.all([
    downloadAssets([url], directory, "image"), downloadAssets([url], directory, "image"),
  ]);
  assert.deepEqual(one.failed, []);
  assert.deepEqual(two.failed, []);
  assert.equal(one.files[0]!.mime_type, "image/png");
  assert.equal(one.files[0]!.url, url);
  assert.equal(one.files[0]!.bytes, fixtures.png!.length);
  assert.notEqual(one.files[0]!.path, two.files[0]!.path);
  assert.equal(await readFile(prior, "utf8"), "keep existing user file");
  assert.deepEqual(await readFile(one.files[0]!.path), fixtures.png);
  assert.equal((await readdir(directory)).filter((name) => name.endsWith(".partial")).length, 0);
});

test("one failed download preserves other results and does not expose remote response content", async () => {
  const directory = await mkdtemp(join(root, "partial-"));
  const result = await downloadAssets([`${base}/image.png`, `${base}/missing.png?token=never-show-token`, `${base}/another.png`], directory, "image");
  assert.equal(result.files.length, 2);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0]!.error, /404/);
  assert.doesNotMatch(result.failed[0]!.error, /never-show|do-not-print|http:/);
  assert.equal(hits.get("/missing.png"), 1);
  assert.equal((await readdir(directory)).length, 2);
});

test("transient HTTP errors use at most three attempts and obey Retry-After", async () => {
  const directory = await mkdtemp(join(root, "retry-"));
  const result = await downloadAssets([`${base}/retry.png`, `${base}/unavailable.png`], directory, "image");
  assert.equal(result.files.length, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(hits.get("/retry.png"), 3);
  assert.equal(hits.get("/unavailable.png"), 3);
  assert.equal((await readdir(directory)).length, 1);
});

test("empty and mislabeled non-media files never become delivered files", async () => {
  const directory = await mkdtemp(join(root, "invalid-"));
  const result = await downloadAssets([`${base}/empty.png`, `${base}/invalid.png`], directory, "image");
  assert.equal(result.files.length, 0);
  assert.equal(result.failed.length, 2);
  assert.match(result.failed[0]!.error, /为空/);
  assert.match(result.failed[1]!.error, /ffprobe/);
  assert.deepEqual(await readdir(directory), []);
});

test("compressed HTTP bodies compare media bytes without treating encoded Content-Length as decoded length", async () => {
  const directory = await mkdtemp(join(root, "compressed-"));
  const result = await downloadAssets([`${base}/compressed.png`], directory, "image");
  assert.deepEqual(result.failed, []);
  assert.equal(result.files[0]!.bytes, fixtures.png!.length);
  assert.deepEqual(await readFile(result.files[0]!.path), fixtures.png);
});

test("an interrupted response is retried with bounded attempts and leaves no partial file", async () => {
  const directory = await mkdtemp(join(root, "broken-"));
  const result = await downloadAssets([`${base}/broken.png`], directory, "image");
  assert.equal(result.files.length, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(hits.get("/broken.png"), 3);
  assert.deepEqual(await readdir(directory), []);
});

test("ffprobe video streams are distinguished from images and audio", async () => {
  const directory = await mkdtemp(join(root, "media-"));
  const video = await downloadAssets([`${base}/clip.mp4`, `${base}/actually-a-png.mp4`], directory, "video");
  assert.equal(video.files.length, 1);
  assert.equal(video.files[0]!.mime_type, "video/mp4");
  assert.equal(video.failed.length, 1);
  assert.match(video.failed[0]!.error, /类型.*不符/);
  const audio = await downloadAssets([`${base}/audio.wav`, `${base}/clip.mp4`], directory, "audio");
  assert.equal(audio.files.length, 1);
  assert.equal(audio.files[0]!.mime_type, "audio/wav");
  assert.equal(audio.failed.length, 1);
});

test("downloaded playlists cannot cause ffprobe to access referenced URLs", async () => {
  const directory = await mkdtemp(join(root, "playlist-"));
  const result = await downloadAssets([`${base}/playlist.mp4`], directory, "video");
  assert.equal(result.files.length, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(hits.get("/never-request-this.ts"), undefined);
  assert.deepEqual(await readdir(directory), []);
});

test("preflight executes ffprobe and provides an install command when unavailable", async () => {
  const moduleUrl = new URL("../src/download.js", import.meta.url).href;
  const script = `const { checkMediaTools } = await import(${JSON.stringify(moduleUrl)}); try { await checkMediaTools(); process.exitCode = 1; } catch (error) { console.log(error.message); }`;
  const { stdout } = await runFile(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, PATH: "" } });
  assert.match(stdout, /ffprobe.*无法运行/);
  assert.match(stdout, /brew install ffmpeg|apt-get install ffmpeg|winget install Gyan.FFmpeg/);
});

test("non-HTTP and credential-bearing URLs fail without echoing credentials", async () => {
  const directory = await mkdtemp(join(root, "urls-"));
  const result = await downloadAssets(["file:///etc/passwd", "https://private-user:private-password@example.test/image.png"], directory, "image");
  assert.equal(result.files.length, 0);
  assert.equal(result.failed.length, 2);
  for (const failure of result.failed) assert.doesNotMatch(failure.error, /private-user|private-password/);
  assert.deepEqual(await readdir(directory), []);
});

test("structured JSON results are saved without media probing", async () => {
  const directory = await mkdtemp(join(root, "structured-json-"));
  const result = await downloadJsonAssets([`${base}/transcript.json?signature=hidden`], directory);
  assert.deepEqual(result.failed, []);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0]!.mime_type, "application/json");
  assert.deepEqual(JSON.parse(await readFile(result.files[0]!.path, "utf8")), { transcripts: [{ text: "结构化转写结果" }] });
  assert.equal((await readdir(directory)).length, 1);
});
