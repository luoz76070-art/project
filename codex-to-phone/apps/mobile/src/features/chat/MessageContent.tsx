import { Fragment, useMemo, type ReactNode } from "react";

function inline(text: string): ReactNode[] {
  // Bound inline matching work on unusually long or malformed Markdown lines.
  if (text.length > 8192) return [text];
  // Raw HTML is rendered as text.
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g).map((part, index) => {
    if (part.startsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(part);
    return link ? <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a> : part;
  });
}

export function MessageContent({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const lines = text.split("\n");
    const result: ReactNode[] = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      const key = index;
      if (line.startsWith("```")) {
        const language = line.slice(3).trim();
        const code: string[] = [];
        while (++index < lines.length && !lines[index].startsWith("```")) code.push(lines[index]);
        index++;
        result.push(<div className="code-block" key={key}>{language && <small>{language}</small>}<pre><code>{code.join("\n")}</code></pre></div>);
      } else if (/^#{1,3} /.test(line)) {
        result.push(<h3 key={key}>{inline(line.replace(/^#{1,3} /, ""))}</h3>); index++;
      } else if (/^\s*([-*]|\d+\.) /.test(line)) {
        const items: ReactNode[] = [];
        const ordered = /^\s*\d+\./.test(line);
        while (index < lines.length && /^\s*([-*]|\d+\.) /.test(lines[index])) {
          items.push(<li key={index}>{inline(lines[index].replace(/^\s*([-*]|\d+\.) /, ""))}</li>); index++;
        }
        result.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      } else if (!line.trim()) { index++; }
      else {
        const paragraph: string[] = [line];
        while (++index < lines.length && lines[index].trim() && !/^(```|#{1,3} |\s*([-*]|\d+\.) )/.test(lines[index])) paragraph.push(lines[index]);
        result.push(<p key={key}>{paragraph.map((part, i) => <Fragment key={i}>{i > 0 && <br />}{inline(part)}</Fragment>)}</p>);
      }
    }
    return result;
  }, [text]);
  return <div className="message-content">{blocks}</div>;
}
