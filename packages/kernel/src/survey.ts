import { opendir, lstat } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectRegion, ProjectSurvey } from '@naos/protocol';
import { CommandError } from './context.ts';

const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', 'target', '__pycache__', 'venv', 'env']);
const LANGUAGES: Record<string, string> = { '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.css': 'CSS', '.scss': 'CSS', '.html': 'HTML', '.md': 'Markdown', '.sql': 'SQL', '.cs': 'C#', '.java': 'Java', '.cpp': 'C++', '.vue': 'Vue', '.svelte': 'Svelte' };

export function regionKind(name: string): ProjectRegion['kind'] {
  if (/test|spec|__tests__/i.test(name)) return 'tests';
  if (/docs?|notes?|wiki|research|brain|knowledge|memory/i.test(name)) return 'docs';
  if (/assets?|public|images?|media|textures?/i.test(name)) return 'assets';
  if (/ui|frontend|client|components?|views?|pages?|styles?|hud|scene/i.test(name)) return 'interface';
  if (/kernel|server|backend|api|services?|protocol/i.test(name)) return 'service';
  if (/config|scripts?|tools?|agents?/i.test(name)) return 'config';
  return 'source';
}

/** Bounded, asynchronous, name-only traversal. Links and hidden directories are never followed. */
export async function surveyProject(root: string, limits = { files: 6000, entries: 15000, depth: 6, ms: 2000 }): Promise<ProjectSurvey> {
  try { if (!(await lstat(root)).isDirectory()) throw new Error(); }
  catch { throw new CommandError('unavailable', 'This project folder is not available.'); }
  const regions = new Map<string, ProjectRegion>(), languages = new Map<string, number>();
  const result: ProjectSurvey = { regions: [], files: 0, languages: [], complete: true };
  const until = Date.now() + limits.ms;
  let entries = 0;
  const walk = async (dir: string, depth: number, regionPath: string): Promise<void> => {
    let directory;
    try { directory = await opendir(dir); }
    catch { result.complete = false; return; }
    for await (const entry of directory) {
      entries += 1;
      if (entries > limits.entries || result.files >= limits.files || Date.now() > until) { result.complete = false; break; }
      if (entry.name.startsWith('.') || SKIP.has(entry.name.toLowerCase()) || entry.isSymbolicLink()) continue;
      const relative = path.relative(root, path.join(dir, entry.name)).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        // Split workspaces into their packages; a source tree remains one region.
        const next = depth === 0 || (depth === 1 && /^(packages|apps|services)$/.test(regionPath)) ? relative : regionPath;
        if (depth >= limits.depth) { result.complete = false; continue; }
        await walk(path.join(dir, entry.name), depth + 1, next);
      } else if (entry.isFile()) {
        const key = regionPath || '.';
        let region = regions.get(key);
        if (!region) { region = { path: key, name: key === '.' ? 'Project base' : key.split('/').at(-1)!, kind: key === '.' ? 'config' : regionKind(key), files: 0, entries: [] }; regions.set(key, region); }
        region.files += 1;
        if (region.entries.length < 10) region.entries.push(relative);
        result.files += 1;
        const language = LANGUAGES[path.extname(entry.name).toLowerCase()];
        if (language) languages.set(language, (languages.get(language) ?? 0) + 1);
      }
    }
  };
  await walk(root, 0, '');
  result.regions = [...regions.values()].sort((a, b) => b.files - a.files || a.path.localeCompare(b.path));
  result.languages = [...languages].map(([name, files]) => ({ name, files })).sort((a, b) => b.files - a.files);
  return result;
}
