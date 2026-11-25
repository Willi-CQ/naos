// Options for query(). The base block of AC 8 goes on every agent, whatever the profile. Each line is a real failure from AC 1.
import type { CanUseTool, HookCallback, McpServerConfig, Options, SettingSource } from '@anthropic-ai/claude-agent-sdk';
import { MANAGED_TITLE_PREFIX } from '@naos/protocol';
import path from 'node:path';
import { agentEnv } from './driver.ts';
import type { Profile } from './types.ts';

/** These tools create state outside the kernel's view: schedules, cloud triggers, nested Claude runs (AC 8). */
export const BASE_DISALLOWED = [
  'CronCreate', 'CronDelete', 'RemoteTrigger', 'ScheduleWakeup', 'PushNotification',
  'SendToProject', 'SendToProjectContext', 'EnterWorktree', 'ExitWorktree', 'Bash(claude *)',
] as const;

/** "Tighter tools" of AC 8 for a repo nobody vouched for. No Skill, Workflow or Agent: those run what the repo ships. */
export const UNKNOWN_WORLD_TOOLS = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'PowerShell', 'AskUserQuestion'] as const;

export const managedTitle = (agentId: string): string => `${MANAGED_TITLE_PREFIX}${agentId}`;

/** `//c/dev/repo/.naos`, the absolute form of a permission rule path. */
export const rulePath = (p: string): string => {
  const unix = path.resolve(p).replaceAll('\\', '/');
  const drive = /^([A-Za-z]):\/(.*)$/.exec(unix);
  return drive ? `//${drive[1]!.toLowerCase()}/${drive[2]}` : `/${unix}`;
};

/**
 * The kernel's data is off limits to its agents. Path rules cover the file tools. The shell rules match commands as written,
 * so they are best effort, and the real gate on a shell is the human (AC 12.4). First Flight flies inside that folder, with
 * only `Write`, so it gets the named files instead of the whole tree.
 */
export function kernelDenyRules(home: string, opts: { scratchInside?: boolean } = {}): string[] {
  const root = rulePath(home);
  if (opts.scratchInside) {
    return ['*.token', 'naos.db*', 'layout.json', 'logs/**', 'audit*'].flatMap((f) => [`Read(${root}/${f})`, `Edit(${root}/${f})`]);
  }
  const leaf = path.basename(home);
  const needle = leaf.startsWith('.') ? leaf : path.resolve(home).replaceAll('\\', '/');
  return [`Read(${root}/**)`, `Edit(${root}/**)`, `Bash(*${needle}*)`, `PowerShell(*${needle}*)`];
}

export interface ComposeInput {
  agentId: string;
  profile: Profile;
  model: string;
  effort: string | null;
  permissionMode: Profile['permissionMode'];
  tools: string[] | null;
  cwd: string;
  /** The budget still free. maxBudgetUsd counts only the new call (AC 2.5). */
  maxBudgetUsd: number;
  maxTurns: number | null;
  /** Assigned before spawn. With `fork` it names the new session. */
  sessionId: string;
  resume?: string;
  fork?: boolean;
  /** Restart a turn a dead process left behind. The model may re-issue its command, so orphans must be gone first (AC 2.4). */
  resumeInterruptedTurn?: boolean;
  trusted: boolean;
  /** Hybrid worktree, AC 10: the kernel made it, the flag adopts it. */
  worktree?: { name: string; repoRoot: string };
  canUseTool: CanUseTool;
  audit: { pre: HookCallback; post: HookCallback };
  denyRules: string[];
  stderr: (data: string) => void;
  os?: McpServerConfig;
}

export function composeOptions(i: ComposeInput): Options {
  const { profile: p } = i;
  const trusted = i.trusted && p.settings !== 'none';
  const sources: SettingSource[] = trusted ? ['user', 'project', 'local'] : [];
  const env: Record<string, string> = { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2', CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '5' };
  if (!trusted) env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  if (i.permissionMode === 'auto') env.CLAUDE_CODE_RETRY_WATCHDOG = '1';
  if (i.resumeInterruptedTurn) env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN = '1';

  const tools = i.tools ?? (trusted ? null : [...UNKNOWN_WORLD_TOOLS]);
  const options: Options = {
    model: i.model,
    cwd: i.cwd,
    maxBudgetUsd: i.maxBudgetUsd,
    permissionMode: i.permissionMode,
    canUseTool: i.canUseTool,
    includePartialMessages: true,
    env: agentEnv(env),
    hooks: {
      PreToolUse: [{ hooks: [i.audit.pre] }],
      PostToolUse: [{ matcher: 'Bash|PowerShell', hooks: [i.audit.post] }],
      PostToolUseFailure: [{ matcher: 'Bash|PowerShell', hooks: [i.audit.post] }],
    },
    settings: {
      disableClaudeAiConnectors: true,
      crossSessionInbound: 'refuse',
      permissions: { deny: i.denyRules },
    },
    disallowedTools: [...BASE_DISALLOWED],
    stderr: i.stderr,
    settingSources: sources,
  };

  if (i.resume) {
    options.resume = i.resume;
    if (i.fork) {
      options.forkSession = true;
      options.sessionId = i.sessionId;
      options.title = managedTitle(i.agentId);
    }
  } else {
    options.sessionId = i.sessionId;
    options.title = managedTitle(i.agentId);
  }

  if (i.effort) options.effort = i.effort as NonNullable<Options['effort']>;
  if (i.maxTurns !== null) options.maxTurns = i.maxTurns;
  if (p.prompt) options.systemPrompt = { type: 'preset', preset: 'claude_code', append: p.prompt };
  if (!p.persist) options.persistSession = false;
  if (tools) options.tools = tools;
  // A plugin list on argv can hit the command line limit (AC 7.17). Only `user` settings bring plugins.
  if (trusted) options.pluginDelivery = 'initialize';
  if (!trusted) options.strictMcpConfig = true;

  const allowed: string[] = [];
  if (i.permissionMode === 'dontAsk' && tools) allowed.push(...tools);
  if (i.os) {
    options.mcpServers = { os: i.os };
    // Limits sit in the handlers, so these tools need no second gate (AC 12.2).
    allowed.push('mcp__os__*');
  }
  if (allowed.length > 0) options.allowedTools = allowed;

  if (i.worktree) {
    options.projectConfigRoot = i.worktree.repoRoot;
    // A resume from the repo root re-enters the worktree on its own (AC 10). Only a new session adopts one.
    if (!i.resume || i.fork) options.extraArgs = { worktree: i.worktree.name };
  }
  return options;
}
