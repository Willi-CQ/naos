// What one request shows and sends. Pure, so every tool's rendering rule (DESIGN 3.6) can be tested in Node. Input comes from a
// model that a tool result can steer, so nothing here treats it as trusted, and React escapes all of it.
import type { ApprovalView } from '@naos/protocol';

export type BodyKind = 'bash' | 'write' | 'edit' | 'plan' | 'question' | 'mcp' | 'other';

const DANGER_REASON = 'outside allowed working directories';

export const isDanger = (a: ApprovalView): boolean =>
  a.danger || a.defaultToNo || (a.decisionReason ?? '').includes(DANGER_REASON);

export function bodyKind(a: Pick<ApprovalView, 'toolName' | 'mcpServer'>): BodyKind {
  const name = a.toolName;
  if (name === 'Bash' || name === 'PowerShell') return 'bash';
  if (name === 'Write') return 'write';
  if (name === 'Edit') return 'edit';
  if (name === 'ExitPlanMode') return 'plan';
  if (name === 'AskUserQuestion') return 'question';
  if (a.mcpServer !== null || name.startsWith('mcp__')) return 'mcp';
  return 'other';
}

export const TOOL_VERB: Record<BodyKind, string> = {
  bash: 'wants to run', write: 'wants to write', edit: 'wants to edit', plan: 'has a plan to review', question: 'has a question', mcp: 'wants to call', other: 'wants to use',
};

export const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** `S` makes no sense for a plan or a question, and a danger card never offers it. */
export const canAlways = (a: ApprovalView): boolean => {
  const kind = bodyKind(a);
  return a.canRememberForSession && kind !== 'plan' && kind !== 'question' && !isDanger(a);
};

export const canAlwaysProject = (a: ApprovalView): boolean => {
  const kind = bodyKind(a);
  return a.canRememberForProject && kind !== 'plan' && kind !== 'question' && !isDanger(a);
};

export const canEdit = (a: ApprovalView): boolean => a.editable !== false && bodyKind(a) !== 'question' && !isDanger(a);

/** `O` opens wide for what reads better wide: a diff, a preview, a plan. */
export const canWiden = (a: ApprovalView): boolean => ['edit', 'write', 'plan'].includes(bodyKind(a));

/** `mcp__docs__search` is server `docs`, tool `search`. A server name can hold single underscores. */
export function mcpParts(toolName: string): { server: string; tool: string } {
  const m = /^mcp__(.+?)__(.+)$/.exec(toolName);
  return m ? { server: m[1]!, tool: m[2]! } : { server: '', tool: toolName };
}

const hidden = (c: number): boolean =>
  c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2060 && c <= 0x206f) || c === 0xfeff;

/** An untrusted server name can carry bidi overrides or line breaks to pose as something else, so each one shows as a code. */
export const escapeUntrusted = (name: string): string =>
  [...name].map((ch) => {
    const c = ch.codePointAt(0)!;
    return hidden(c) ? `\\u${c.toString(16).padStart(4, '0')}` : ch;
  }).join('').slice(0, 80);

export const serverTrusted = (server: ApprovalView['mcpServer']): boolean => server?.source === 'sdk';

export interface DiffLine { kind: 'same' | 'del' | 'add'; text: string }

const CONTEXT = 2;

/** Lines common to both ends stay as context and the middle shows as removed then added. No dependency: an Edit is a small hunk. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }
  const same = (lines: string[]): DiffLine[] => lines.map((line) => ({ kind: 'same', text: line }));
  return [
    ...same(a.slice(Math.max(0, start - CONTEXT), start)),
    ...a.slice(start, endA).map((line): DiffLine => ({ kind: 'del', text: line })),
    ...b.slice(start, endB).map((line): DiffLine => ({ kind: 'add', text: line })),
    ...same(a.slice(endA, endA + CONTEXT)),
  ];
}

export type MdBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'item'; marker: string; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'code'; text: string };

/** The Markdown a plan uses: headings, lists, paragraphs, code fences. Output is plain text blocks, so no HTML can come through. */
export function markdown(source: string): MdBlock[] {
  const out: MdBlock[] = [];
  const lines = source.split(/\r?\n/);
  let para: string[] = [];
  const flush = (): void => {
    if (para.length > 0) out.push({ kind: 'para', text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      for (i += 1; i < lines.length && !/^\s*```/.test(lines[i]!); i += 1) code.push(lines[i]!);
      out.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (heading) { flush(); out.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! }); }
    else if (item) { flush(); out.push({ kind: 'item', marker: /\d/.test(item[1]!) ? item[1]! : '-', text: item[2]! }); }
    else if (line.trim() === '') flush();
    else para.push(line.trim());
  }
  flush();
  return out;
}

export interface QuestionOption { label: string; description: string }
export interface Question { question: string; header: string; multi: boolean; options: QuestionOption[] }

/** A malformed form has no options to pick, and the card says so. It never throws in a render. */
export function questionsOf(input: Record<string, unknown>): Question[] {
  const raw = input.questions;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 4).flatMap((q: unknown) => {
    if (typeof q !== 'object' || q === null) return [];
    const row = q as Record<string, unknown>;
    const options = Array.isArray(row.options) ? row.options : [];
    return [{
      question: text(row.question),
      header: text(row.header),
      multi: row.multiSelect === true,
      options: options.slice(0, 4).flatMap((o: unknown) => {
        if (typeof o === 'string') return [{ label: o, description: '' }];
        if (typeof o !== 'object' || o === null) return [];
        const opt = o as Record<string, unknown>;
        return text(opt.label) ? [{ label: text(opt.label), description: text(opt.description) }] : [];
      }),
    }];
  });
}

export type Picks = Record<number, number[]>;

/** `1` to `4`: one option for a single choice, a toggle for a multi choice. */
export function pick(picks: Picks, question: Question, at: number, option: number): Picks {
  if (option >= question.options.length) return picks;
  const now = picks[at] ?? [];
  if (!question.multi) return { ...picks, [at]: [option] };
  return { ...picks, [at]: now.includes(option) ? now.filter((n) => n !== option) : [...now, option].sort((a, b) => a - b) };
}

/** The first question still without an answer takes the number keys, so the form fills top to bottom. */
export const activeQuestion = (questions: readonly Question[], picks: Picks): number => {
  const at = questions.findIndex((q, i) => (picks[i]?.length ?? 0) === 0);
  return at === -1 ? Math.max(0, questions.length - 1) : at;
};

export const allAnswered = (questions: readonly Question[], picks: Picks): boolean =>
  questions.length > 0 && questions.every((_, i) => (picks[i]?.length ?? 0) > 0);

/** `updatedInput: { questions, answers }`: the question text is the key, a multi choice joins with a comma. */
export function answersOf(questions: readonly Question[], picks: Picks): Record<string, string> {
  const out: Record<string, string> = {};
  questions.forEach((q, i) => {
    out[q.question] = (picks[i] ?? []).map((n) => q.options[n]!.label).join(', ');
  });
  return out;
}

export interface Editable { field: string | null; label: string; value: string }

/** What `E` edits. A tool with no obvious main field is edited as its whole JSON input. */
export function editableOf(a: ApprovalView): Editable {
  switch (bodyKind(a)) {
    case 'bash': return { field: 'command', label: 'command', value: text(a.input.command) };
    case 'edit': return { field: 'new_string', label: 'new text', value: text(a.input.new_string) };
    case 'write': return { field: 'content', label: 'file content', value: text(a.input.content) };
    case 'plan': return { field: 'plan', label: 'plan', value: text(a.input.plan) };
    default: return { field: null, label: 'input, JSON', value: JSON.stringify(a.input, null, 2) };
  }
}

/** The edited input, or null when the JSON does not parse. The rest of the input stays as the model sent it. */
export function applyEdit(a: ApprovalView, edit: Editable, value: string): Record<string, unknown> | null {
  if (edit.field !== null) return { ...a.input, [edit.field]: value };
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The first lines of a file, and how many more there are. */
export function previewOf(content: string, lines: number): { shown: string; more: number; total: number } {
  const all = content.split('\n');
  return { shown: all.slice(0, lines).join('\n'), more: Math.max(0, all.length - lines), total: all.length };
}

export const pretty = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '';
  }
};
