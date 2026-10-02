import { inflateRawSync } from 'node:zlib';
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
/** Read bounded text entries in memory. Never extracts arbitrary archive paths to disk. */
function entries(bytes) {
    let eocd = -1;
    for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65_557); p--) {
        if (bytes.readUInt32LE(p) === 0x06054b50 && p + 22 + bytes.readUInt16LE(p + 20) === bytes.length) {
            eocd = p;
            break;
        }
    }
    if (eocd < 0 || bytes.readUInt16LE(eocd + 4) || bytes.readUInt16LE(eocd + 6))
        throw new Error('Unsupported ZIP directory.');
    const count = bytes.readUInt16LE(eocd + 10);
    let pos = bytes.readUInt32LE(eocd + 16);
    if (count > 512 || count === 0xffff)
        throw new Error('Archive exceeds review limits.');
    const result = new Map();
    let total = 0;
    for (let i = 0; i < count; i++) {
        if (pos + 46 > eocd || bytes.readUInt32LE(pos) !== 0x02014b50)
            throw new Error('Invalid ZIP directory.');
        const flags = bytes.readUInt16LE(pos + 8), method = bytes.readUInt16LE(pos + 10);
        const compressed = bytes.readUInt32LE(pos + 20), size = bytes.readUInt32LE(pos + 24);
        const nameLength = bytes.readUInt16LE(pos + 28), extra = bytes.readUInt16LE(pos + 30), comment = bytes.readUInt16LE(pos + 32);
        const offset = bytes.readUInt32LE(pos + 42);
        const next = pos + 46 + nameLength + extra + comment;
        if (next > eocd)
            throw new Error('Invalid ZIP entry.');
        const name = bytes.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
        pos = next;
        if (!/\.(md|txt|tex|docx)$/i.test(name) && name !== 'word/document.xml')
            continue;
        if (flags & 1 || ![0, 8].includes(method) || total + size > MAX_TEXT_BYTES || offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50)
            throw new Error('Unsupported or oversized review text entry.');
        const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
        if (start + compressed > bytes.length)
            throw new Error('Truncated ZIP entry.');
        const raw = bytes.subarray(start, start + compressed);
        const data = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: MAX_TEXT_BYTES });
        if (data.length !== size)
            throw new Error('ZIP text length mismatch.');
        total += size;
        result.set(name, data);
    }
    return result;
}
export function extractDocumentText(bytes) {
    if (bytes.length > 32 * 1024 * 1024)
        throw new Error('Document exceeds the review extraction limit.');
    const parts = [];
    let textBytes = 0;
    const append = (text) => {
        textBytes += Buffer.byteLength(text, 'utf8') + (parts.length ? 2 : 0);
        if (textBytes > MAX_TEXT_BYTES)
            throw new Error('Combined document text exceeds the review text limit.');
        parts.push(text);
    };
    for (const [name, data] of entries(bytes)) {
        if (/\.docx$/i.test(name)) {
            const xml = entries(data).get('word/document.xml');
            if (xml)
                append(xml.toString('utf8').replace(/<\/w:p>/g, '\n').replace(/<[^>]*>/g, '')
                    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        }
        else
            append(data.toString('utf8'));
    }
    if (!parts.length)
        throw new Error('Archive has no supported readable text.');
    return { text: parts.join('\n\n'), coverage: 'Extracted text only; page layout, embedded images, formatting and formula fidelity are not proven by text extraction.' };
}
