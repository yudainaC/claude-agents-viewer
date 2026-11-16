import type { ReactNode } from "react";

// Rendu Markdown minimal et sûr (pas de HTML injecté) pour les réponses de Claude.

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith("`")) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**")) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else {
      const label = /^\[([^\]]+)\]/.exec(tok)![1];
      out.push(
        <a key={k} href={m[2]} target="_blank" rel="noreferrer">
          {label}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={k++} className="md-code" data-lang={lang || undefined}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (/^\s*[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*] /, ""));
      blocks.push(
        <ul key={k++}>
          {items.map((t, j) => (
            <li key={j}>{inline(t, j)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\s*\d+[.)] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)] /.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)] /, ""));
      blocks.push(
        <ol key={k++}>
          {items.map((t, j) => (
            <li key={j}>{inline(t, j)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    const h = /^(#{1,4}) (.*)$/.exec(line);
    if (h) {
      blocks.push(
        <p key={k++} className={`md-h md-h${h[1].length}`}>
          {inline(h[2])}
        </p>,
      );
      i++;
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4} |\s*[-*] |\s*\d+[.)] )/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++}>{inline(para.join("\n"))}</p>);
  }
  return <div className="md">{blocks}</div>;
}
