import { createHash } from "node:crypto";

type Receipt = { clientMessageId: string; state: "received" | "submitted" | "confirmed" | "unknown"; updatedAt: string };
type Entry = { fingerprint: string; receipt: Receipt; result: Promise<unknown>; expiresAt: number; settled: boolean };

/** Failed/uncertain submissions are retained too: retrying an ID never repeats work. */
export class SubmissionRegistry {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly limit = 1000, private readonly retentionMs = 24 * 60 * 60_000) {}

  receipt(id: string): Receipt | null {
    this.prune();
    return this.entries.get(id)?.receipt ?? null;
  }

  async execute<T extends object>(id: string | undefined, input: unknown, action: () => Promise<T>): Promise<T & { submission?: Receipt }> {
    if (!id) return action(); // Existing clients keep their original response contract.
    this.prune();
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const previous = this.entries.get(id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw Object.assign(new Error("clientMessageId reused with different content"), { statusCode: 409 });
      return previous.result as Promise<T & { submission: Receipt }>;
    }
    if (this.entries.size >= this.limit) throw Object.assign(new Error("Submission capacity reached; try later"), { statusCode: 503 });
    const receipt: Receipt = { clientMessageId: id, state: "received", updatedAt: new Date().toISOString() };
    const entry: Entry = { fingerprint, receipt, result: Promise.resolve(), expiresAt: Infinity, settled: false };
    entry.result = Promise.resolve().then(action).then((result) => {
      const outcome = result as { ok?: boolean; warning?: string; delivery?: "confirmed" | "submitted" | "uncertain" };
      receipt.state = outcome.delivery === "uncertain" || outcome.ok === false ? "unknown" : outcome.delivery === "submitted" || outcome.warning ? "submitted" : "confirmed";
      return { ...result, submission: { ...receipt, updatedAt: new Date().toISOString() } };
    }).catch((error) => {
      receipt.state = "unknown";
      throw error;
    }).finally(() => {
      receipt.updatedAt = new Date().toISOString();
      entry.settled = true;
      entry.expiresAt = Date.now() + this.retentionMs;
    });
    this.entries.set(id, entry);
    return entry.result as Promise<T & { submission: Receipt }>;
  }

  private prune() {
    for (const [id, entry] of this.entries) if (entry.settled && entry.expiresAt <= Date.now()) this.entries.delete(id);
  }
}
