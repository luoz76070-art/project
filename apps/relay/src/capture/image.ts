/** Structural validation only. Encoded image data is never decoded or re-encoded. */
export const captureLimits = { imageBytes: 25 * 1024 * 1024, pixels: 40_000_000, edge: 16384,
  originals: 16, cardBytes: 100 * 1024 * 1024, storeBytes: 1024 * 1024 * 1024, assets: 32_000, previewEdge: 1600 } as const;
export const captureError = (code = 'capture_invalid_image', statusCode = 422) => Object.assign(new Error(code), { statusCode });
function requireImage(ok: unknown): asserts ok { if (!ok) throw captureError(); }
function dimensions(width: number, height: number) {
  if (!width || !height || width > captureLimits.edge || height > captureLimits.edge || width * height > captureLimits.pixels) throw captureError('capture_dimensions_exceeded', 413);
  return { width, height };
}
function exifOrientation(input: Buffer): number {
  const b = input.subarray(input.subarray(0, 6).equals(Buffer.from('Exif\0\0')) ? 6 : 0);
  requireImage(b.length >= 8);
  const little = b.toString('ascii', 0, 2) === 'II';
  requireImage(little || b.toString('ascii', 0, 2) === 'MM');
  const u16 = (i: number) => { requireImage(i >= 0 && i + 2 <= b.length); return little ? b.readUInt16LE(i) : b.readUInt16BE(i); };
  const u32 = (i: number) => { requireImage(i >= 0 && i + 4 <= b.length); return little ? b.readUInt32LE(i) : b.readUInt32BE(i); };
  requireImage(u16(2) === 42);
  const start = u32(4); requireImage(start >= 8);
  const count = u16(start); requireImage(start + 2 + count * 12 + 4 <= b.length);
  let orientation = 1, found = false;
  for (let i = 0; i < count; i++) {
    const p = start + 2 + i * 12;
    if (u16(p) !== 0x112) continue;
    requireImage(!found && u16(p + 2) === 3 && u32(p + 4) === 1);
    orientation = u16(p + 8); requireImage(orientation >= 1 && orientation <= 8); found = true;
  }
  return orientation;
}
function jpeg(b: Buffer) {
  const out: Buffer[] = [b.subarray(0, 2)]; let p = 2, width = 0, height = 0, orientation = 1, scan = false, ended = false, exif = false;
  while (p < b.length) {
    const start = p; requireImage(b[p++] === 0xff);
    while (b[p] === 0xff) p++;
    requireImage(p < b.length); const marker = b[p++];
    if (marker === 0xd9) { requireImage(scan && p === b.length); out.push(b.subarray(start, p)); ended = true; break; }
    requireImage(marker !== 0 && marker !== 0xd8 && !(marker >= 0xd0 && marker <= 0xd7) && marker !== 1);
    requireImage(p + 2 <= b.length); const length = b.readUInt16BE(p), end = p + length;
    requireImage(length >= 2 && end <= b.length); const data = b.subarray(p + 2, end);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      requireImage([0xc0, 0xc1, 0xc2].includes(marker) && !width && !scan && data.length >= 6);
      requireImage(data[0] === 8 && data[5] >= 1 && data[5] <= 4 && data.length === 6 + 3 * data[5]);
      ({ width, height } = dimensions(data.readUInt16BE(3), data.readUInt16BE(1)));
    }
    const isExif = marker === 0xe1 && data.subarray(0, 6).equals(Buffer.from('Exif\0\0'));
    const isXmp = marker === 0xe1 && (data.subarray(0, 29).toString('ascii') === 'http://ns.adobe.com/xap/1.0/\0' || data.subarray(0, 35).toString('ascii') === 'http://ns.adobe.com/xmp/extension/\0');
    if (isExif) { requireImage(!exif); orientation = exifOrientation(data); exif = true; }
    if (!isExif && !isXmp && marker !== 0xed) out.push(b.subarray(start, end));
    p = end;
    if (marker === 0xda) {
      requireImage(width && data.length >= 6 && data[0] >= 1 && data[0] <= 4 && data.length === 4 + 2 * data[0]);
      scan = true; const entropy = p;
      while (p < b.length) {
        if (b[p] !== 0xff) { p++; continue; }
        let next = p + 1; while (b[next] === 0xff) next++;
        requireImage(next < b.length);
        if (b[next] === 0 || (b[next] >= 0xd0 && b[next] <= 0xd7)) { p = next + 1; continue; }
        break;
      }
      requireImage(p > entropy); out.push(b.subarray(entropy, p));
    }
  }
  requireImage(ended && width && scan);
  return { data: Buffer.concat(out), width, height, orientation, mimeType: 'image/jpeg' as const };
}
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
export function pngCrc(b: Buffer): number { let n = 0xffffffff; for (const byte of b) n = crcTable[(n ^ byte) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; }
function png(b: Buffer) {
  const out: Buffer[] = [b.subarray(0, 8)]; let p = 8, width = 0, height = 0, orientation = 1, idat = 0, seenIdat = false, ended = false, palette = false, dataEnded = false, exif = false, color = -1;
  while (p < b.length) {
    requireImage(p + 12 <= b.length); const size = b.readUInt32BE(p), end = p + size + 12;
    requireImage(end <= b.length); const type = b.toString('ascii', p + 4, p + 8), data = b.subarray(p + 8, end - 4);
    requireImage(/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type) && pngCrc(b.subarray(p + 4, end - 4)) === b.readUInt32BE(end - 4));
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw captureError('capture_animation_unsupported');
    requireImage(width || type === 'IHDR');
    if (type === 'IHDR') {
      requireImage(p === 8 && size === 13); color = data[9];
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      requireImage(depths[color]?.includes(data[8]) && data[10] === 0 && data[11] === 0 && data[12] <= 1);
      ({ width, height } = dimensions(data.readUInt32BE(0), data.readUInt32BE(4)));
    } else if (type === 'PLTE') { requireImage(!palette && !seenIdat && ![0, 4].includes(color) && size > 0 && size <= 768 && size % 3 === 0); palette = true; }
    else if (type === 'IDAT') { requireImage(!dataEnded && (color !== 3 || palette)); seenIdat = true; idat += size; }
    else if (type === 'IEND') { requireImage(size === 0 && idat > 0 && end === b.length); ended = true; }
    else { requireImage(type[0] === type[0].toLowerCase()); if (seenIdat) dataEnded = true; }
    if (type === 'eXIf') { requireImage(!exif); orientation = exifOrientation(data); exif = true; }
    if (!['eXIf', 'tEXt', 'iTXt', 'zTXt'].includes(type)) out.push(b.subarray(p, end));
    p = end;
  }
  requireImage(ended);
  return { data: Buffer.concat(out), width, height, orientation, mimeType: 'image/png' as const };
}
function webp(b: Buffer) {
  requireImage(b.length >= 20 && b.readUInt32LE(4) + 8 === b.length);
  const out: Buffer[] = []; let p = 12, width = 0, height = 0, canvas: { width: number; height: number } | undefined, orientation = 1, exif = false, xmp = false, alpha = false, flags = 0;
  while (p < b.length) {
    requireImage(p + 8 <= b.length); const type = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4), end = p + 8 + size + (size % 2);
    requireImage(end <= b.length && (!(size % 2) || b[end - 1] === 0)); const data = b.subarray(p + 8, p + 8 + size);
    if (type === 'ANIM' || type === 'ANMF') throw captureError('capture_animation_unsupported');
    if (type === 'VP8X') {
      requireImage(p === 12 && size === 10 && !(data[0] & 0xc1) && data.readUIntLE(1, 3) === 0);
      flags = data[0]; if (flags & 2) throw captureError('capture_animation_unsupported');
      canvas = dimensions(data.readUIntLE(4, 3) + 1, data.readUIntLE(7, 3) + 1);
      const chunk = Buffer.from(b.subarray(p, end)); chunk[8] &= ~0x0c; out.push(chunk);
    } else if (type === 'VP8 ' || type === 'VP8L') {
      requireImage(!width);
      if (type === 'VP8 ') {
        requireImage(size > 10 && !(data[0] & 1) && ((data[0] >> 1) & 7) <= 3 && (data[0] & 16) && data.subarray(3, 6).equals(Buffer.from([0x9d, 1, 0x2a])));
        requireImage((data.readUIntLE(0, 3) >>> 5) <= size - 10);
        ({ width, height } = dimensions(data.readUInt16LE(6) & 0x3fff, data.readUInt16LE(8) & 0x3fff));
      } else {
        requireImage(size > 5 && data[0] === 0x2f); const bits = data.readUInt32LE(1); requireImage((bits >>> 29) === 0 && !alpha);
        ({ width, height } = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1));
      }
      out.push(b.subarray(p, end));
    } else if (type === 'EXIF') { requireImage(canvas && !exif); orientation = exifOrientation(data); exif = true; }
    else if (type === 'XMP ') { requireImage(canvas && !xmp); xmp = true; }
    else {
      requireImage(canvas);
      if (type === 'ALPH') { requireImage(!width && !alpha && size > 1 && !(data[0] & 0xc0)); alpha = true; }
      out.push(b.subarray(p, end));
    }
    p = end;
  }
  requireImage(width && (!canvas || (canvas.width === width && canvas.height === height)) && Boolean(flags & 8) === exif && Boolean(flags & 4) === xmp);
  const body = Buffer.concat(out), header = Buffer.from(b.subarray(0, 12)); header.writeUInt32LE(body.length + 4, 4);
  return { data: Buffer.concat([header, body]), width, height, orientation, mimeType: 'image/webp' as const };
}
export function sanitizeCaptureImage(b: Buffer, mimeType: string) {
  if (!b.length || b.length > captureLimits.imageBytes) throw captureError('capture_image_too_large', 413);
  const result = b[0] === 0xff && b[1] === 0xd8 ? jpeg(b)
    : b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? png(b)
    : b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' ? webp(b) : null;
  if (!result || result.mimeType !== mimeType) throw captureError('capture_format_unsupported');
  return result;
}
