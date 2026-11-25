// The Veil, DESIGN 7.10. It acts here, in the selector layer, so no component ever holds a real name and none can leak one.
// Worlds become star names hashed from projectRoot with the per-install salt. Everything else private becomes structure.
import type { ApprovalView, ToolSummary, World, WorldId } from '@naos/protocol';

const STARS = [
  'acrux', 'adhara', 'albireo', 'alcor', 'aldebaran', 'algol', 'alioth', 'alkaid', 'almach', 'alnair', 'alnilam', 'alnitak', 'alphard',
  'alphecca', 'alpheratz', 'altair', 'ankaa', 'antares', 'arcturus', 'atria', 'avior', 'bellatrix', 'betelgeuse', 'canopus', 'capella',
  'castor', 'deneb', 'diphda', 'dubhe', 'elnath', 'eltanin', 'enif', 'fomalhaut', 'gacrux', 'hadar', 'hamal', 'kochab', 'markab', 'menkar',
  'merak', 'mimosa', 'mintaka', 'mirach', 'mirfak', 'mizar', 'nunki', 'peacock', 'phecda', 'polaris', 'pollux', 'procyon', 'rasalhague',
  'regulus', 'rigel', 'sabik', 'sadr', 'saiph', 'scheat', 'schedar', 'shaula', 'sirius', 'spica', 'suhail', 'tarazed', 'thuban', 'unukalhai',
  'vega', 'wezen', 'zubenelgenubi', 'zubeneschamali',
] as const;

/** FNV-1a. No crypto is needed: the salt only has to stop a name being looked up across installs. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable star name per world. Lower slots keep theirs, a collision walks to the next free star, and the Belt comes last so rubble never takes a repo's star. */
export function veilNames(worlds: readonly World[], salt: string): Map<WorldId, string> {
  const taken = new Set<string>();
  const out = new Map<WorldId, string>();
  const rank = (world: World): number => (world.kind === 'belt' ? Number.MAX_SAFE_INTEGER : world.slot);
  for (const world of [...worlds].sort((a, b) => rank(a) - rank(b) || (a.worldId < b.worldId ? -1 : 1))) {
    let at = hash32(`${salt}:${world.projectRoot ?? world.worldId}`) % STARS.length;
    while (taken.has(STARS[at]!) && taken.size < STARS.length) at = (at + 1) % STARS.length;
    const name = STARS[at]!;
    taken.add(name);
    out.set(world.worldId, name);
  }
  return out;
}

export const textShape = (kind: string, text: string): string => {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return `${kind}, ${words} ${words === 1 ? 'word' : 'words'}, ${text.length} chars`;
};

/** `2 words, 15 chars`. A title is private, its size is not. */
export const titleShape = (title: string | null): string => {
  if (!title) return 'no title';
  const words = title.trim().split(/\s+/).filter(Boolean).length;
  return `${words} ${words === 1 ? 'word' : 'words'}, ${title.length} ch`;
};

export const lineShape = (tool: string, text: string): string => {
  const lines = text.split('\n').length;
  return `${tool}, ${lines} ${lines === 1 ? 'line' : 'lines'}, ${text.length} chars`;
};

/** The row text of a tool call. `target` is sensitive, `shape` was built to be safe. */
export const toolTarget = (summary: ToolSummary, veil: boolean): string =>
  veil ? summary.shape : (summary.target ?? summary.shape);

/** An MCP tool name carries a server name, and that can be a private one. */
export const veilTool = (name: string, veil: boolean): string => (veil && name.startsWith('mcp__') ? 'MCP' : name);

const firstLine = (text: string): string => text.split('\n')[0]!.slice(0, 160);

const asText = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/** What a decision asks, in one line: the command, the file, the first line of a plan, or a question. */
export function approvalPreview(a: ApprovalView, veil: boolean): string {
  const input = a.input;
  const text = asText(input.command) ?? asText(input.file_path) ?? asText(input.notebook_path) ?? asText(input.plan)
    ?? asText((input.questions as Array<{ question?: unknown }> | undefined)?.[0]?.question) ?? asText(a.description);
  if (text === null) {
    const fields = Object.keys(input).length;
    return `${veilTool(a.toolName, veil)}, ${fields} ${fields === 1 ? 'field' : 'fields'}`;
  }
  return veil ? lineShape(veilTool(a.toolName, veil), text) : firstLine(text);
}
