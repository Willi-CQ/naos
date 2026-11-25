// canUseTool only sees what nothing else approved, so `echo` never reaches it (AC 1.12). The PreToolUse hook sees every call.
// This table is the one place a tool input may be stored. It is local, and it never leaves through events or logs.
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import type { AgentId } from '@naos/protocol';
import type { Store } from './store.ts';

const DETAIL_LIMIT = 16_384;

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

export interface ShellWatch {
  shellStarted(agentId: AgentId): void;
  shellFinished(agentId: AgentId): void;
}

export class Audit {
  readonly #store: Store;
  readonly #shells: ShellWatch;
  readonly #now: () => number;

  constructor(store: Store, shells: ShellWatch, now: () => number = Date.now) {
    this.#store = store;
    this.#shells = shells;
    this.#now = now;
  }

  record(agentId: AgentId, event: string, fields: { toolName?: string; toolUseId?: string; requestId?: string; subagentId?: string | null; detail?: unknown } = {}): void {
    const detail = fields.detail === undefined ? null : JSON.stringify(fields.detail).slice(0, DETAIL_LIMIT);
    this.#store.audit({
      at: this.#now(), agentId, event, detail, toolName: fields.toolName ?? null, toolUseId: fields.toolUseId ?? null,
      requestId: fields.requestId ?? null, subagentId: fields.subagentId ?? null,
    });
  }

  /** Never denies. Policy belongs to deny rules and the human. A throw here must not turn into a refused tool. */
  hooks(agentId: AgentId): { pre: HookCallback; post: HookCallback } {
    const pre: HookCallback = async (input) => {
      try {
        if (input.hook_event_name === 'PreToolUse') {
          this.record(agentId, 'tool', { toolName: input.tool_name, toolUseId: input.tool_use_id, subagentId: input.agent_id, detail: input.tool_input });
          if (SHELL_TOOLS.has(input.tool_name)) this.#shells.shellStarted(agentId);
        }
      } catch { /* Audit must never block the tool. */ }
      return {};
    };
    const post: HookCallback = async (input) => {
      if (input.hook_event_name === 'PostToolUse' || input.hook_event_name === 'PostToolUseFailure') {
        if (SHELL_TOOLS.has(input.tool_name)) this.#shells.shellFinished(agentId);
      }
      return {};
    };
    return { pre, post };
  }
}
