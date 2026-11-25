// Structure of one tool call for the Channel. `target` is sensitive and goes through the Veil. `shape` is what the Veil
// shows instead, so it holds counts and the tool name, never a piece of the input.
import type { ToolSummary } from '@naos/protocol';
import { normalizePath } from './paths.ts';
import type { Raw } from './parse.ts';
import { str } from './parse.ts';

const TARGET_LIMIT = 160;

const cut = (s: string): string => (s.length > TARGET_LIMIT ? s.slice(0, TARGET_LIMIT) : s);

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

const lineCount = (s: string): number => {
  if (s.length === 0) return 0;
  let n = 1;
  for (let i = s.indexOf('\n'); i !== -1; i = s.indexOf('\n', i + 1)) n += 1;
  return s.endsWith('\n') ? n - 1 : n;
};

function firstLine(s: string): string {
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (t) return t;
  }
  return '';
}

function relative(p: string, cwd: string | null): string {
  const norm = normalizePath(p);
  if (!cwd) return norm;
  const base = normalizePath(cwd);
  return norm.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? norm.slice(base.length + 1) : norm;
}

const inputChars = (input: Raw): number => {
  try {
    return JSON.stringify(input)?.length ?? 0;
  } catch {
    return 0;
  }
};

export function summarizeTool(name: string, input: Raw, cwd: string | null): ToolSummary {
  const text = (key: string): string | null => str(input[key]);
  switch (name) {
    case 'Bash':
    case 'PowerShell':
    case 'Monitor': {
      const command = text('command') ?? '';
      return { target: command ? cut(firstLine(command)) : null, shape: `${name}, ${plural(lineCount(command), 'line')}, ${command.length} chars` };
    }
    case 'Read':
    case 'NotebookEdit': {
      const file = text('file_path') ?? text('notebook_path');
      return { target: file ? cut(relative(file, cwd)) : null, shape: `${name}, 1 file` };
    }
    case 'Write': {
      const file = text('file_path');
      const content = text('content') ?? '';
      return {
        target: file ? cut(relative(file, cwd)) : null,
        shape: `${name}, ${plural(lineCount(content), 'line')}, ${content.length} chars`,
        plus: lineCount(content),
      };
    }
    case 'Edit': {
      const file = text('file_path');
      const before = text('old_string') ?? '';
      const after = text('new_string') ?? '';
      return {
        target: file ? cut(relative(file, cwd)) : null,
        shape: `${name}, +${lineCount(after)} -${lineCount(before)}`,
        plus: lineCount(after),
        minus: lineCount(before),
      };
    }
    case 'Grep':
    case 'Glob': {
      const pattern = text('pattern');
      return { target: pattern ? cut(pattern) : null, shape: `${name}, ${pattern?.length ?? 0} chars` };
    }
    case 'WebFetch': {
      const url = text('url');
      return { target: url ? cut(url) : null, shape: `${name}, 1 url` };
    }
    case 'WebSearch':
    case 'ToolSearch': {
      const query = text('query');
      return { target: query ? cut(query) : null, shape: `${name}, ${query?.length ?? 0} chars` };
    }
    case 'Agent':
    case 'Task': {
      const description = text('description');
      return { target: description ? cut(description) : null, shape: `${name}, ${text('subagent_type') ? 'typed' : 'general'}` };
    }
    case 'Skill': {
      const skill = text('skill');
      return { target: skill ? cut(skill) : null, shape: `${name}, 1 skill` };
    }
    case 'SendMessage': {
      const to = text('to');
      return { target: to ? cut(to) : null, shape: `${name}, ${(text('message') ?? '').length} chars` };
    }
    default:
      return { target: null, shape: `${name}, ${inputChars(input)} chars` };
  }
}
