import fs from "node:fs/promises";

// A single record may exceed the normal page budget; expansion remains bounded.
export const maxJsonlRecordBytes = 8 * 1024 * 1024;

export async function readJsonlWindow(file: string, options: { cursor?: number; before?: number; maxBytes: number; generation?: string }) {
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    const generation = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
    const reset = options.cursor !== undefined && (options.cursor > stat.size || (options.generation !== undefined && options.generation !== generation));
    let start = reset ? 0 : Math.max(0, options.cursor ?? 0);
    let end = Math.min(stat.size, Math.max(0, options.before ?? stat.size));
    const read = async (offset: number, length: number) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    };
    let buffer: Buffer;
    if (options.cursor !== undefined) {
      let length = Math.min(end - start, Math.max(1, options.maxBytes), maxJsonlRecordBytes);
      buffer = await read(start, length);
      while (buffer.indexOf(10) < 0 && start + buffer.length < end && length < maxJsonlRecordBytes) {
        length = Math.min(end - start, length * 2, maxJsonlRecordBytes);
        buffer = await read(start, length);
      }
      const complete = buffer.lastIndexOf(10) + 1;
      if (!complete && buffer.length >= maxJsonlRecordBytes) throw recordTooLarge();
      buffer = buffer.subarray(0, complete);
      end = start + complete;
    } else {
      // Include an entire first record even if it crosses the preferred window.
      let length = Math.min(end, Math.max(1, options.maxBytes), maxJsonlRecordBytes);
      buffer = await read(end - length, length);
      while (end - length > 0 && (buffer.indexOf(10) < 0 || buffer.indexOf(10) === buffer.lastIndexOf(10))) {
        if (length >= maxJsonlRecordBytes) throw recordTooLarge();
        length = Math.min(end, length * 2, maxJsonlRecordBytes);
        buffer = await read(end - length, length);
      }
      start = end - length;
      const first = start > 0 ? buffer.indexOf(10) + 1 : 0;
      const complete = buffer.lastIndexOf(10) + 1;
      end = start + complete;
      start += first;
      buffer = buffer.subarray(first, complete);
    }
    const records: { value: unknown; offset: number }[] = [];
    let offset = 0;
    while (offset < buffer.length) {
      const newline = buffer.indexOf(10, offset);
      if (newline < 0) break;
      if (newline - offset > maxJsonlRecordBytes) throw recordTooLarge();
      try {
        records.push({ value: JSON.parse(buffer.subarray(offset, newline).toString("utf8")), offset: start + offset });
      } catch {
        // A malformed complete record must not stall subsequent valid records.
      }
      offset = newline + 1;
    }
    return { records, cursor: end, windowStart: start, fileSize: stat.size, generation, reset, truncated: options.cursor !== undefined ? end < stat.size : start > 0 };
  } finally {
    await handle.close();
  }
}

function recordTooLarge() {
  return Object.assign(new Error("JSONL record exceeds the 8 MiB limit; resync required"), { code: "JSONL_RECORD_TOO_LARGE", statusCode: 413 });
}
