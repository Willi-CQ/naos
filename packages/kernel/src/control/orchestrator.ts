// The `os` MCP server, AC 12. One per agent, in process, built in the closure that knows who it serves: identity cannot be
// spoofed because no tool takes it as an argument. Child output comes back as a tool result, never as a user message, so it
// stays data even when it holds injected instructions. No tool here can reach an approval.
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { AgentId, AgentState, ManagedAgentView } from '@naos/protocol';
import { AGENT_ID, LIST_SHAPE, SEND_SHAPE, SPAWN_SHAPE, TOOL_TEXT, WAIT_SHAPE, statusRow } from './ostools.ts';

export interface OsSpawnInput {
  prompt: string;
  project?: string | undefined;
  profile?: string | undefined;
  model?: string | undefined;
  budget_usd?: number | undefined;
  worktree?: boolean | undefined;
  title?: string | undefined;
  idempotency_key?: string | undefined;
}

/** What the tools may do. The supervisor enforces every limit behind this. */
export interface OsOps {
  spawnChild(caller: AgentId, input: OsSpawnInput): Promise<{ agent_id: AgentId; status: AgentState }>;
  statusFor(caller: AgentId, target: AgentId): ManagedAgentView;
  waitFor(caller: AgentId, target: AgentId, timeoutS: number, signal?: AbortSignal): Promise<{ agent: ManagedAgentView; result: string | null; done: boolean }>;
  sendFrom(caller: AgentId, target: AgentId, text: string, interrupt: boolean): { sendId: string };
  stopFrom(caller: AgentId, target: AgentId): Promise<ManagedAgentView>;
  listFor(caller: AgentId, scope: 'children' | 'tree'): ManagedAgentView[];
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const ok = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

/** The model reads the refusal and adapts. Spike text: `refused: depth limit 1 reached` (AC 12.3). */
const guarded = async (run: () => unknown): Promise<ToolResult> => {
  try {
    return ok(await run());
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: (e as Error).message }] };
  }
};

export function osServer(ops: OsOps, self: AgentId): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'os',
    version: '0.1.0',
    tools: [
      tool('agent_spawn', TOOL_TEXT.agent_spawn, SPAWN_SHAPE, (args) => guarded(() => ops.spawnChild(self, args)), { alwaysLoad: true }),
      tool('agent_status', TOOL_TEXT.agent_status, AGENT_ID, ({ agent_id }) => guarded(() => statusRow(ops.statusFor(self, agent_id))), { alwaysLoad: true }),
      tool('agent_wait', TOOL_TEXT.agent_wait, WAIT_SHAPE, ({ agent_id, timeout_s }, extra) => guarded(async () => {
        const signal = (extra as { signal?: AbortSignal } | undefined)?.signal;
        const { agent, result, done } = await ops.waitFor(self, agent_id, timeout_s, signal);
        return { ...statusRow(agent), done, result };
      }), { alwaysLoad: true }),
      tool('agent_send', TOOL_TEXT.agent_send, SEND_SHAPE, ({ agent_id, text, interrupt }) => guarded(() => ({ send_id: ops.sendFrom(self, agent_id, text, interrupt === true).sendId })), { alwaysLoad: true }),
      tool('agent_stop', TOOL_TEXT.agent_stop, AGENT_ID, ({ agent_id }) => guarded(async () => statusRow(await ops.stopFrom(self, agent_id))), { alwaysLoad: true }),
      tool('agent_list', TOOL_TEXT.agent_list, LIST_SHAPE, ({ scope }) => guarded(() => ops.listFor(self, scope).map(statusRow)), { alwaysLoad: true }),
    ],
  });
}
