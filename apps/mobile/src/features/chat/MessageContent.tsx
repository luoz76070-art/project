import { Fragment, useMemo, type ReactNode } from "react";
import { MessageImage } from "./MessageImage";

function localFileName(destination: string) {
  // A file reference is display-only: never navigate or fetch its destination.
  if (!destination || /[\u0000-\u001f]/u.test(destination) || destination.startsWith("//")) return null;
  const windowsPath = /^[a-z]:[\\/]/iu.test(destination);
  if (/^[a-z][a-z\d+.-]*:/iu.test(destination) && !windowsPath && !/^file:/iu.test(destination)) return null;
  if (!windowsPath && !/^(?:file:|[./~\\])|[/\\]|\.[a-z\d]+(?:[:#].*)?$/iu.test(destination)) return null;
  let path = destination.replace(/^file:\/\//iu, "");
  try { path = decodeURIComponent(path); } catch { /* Keep malformed escapes as visible text. */ }
  return path.replace(/\\/gu, "/").replace(/(?:#L\d+(?:-L?\d+)?|:\d+(?::\d+)?)$/u, "").split("/").filter(Boolean).at(-1) || null;
}

function inline(text: string): ReactNode[] {
  // Bound inline matching work on unusually long or malformed Markdown lines.
  if (text.length > 8192) return [text];
  // Raw HTML is rendered as text. Delimiters must hug their text (GFM flanking), so `2 * 3 * 4`
  // stays literal. Odd split indexes are the captured inline tokens.
  return text.split(/(`[^`\n]+`|!\[[^\]\n]*\]\(\s*(?:<[^>\n]+>|(?:[^()\n]|\([^()\n]*\))+?)\s*\)|\*\*[^*\s](?:[^*\n]*[^*\s])?\*\*|~~[^~\s](?:[^~\n]*[^~\s])?~~|\*[^*\s](?:[^*\n]*[^*\s])?\*|\[[^\]\n]+\]\(\s*(?:<[^>\n]+>|(?:[^()\n]|\([^()\n]*\))+?)\s*\))/g).map((part, index) => {
    if (index % 2 === 0) return part;
    if (part.startsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    const image = /^!\[([^\]\n]*)\]\(\s*(.*?)\s*\)$/u.exec(part);
    if (image) return <MessageImage key={index} source={image[2]} alt={image[1]} />;
    if (part.startsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("~~")) return <del key={index}>{part.slice(2, -2)}</del>;
    if (part.startsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(\s*(.*?)\s*\)$/u.exec(part);
    if (!link) return part;
    const destination = link[2].replace(/^<|>$/gu, "");
    if (/^https?:\/\//iu.test(destination)) return <a key={index} href={destination} target="_blank" rel="noreferrer">{link[1]}</a>;
    const name = localFileName(destination);
    return name ? <span key={index} className="local-file-tag" title={destination}>{name}</span> : part;
  });
}

const fencePattern = /^(\s*)```(.*)$/;
const headingPattern = /^(#{1,6})[ \t]+(\S.*?)(?:[ \t]+#+)?[ \t]*$/;
const rulePattern = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const listPattern = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const quotePattern = /^ {0,3}>[ \t]?(.*)$/;
const separatorPattern = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
// Bounds for model output: wide tables scroll, deeper nesting is flattened.
const maxTableColumns = 24, maxListDepth = 4, maxQuoteDepth = 3;

function indentWidth(space: string) { return space.replace(/\t/gu, "    ").length; }
function listItem(line: string) { return rulePattern.test(line) ? null : listPattern.exec(line); }

// GFM row split: outer pipes are optional and `\|` stays a literal pipe.
function tableCells(line: string) {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < row.length; index++) {
    if (row[index] === "\\" && row[index + 1] === "|") { cell += "|"; index++; }
    else if (row[index] === "|") { cells.push(cell.trim()); cell = ""; }
    else cell += row[index];
  }
  cells.push(cell.trim());
  return cells;
}

function tableStart(lines: string[], index: number) {
  const next = lines[index + 1];
  return lines[index].includes("|") && next !== undefined && next.includes("|") && separatorPattern.test(next) && tableCells(lines[index]).length === tableCells(next).length;
}

function blockStart(lines: string[], index: number) {
  const line = lines[index];
  return fencePattern.test(line) || headingPattern.test(line) || rulePattern.test(line) || listPattern.test(line) || quotePattern.test(line) || tableStart(lines, index);
}

function textLines(lines: string[]) {
  return lines.map((part, index) => <Fragment key={index}>{index > 0 && <br />}{inline(part)}</Fragment>);
}

// GFM starts a new list when the bullet or the ordered delimiter changes.
type ListEntry = { indent: number; marker: string; number: number; lines: string[] };

function collectList(lines: string[], start: number) {
  const entries: ListEntry[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    const item = listItem(line);
    if (item) {
      entries.push({ indent: indentWidth(item[1]), marker: item[2].at(-1)!, number: Number.parseInt(item[2], 10) || 1, lines: [item[3]] });
      index++;
    } else if (!line.trim()) {
      // A blank line keeps the list open only for another item or an indented continuation.
      let ahead = index + 1;
      while (ahead < lines.length && !lines[ahead].trim()) ahead++;
      if (ahead >= lines.length || !(listItem(lines[ahead]) || /^\s{2,}\S/u.test(lines[ahead]))) break;
      index = ahead;
    } else if (blockStart(lines, index)) {
      break;
    } else {
      entries[entries.length - 1].lines.push(line.trim());
      index++;
    }
  }
  return { entries, next: index };
}

// Items indented at least two columns past their parent nest under it.
function listNode(entries: ListEntry[], start: number, key: string, depth: number): [ReactNode, number] {
  const { indent: base, marker, number } = entries[start];
  const ordered = marker === "." || marker === ")";
  const items: ReactNode[] = [];
  let index = start;
  while (index < entries.length) {
    const entry = entries[index];
    if (index > start && (entry.indent < base || entry.marker !== marker)) break;
    const itemKey = index++;
    const nested: ReactNode[] = [];
    while (depth < maxListDepth && index < entries.length && entries[index].indent >= base + 2) {
      const [node, next] = listNode(entries, index, `${key}-${index}`, depth + 1);
      nested.push(node);
      index = next;
    }
    items.push(<li key={itemKey}>{textLines(entry.lines)}{nested}</li>);
  }
  return [ordered ? <ol key={key} start={number === 1 ? undefined : number}>{items}</ol> : <ul key={key}>{items}</ul>, index];
}

function tableNode(lines: string[], start: number, key: string): [ReactNode, number] {
  const head = tableCells(lines[start]).slice(0, maxTableColumns);
  const align = tableCells(lines[start + 1]).map(cell => cell.endsWith(":") ? cell.startsWith(":") ? "align-center" : "align-right" : undefined);
  const rows: string[][] = [];
  let index = start + 2;
  while (index < lines.length && lines[index].trim() && lines[index].includes("|") && !fencePattern.test(lines[index]) && !headingPattern.test(lines[index]) && !quotePattern.test(lines[index])) rows.push(tableCells(lines[index++]));
  return [<div className="table-scroll" key={key}><table>
    <thead><tr>{head.map((cell, column) => <th key={column} className={align[column]}>{inline(cell)}</th>)}</tr></thead>
    {rows.length > 0 && <tbody>{rows.map((row, line) => <tr key={line}>{head.map((_, column) => <td key={column} className={align[column]}>{inline(row[column] ?? "")}</td>)}</tr>)}</tbody>}
  </table></div>, index];
}

function blocks(lines: string[], depth: number, prefix: string): ReactNode[] {
  const result: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const key = `${prefix}${index}`;
    const fence = fencePattern.exec(line);
    const heading = headingPattern.exec(line);
    if (fence) {
      const language = fence[2].trim();
      const indent = fence[1].length;
      const code: string[] = [];
      while (++index < lines.length && !/^\s*```/u.test(lines[index])) code.push(lines[index].replace(new RegExp(`^ {0,${indent}}`, "u"), ""));
      index++;
      result.push(<div className="code-block" key={key}>{language && <small>{language}</small>}<pre><code>{code.join("\n")}</code></pre></div>);
    } else if (heading) {
      result.push(heading[1].length <= 3 ? <h3 key={key}>{inline(heading[2])}</h3> : <h4 key={key}>{inline(heading[2])}</h4>); index++;
    } else if (rulePattern.test(line)) {
      result.push(<hr key={key} />); index++;
    } else if (listItem(line)) {
      const { entries, next } = collectList(lines, index);
      for (let start = 0; start < entries.length;) {
        const [node, after] = listNode(entries, start, `${key}-${start}`, 0);
        result.push(node);
        start = after;
      }
      index = next;
    } else if (quotePattern.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && quotePattern.test(lines[index])) quoted.push(quotePattern.exec(lines[index++])![1]);
      result.push(<blockquote key={key}>{depth < maxQuoteDepth ? blocks(quoted, depth + 1, `${key}-`) : <p>{textLines(quoted)}</p>}</blockquote>);
    } else if (tableStart(lines, index)) {
      const [node, next] = tableNode(lines, index, key);
      result.push(node);
      index = next;
    } else if (!line.trim()) { index++; }
    else {
      const paragraph: string[] = [line];
      while (++index < lines.length && lines[index].trim() && !blockStart(lines, index)) paragraph.push(lines[index]);
      result.push(<p key={key}>{textLines(paragraph)}</p>);
    }
  }
  return result;
}

export function MessageContent({ text }: { text: string }) {
  const content = useMemo(() => blocks(text.replace(/\r\n?/gu, "\n").split("\n"), 0, ""), [text]);
  return <div className="message-content">{content}</div>;
}
