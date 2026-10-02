import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractDocumentText } from '../src/documentText.js';
const exec = promisify(execFile);

test('real ZIP/DOCX text extraction retains Chinese content and explicitly limits layout claims', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aihub-document-review-'));
  try {
    await mkdir(join(root, 'word'));
    await writeFile(join(root, 'word/document.xml'), '<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>中文需求 &amp; 公式</w:t></w:r></w:p></w:body></w:document>');
    // zip is a development fixture tool, never a Plugin runtime dependency.
    await exec('zip', ['-q', 'converted.docx', 'word/document.xml'], { cwd: root, timeout: 10_000 });
    await writeFile(join(root, 'converted.md'), '# 转换结果\n\n表格内容完整。\n');
    await exec('zip', ['-q', 'result.zip', 'converted.docx', 'converted.md'], { cwd: root, timeout: 10_000 });
    const extracted = extractDocumentText(await readFile(join(root, 'result.zip')));
    assert.match(extracted.text, /中文需求 & 公式/); assert.match(extracted.text, /表格内容完整/);
    assert.match(extracted.coverage, /layout.*not proven/);
    assert.throws(() => extractDocumentText(Buffer.from('PK\x03\x04broken archive')), /ZIP/);
    await writeFile(join(root, 'large.md'), 'x'.repeat(2 * 1024 * 1024 + 1));
    await exec('zip', ['-q', 'large.zip', 'large.md'], { cwd: root, timeout: 10_000 });
    const oversized = await readFile(join(root, 'large.zip'));
    assert.throws(() => extractDocumentText(oversized), /oversized/);
    await writeFile(join(root, 'word/document.xml'), `<w:p>${'x'.repeat(1024 * 1024 + 50)}</w:p>`);
    for (const name of ['first.docx', 'second.docx']) await exec('zip', ['-q', name, 'word/document.xml'], { cwd: root, timeout: 10_000 });
    await exec('zip', ['-q', 'nested.zip', 'first.docx', 'second.docx'], { cwd: root, timeout: 10_000 });
    const combined = await readFile(join(root, 'nested.zip'));
    assert.throws(() => extractDocumentText(combined), /Combined document text/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
