import { existsSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NativeClient } from '@naos/protocol';
import type { NativeExecutable } from './rpc.ts';

export function findNative(client: NativeClient, env: NodeJS.ProcessEnv = process.env): NativeExecutable | null {
  const explicit = env[client === 'codex' ? 'NAOS_CODEX_BIN' : 'NAOS_CURSOR_AGENT_BIN'];
  if (explicit) { try { return statSync(explicit).isFile() ? { file: path.resolve(explicit), args: [] } : null; } catch { return null; } }
  if (client === 'cursor') {
    const local = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../.naos/bin/cursor/dist-package');
    if (existsSync(path.join(local, 'node.exe')) && existsSync(path.join(local, 'index.js'))) return { file: path.join(local, 'node.exe'), args: [path.join(local, 'index.js')] };
  }
  const names = client === 'codex' ? ['codex'] : ['agent', 'cursor-agent'];
  const folders = [path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.cursor', 'bin'), path.join(os.homedir(), '.cursor-agent'), path.join(env.LOCALAPPDATA ?? os.homedir(), 'cursor-agent'), ...(env.PATH ?? '').split(path.delimiter)];
  const candidates: string[] = [];
  for (const folder of folders) for (const name of names) candidates.push(path.join(folder, process.platform === 'win32' ? `${name}.exe` : name));
  if (client === 'codex') {
    for (const editor of ['.cursor', '.vscode']) {
      const extensions = path.join(os.homedir(), editor, 'extensions');
      try { for (const name of readdirSync(extensions).filter((n) => n.startsWith('openai.chatgpt-')).sort().reverse().slice(0, 8)) candidates.push(path.join(extensions, name, 'bin', 'windows-x86_64', 'codex.exe')); } catch { /* no extension */ }
    }
    for (const folder of folders) {
      const script = path.join(folder, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (existsSync(script)) return { file: process.execPath, args: [script] };
    }
  }
  for (const file of candidates) { try { if (statSync(file).isFile()) return { file: path.resolve(file), args: [] }; } catch { /* not installed here */ } }
  return null;
}
