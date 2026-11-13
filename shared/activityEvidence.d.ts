/** One observation per current turn; no payloads and no persisted history. */
export type ActivityEvidence = {
  kind: "thinking" | "working" | "outputting";
  turnId: string;
  observedAt: string;
};
