export function imageSource(source: string): { kind: "remote" | "local" | "invalid"; value: string } {
  const value = source.trim().replace(/^<|>$/gu, "");
  if (/^https:\/\//iu.test(value)) {
    try { const url = new URL(value); if (!url.username && !url.password) return { kind: "remote", value: url.href }; } catch { /* Render an actionable error below. */ }
    return { kind: "invalid", value };
  }
  if (/^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z\d+/=]+$/iu.test(value) && value.length <= 12 * 1024 * 1024) return { kind: "remote", value };
  if (!value || value.length > 4096 || value.includes("\0") || (/^[a-z][a-z\d+.-]*:/iu.test(value) && !value.startsWith("file:"))) return { kind: "invalid", value };
  return { kind: "local", value };
}
