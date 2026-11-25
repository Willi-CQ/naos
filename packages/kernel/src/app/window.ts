// The app window: Edge or Chrome with --app, in a profile of its own, so the session cookie and history stay out of the user's
// normal browser. Without either, the default browser opens a plain tab. Nothing opens under the test runner, whatever is set.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { underTest } from '../config.ts';
import type { Logger } from '../context.ts';

const BROWSERS = ['Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe'];

export interface Launch {
  command: string;
  args: string[];
}

/** The fragment outlives the 302 at /auth, because a redirect without its own fragment keeps the one it came with. */
export const appUrl = (port: number, token: string, docket?: string | null): string =>
  `http://127.0.0.1:${port}/auth?token=${token}${docket ? `#docket=${docket}` : ''}`;

export const windowArgs = (url: string, home: string): string[] => [
  `--app=${url}`,
  `--user-data-dir=${path.join(home, 'app-profile')}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--start-maximized',
];

export function findAppBrowser(env: NodeJS.ProcessEnv, exists: (file: string) => boolean): string | null {
  const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter((root): root is string => Boolean(root));
  for (const browser of BROWSERS) {
    for (const root of roots) {
      const file = path.win32.join(root, browser);
      if (exists(file)) return file;
    }
  }
  return null;
}

const defaultBrowser = (url: string, platform: NodeJS.Platform): Launch => {
  if (platform === 'win32') return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  return platform === 'darwin' ? { command: 'open', args: [url] } : { command: 'xdg-open', args: [url] };
};

export function windowCommand(
  url: string,
  home: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): Launch {
  const args = windowArgs(url, home);
  const chosen = env.NAOS_APP_BROWSER;
  if (chosen) return /\.[cm]?js$/.test(chosen) ? { command: process.execPath, args: [chosen, ...args] } : { command: chosen, args };
  const found = platform === 'win32' ? findAppBrowser(env, exists) : null;
  return found ? { command: found, args } : defaultBrowser(url, platform);
}

/** No `windowsHide`: Node passes SW_HIDE, which a GUI program may apply to its first window. Detached has no console to hide. */
export function openWindow(url: string, home: string, log: Pick<Logger, 'warn'>): void {
  if (underTest()) return;
  const { command, args } = windowCommand(url, home);
  spawn(command, args, { detached: true, stdio: 'ignore' }).on('error', () => log.warn('the app window did not start', {})).unref();
}
