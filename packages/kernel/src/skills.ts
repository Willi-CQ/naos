import { lstat, open, readdir, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProjectSkill, ProjectSkillSource, SessionClient, SkillInstructions } from '@naos/protocol';

const MAX_SKILLS = 120;
const MAX_SKILL_BYTES = 96_000;
const FRONTMATTER_BYTES = 16_000;
const clean = (value: string, limit: number): string => value.replace(/[\0\r]/g, '').trim().slice(0, limit);
const unquote = (value: string): string => value.replace(/^(["'])(.*)\1$/, '$2').trim();

interface SkillFile { id: string; file: string; folder: string; scope: 'project' | 'user'; source: ProjectSkillSource; client: SessionClient | 'shared'; kind: 'skill' | 'command' }
interface SkillSourceDir { folder: string; scope: 'project' | 'user'; source: ProjectSkillSource; client: SessionClient | 'shared'; kind: 'skill' | 'command' }

function sources(root: string, home: string, env: NodeJS.ProcessEnv, trusted: boolean): SkillSourceDir[] {
  const project = trusted ? [
    { folder: path.join(root, '.agents', 'skills'), scope: 'project' as const, source: 'shared' as const, client: 'shared' as const, kind: 'skill' as const },
    { folder: path.join(root, '.codex', 'skills'), scope: 'project' as const, source: 'codex' as const, client: 'codex' as const, kind: 'skill' as const },
    { folder: path.join(root, '.claude', 'skills'), scope: 'project' as const, source: 'claude-code' as const, client: 'claude-code' as const, kind: 'skill' as const },
    { folder: path.join(root, '.claude', 'commands'), scope: 'project' as const, source: 'claude-code' as const, client: 'claude-code' as const, kind: 'command' as const },
    { folder: path.join(root, '.cursor', 'commands'), scope: 'project' as const, source: 'cursor' as const, client: 'cursor' as const, kind: 'command' as const },
  ] : [];
  const codexHome = path.resolve(env.CODEX_HOME || path.join(home, '.codex'));
  const personal = [
    { folder: path.join(home, '.agents', 'skills'), scope: 'user' as const, source: 'shared' as const, client: 'shared' as const, kind: 'skill' as const },
    { folder: path.join(codexHome, 'skills'), scope: 'user' as const, source: 'codex' as const, client: 'codex' as const, kind: 'skill' as const },
    { folder: path.join(home, '.claude', 'skills'), scope: 'user' as const, source: 'claude-code' as const, client: 'claude-code' as const, kind: 'skill' as const },
    { folder: path.join(home, '.claude', 'commands'), scope: 'user' as const, source: 'claude-code' as const, client: 'claude-code' as const, kind: 'command' as const },
  ];
  const seen = new Set<string>();
  return [...project, ...personal].filter((entry) => {
    const key = path.resolve(entry.folder).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function skillId(scope: SkillFile['scope'], source: ProjectSkillSource, kind: SkillFile['kind'], name: string): string {
  return `${scope}:${source}:${kind}:${encodeURIComponent(name)}`;
}

function parseMetadata(text: string, fallback: string): { name: string; description: string; body: string } {
  const normalized = text.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---')) return { name: fallback, description: firstDescription(normalized), body: normalized.trim() };
  const end = normalized.indexOf('\n---', 3);
  if (end < 0) return { name: fallback, description: firstDescription(normalized), body: normalized.trim() };
  const header = normalized.slice(3, end).split(/\r?\n/);
  const get = (key: string): string | null => {
    const line = header.find((row) => row.startsWith(`${key}:`));
    return line ? unquote(line.slice(key.length + 1)) : null;
  };
  return {
    name: clean(get('name') || fallback, 80),
    description: clean(get('description') || firstDescription(normalized.slice(end + 4)), 180),
    body: normalized.slice(end + 4).trim(),
  };
}

function firstDescription(value: string): string {
  return clean(value.split(/\r?\n/).map((line) => line.replace(/^#+\s*/, '').trim()).find(Boolean) ?? 'Reusable project workflow.', 180);
}

async function safeDirectory(folder: string): Promise<boolean> {
  try { return (await lstat(folder)).isDirectory(); } catch { return false; }
}

async function filesIn(root: string, kind: SkillFile['kind']): Promise<Array<{ name: string; folder: string; file: string }>> {
  if (!await safeDirectory(root)) return [];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const found: Array<{ name: string; folder: string; file: string }> = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      if (kind === 'skill' && entry.isDirectory()) {
        const folder = path.join(root, entry.name), file = path.join(folder, 'SKILL.md');
        try {
          if (!(await lstat(folder)).isDirectory()) continue;
          const manifest = await lstat(file);
          if (manifest.isFile() && manifest.size <= MAX_SKILL_BYTES) found.push({ name: entry.name, folder, file });
        } catch { /* Absent or unsafe skill manifests stay undiscoverable. */ }
      } else if (kind === 'command' && entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        found.push({ name: entry.name.slice(0, -3), folder: root, file: path.join(root, entry.name) });
      }
      if (found.length >= MAX_SKILLS) break;
    }
    return found;
  } catch { return []; }
}

async function enumerate(root: string, home: string, env: NodeJS.ProcessEnv, trusted: boolean): Promise<Array<{ ref: SkillFile; metadata: ProjectSkill }>> {
  const results: Array<{ ref: SkillFile; metadata: ProjectSkill }> = [];
  const projectRealRoot = trusted ? await realpath(root).catch(() => null) : null;
  for (const source of sources(root, home, env, trusted)) {
    for (const item of await filesIn(source.folder, source.kind)) {
      const id = skillId(source.scope, source.source, source.kind, item.name);
      const ref: SkillFile = { ...source, ...item, id };
      try {
        const manifest = await lstat(ref.file);
        if (!manifest.isFile() || manifest.size > MAX_SKILL_BYTES) continue;
        const descriptor = await open(ref.file, 'r');
        let text: string;
        try {
          const prefix = Buffer.alloc(Math.min(manifest.size, FRONTMATTER_BYTES));
          const { bytesRead } = await descriptor.read(prefix, 0, prefix.byteLength, 0);
          text = prefix.subarray(0, bytesRead).toString('utf8');
        } finally { await descriptor.close(); }
        const parsed = parseMetadata(text, item.name);
        const realFolder = await realpath(ref.folder), realFile = await realpath(ref.file);
        if (!realFile.startsWith(`${realFolder}${path.sep}`) && realFile !== realFolder) continue;
        if (ref.scope === 'project' && (!projectRealRoot || realFolder !== projectRealRoot && !realFolder.startsWith(`${projectRealRoot}${path.sep}`))) continue;
        results.push({ ref, metadata: { id, name: parsed.name, description: parsed.description, source: ref.source, scope: ref.scope, kind: ref.kind, client: ref.client, requiresTrust: ref.scope === 'project' && !trusted } });
      } catch { /* Races, permissions and malformed files do not break the picker. */ }
      if (results.length >= MAX_SKILLS) return results;
    }
  }
  return results;
}

export async function listProjectSkills(root: string, trusted: boolean, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): Promise<ProjectSkill[]> {
  const entries = await enumerate(root, home, env, trusted);
  const unique = new Map<string, ProjectSkill>();
  for (const entry of entries) if (!unique.has(entry.metadata.id)) unique.set(entry.metadata.id, entry.metadata);
  return [...unique.values()].sort((a, b) => Number(a.scope === 'project') - Number(b.scope === 'project') || a.name.localeCompare(b.name));
}

export async function readProjectSkill(root: string, trusted: boolean, id: string, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): Promise<SkillInstructions> {
  const entry = (await enumerate(root, home, env, trusted)).find((value) => value.metadata.id === id);
  if (!entry || entry.metadata.requiresTrust) throw new Error('That workflow is unavailable until the project is trusted.');
  const stat = await lstat(entry.ref.file);
  if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) throw new Error('That workflow is too large to load.');
  const content = await readFile(entry.ref.file, 'utf8');
  const end = content.startsWith('---') ? content.indexOf('\n---', 3) : -1;
  const body = content.slice(end >= 0 ? end + 4 : 0).trim();
  return { ...entry.metadata, instructions: body.slice(0, 40_000), truncated: body.length > 40_000 };
}
