// The launch line, DESIGN 3.8: `@world #profile $budget x2 moon prompt`. Directives are read only at the head of the line, so a prompt
// that mentions `$5` or `x2` keeps its words. On QWERTZ `@` needs AltGr, so a leading word that matches a world counts as `@world`.
import type { SpawnSpec } from '@naos/protocol';

export type TokenKind = 'world' | 'profile' | 'budget' | 'copies' | 'moon' | 'prompt' | 'unknown';

export interface Token { text: string; kind: TokenKind; start: number; end: number }

export interface Parsed {
  tokens: Token[];
  /** The canonical world name, or what was typed when no world has that name. */
  world: string | null;
  worldKnown: boolean;
  profile: string | null;
  profileKnown: boolean;
  budgetUsd: number | null;
  copies: number | null;
  moon: boolean;
  prompt: string;
}

export interface Vocabulary { worlds: readonly string[]; profiles: readonly string[] }

const canonical = (name: string, known: readonly string[]): string | undefined => {
  const lower = name.toLowerCase();
  return known.find((row) => row.toLowerCase() === lower);
};

/** The folder's spelling works too: `@benchmark-agent` is `Benchmark Agent`. */
const squash = (name: string): string => name.toLowerCase().replace(/[-_\s]+/g, '');

/** A world's name can hold spaces, so it is matched against the line and not against one word. The longest name wins. */
function worldAt(line: string, start: number, known: readonly string[]): { name: string; end: number } | null {
  const rest = line.slice(start).toLowerCase();
  let best: { name: string; end: number } | null = null;
  for (const name of known) {
    const after = rest[name.length];
    if (!rest.startsWith(name.toLowerCase()) || (after !== undefined && !/\s/.test(after))) continue;
    if (best === null || name.length > best.name.length) best = { name, end: start + name.length };
  }
  if (best !== null) return best;
  const word = /^\S+/.exec(rest)?.[0];
  const name = word === undefined ? undefined : known.find((row) => squash(row) === squash(word));
  return name === undefined || word === undefined ? null : { name, end: start + word.length };
}

const BUDGET = /^\$(\d+(?:\.\d{1,2})?)$/;
const COPIES = /^x(\d{1,3})$/i;

export function parseLaunch(line: string, words: Vocabulary): Parsed {
  const parsed: Parsed = { tokens: [], world: null, worldKnown: false, profile: null, profileKnown: false, budgetUsd: null, copies: null, moon: false, prompt: '' };
  const pattern = /\S+/g;
  let first = true;
  for (let m = pattern.exec(line); m !== null; m = pattern.exec(line)) {
    const raw = m[0];
    const span = { text: raw, start: m.index, end: m.index + raw.length };
    let kind: TokenKind | null = null;
    if (raw.startsWith('@') && raw.length > 1) {
      const known = worldAt(line, m.index + 1, words.worlds);
      parsed.world = known?.name ?? raw.slice(1);
      parsed.worldKnown = known !== null;
      kind = known === null ? 'unknown' : 'world';
      if (known !== null) {
        span.end = pattern.lastIndex = known.end;
        span.text = line.slice(span.start, known.end);
      }
    } else if (raw.startsWith('#') && raw.length > 1) {
      const known = canonical(raw.slice(1), words.profiles);
      parsed.profile = known ?? raw.slice(1);
      parsed.profileKnown = known !== undefined;
      kind = known === undefined ? 'unknown' : 'profile';
    } else if (BUDGET.test(raw)) {
      const usd = Number(BUDGET.exec(raw)![1]);
      if (usd > 0) { parsed.budgetUsd = usd; kind = 'budget'; } else kind = 'unknown';
    } else if (COPIES.test(raw)) {
      const n = Number(COPIES.exec(raw)![1]);
      if (n >= 1) { parsed.copies = n; kind = 'copies'; } else kind = 'unknown';
    } else if (raw.toLowerCase() === 'moon') {
      parsed.moon = true;
      kind = 'moon';
    } else if (first) {
      const known = worldAt(line, m.index, words.worlds);
      if (known !== null) {
        parsed.world = known.name;
        parsed.worldKnown = true;
        kind = 'world';
        span.end = pattern.lastIndex = known.end;
        span.text = line.slice(span.start, known.end);
      }
    }
    if (kind === null) {
      parsed.prompt = line.slice(m.index).trim();
      parsed.tokens.push({ ...span, end: line.length, text: line.slice(m.index), kind: 'prompt' });
      return parsed;
    }
    parsed.tokens.push({ ...span, kind });
    first = false;
  }
  return parsed;
}

export interface Head { world: string | null; profile: string | null; budgetUsd: number | null; copies: number | null; moon: boolean }

/** Editing a row writes the line again, so the line stays the one source of truth (3.8). */
export function composeLine(head: Head, prompt: string): string {
  const parts: string[] = [];
  if (head.world) parts.push(`@${head.world}`);
  if (head.profile) parts.push(`#${head.profile}`);
  if (head.budgetUsd !== null) parts.push(`$${head.budgetUsd}`);
  if (head.copies !== null && head.copies > 1) parts.push(`x${head.copies}`);
  if (head.moon) parts.push('moon');
  return parts.length === 0 ? prompt : `${parts.join(' ')} ${prompt}`;
}

export interface LaunchContext {
  world: { worldId: string; name: string; trusted: boolean } | null;
  /** Profile names with their worktree default. */
  profiles: ReadonlyArray<{ name: string; worktree: boolean; defaultBudgetUsd: number }>;
  mission: { treeBudgetUsd: number; childLimit: number; depth: number } | null;
  /** The row's own switch. null follows the line and the profile. */
  moonOverride: boolean | null;
}

/** `build` in a trusted repo, `recon` otherwise (3.8). A mission is always the orchestrator. */
export const defaultProfile = (trusted: boolean, mission: boolean): string => (mission ? 'orchestrator' : trusted ? 'build' : 'recon');

export interface Resolved {
  profile: string;
  budgetUsd: number | null;
  copies: number;
  moon: boolean;
  /** Plain words for what stops this line. null when it can go. */
  blocked: string | null;
}

export function resolve(parsed: Parsed, ctx: LaunchContext): Resolved {
  const profile = parsed.profile ?? defaultProfile(ctx.world?.trusted ?? false, ctx.mission !== null);
  const row = ctx.profiles.find((p) => p.name === profile);
  const moon = ctx.moonOverride ?? (parsed.moon || (row?.worktree ?? false));
  const copies = parsed.copies ?? 1;
  const budgetUsd = parsed.budgetUsd ?? row?.defaultBudgetUsd ?? null;
  let blocked: string | null = null;
  if (parsed.world !== null && !parsed.worldKnown) blocked = `No world is named ${parsed.world}.`;
  else if (ctx.world === null) blocked = 'Name a world with @world, or select one.';
  else if (parsed.profile !== null && !parsed.profileKnown) blocked = `No profile is named ${parsed.profile}.`;
  else if (row === undefined) blocked = `Profile ${profile} is not loaded.`;
  else if (parsed.prompt === '') blocked = 'Write a prompt.';
  return { profile, budgetUsd, copies, moon, blocked };
}

const TITLE_CHARS = 48;

/** The spec for preflight and spawn. A prompt goes as data, it is never put on a command line. */
export function specOf(parsed: Parsed, resolved: Resolved, ctx: LaunchContext, extra: Pick<SpawnSpec, 'mode' | 'queue' | 'idempotencyKey'> = {}): SpawnSpec {
  const spec: SpawnSpec = {
    profile: resolved.profile,
    prompt: parsed.prompt,
    copies: resolved.copies,
    worktree: resolved.moon,
    title: parsed.prompt.split('\n')[0]!.slice(0, TITLE_CHARS),
    ...extra,
  };
  if (ctx.world !== null) spec.worldId = ctx.world.worldId;
  if (resolved.budgetUsd !== null) spec.budgetUsd = resolved.budgetUsd;
  if (ctx.mission !== null) spec.mission = ctx.mission;
  return spec;
}

/** The same launch from a terminal. The prompt stays out of it, as in the sheet's wireframe. */
export function terminalLine(world: string | null, r: Resolved): string {
  const parts = ['naos launch'];
  if (world) parts.push(`--world ${/\s/.test(world) ? `"${world}"` : world}`);
  parts.push(`--profile ${r.profile}`);
  if (r.budgetUsd !== null) parts.push(`--budget ${r.budgetUsd}`);
  if (r.copies > 1) parts.push(`--copies ${r.copies}`);
  parts.push('"..."');
  return parts.join(' ');
}
