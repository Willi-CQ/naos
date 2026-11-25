#!/usr/bin/env node
// The six orchestrator tools for sessions outside the kernel, such as this repo's own Claude session. It talks to POST /api/cmd
// with the MCP bearer token, so it sits in scope `mcp`, which has no route to approvals, trust or All stop. A token is not an
// identity: the kernel treats every caller here as external, with lower limits (AC 12.1).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Command, CommandResult, ManagedAgentView, SpawnReceipt, SpawnSpec } from '@naos/protocol';
import { DEFAULT_PORT } from '@naos/protocol';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_ID, LIST_SHAPE, SEND_SHAPE, SPAWN_SHAPE, TOOL_TEXT, WAIT_SHAPE, statusRow } from './ostools.ts';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const fail = (text: string): ToolResult => ({ isError: true, content: [{ type: 'text', text }] });
const ok = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const home = (): string => path.resolve(process.env.NAOS_HOME ?? path.join(REPO, '.naos'));

const readText = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
};

/** Read on every call. The kernel may have restarted, on another port. */
function port(): number {
  const fromEnv = Number(process.env.NAOS_PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  try {
    const run = JSON.parse(readText(path.join(home(), 'kernel.json')) ?? '{}') as { port?: number };
    return run.port ?? DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

async function command<T>(body: Command, use: (result: T) => unknown): Promise<ToolResult> {
  const token = readText(path.join(home(), 'mcp.token'));
  if (!token) return fail('NAOS has no MCP token yet, so its kernel has never run here. Start it with: npm run up');
  const target = port();
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${target}/api/cmd`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return fail(`The NAOS kernel is not running: nothing answers on 127.0.0.1:${target}. Start it with: npm run up`);
  }
  let reply: CommandResult;
  try {
    reply = await response.json() as CommandResult;
  } catch {
    return fail(`The NAOS kernel gave an unreadable answer, status ${response.status}.`);
  }
  if (!reply.ok) return fail(reply.error.message);
  return ok(use(reply.result as T));
}

/** A folder becomes the craft's working directory, anything else names a world. Default: where this session runs. */
function place(project: string | undefined): Pick<SpawnSpec, 'cwd' | 'worldId'> {
  const target = project ?? process.cwd();
  return statSync(target, { throwIfNoEntry: false })?.isDirectory() ? { cwd: path.resolve(target) } : { worldId: target };
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'naos', version: '0.1.0' });

  server.registerTool('agent_spawn', { description: TOOL_TEXT.agent_spawn, inputSchema: SPAWN_SHAPE }, (a) => {
    const spec: SpawnSpec = {
      ...place(a.project),
      profile: a.profile ?? 'build',
      prompt: a.prompt,
      ...(a.model ? { model: a.model } : {}),
      ...(a.budget_usd !== undefined ? { budgetUsd: a.budget_usd } : {}),
      ...(a.worktree !== undefined ? { worktree: a.worktree } : {}),
      ...(a.title ? { title: a.title } : {}),
      ...(a.idempotency_key ? { idempotencyKey: a.idempotency_key } : {}),
    };
    return command<SpawnReceipt>({ type: 'agent.spawn', spec }, (r) => ({ agent_id: r.agentIds[0] ?? null, status: r.queued > 0 ? 'queued' : 'spawning' }));
  });

  server.registerTool('agent_status', { description: TOOL_TEXT.agent_status, inputSchema: AGENT_ID }, ({ agent_id }) =>
    command<ManagedAgentView>({ type: 'agent.status', agentId: agent_id }, statusRow));

  server.registerTool('agent_wait', { description: TOOL_TEXT.agent_wait, inputSchema: WAIT_SHAPE }, ({ agent_id, timeout_s }) =>
    command<{ agent: ManagedAgentView; result: string | null; done: boolean }>(
      { type: 'agent.wait', agentId: agent_id, timeoutS: timeout_s },
      ({ agent, result, done }) => ({ ...statusRow(agent), done, result }),
    ));

  server.registerTool('agent_send', { description: TOOL_TEXT.agent_send, inputSchema: SEND_SHAPE }, ({ agent_id, text, interrupt }) =>
    command<{ sendId: string }>({ type: 'agent.send', agentId: agent_id, text, priority: interrupt ? 'now' : 'queue' }, (r) => ({ send_id: r.sendId })));

  server.registerTool('agent_stop', { description: TOOL_TEXT.agent_stop, inputSchema: AGENT_ID }, ({ agent_id }) =>
    command<{ result: string }>({ type: 'agent.stop', agentId: agent_id }, (r) => ({ agent_id, result: r.result })));

  // The kernel scopes this to what MCP callers started, so `all` here is the caller's own tree.
  server.registerTool('agent_list', { description: TOOL_TEXT.agent_list, inputSchema: LIST_SHAPE }, () =>
    command<ManagedAgentView[]>({ type: 'agent.list', scope: 'all' }, (rows) => rows.map(statusRow)));

  return server;
}

export async function main(): Promise<void> {
  await buildServer().connect(new StdioServerTransport());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
