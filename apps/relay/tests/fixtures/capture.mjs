import { deflateSync } from 'node:zlib';
import { pngCrc } from '../../dist/capture/image.js';
export function chunk(type, data) { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(pngCrc(b.subarray(4, -4)), b.length - 4); return b; }
export const exif = (orientation = 6) => { const b = Buffer.alloc(26); b.write('II'); b.writeUInt16LE(42, 2); b.writeUInt32LE(8, 4); b.writeUInt16LE(1, 8); b.writeUInt16LE(0x112, 10); b.writeUInt16LE(3, 12); b.writeUInt32LE(1, 14); b.writeUInt16LE(orientation, 18); return b; };
export function png(extra = [], width = 2, height = 1) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), ...extra, chunk('IDAT', deflateSync(Buffer.from([0,255,0,0,0,255,0]))), chunk('IEND', Buffer.alloc(0))]);
}
export function segment(marker, data) { const b = Buffer.alloc(4); b[0] = 255; b[1] = marker; b.writeUInt16BE(data.length + 2, 2); return Buffer.concat([b, data]); }
export const entropy = Buffer.from([0x42,0xff,0,0x21,0xff,0xd0,0x22]);
export function jpeg(extra = []) { return Buffer.concat([Buffer.from([255,216]), ...extra, segment(0xc0, Buffer.from([8,0,1,0,2,1,1,0x11,0])), segment(0xda, Buffer.from([1,1,0,0,63,0])), entropy, Buffer.from([255,217])]); }
export function riffChunk(type, data) { const b = Buffer.alloc(8 + data.length + (data.length % 2)); b.write(type); b.writeUInt32LE(data.length, 4); data.copy(b, 8); return b; }
export function webp(extra = [], flags = 0) { const x = Buffer.alloc(10); x[0] = flags; const image = riffChunk('VP8L', Buffer.from([0x2f,0,0,0,0,0x10])); const chunks = Buffer.concat([...(extra.length || flags ? [riffChunk('VP8X', x)] : []), image, ...extra]); const h = Buffer.alloc(12); h.write('RIFF'); h.writeUInt32LE(chunks.length + 4, 4); h.write('WEBP', 8); return Buffer.concat([h, chunks]); }
