import { type PendingAttachment, type CodexMessage } from "../../app/types";

export async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export function composeMessageWithAttachments(text: string, attachments: PendingAttachment[]) {
  const body = text.trim();
  if (attachments.length === 0) return body;
  const attachmentBlock = ["已上传附件：", ...attachments.map((attachment) => `- ${attachment.fileName} | ${attachment.path}`)].join("\n");
  return [body, attachmentBlock].filter(Boolean).join("\n\n");
}

export function attachmentSummaryText(attachments: PendingAttachment[]) {
  if (attachments.length === 0) return "";
  if (attachments.length === 1) return `已上传 ${attachments[0].fileName}`;
  return `已上传 ${attachments.length} 个附件`;
}

export function parseMessageAttachments(message: CodexMessage) {
  const parsed: PendingAttachment[] = [];
  let text = message.text;
  const modernBlock = text.match(/(?:^|\n)已上传附件：\n((?:- .+(?:\n|$))+)\s*$/);
  if (modernBlock) {
    text = text.slice(0, modernBlock.index ?? 0).trim();
    for (const line of modernBlock[1].split(/\r?\n/)) {
      const attachment = attachmentFromModernLine(line);
      if (attachment) parsed.push(attachment);
    }
  }

  const remainingLines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const legacyPath = line.match(/^\s*已上传文件：(.+?)\s*$/)?.[1];
    if (legacyPath) {
      parsed.push(attachmentFromPath(legacyPath));
      continue;
    }
    remainingLines.push(line);
  }

  return {
    text: remainingLines.join("\n").trim(),
    attachments: mergeAttachments(parsed, message.attachments ?? []),
  };
}

export function attachmentFromModernLine(line: string): PendingAttachment | null {
  const body = line.replace(/^\s*-\s*/, "").trim();
  if (!body) return null;
  const separator = body.lastIndexOf(" | ");
  if (separator < 0) return attachmentFromPath(body);
  const fileName = body.slice(0, separator).trim();
  const path = body.slice(separator + 3).trim();
  return attachmentFromPath(path, fileName);
}

export function attachmentFromPath(path: string, fileName?: string): PendingAttachment {
  const cleanPath = path.replace(/^["'`]+|["'`]+$/g, "").trim();
  const resolvedName = fileName?.trim() || cleanPath.split(/[\\/]+/).filter(Boolean).pop() || "附件";
  return {
    id: `parsed-${cleanPath}-${resolvedName}`,
    fileName: resolvedName,
    path: cleanPath,
    relativePath: "",
    size: 0,
    createdAt: "",
    mimeType: mimeTypeFromName(resolvedName),
    previewUrl: null,
  };
}

export function mergeAttachments(parsed: PendingAttachment[], provided: PendingAttachment[]) {
  const byKey = new Map<string, PendingAttachment>();
  for (const attachment of [...parsed, ...provided]) {
    byKey.set(`${attachment.path}:${attachment.fileName}`, attachment);
  }
  return Array.from(byKey.values());
}

export function isImageFile(file: File) {
  return file.type.startsWith("image/") || isImageName(file.name);
}

export function isImageAttachment(attachment: PendingAttachment) {
  return attachment.mimeType.startsWith("image/") || isImageName(attachment.fileName) || isImageName(attachment.path);
}

export function isImageName(value: string) {
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i.test(value);
}

export function mimeTypeFromName(value: string) {
  if (/\.png$/i.test(value)) return "image/png";
  if (/\.jpe?g$/i.test(value)) return "image/jpeg";
  if (/\.gif$/i.test(value)) return "image/gif";
  if (/\.webp$/i.test(value)) return "image/webp";
  if (/\.heic$/i.test(value)) return "image/heic";
  if (/\.heif$/i.test(value)) return "image/heif";
  if (/\.avif$/i.test(value)) return "image/avif";
  return "application/octet-stream";
}

export function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "已上传";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 100 * 1024 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function revokeAttachmentPreviews(attachments: PendingAttachment[]) {
  for (const attachment of attachments) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }
}
