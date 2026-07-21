import fs from "node:fs/promises";
import path from "node:path";

export type UploadResult = {
  ok: true;
  fileName: string;
  originalName: string;
  path: string;
  relativePath: string;
  size: number;
  createdAt: string;
};

export class UploadStore {
  constructor(private readonly rootDir: string) {}

  getUploadDir(): string {
    return path.join(this.rootDir, "mobile-uploads");
  }

  async saveUpload(params: { fileName: string; dataBase64: string }): Promise<UploadResult> {
    const uploadDir = this.getUploadDir();
    await fs.mkdir(uploadDir, { recursive: true });

    const originalName = safeFileName(params.fileName);
    const timestamp = timestampForFileName(new Date());
    const fileName = `${timestamp}-${originalName}`;
    const target = path.join(uploadDir, fileName);
    const resolvedDir = path.resolve(uploadDir);
    const resolvedTarget = path.resolve(target);
    if (!resolvedTarget.startsWith(`${resolvedDir}${path.sep}`)) {
      throw new Error("upload-path-outside-root");
    }

    const buffer = Buffer.from(params.dataBase64, "base64");
    if (buffer.length === 0) throw new Error("upload-empty-file");
    if (buffer.length > 25 * 1024 * 1024) throw new Error("upload-too-large");

    await fs.writeFile(resolvedTarget, buffer, { flag: "wx" });
    return {
      ok: true,
      fileName,
      originalName,
      path: resolvedTarget,
      relativePath: path.relative(this.rootDir, resolvedTarget),
      size: buffer.length,
      createdAt: new Date().toISOString(),
    };
  }
}

function safeFileName(value: string): string {
  const trimmed = path.basename(value || "upload.bin").trim();
  const cleaned = trimmed.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").slice(0, 120);
  return cleaned || "upload.bin";
}

function timestampForFileName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}
