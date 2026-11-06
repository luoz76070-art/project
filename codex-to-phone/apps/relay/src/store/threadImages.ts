import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const maxThreadImageBytes = 8 * 1024 * 1024;
function imageError(code: string, statusCode: number) {
  return Object.assign(new Error(code), { statusCode, code });
}
function imageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a$/u.test(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.toString("ascii", 4, 8) === "ftyp" && /^(avif|avis)$/u.test(bytes.toString("ascii", 8, 12))) return "image/avif";
  return null;
}

/** Only raster images inside this thread's real project directory are exposed. */
export async function readThreadImage(cwd: string, source: string) {
  let input = source;
  try {
    if (source.startsWith("file:")) input = fileURLToPath(source);
    else input = decodeURIComponent(source);
  } catch { throw imageError("image_path_invalid", 400); }
  if (input.includes("\0") || /^[a-z][a-z\d+.-]*:/iu.test(input)) throw imageError("image_path_invalid", 400);
  try {
    const root = await fs.realpath(cwd);
    const target = await fs.realpath(path.resolve(root, input));
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw imageError("image_outside_project", 403);
    const file = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw imageError("image_type_unsupported", 415);
      if (stat.size > maxThreadImageBytes) throw imageError("image_too_large", 413);
      // A bounded read also protects against growth after stat().
      const bytes = Buffer.alloc(Math.min(stat.size + 1, maxThreadImageBytes + 1));
      let length = 0;
      while (length < bytes.length) {
        const read = await file.read(bytes, length, bytes.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      if (length > maxThreadImageBytes || length > stat.size) throw imageError("image_too_large", 413);
      const content = bytes.subarray(0, length);
      const mimeType = imageMime(content);
      if (!mimeType) throw imageError("image_type_unsupported", 415);
      return { mimeType, size: length, dataUrl: `data:${mimeType};base64,${content.toString("base64")}` };
    } finally { await file.close(); }
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) throw error;
    throw imageError("image_not_found", 404);
  }
}
