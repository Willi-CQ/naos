// All mutations go through one route, POST /api/cmd (wire.ts). A failed call comes back as a value, never as a throw into a render.
import type { CommandMap, CommandResult, CommandType } from '@naos/protocol';

export async function command<K extends CommandType>(type: K, input: CommandMap[K]['in']): Promise<CommandResult<K>> {
  try {
    const res = await fetch('/api/cmd', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, ...input }),
    });
    return (await res.json()) as CommandResult<K>;
  } catch {
    return { ok: false, error: { code: 'unavailable', message: 'kernel not responding' } };
  }
}
