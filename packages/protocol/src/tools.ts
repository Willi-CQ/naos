// Tool families, DESIGN 2.4. Loudness is the inverse of base rate. The set is open: unknown tools fall to 'other'.
import type { ToolFamily } from './observed.ts';

const FAMILY: Readonly<Record<string, ToolFamily>> = {
  Bash: 'shell', PowerShell: 'shell', Monitor: 'shell', TaskStop: 'shell', TaskOutput: 'shell',
  Read: 'read', Glob: 'read', Grep: 'read', ToolSearch: 'read', Skill: 'read', ListAgents: 'read',
  Edit: 'edit', Write: 'edit', NotebookEdit: 'edit',
  WebFetch: 'web', WebSearch: 'web',
  Agent: 'launch', Task: 'launch', Workflow: 'launch', mcp__os__agent_spawn: 'launch', mcp__naos__agent_spawn: 'launch',
  SendMessage: 'send', SendToProject: 'send', mcp__os__agent_send: 'send', mcp__naos__agent_send: 'send',
  AskUserQuestion: 'ask', ExitPlanMode: 'ask',
  exec_command: 'shell', write_stdin: 'shell', run_terminal_cmd: 'shell',
  read_file: 'read', list_dir: 'read', search_files: 'read', codebase_search: 'read',
  apply_patch: 'edit', edit_file: 'edit', write_file: 'edit',
  spawn_agent: 'launch', send_message: 'send', send_input: 'send', followup_task: 'send',
  request_user_input: 'ask', request_user_input_async: 'ask', web__run: 'web', 'web.run': 'web',
};

export const toolFamily = (name: string): ToolFamily =>
  FAMILY[name] ?? (name.startsWith('mcp__') ? 'mcp' : 'other');
