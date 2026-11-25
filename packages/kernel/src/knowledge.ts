import { lstat, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { KnowledgeGraph } from '@naos/protocol';
import { CommandError } from './context.ts';

const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', 'target', 'venv']);
const KNOWLEDGE = /^(\.?brain|knowledge|notes?|memory|wiki|docs?|research|concepts?)$/i;
const within = (root: string, file: string): boolean => { const p = path.relative(root, file); return p !== '..' && !p.startsWith(`..${path.sep}`) && !path.isAbsolute(p); };

/** Explicit, on-demand document graph. No bodies, credentials or absolute paths leave the kernel. */
export async function projectKnowledge(folder: string, limits = { files: 160, entries: 8000, bytes: 2_000_000, ms: 1800 }): Promise<KnowledgeGraph> {
  let root: string;
  try { if (!(await lstat(folder)).isDirectory()) throw new Error(); root = await realpath(folder); }
  catch { throw new CommandError('unavailable', 'This project folder is not available.'); }
  const graph: KnowledgeGraph = { nodes: [], edges: [], complete: true };
  const documents = new Map<string, string>();
  const deadline = Date.now() + limits.ms;
  let entries = 0, bytes = 0;
  const walk = async (dir: string, depth: number, knowledge: boolean): Promise<void> => {
    let stream;
    try { stream = await opendir(dir); } catch { graph.complete = false; return; }
    for await (const entry of stream) {
      if (++entries > limits.entries || graph.nodes.length >= limits.files || bytes >= limits.bytes || Date.now() > deadline) { graph.complete = false; break; }
      if (entry.isSymbolicLink() || SKIP.has(entry.name.toLowerCase()) || entry.name.startsWith('.') && entry.name !== '.brain') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 5) await walk(file, depth + 1, knowledge || KNOWLEDGE.test(entry.name));
        else graph.complete = false;
      } else if (entry.isFile() && /\.(md|mdx)$/i.test(entry.name) && (knowledge || depth === 0 && /^readme\.md$/i.test(entry.name))) {
        let handle;
        try {
          if (!within(root, await realpath(file))) continue;
          handle = await open(file, 'r');
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > 65536 || bytes + stat.size > limits.bytes) { graph.complete = false; continue; }
          const buffer = Buffer.alloc(Math.min(65536, stat.size));
          const read = await handle.read(buffer, 0, buffer.length, 0);
          bytes += read.bytesRead;
          const text = buffer.subarray(0, read.bytesRead).toString('utf8');
          const id = path.relative(root, file).replaceAll('\\', '/');
          const title = text.match(/^#\s+(.+)$/m)?.[1]?.replace(/[*_`]/g, '').trim().slice(0, 90) || entry.name.replace(/\.(md|mdx)$/i, '');
          graph.nodes.push({ id, title, folder: path.posix.dirname(id) }); documents.set(id, text);
        } catch { graph.complete = false; }
        finally { await handle?.close(); }
      }
    }
  };
  await walk(root, 0, false);
  const names = new Map<string, string[]>(), ids = new Map(graph.nodes.map((n) => [n.id.toLowerCase(), n.id]));
  for (const n of graph.nodes) {
    const name = path.posix.basename(n.id).replace(/\.(md|mdx)$/i, '').toLowerCase();
    names.set(name, [...names.get(name) ?? [], n.id]);
  }
  const edges = new Set<string>();
  for (const [id, body] of documents) {
    const prose = body.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*(?:\r?\n|$)/gm, '').replace(/`[^`\n]*`/g, '');
    const targets = prose.matchAll(/\[\[([^\[\]\n]{1,500})\]\]|\[[^\[\]\n]{0,500}\]\(([^)\s]{1,500})(?:\s+"[^"\n]{0,500}")?\)/g);
    for (const match of targets) {
      let target = (match[1] ?? match[2] ?? '').split('|')[0]!.split('#')[0]!;
      try { target = decodeURIComponent(target); } catch { continue; }
      if (!target || /^(?:[a-z]+:|\/|\\)/i.test(target)) continue;
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(id), target));
      if (relative === '..' || relative.startsWith('../')) continue;
      const possibilities = [relative, `${relative}.md`, `${relative}.mdx`];
      const byPath = possibilities.map((p) => ids.get(p.toLowerCase())).find(Boolean);
      const byName = match[1] ? names.get(path.posix.basename(target).replace(/\.(md|mdx)$/i, '').toLowerCase()) : undefined;
      const to = byPath ?? (byName?.length === 1 ? byName[0] : undefined);
      if (!to || to === id || edges.has(`${id}\0${to}`)) continue;
      graph.edges.push({ from: id, to, kind: 'link' }); edges.add(`${id}\0${to}`);
    }
  }
  return graph;
}
