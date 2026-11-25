import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { identityForRepo, type RepoIdentity } from '@naos/protocol';

function publicFile(root: string, name: string): string {
  let fd: number | undefined;
  try {
    const file = path.join(root, name);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return '';
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const bytes = Buffer.alloc(Math.min(size, 32_768));
    return bytes.toString('utf8', 0, readSync(fd, bytes, 0, bytes.length, 0));
  } catch { return ''; }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** Only this classification leaves the reader. No document text, scripts or dependencies enter the world snapshot. */
export function readRepoIdentity(root: string | null, name: string): RepoIdentity {
  if (!root) return identityForRepo(name);
  let description = '', topics: string[] = [];
  try {
    const pkg = JSON.parse(publicFile(root, 'package.json')) as Record<string, unknown>;
    description = typeof pkg.description === 'string' ? pkg.description : '';
    topics = Array.isArray(pkg.keywords) ? pkg.keywords.filter((v): v is string => typeof v === 'string') : [];
  } catch { /* A project need not be a JavaScript package. */ }
  const readme = publicFile(root, 'README.md') || publicFile(root, 'README');
  return identityForRepo(name, `${description}\n${readme.slice(0, 12000)}`, topics);
}
