// A Windows toast through PowerShell, DESIGN 3.7 and Appendix A. The route is [U]: nothing here has been seen on a real
// desktop, because tests may never raise one. Text reaches PowerShell through the environment, never through the command line.
import { spawn } from 'node:child_process';
import type { Logger } from '../context.ts';

/** PowerShell's own AUMID. An unpackaged script needs a registered id, and this one exists on every Windows install. */
const APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';
const TIMEOUT_MS = 15_000;

const SCRIPT = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($env:NAOS_TOAST_XML)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:NAOS_TOAST_APP).Show($toast)
`;

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export interface Toast {
  /** `kestrel β needs approval: Bash`. Never message text. */
  text: string;
  /** Opened on click. For a decision that is GET /open, which brings up the app window on it. */
  url: string;
}

export const toastXml = (toast: Toast): string =>
  `<toast activationType="protocol" launch="${escapeXml(toast.url)}"><visual><binding template="ToastGeneric">`
  + `<text>NAOS</text><text>${escapeXml(toast.text)}</text></binding></visual></toast>`;

/** Fire and forget. A toast that fails costs one log line and leaves the title and favicon channels working. */
export function raiseToast(toast: Toast, log: Logger): void {
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: TIMEOUT_MS,
    env: { ...process.env, NAOS_TOAST_XML: toastXml(toast), NAOS_TOAST_APP: APP_ID },
  });
  child.on('error', () => log.warn('toast failed to start', {}));
  child.on('exit', (code) => {
    if (code !== 0) log.warn('toast failed', { code });
  });
}
