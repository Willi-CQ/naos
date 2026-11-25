import { useState } from 'react';
import { parseMarkdown, type InlinePart, type MarkdownBlock } from '../../core/markdown.ts';

function Inline({ parts }: { parts: InlinePart[] }) {
  return <>{parts.map((part, index) => {
    if (part.kind === 'text') return <span key={index}>{part.text}</span>;
    if (part.kind === 'code') return <code key={index}>{part.text}</code>;
    if (part.kind === 'strong') return <strong key={index}>{part.text}</strong>;
    if (part.kind === 'em') return <em key={index}>{part.text}</em>;
    if (part.kind === 'del') return <del key={index}>{part.text}</del>;
    if (part.kind === 'link') return <a key={index} href={part.href} target="_blank" rel="noreferrer">{part.text}</a>;
    return null;
  })}</>;
}

function CodeBlock({ block }: { block: Extract<MarkdownBlock, { kind: 'code' }> }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(block.text); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }
    catch { setCopied(false); }
  };
  return <div className="message-code"><div><span>{block.language || 'CODE'}</span><button type="button" onClick={() => void copy()} aria-label="Copy code block">{copied ? 'Copied' : 'Copy'}</button></div><pre><code>{block.text}</code></pre></div>;
}

export function MessageBody({ text }: { text: string }) {
  return <div className="project-message-body">{parseMarkdown(text).map((block, index) => {
    if (block.kind === 'paragraph') return <p key={index}><Inline parts={block.parts}/></p>;
    if (block.kind === 'heading') return <div key={index} className="message-heading" data-level={block.level}><Inline parts={block.parts}/></div>;
    if (block.kind === 'quote') return <blockquote key={index}><Inline parts={block.parts}/></blockquote>;
    if (block.kind === 'rule') return <hr key={index}/>;
    if (block.kind === 'code') return <CodeBlock key={index} block={block}/>;
    if (block.kind === 'table') return <div key={index} className="message-table-wrap"><table><thead><tr>{block.header.map((parts, cell) => <th key={cell}><Inline parts={parts}/></th>)}</tr></thead><tbody>{block.rows.map((row, line) => <tr key={line}>{block.header.map((_, cell) => <td key={cell}><Inline parts={row[cell] ?? []}/></td>)}</tr>)}</tbody></table></div>;
    const Tag = block.ordered ? 'ol' : 'ul';
    return <Tag key={index}>{block.items.map((parts, item) => <li key={item}><Inline parts={parts}/></li>)}</Tag>;
  })}</div>;
}
