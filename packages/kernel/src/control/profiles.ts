// agents/*.md: a role, as Markdown with a little frontmatter. Claude writes these, so the format stays small and a bad file is
// a warning, never a crash. See agents/README.md.
import type { ProfileView } from '@naos/protocol';
import fs from 'node:fs';
import path from 'node:path';
import type { Bus, Logger } from '../context.ts';
import type { Profile } from './types.ts';

const MODES: ReadonlySet<string> = new Set(['default', 'plan', 'dontAsk', 'auto']);
const RELOAD_MS = 100; // One save fires several watch events.

export const DEFAULTS = { model: 'claude-haiku-5-5', effort: 'low', defaultBudgetUsd: 0.5 } as const;

type Value = string | number | boolean | null | string[];

const scalar = (raw: string): string | number | boolean | null => {
  const s = raw.trim();
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const quoted = /^(['"])(.*)\1$/.exec(s);
  return quoted ? quoted[2]! : s;
};

/** `key: value`, `key: [a, b]`, and `- item` lines under a bare key. Nothing else of YAML. */
export function parseFrontmatter(text: string): { fields: Record<string, Value>; body: string } | null {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return null;
  const fields: Record<string, Value> = {};
  const inline = new Set<string>();
  let listKey: string | null = null;
  for (const line of m[1]!.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const item = /^-\s+(.*)$/.exec(trimmed);
    if (item && listKey) {
      (fields[listKey] as string[]).push(String(scalar(item[1]!)));
      continue;
    }
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(trimmed);
    if (!kv) continue;
    const [, key, raw] = kv as unknown as [string, string, string];
    listKey = null;
    const list = /^\[(.*)\]$/.exec(raw.trim());
    if (list) {
      fields[key] = list[1]!.split(',').map((s) => String(scalar(s))).filter((s) => s !== 'null');
      inline.add(key);
    } else if (raw.trim() === '') {
      fields[key] = [];
      listKey = key;
    } else fields[key] = scalar(raw);
  }
  // A bare key with no `- item` under it is an empty value, not an empty list: `tools:` must not mean "no tools".
  for (const key of Object.keys(fields)) if (Array.isArray(fields[key]) && fields[key].length === 0 && !inline.has(key)) fields[key] = null;
  return { fields, body: text.slice(m[0].length).trim() };
}

export function parseProfile(text: string, source: string): { profile: Profile } | { error: string } {
  const parsed = parseFrontmatter(text);
  if (!parsed) return { error: 'no frontmatter' };
  const f = parsed.fields;
  const name = typeof f.name === 'string' ? f.name : path.basename(source, '.md');
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return { error: `bad name: ${name}` };
  const permissionMode = f.permissionMode ?? 'default';
  if (typeof permissionMode !== 'string' || !MODES.has(permissionMode)) return { error: `bad permissionMode: ${String(permissionMode)}` };
  const budget = f.defaultBudgetUsd ?? DEFAULTS.defaultBudgetUsd;
  if (typeof budget !== 'number' || budget <= 0) return { error: 'defaultBudgetUsd must be a positive number' };
  const tools = f.tools === null || f.tools === undefined ? null : Array.isArray(f.tools) ? f.tools : typeof f.tools === 'string' ? [f.tools] : undefined;
  if (tools === undefined) return { error: 'tools must be a list' };
  const maxTurns = f.maxTurns ?? null;
  if (maxTurns !== null && (typeof maxTurns !== 'number' || maxTurns < 1)) return { error: 'maxTurns must be a positive number' };
  if (f.settings !== undefined && f.settings !== 'none' && f.settings !== 'world') return { error: 'settings must be none or world' };
  return {
    profile: {
      name,
      description: typeof f.description === 'string' ? f.description : '',
      model: typeof f.model === 'string' ? f.model : DEFAULTS.model,
      effort: f.effort === null ? null : typeof f.effort === 'string' ? f.effort : DEFAULTS.effort,
      permissionMode: permissionMode as ProfileView['permissionMode'],
      defaultBudgetUsd: budget,
      worktree: f.worktree === true,
      tools,
      orchestrator: f.orchestrator === true,
      source,
      prompt: parsed.body,
      maxTurns,
      settings: f.settings === 'none' ? 'none' : 'world',
      persist: f.persist !== false,
    },
  };
}

export const toView = ({ prompt: _p, maxTurns: _m, settings: _s, persist: _r, ...view }: Profile): ProfileView => view;

export class Profiles {
  readonly #dir: string;
  readonly #bus: Pick<Bus, 'publish'>;
  readonly #log: Logger;
  #byName = new Map<string, Profile>();
  #bySource = new Map<string, Profile>();
  #watcher: fs.FSWatcher | null = null;
  #timer: NodeJS.Timeout | null = null;

  constructor(dir: string, bus: Pick<Bus, 'publish'>, log: Logger) {
    this.#dir = dir;
    this.#bus = bus;
    this.#log = log;
  }

  start(): void {
    this.reload();
    try {
      this.#watcher = fs.watch(this.#dir, () => this.#schedule());
      this.#watcher.unref();
      this.#watcher.on('error', (e) => this.#log.warn('control: agents/ watch failed', { error: String(e) }));
    } catch (e) {
      this.#log.warn('control: agents/ is not watched', { error: String(e) });
    }
  }

  #schedule(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.reload();
    }, RELOAD_MS);
    this.#timer.unref();
  }

  /** A file that stopped parsing keeps its last good version, so a half-saved edit cannot take a role away. */
  reload(): void {
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.#dir).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
    } catch { /* No agents folder: an empty list, launches report it. */ }
    const bySource = new Map<string, Profile>();
    for (const file of files) {
      const source = `agents/${file}`;
      let text: string;
      try {
        text = fs.readFileSync(path.join(this.#dir, file), 'utf8');
      } catch {
        continue;
      }
      const parsed = parseProfile(text, source);
      if ('error' in parsed) {
        this.#log.warn('control: profile ignored', { source, error: parsed.error });
        const previous = this.#bySource.get(source);
        if (previous) bySource.set(source, previous);
        continue;
      }
      bySource.set(source, parsed.profile);
    }
    const byName = new Map<string, Profile>();
    for (const profile of bySource.values()) {
      if (byName.has(profile.name)) this.#log.warn('control: duplicate profile name', { name: profile.name, source: profile.source });
      else byName.set(profile.name, profile);
    }
    this.#bySource = bySource;
    this.#byName = byName;
    this.#bus.publish({ type: 'profiles.changed', profiles: this.list() });
  }

  list(): ProfileView[] {
    return [...this.#byName.values()].map(toView);
  }

  get(name: string): Profile | undefined {
    return this.#byName.get(name);
  }

  stop(): void {
    this.#watcher?.close();
    this.#watcher = null;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
