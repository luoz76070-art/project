export type VoiceContextSource = { cwd?: string | null; title?: string; messages?: readonly { text: string }[] };

const basename = (value: string) => value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
const clean = (value: string) => value.normalize("NFKC").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
// Titles can themselves contain paths. Keep only their leaf names, and omit URLs.
function safeTitle(value: string) {
  return clean(value).replace(/https?:\/\/[^\s<>"'`，。；！？]+/gi, "")
    .replace(/[^\s<>"'`，。；！？]*[\\/][^\s<>"'`，。；！？]*/g, token => basename(token));
}

/** Only bounded names leave this function; no message bodies or full paths. */
export function buildAsrHints(source: VoiceContextSource): string[] {
  const hints: string[] = [], seen = new Set<string>();
  let remaining = 500;
  const add = (raw: string) => {
    const value = clean(raw), key = value.toLowerCase();
    if (!value || seen.has(key) || remaining <= 0) return false;
    seen.add(key);
    // Count UTF-16 units conservatively, but never split a surrogate pair.
    const room = remaining - (hints.length ? 1 : 0);
    let text = "";
    for (const char of value) { if (text.length + char.length > room) break; text += char; }
    if (!text) return false;
    hints.push(text); remaining -= text.length + (hints.length > 1 ? 1 : 0);
    return true;
  };
  add(basename(clean(source.cwd ?? "")));
  add(safeTitle(source.title ?? ""));
  let files = 0;
  // Use only the already-loaded 20 most recent messages, newest first.
  for (const message of (source.messages ?? []).slice(-20).reverse()) {
    const text = message.text.slice(0, 20_000).normalize("NFKC").replace(/https?:\/\/[^\s<>"'`，。；！？]+/gi, " ");
    const tokens = text.match(/[^\s<>"'`()[\]{},;!?，。；：！？、]+/g) ?? [];
    for (const token of tokens) {
      const file = basename(token).replace(/:\d+(?::\d+)?$/, "").replace(/[.,;!?]+$/, "");
      if (/^[\p{L}\p{N}_.@+-]+\.[a-zA-Z][a-zA-Z0-9]{0,15}$/u.test(file) && add(file)) files++;
      if (files >= 10 || remaining <= 0) return hints;
    }
  }
  return hints;
}
