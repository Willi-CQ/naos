import type { AgentProvider, NativeClient, SpawnSpec, ToolFamily, ToolSummary } from '@naos/protocol';
import { CommandError } from '../../context.ts';
import { object, StdioRpc, type Obj, type NativeExecutable, type RpcTransport } from './rpc.ts';
import path from 'node:path';

export interface NativeEvents {
  limits?(value: Obj): void;
  text(id: string, text: string, complete: boolean): void;
  tool(id: string, name: string, family: ToolFamily, done: boolean, isError?: boolean, summary?: ToolSummary): void;
  approval(method: string, id: string | number, params: Obj): void;
  finished(reason: string): void;
  failed(message: string): void;
}
export type RpcFactory = (exe: NativeExecutable, args: string[], cwd: string, jsonrpc: boolean) => RpcTransport;
export const realRpc: RpcFactory = (exe, args, cwd, jsonrpc) => new StdioRpc(exe, args, cwd, jsonrpc);

export class NativeBridge {
  readonly rpc: RpcTransport;
  readonly client: NativeClient;
  threadId = '';
  model = '';
  instructionFilesLoaded: number | null = null;
  private turnId = '';
  private generation = 0;
  private readonly events: NativeEvents;
  private readonly cwd: string;
  constructor(client: NativeClient, exe: NativeExecutable, cwd: string, events: NativeEvents, factory: RpcFactory = realRpc) {
    this.client = client; this.events = events; this.cwd = cwd;
    this.rpc = factory(exe, client === 'codex' ? ['app-server', '--listen', 'stdio://'] : ['acp'], cwd, client === 'cursor');
    this.rpc.onMessage = (method, params, id) => this.message(method, params, id);
    this.rpc.onExit = () => events.failed('The agent CLI exited. Resume the conversation after checking its login.');
  }
  async initialize(): Promise<void> {
    if (this.client === 'codex') {
      await this.rpc.request('initialize', { clientInfo: { name: 'naos', title: 'NAOS local project workspace', version: '0.1.0' } });
      this.rpc.notify('initialized', {});
    } else {
      const init = await this.rpc.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'naos', title: 'NAOS', version: '0.1.0' } });
      if (init.protocolVersion !== 1) throw new CommandError('unavailable', 'This Cursor CLI uses an unsupported ACP protocol version.');
    }
  }
  async inspect(): Promise<Pick<AgentProvider, 'authenticated' | 'auth' | 'models'>> {
    if (this.client === 'cursor') return { authenticated: null, auth: 'provider', models: [] };
    const account = await this.rpc.request('account/read', { refreshToken: false });
    const models = await this.rpc.request('model/list', { limit: 100, includeHidden: false });
    const type = object(account.account).type;
    return { authenticated: !!account.account || account.requiresOpenaiAuth === false, auth: type === 'chatgpt' ? 'chatgpt' : type === 'apiKey' ? 'api-key' : 'unknown',
      models: (Array.isArray(models.data) ? models.data : []).map(object).filter((m) => typeof m.id === 'string').map((m) => ({ id: String(m.model ?? m.id), name: String(m.displayName ?? m.id), default: m.isDefault === true })) };
  }
  async start(cwd: string, spec: SpawnSpec, resumeId?: string): Promise<string> {
    if (this.client === 'codex') {
      const account = await this.rpc.request('account/read', { refreshToken: false });
      if (!account.account && account.requiresOpenaiAuth !== false) throw new CommandError('unavailable', 'Sign in first with codex login. NAOS uses the CLI’s own login.');
      const limits = await this.rpc.request('account/rateLimits/read', {}).catch(() => ({}));
      this.events.limits?.(object(object(limits).rateLimits));
      const primary = object(object(object(limits).rateLimits).primary);
      if (Number(primary.usedPercent) >= 100 && (!primary.resetsAt || Number(primary.resetsAt) * 1000 > Date.now())) throw new CommandError('limit', 'Codex reports an account usage limit. Wait for the provider reset.');
      const params: Obj = { cwd, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: spec.mode ? 'read-only' : 'workspace-write' };
      if (spec.model) params.model = spec.model;
      if (spec.mode === 'plan-first') params.developerInstructions = 'Plan the requested change and explain the plan. Do not modify files during this turn.';
      const result = await this.rpc.request(resumeId ? 'thread/resume' : 'thread/start', resumeId ? { ...params, threadId: resumeId, excludeTurns: true } : { ...params, serviceName: 'naos' });
      this.threadId = String(object(result.thread).id ?? '');
      this.model = String(result.model ?? spec.model ?? '');
      this.instructionFilesLoaded = Array.isArray(result.instructionSources) ? result.instructionSources.length : null;
    } else {
      const result = await this.rpc.request(resumeId ? 'session/load' : 'session/new', { cwd, mcpServers: [], ...(resumeId ? { sessionId: resumeId } : {}) });
      this.threadId = String(result.sessionId ?? resumeId ?? '');
      this.model = String(object(result.models).currentModelId ?? spec.model ?? '');
      if (spec.mode) await this.rpc.request('session/set_mode', { sessionId: this.threadId, modeId: spec.mode === 'plan-first' ? 'plan' : 'ask' });
      if (spec.model) await this.rpc.request('session/set_model', { sessionId: this.threadId, modelId: spec.model });
    }
    if (!this.threadId) throw new CommandError('unavailable', 'The CLI did not return a conversation ID.');
    return this.threadId;
  }
  async send(text: string, sendId: string): Promise<void> {
    const generation = ++this.generation;
    if (this.client === 'codex') {
      const result = await this.rpc.request('turn/start', { threadId: this.threadId, input: [{ type: 'text', text }], clientUserMessageId: sendId });
      this.turnId = String(object(result.turn).id ?? this.turnId);
    } else {
      // ACP returns the prompt response only when its streamed turn has finished.
      void this.rpc.request('session/prompt', { sessionId: this.threadId, prompt: [{ type: 'text', text }] }, 0).then((result) => {
        if (generation === this.generation) this.events.finished(String(result.stopReason ?? 'end_turn'));
      }).catch((e: unknown) => { if (generation === this.generation) this.events.failed(e instanceof Error ? e.message : 'Cursor could not complete the turn.'); });
    }
  }
  async interrupt() {
    this.generation += 1;
    if (!this.threadId) return;
    if (this.client === 'codex' && this.turnId) await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }, 2000);
    else if (this.client === 'cursor') this.rpc.notify('session/cancel', { sessionId: this.threadId });
  }
  private message(method: string, p: Obj, id?: string | number) {
    if (method === 'account/rateLimits/updated') this.events.limits?.(object(p.rateLimits));
    if (id !== undefined) {
      if (method.endsWith('/requestApproval') || method === 'session/request_permission' || method === 'item/tool/requestUserInput' || method === 'cursor/ask_question' || method === 'cursor/create_plan') this.events.approval(method, id, p);
      else this.rpc.reject(id, 'This client does not support that request.');
      return;
    }
    if (this.client === 'codex') {
      if (p.threadId && this.threadId && p.threadId !== this.threadId) return;
      if (method === 'turn/started') this.turnId = String(object(p.turn).id ?? '');
      if (method === 'item/agentMessage/delta') this.events.text(String(p.itemId ?? 'reply'), String(p.delta ?? ''), false);
      if (method === 'item/started' || method === 'item/completed') {
        const item = object(p.item), done = method === 'item/completed', itemId = String(item.id ?? 'item');
        if (item.type === 'agentMessage' && done) this.events.text(itemId, String(item.text ?? ''), true);
        else if (item.type === 'commandExecution') this.events.tool(itemId, 'Shell command', 'shell', done, item.status === 'failed' || item.status === 'declined');
        else if (item.type === 'fileChange') this.events.tool(itemId, 'File change', 'edit', done, item.status === 'failed' || item.status === 'declined', this.fileSummary(item));
        else if (item.type === 'mcpToolCall') this.events.tool(itemId, String(item.tool ?? 'MCP tool'), 'mcp', done, item.status === 'failed' || !!item.error);
      }
      if (method === 'turn/completed') {
        const turn = object(p.turn);
        if (this.turnId && turn.id && turn.id !== this.turnId) return;
        if (turn.status === 'failed') this.events.failed(String(object(turn.error).message ?? 'Codex could not complete this turn.'));
        else this.events.finished(String(turn.status ?? 'completed'));
      }
      if (method === 'serverRequest/resolved') this.events.approval(method, String(p.requestId ?? ''), p);
    } else if (method === 'session/update' && (!p.sessionId || p.sessionId === this.threadId)) {
      const update = object(p.update), kind = update.sessionUpdate;
      if (kind === 'agent_message_chunk') this.events.text(`reply-${this.generation}`, String(object(update.content).text ?? ''), false);
      if (kind === 'tool_call' || kind === 'tool_call_update') {
        const family = update.kind === 'execute' ? 'shell' : update.kind === 'edit' ? 'edit' : 'other';
        this.events.tool(String(update.toolCallId ?? 'tool'), String(update.title ?? 'Cursor tool'), family, update.status === 'completed' || update.status === 'failed', update.status === 'failed', family === 'edit' ? this.fileSummary(update) : undefined);
      }
    }
  }
  private fileSummary(value: Obj): ToolSummary {
    const input = object(value.rawInput ?? value.input);
    const candidates = [input.path, input.file_path, input.notebook_path, value.path, value.filePath, value.file_path];
    if (Array.isArray(value.changes)) for (const entry of value.changes) candidates.push(object(entry).path);
    if (Array.isArray(value.content)) for (const entry of value.content) candidates.push(object(entry).path, object(entry).filePath);
    const files = [...new Set(candidates.filter((candidate): candidate is string => typeof candidate === 'string').map((file) => {
      const relative = path.relative(this.cwd, path.resolve(this.cwd, file));
      return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : null;
    }).filter((file): file is string => file !== null))].slice(0, 4);
    return { target: files.length ? files.join(', ') : null, shape: files.length ? `File change · ${files.length} ${files.length === 1 ? 'file' : 'files'}` : 'File change' };
  }
  async close() { this.rpc.onExit = null; await this.rpc.close(); }
}
