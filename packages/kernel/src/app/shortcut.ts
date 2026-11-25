// NAOS.lnk. wscript has no console of its own, and its launcher runs node with a hidden window, so a click shows nothing but
// the app. A link straight to node.exe would show a console, and a minimised one still lands in Windows Terminal.
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { underTest } from '../config.ts';

const run = promisify(execFile);

export interface ShortcutSpec {
  target: string;
  args: string;
  workingDirectory: string;
  icon: string;
  description: string;
}

/** win32 paths on any host, because the link is read by Windows. A path on Windows cannot hold a quote, so quoting is enough. */
export function shortcutSpec(options: { nodePath: string; repoRoot: string; windowsDir: string }): ShortcutSpec {
  const join = path.win32.join;
  return {
    target: join(options.windowsDir, 'System32', 'wscript.exe'),
    args: `//nologo //E:jscript "${join(options.repoRoot, 'scripts', 'naos-launch.js')}" "${options.nodePath}"`,
    workingDirectory: options.repoRoot,
    icon: `${join(options.repoRoot, 'packages', 'ui', 'public', 'naos.ico')},0`,
    description: 'NAOS, every Claude on this machine',
  };
}

/** All values come through the environment, as in toast.ts, so a path is never parsed as script. */
const SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$dirs = if ($env:NAOS_LNK_DIRS) { $env:NAOS_LNK_DIRS -split '\\|' } else { @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop')) }
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in $dirs) {
  $file = Join-Path $dir 'NAOS.lnk'
  if ($env:NAOS_LNK_REMOVE) {
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file; Write-Output "removed $file" }
    continue
  }
  $link = $shell.CreateShortcut($file)
  $link.TargetPath = $env:NAOS_LNK_TARGET
  $link.Arguments = $env:NAOS_LNK_ARGS
  $link.WorkingDirectory = $env:NAOS_LNK_CWD
  $link.IconLocation = $env:NAOS_LNK_ICON
  $link.Description = $env:NAOS_LNK_DESCRIPTION
  $link.Save()
  Write-Output "created $file"
}
`;

export async function writeShortcuts(options: { spec: ShortcutSpec; dir?: string | undefined; remove: boolean }): Promise<string> {
  if (process.platform !== 'win32') throw new Error('shortcuts are Windows only');
  const { spec, dir, remove } = options;
  if (dir === undefined && underTest()) throw new Error('a test may not touch the real Start menu or Desktop');
  if (dir !== undefined && !remove) mkdirSync(dir, { recursive: true });
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      NAOS_LNK_DIRS: dir === undefined ? '' : path.resolve(dir),
      NAOS_LNK_REMOVE: remove ? '1' : '',
      NAOS_LNK_TARGET: spec.target,
      NAOS_LNK_ARGS: spec.args,
      NAOS_LNK_CWD: spec.workingDirectory,
      NAOS_LNK_ICON: spec.icon,
      NAOS_LNK_DESCRIPTION: spec.description,
    },
  });
  return stdout.trim();
}
