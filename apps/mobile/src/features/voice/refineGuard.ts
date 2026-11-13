export type MissingVoiceDetail = { kind: "number" | "literal" | "negation"; text: string };
type Detail = MissingVoiceDetail & { key: string };

const digits: Record<string, string> = { 零: "0", 〇: "0", 一: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };
const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
// Bound token lengths to avoid quadratic regex scans on the 20,000-character input limit.
const atom = "[0-9零〇一二两三四五六七八九十百千万]{1,32}";
const fraction = "[0-9零〇一二两三四五六七八九]{1,32}";
const decimal = `[+-]?${atom}(?:[.点]${fraction})?`;
const normalize = (text: string) => text.normalize("NFKC").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const compact = (text: string) => normalize(text).toLowerCase().replace(/\s/g, "");

function integer(text: string): string {
  if (!/[十百千万]/.test(text)) return [...text].map(char => digits[char] ?? char).join("").replace(/^0+(?=\d)/, "");
  let total = 0, section = 0, value = 0, lastUnit = 1, explicitZero = false;
  for (const part of text.match(/[0-9]+|./g) ?? []) {
    const unit = units[part];
    if (!unit) { value = Number(digits[part] ?? part); if (value === 0) explicitZero = true; }
    else {
      if (unit === 10000) { total += (section + value || 1) * unit; section = 0; }
      else section += (value || 1) * unit;
      value = 0; lastUnit = unit; explicitZero = false;
    }
  }
  // Common abbreviated counts: 两百三 = 230, but 两百零三 = 203.
  if (value > 0 && value < 10 && lastUnit >= 100 && !explicitZero) value *= lastUnit / 10;
  return String(total + section + value);
}
function numberKey(text: string) {
  const sign = text.startsWith("-") ? "-" : "";
  const [whole, tail] = text.replace(/^[+-]/, "").split(/[.点]/);
  const decimals = tail ? [...tail].map(char => digits[char] ?? char).join("").replace(/0+$/, "") : "";
  const value = integer(whole) + (decimals ? `.${decimals}` : "");
  return (value === "0" ? "" : sign) + value;
}

/** Technical spans are masked so digits/not inside code do not create duplicate warnings. */
function literals(text: string) {
  const details: Detail[] = [];
  let rest = text;
  function take(pattern: RegExp, accept: (value: string) => boolean = () => true) {
    rest = rest.replace(pattern, value => {
      if (!accept(value)) return value;
      const display = value.startsWith("`") ? value.replace(/^`+|`+$/g, "")
        : value.replace(/[.,;:!?]+$/, "").replace(/(\.[a-z][a-z0-9]{0,15})[\u3400-\u9fff]+$/i, "$1");
      if (display.trim()) details.push({ kind: "literal", text: display, key: compact(display) });
      // Keep prose after an unquoted filename (src/a.ts不要发布) for the negation pass.
      const length = value.startsWith("`") ? value.length : display.length;
      return " ".repeat(length) + value.slice(length);
    });
  }
  take(/`[^`]+`/g);
  take(/\b(?:https?:\/\/|www\.)[^\s`<>"'，。；！？（）【】]+/gi);
  take(/(?<![a-z0-9_$@~.+%-])(?:[a-z]:)?[a-z0-9_$@~.+%-]*(?:[/\\][\p{L}\p{N}_$@~.+%-]+)+/giu, value => /[\p{L}_$~]/u.test(value));
  take(/(?:\b[a-z0-9_$@~-][a-z0-9_$@~.-]*|(?<![\w.]))\.[a-z][a-z0-9]{0,15}\b/gi);
  take(/[a-z_$][a-z0-9_$]*/gi, value => /[a-z][A-Z]/.test(value) || /[a-z0-9]_[a-z0-9]/i.test(value));
  return { details, rest };
}

function numbers(text: string, allowBareChinese = false): Detail[] {
  const details: Detail[] = [];
  let rest = text.toLowerCase();
  function take(pattern: string, key: (value: string, offset: number) => string | undefined) {
    rest = rest.replace(new RegExp(pattern, "g"), (value: string, offset: number) => {
      // Do not report a truncated piece of an unusually long or unsupported number.
      if (/[0-9零〇一二两三四五六七八九十百千万]/.test((rest[offset - 1] ?? "") + (rest[offset + value.length] ?? ""))) return value;
      const canonical = key(compact(value), offset);
      if (!canonical) return value;
      details.push({ kind: "number", text: value.trim(), key: canonical });
      return " ".repeat(value.length);
    });
  }
  const parts = (value: string) => (value.match(new RegExp(atom, "g")) ?? []).map(integer);
  take(`(?:[0-9]{4}\\s*[-/.]\\s*[0-9]{1,2}\\s*[-/.]\\s*[0-9]{1,2}|${atom}\\s*年\\s*${atom}\\s*月\\s*${atom}\\s*[日号]?)`, value => `date:${parts(value).join("-")}`);
  take(`(?:${atom}\\s*月\\s*${atom}\\s*[日号]|[0-9]{1,2}/[0-9]{1,2})`, value => `date:${parts(value).join("-")}`);
  take(`(?:百分之\\s*${decimal}|${decimal}\\s*%)`, value => `percent:${numberKey(value.replace(/^百分之|%$/g, ""))}`);
  take(`(?:${atom}\\s*:\\s*${atom}(?:\\s*:\\s*${atom})?|${atom}\\s*[点时]\\s*${atom}\\s*分(?:\\s*${atom}\\s*秒)?|${atom}[点时](?:[0-9]{2}|[零〇一二两三四五六七八九]?十[零〇一二两三四五六七八九]?)(?![0-9零〇一二两三四五六七八九十百千万秒])|${atom}[点时](?:整|(?![0-9零〇一二两三四五六七八九十百千万])))`, value => {
    const [hour, minute = "0", second = "0"] = parts(value);
    return `time:${hour}:${minute}:${second}`;
  });
  take(`${atom}(?:\\s*\\.\\s*${atom}){2,}`, value => `version:${parts(value).join(".")}`);
  take(decimal, (value, offset) => {
    // Bare Chinese numerals in ordinary words (一起/一下/万一) are not quantities.
    if (!/[0-9]/.test(value)) {
      const before = text.slice(0, offset), after = text.slice(offset + value.length);
      if (value.includes("万一") || (value === "千万" && /^(?:不要|别|注意|记住|小心|要)/.test(after))) return undefined;
      const context = /(?:第|百分之)\s*$/.test(before) || /^\s*(?:个|次|项|条|份|台|人|天|日|月|年|小时|分钟|秒钟|时|点|分|秒|元|块|倍|页|章|步|处|组|张|米|公里|公斤|字|行|套|本|岁|%)/.test(after);
      const standalone = (!before || /[\s,，、。;；:：!?！？(（\[【`'"]$/.test(before)) && (!after || /^[\s,，、。;；:：!?！？)）\]】`'"]/.test(after));
      if (!allowBareChinese && !context && !standalone) return undefined;
    }
    return `number:${numberKey(value)}`;
  });
  return details;
}

function literalTarget(text: string) {
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) positions.push(i);
  return { text, compact: compact(text), positions };
}
function literalPresent(target: ReturnType<typeof literalTarget>, detail: Detail) {
  // Ignore formatting spaces, but use the original boundaries to distinguish a.ts/a.tsx.
  for (let index = target.compact.indexOf(detail.key); index >= 0; index = target.compact.indexOf(detail.key, index + 1)) {
    const start = target.positions[index], end = target.positions[index + detail.key.length - 1] + 1;
    const suffix = target.text.slice(end);
    if (!/[a-z0-9_$]/i.test(target.text[start - 1] ?? "") && !/^(?:[a-z0-9_$/\\-]|\.[a-z0-9_])/i.test(suffix)) return true;
  }
  return false;
}

type Negation = { text: string; action: string };
function negations(text: string) {
  const source = text.toLowerCase().replace(/不得不|不能不|不但|不仅|不错|不妨|不一样|不同(?!意)|不论|不管|分别|区别|特别|告别|识别|级别|个别|类别|性别|差别|离别|鉴别|辨别|别名|别的|别人|别处/g, value => " ".repeat(value.length));
  const pattern = /不要|不准|不能|无需|没有|禁止|勿|别|不|\b(?:don't|do\s+not|not(?!\s+only\b)|never|without)\b/g;
  const markers = [...source.matchAll(pattern)];
  const hasNegation = new RegExp(pattern.source);
  const positive = source.replace(/[^,，。.;；!?！？]+/g, clause => {
    const start = clause.search(hasNegation);
    if (start < 0) return clause;
    // Passive prohibitions cover the preceding action; “deploy without tests” does not.
    const passive = /禁止|不允许|不准|\b(?:not|never)\s+(?:allowed|permitted|required|needed|necessary|possible|recommended|supported)\b/.test(clause);
    const maskFrom = passive ? 0 : start;
    return clause.slice(0, maskFrom) + " ".repeat(clause.length - maskFrom);
  });
  const phrases: Negation[] = [];
  for (let i = markers.length - 1; i >= 0; i--) {
    const marker = markers[i], start = marker.index;
    const end = markers[i + 1]?.index ?? source.length;
    const tail = source.slice(start + marker[0].length, end).split(/[,，。.;；!?！？]/)[0].trim();
    const phrase = source.slice(start, start + marker[0].length + source.slice(start + marker[0].length, end).indexOf(tail) + tail.length).trim();
    const actionText = tail.replace(/^(?:(?:再|去|进行|直接|自动|随意|立即|继续|擅自)\s*)+/, "");
    const action = actionText.match(/^[\u3400-\u9fff]{2}/)?.[0] ?? actionText.match(/[a-z][a-z0-9_-]*/)?.[0] ?? "";
    phrases.unshift({ text: phrase, action });
  }
  return { phrases, positive };
}
function missingNegations(original: string, refined: string): MissingVoiceDetail[] {
  const before = negations(original), after = negations(refined), remaining = [...after.phrases];
  const unmatched = before.phrases.filter(item => {
    const index = remaining.findIndex(other => item.action && item.action === other.action);
    if (index < 0) return true;
    remaining.splice(index, 1); return false;
  });
  const missing: MissingVoiceDetail[] = [];
  for (const item of unmatched) {
    // A retained action now stated positively is stronger evidence than total word count.
    const positive = item.action && (/^[a-z]/.test(item.action) ? new RegExp(`\\b${item.action}\\b`).test(after.positive) : after.positive.includes(item.action));
    if (!positive && remaining.length) remaining.pop(); // Unknown synonymous rewrite: prefer not to warn.
    else missing.push({ kind: "negation", text: item.text });
  }
  return missing;
}

/** Conservative lexical hints only; never rewrites text or decides whether it may be adopted. */
export function findMissingVoiceDetails(original: string, refined: string): MissingVoiceDetail[] {
  const source = normalize(original), target = normalize(refined);
  const before = literals(source);
  const targetLiterals = literalTarget(target.toLowerCase());
  // A detail preserved inside newly added Markdown/code formatting is still present.
  // Accept bare target numerals too (上限三 / 重试三遍); uncertainty should reduce warnings.
  const targetNumbers = new Set(numbers(target, true).map(item => item.key));
  const missing: MissingVoiceDetail[] = [
    ...numbers(before.rest).filter(item => !targetNumbers.has(item.key)),
    ...before.details.filter(item => !literalPresent(targetLiterals, item)),
    ...missingNegations(before.rest, target),
  ];
  const unique = new Set<string>();
  return missing.filter(item => {
    const key = `${item.kind}:${compact(item.text)}`;
    if (unique.has(key)) return false;
    unique.add(key); return true;
  }).map(({ kind, text }) => ({ kind, text }));
}
