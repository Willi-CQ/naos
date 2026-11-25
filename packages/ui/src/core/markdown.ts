export type InlinePart =
  | { kind: 'text' | 'code' | 'strong' | 'em' | 'del'; text: string }
  | { kind: 'link'; text: string; href: string };

export type MarkdownBlock =
  | { kind: 'paragraph'; parts: InlinePart[] }
  | { kind: 'heading'; level: number; parts: InlinePart[] }
  | { kind: 'quote'; parts: InlinePart[] }
  | { kind: 'list'; ordered: boolean; items: InlinePart[][] }
  | { kind: 'table'; header: InlinePart[][]; rows: InlinePart[][][] }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'rule' };

const INLINE = /(`+[^`\n]+`+|\[[^\]\n]+\]\((?:[^()\n]|\([^()\n]*\))+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_)/g;
const HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const LIST = /^\s*([-+*]|\d+[.)])\s+(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)?.*$/;
const isTableRule = (line: string): boolean => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
const cells = (line: string): string[] => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim().replace(/\\\|/g, '|'));

export function inlineMarkdown(value: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let at = 0;
  for (const match of value.matchAll(INLINE)) {
    const index = match.index!;
    if (index > at) parts.push({ kind: 'text', text: value.slice(at, index) });
    const token = match[0];
    if (token.startsWith('`')) parts.push({ kind: 'code', text: token.replace(/^`+|`+$/g, '') });
    else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\((.+)\)$/.exec(token)!;
      let href: string;
      try { href = new URL(link[2]!).protocol.match(/^https?:$/) ? link[2]! : ''; } catch { href = ''; }
      parts.push(href ? { kind: 'link', text: link[1]!, href } : { kind: 'text', text: link[1]! });
    } else if (token.startsWith('**') || token.startsWith('__')) parts.push({ kind: 'strong', text: token.slice(2, -2) });
    else if (token.startsWith('~~')) parts.push({ kind: 'del', text: token.slice(2, -2) });
    else if (token.startsWith('*') || token.startsWith('_')) parts.push({ kind: 'em', text: token.slice(1, -1) });
    at = index + token.length;
  }
  if (at < value.length) parts.push({ kind: 'text', text: value.slice(at) });
  return parts;
}

const isRule = (line: string): boolean => /^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);
const isBlockStart = (line: string, next?: string): boolean => FENCE.test(line) || HEADING.test(line) || LIST.test(line) || /^\s*>/.test(line) || isRule(line) || !!next && line.includes('|') && isTableRule(next);

export function parseMarkdown(value: string): MarkdownBlock[] {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i += 1; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const language = (fence[2] ?? '').slice(0, 32);
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[i]!)) code.push(lines[i++]!);
      if (i < lines.length) i += 1;
      blocks.push({ kind: 'code', language, text: code.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) { blocks.push({ kind: 'heading', level: heading[1]!.length, parts: inlineMarkdown(heading[2]!) }); i += 1; continue; }
    if (isRule(line)) { blocks.push({ kind: 'rule' }); i += 1; continue; }

    if (i + 1 < lines.length && line.includes('|') && isTableRule(lines[i + 1]!)) {
      const header = cells(line).map(inlineMarkdown), width = header.length, rows: InlinePart[][][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) {
        rows.push(cells(lines[i]!).slice(0, width).map(inlineMarkdown)); i += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      blocks.push({ kind: 'quote', parts: inlineMarkdown(quote.join(' ')) });
      continue;
    }

    const item = LIST.exec(line);
    if (item) {
      const ordered = /^\d/.test(item[1]!);
      const items: InlinePart[][] = [];
      while (i < lines.length) {
        const next = LIST.exec(lines[i]!);
        if (!next || /^\d/.test(next[1]!) !== ordered) break;
        items.push(inlineMarkdown(next[2]!)); i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const paragraph = [line]; i += 1;
    while (i < lines.length && lines[i]!.trim() && !isBlockStart(lines[i]!, lines[i + 1])) paragraph.push(lines[i++]!);
    blocks.push({ kind: 'paragraph', parts: inlineMarkdown(paragraph.join('\n')) });
  }
  return blocks;
}
