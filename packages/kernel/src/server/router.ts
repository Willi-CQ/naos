// The one place a command runs. Scope is decided here, from the contract's table, before any handler is reached.
import { COMMAND_SCOPES } from '@naos/protocol';
import type { AuthScope, Command, CommandErrorCode, CommandResult, CommandType } from '@naos/protocol';
import { CommandError } from '../context.ts';
import type { CommandHandler, Logger, Router } from '../context.ts';

export interface KernelRouter extends Router {
  dispatch(body: unknown, scope: AuthScope): Promise<CommandResult>;
  has(type: CommandType): boolean;
  /** Runs after a command succeeded. The server uses it to learn who watches text. */
  afterSuccess(fn: (command: Command) => void): void;
}

const fail = (code: CommandErrorCode, message: string): CommandResult => ({ ok: false, error: { code, message } });

export const STATUS_OF: Record<CommandErrorCode, number> = {
  'bad-request': 400, forbidden: 403, 'not-found': 404, conflict: 409, limit: 429, internal: 500, unavailable: 503,
};

export function createRouter(log: Logger): KernelRouter {
  const handlers = new Map<CommandType, CommandHandler<CommandType>>();
  const after: Array<(command: Command) => void> = [];

  return {
    register(type, handler) {
      if (handlers.has(type)) log.warn('command handler replaced', { type });
      handlers.set(type, handler as unknown as CommandHandler<CommandType>);
    },
    has: (type) => handlers.has(type),
    afterSuccess(fn) {
      after.push(fn);
    },
    async dispatch(body, scope) {
      if (typeof body !== 'object' || body === null) return fail('bad-request', 'a command is a JSON object');
      const type = (body as { type?: unknown }).type;
      // hasOwn, so a body naming `constructor` is an unknown command and not a property of the table.
      if (typeof type !== 'string' || !Object.hasOwn(COMMAND_SCOPES, type)) return fail('bad-request', 'unknown command');
      const known = type as CommandType;
      if (!COMMAND_SCOPES[known].includes(scope)) return fail('forbidden', `${known} is not open to scope ${scope}`);
      const handler = handlers.get(known);
      if (!handler) return fail('unavailable', `${known} is not available on this kernel`);
      try {
        const result = await handler(body as Extract<Command, { type: CommandType }>, { scope });
        for (const fn of after) fn(body as Command);
        return { ok: true, result };
      } catch (error) {
        if (error instanceof CommandError) return fail(error.code, error.message);
        // The message can quote a path or a prompt, so it stays out of the log and the response.
        log.error('command failed', { type: known, error: error instanceof Error ? error.name : 'unknown' });
        return fail('internal', 'the command failed');
      }
    },
  };
}
