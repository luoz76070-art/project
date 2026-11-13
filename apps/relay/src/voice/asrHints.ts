// Official contracts: improve-asr-accuracy and qwen-asr-api-reference on help.aliyun.com.
const fixedWords = ["手机会话", "聊天会话", "Codex", "DeepSeek"];

export function asrHints(model: string, hints: readonly string[] = []) {
  const words = [...new Map([...fixedWords, ...hints].map(word => [word.toLowerCase(), word])).values()];
  if (model === "qwen3-asr-flash") {
    return { system: hints.length ? words.join("\n") : undefined, vocabulary: undefined };
  }
  if (model === "qwen-audio-3.1-asr-flash") {
    // Instant hotwords: non-ASCII <=15 characters, ASCII <=7 space-separated parts.
    const vocabulary = Object.fromEntries(words.map(word => [
      /[^\x20-\x7e]/.test(word) ? Array.from(word).slice(0, 15).join("") : word.split(/\s+/).slice(0, 7).join(" "), 1,
    ]));
    return { vocabulary, system: undefined };
  }
  // Unknown models must not inherit parameters from a different ASR protocol.
  return { vocabulary: undefined, system: undefined };
}
