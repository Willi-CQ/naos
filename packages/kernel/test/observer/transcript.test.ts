import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentActivity, sameActivity, sessionActivity } from '../../src/observer/activity.ts';
import type { Raw } from '../../src/observer/parse.ts';
import { summarizeTool } from '../../src/observer/toolSummary.ts';
import { TranscriptMachine } from '../../src/observer/transcript.ts';
import type { Link, NodeEvent } from '../../src/observer/transcript.ts';
import { apiRequest, assistant, costState, iso, toolResult, toolUse, usage, userPrompt } from './records.ts';

function run(records: object[]): { m: TranscriptMachine; events: Array<NodeEvent & { at: number }>; links: Link[]; types: string[] } {
  const events: Array<NodeEvent & { at: number }> = [];
  const links: Link[] = [];
  const m = new TranscriptMachine({
    event: (e, at) => events.push({ ...e, at }),
    link: (l) => links.push(l),
  });
  records.forEach((r, i) => m.feed(r as Raw, i));
  m.endChunk();
  return { m, events, links, types: events.map((e) => e.type) };
}

const ofType = <T extends NodeEvent['type']>(events: NodeEvent[], type: T): Array<Extract<NodeEvent, { type: T }>> =>
  events.filter((e) => e.type === type) as Array<Extract<NodeEvent, { type: T }>>;

describe('tool pairing and message grouping', () => {
  it('groups records by message.id: one message.completed, blocks in order, sizes parallel', () => {
    const { events } = run([
      assistant({ id: 'm1', stop: 'tool_use', content: [{ type: 'thinking', thinking: 'x'.repeat(40) }], usage: usage(100, 1) }),
      assistant({ id: 'm1', stop: 'tool_use', content: [{ type: 'text', text: 'hello' }], usage: usage(100, 2) }),
      assistant({ id: 'm1', stop: 'tool_use', content: [toolUse('t1', 'Read', { file_path: 'c:/work/repo/a.ts' })], usage: usage(100, 3, { output_tokens_details: { thinking_tokens: 7 } }) }),
    ]);
    const done = ofType(events, 'message.completed');
    assert.equal(done.length, 1);
    assert.deepEqual(done[0]?.blocks, ['thinking', 'text', 'tool_use']);
    assert.equal(done[0]?.blockSizes[0], 7, 'tokens for thinking');
    assert.equal(done[0]?.blockSizes[1], 5, 'chars for text');
    assert.equal(done[0]?.blockSizes.length, 3);
    assert.equal(done[0]?.usage.output, 3, 'the last record holds the final numbers');
  });

  it('pairs tool_use and tool_result across records, with duration and family', () => {
    const { events, m } = run([
      assistant({ id: 'm1', stop: 'tool_use', content: [toolUse('t1', 'Bash', { command: 'echo a\necho b' }), toolUse('t2', 'Edit', { file_path: 'c:/work/repo/b.ts', old_string: 'a', new_string: 'b\nc' })] }, { at: 0 }),
      toolResult('t2', { at: 500 }),
      toolResult('t1', { at: 1500 }, {}, true),
    ]);
    const started = ofType(events, 'tool.started');
    assert.deepEqual(started.map((e) => [e.toolUseId, e.toolFamily]), [['t1', 'shell'], ['t2', 'edit']]);
    assert.equal(started[0]?.summary.target, 'echo a');
    assert.equal(started[0]?.summary.shape, 'Bash, 2 lines, 13 chars');
    assert.equal(started[1]?.summary.target, 'b.ts', 'relative to the working directory');
    assert.equal(started[1]?.summary.plus, 2);
    assert.equal(started[1]?.summary.minus, 1);
    const finished = ofType(events, 'tool.finished');
    assert.deepEqual(finished.map((e) => [e.toolUseId, e.durationMs, e.isError]), [['t2', 500, false], ['t1', 1500, true]]);
    assert.equal(m.openTools.size, 0);
    assert.equal(m.errors, 1);
    assert.equal(m.toolCalls, 2);
  });

  it('a result with no known call is ignored, and an open tool stays open', () => {
    const { events, m } = run([
      toolResult('ghost'),
      assistant({ id: 'm1', stop: 'tool_use', content: [toolUse('t1', 'Read')] }),
    ]);
    assert.equal(ofType(events, 'tool.finished').length, 0);
    assert.equal(m.openTools.size, 1);
    assert.equal(m.outcome(), 'abandoned');
  });

  it('carries the permission decision and denial on a refused call', () => {
    const { events } = run([
      assistant({ id: 'm1', stop: 'tool_use', content: [toolUse('t1', 'Bash', { command: 'rm x' })] }),
      toolResult('t1', {}, { permissionDecision: { decision: 'reject', source: 'user_temporary' }, toolDenialKind: 'user-rejected' }, true),
    ]);
    const [f] = ofType(events, 'tool.finished');
    assert.equal(f?.decision, 'reject');
    assert.deepEqual(f?.denial, { kind: 'user-rejected', source: 'user_temporary' });
  });

  it('keeps one id through a tool round inside a streaming response, without a second completion', () => {
    const { events, m } = run([
      assistant({ id: 'm1', stop: 'tool_use', content: [toolUse('t1', 'Read')], usage: usage(10, 1) }),
    ]);
    assert.equal(ofType(events, 'message.completed').length, 1);
    // A late block of the same message arrives in a later flush.
    m.feed(toolResult('t1') as Raw, 10);
    m.feed(assistant({ id: 'm1', stop: 'tool_use', content: [toolUse('t2', 'Grep', { pattern: 'p' })], usage: usage(10, 9) }) as Raw, 11);
    m.endChunk();
    assert.equal(ofType(events, 'message.completed').length, 1);
    assert.equal(ofType(events, 'tool.started').length, 2);
    assert.equal(m.book.total.output, 9, 'usage replaced, never summed');
    assert.equal(m.book.total.messages, 1);
  });
});

describe('turns', () => {
  it('starts on real user text only, and ends on a final stop with no open tools', () => {
    const { events, types, m } = run([
      userPrompt('placeholder prompt', { at: 0 }),
      userPrompt('harness', { at: 1 }, { isMeta: true }),
      assistant({ id: 'm1', stop: 'tool_use', content: [toolUse('t1', 'Read')] }, { at: 2 }),
      toolResult('t1', { at: 3 }),
      assistant({ id: 'm2', stop: 'end_turn' }, { at: 4 }),
    ]);
    assert.equal(types.filter((t) => t === 'turn.started').length, 1);
    assert.equal(ofType(events, 'turn.started')[0]?.origin, 'human');
    assert.deepEqual(ofType(events, 'turn.ended').map((e) => e.stopReason), ['end_turn']);
    assert.equal(m.last, 'turn-end');
    assert.equal(m.outcome(), 'clean');
  });

  it('a null stop reason does not end the turn, and marks the output partial', () => {
    const { events, m } = run([assistant({ id: 'm1', stop: null, usage: usage(10, 8) }), assistant({ id: 'm2', stop: 'end_turn' })]);
    assert.equal(ofType(events, 'turn.ended').length, 1);
    assert.equal(m.book.total.partialOutputMessages, 1);
    assert.equal(ofType(events, 'message.completed')[0]?.usage.partialOutputMessages, 1);
  });

  it('an interrupt closes open tools and is not a turn', () => {
    const { events, m } = run([
      assistant({ id: 'm1', stop: 'tool_use', content: [toolUse('t1', 'Bash')] }),
      userPrompt('[Request interrupted by user for tool use]'),
    ]);
    assert.equal(ofType(events, 'turn.started').length, 0);
    assert.equal(ofType(events, 'tool.finished')[0]?.isError, true);
    assert.equal(m.last, 'interrupted');
    assert.equal(m.openTools.size, 0);
  });

  it('takes the origin from turnOrigin, then origin.kind', () => {
    const { events } = run([
      userPrompt('a', {}, { turnOrigin: undefined, origin: { kind: 'task-notification' } }),
      userPrompt('b', {}, { turnOrigin: 'peer' }),
      userPrompt('c', {}, { turnOrigin: undefined, promptSource: 'sdk' }),
    ]);
    assert.deepEqual(ofType(events, 'turn.started').map((e) => e.origin), ['task_notification', 'peer', 'sdk']);
  });
});

describe('record to event mapping', () => {
  it('api-request gives request.started, ahead of any assistant record', () => {
    const { events, m } = run([apiRequest({}, 'claude-haiku-5-5')]);
    assert.deepEqual(ofType(events, 'request.started').map((e) => e.model), ['claude-haiku-5-5']);
    assert.equal(m.model, 'claude-haiku-5-5');
    assert.equal(m.last, 'api-request');
    assert.equal(m.outcome(), 'abandoned');
  });

  it('system records give retry and compaction', () => {
    const { events, m } = run([
      { type: 'system', subtype: 'api_error', retryAttempt: 2, maxRetries: 10, retryInMs: 4000, timestamp: iso(0) },
      { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 900, postTokens: 90, durationMs: 11 }, timestamp: iso(1) },
    ]);
    assert.deepEqual(ofType(events, 'api.retry')[0], { type: 'api.retry', attempt: 2, maxRetries: 10, retryInMs: 4000, at: Date.parse(iso(0)) });
    assert.equal(ofType(events, 'compacted')[0]?.postTokens, 90);
    assert.equal(m.contextTokens, 90);
  });

  it('an api error message gives api.error and rate_limit.hit, in ms', () => {
    const { events, m } = run([
      assistant({ id: 'e1', model: '<synthetic>', usage: usage(0, 0) }, {}, {
        isApiErrorMessage: true, error: 'rate_limit', apiError: 'usage_limit_reached', apiErrorStatus: 429,
        quotaLimits: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1_793_414_400 },
      }),
    ]);
    assert.equal(ofType(events, 'api.error')[0]?.httpStatus, 429);
    assert.deepEqual(ofType(events, 'rate_limit.hit').map((e) => [e.limit, e.resetsAt]), [['five_hour', 1_793_414_400_000]]);
    assert.equal(m.error?.kind, 'rate_limit');
    assert.equal(ofType(events, 'message.completed').length, 0, 'a synthetic message is not a response');
    assert.equal(m.model, null);
  });

  it('counts the queue, and parses only three tags of a task notification', () => {
    const body = '<task-notification><task-id>tk</task-id><tool-use-id>t9</tool-use-id><status>completed</status><summary>private</summary></task-notification>';
    const { m, links } = run([
      { type: 'queue-operation', operation: 'enqueue', content: body },
      { type: 'queue-operation', operation: 'enqueue' },
      { type: 'queue-operation', operation: 'dequeue' },
    ]);
    assert.equal(m.queued, 1);
    assert.deepEqual(links, [{ kind: 'notification', toolUseId: 't9', taskId: 'tk', status: 'completed' }]);
    assert.ok(!JSON.stringify(links).includes('private'));
  });

  it('finds the joins in tool results', () => {
    const { links } = run([
      assistant({ id: 'm1', stop: 'tool_use', content: [toolUse('t1', 'Agent'), toolUse('t2', 'Workflow')] }),
      toolResult('t1', {}, { toolUseResult: { agentId: 'a1', status: 'async_launched' } }),
      toolResult('t2', {}, { toolUseResult: { runId: 'wf_1', taskId: 'tk', workflowName: 'wn', status: 'async_launched' } }),
    ]);
    assert.deepEqual(links.map((l) => l.kind), ['launch', 'launch', 'agent', 'workflow']);
  });

  it('uses the SDK title rule, and the model ignores <synthetic>', () => {
    const { m } = run([
      { type: 'last-prompt', lastPrompt: 'a prompt' },
      { type: 'ai-title', aiTitle: 'ai name' },
      assistant({ id: 'm1', model: 'claude-sonnet-5-5' }),
      assistant({ id: 'm2', model: '<synthetic>', usage: usage(0, 0) }),
    ]);
    assert.deepEqual(m.title(), { title: 'ai name', source: 'ai' });
    m.feed({ type: 'custom-title', customTitle: 'mine' }, 9);
    assert.deepEqual(m.title(), { title: 'mine', source: 'custom' });
    assert.equal(m.model, 'claude-sonnet-5-5');
  });

  it('uses the first cwd as the start, the last for display', () => {
    const { m } = run([userPrompt('a', { cwd: 'c:/one' }), userPrompt('b', { cwd: 'c:/two' })]);
    assert.equal(m.firstCwd, 'c:/one');
    assert.equal(m.lastCwd, 'c:/two');
  });

  it('cost-state keeps the highest non-zero value and ends clean', () => {
    const { m } = run([costState(3), costState(0), costState(2)]);
    assert.equal(m.costStateUsd, 3);
    assert.equal(m.outcome(), 'clean');
  });

  it('unknown types change nothing and never throw', () => {
    const { events, m } = run([{ type: 'from-the-future', x: { y: 1 } }, { type: 'assistant' }, { type: 'user', message: 7 }, { type: 'system' }]);
    assert.equal(events.length, 0);
    assert.equal(m.last, 'none');
  });
});

describe('activity, RF 3.5 priority order', () => {
  const starting = { state: 'starting', since: 1 } as const;
  const tail = (records: object[]): TranscriptMachine => run(records).m;

  it('no status is starting, then the tail decides on a CLI that never writes one', () => {
    assert.equal(sessionActivity({ status: null, waitingFor: null, statusAt: null }, tail([]), starting, 9).state, 'starting');
    assert.equal(sessionActivity({ status: null, waitingFor: null, statusAt: null }, tail([apiRequest()]), starting, 9).state, 'generating');
  });

  it('busy reads retrying, then tool_running, then generating', () => {
    const busy = { status: 'busy', waitingFor: null, statusAt: null };
    const retry = tail([{ type: 'system', subtype: 'api_error', retryAttempt: 1, maxRetries: 3, retryInMs: 500, timestamp: iso(0) }]);
    const a = sessionActivity(busy, retry, starting, 9);
    assert.equal(a.state, 'retrying');
    assert.equal(a.state === 'retrying' ? a.nextAttemptAt : 0, Date.parse(iso(0)) + 500);
    assert.equal(sessionActivity(busy, tail([assistant({ id: 'm', stop: 'tool_use', content: [toolUse('t', 'Read')] })]), starting, 9).state, 'tool_running');
    assert.equal(sessionActivity(busy, tail([apiRequest()]), starting, 9).state, 'generating');
  });

  it('idle reads errored or interrupted from the last records, shell is idle with a background shell', () => {
    const idle = { status: 'idle', waitingFor: null, statusAt: null };
    const failed = tail([assistant({ id: 'e', model: '<synthetic>' }, {}, { isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429 })]);
    assert.equal(sessionActivity(idle, failed, starting, 9).state, 'errored');
    assert.equal(sessionActivity(idle, tail([userPrompt('[Request interrupted by user]')]), starting, 9).state, 'interrupted');
    const shell = sessionActivity({ ...idle, status: 'shell' }, tail([assistant({ id: 'm' })]), starting, 9);
    assert.deepEqual(shell, { state: 'idle', since: 9, backgroundShell: true });
  });

  it('waiting maps the reason, and an unknown reason is kept open', () => {
    const a = sessionActivity({ status: 'waiting', waitingFor: 'permission prompt', statusAt: 5 }, tail([]), starting, 9);
    assert.deepEqual(a, { state: 'waiting', since: 5, reason: 'permission prompt' });
    const b = sessionActivity({ status: 'waiting', waitingFor: 'a new reason', statusAt: 5 }, tail([]), starting, 9);
    assert.equal(b.state === 'waiting' ? b.reason : '', 'unknown');
  });

  it('since holds while the state holds, so a timer on screen does not restart', () => {
    const prev = { state: 'generating', since: 100 } as const;
    const next = sessionActivity({ status: 'busy', waitingFor: null, statusAt: null }, tail([apiRequest({ at: 5000 })]), prev, 9000);
    assert.equal(next.since, 100);
  });

  it('agents have no pid file, their tail alone decides', () => {
    assert.equal(agentActivity(tail([]), starting, 9).state, 'starting');
    assert.equal(agentActivity(tail([apiRequest()]), starting, 9).state, 'generating');
    assert.equal(agentActivity(tail([assistant({ id: 'm' })]), starting, 9).state, 'idle');
  });

  it('sameActivity sees a changed tool list', () => {
    const tool = (id: string) => ({ toolUseId: id, name: 'Read', family: 'read' as const, startedAt: 1 });
    assert.equal(sameActivity({ state: 'tool_running', since: 1, tools: [tool('a')] }, { state: 'tool_running', since: 1, tools: [tool('a')] }), true);
    assert.equal(sameActivity({ state: 'tool_running', since: 1, tools: [tool('a')] }, { state: 'tool_running', since: 1, tools: [tool('b')] }), false);
  });
});

describe('summarizeTool', () => {
  it('cuts the target to 160 chars and keeps the shape free of input', () => {
    const long = `secret-${'x'.repeat(400)}`;
    const bash = summarizeTool('Bash', { command: long }, null);
    assert.equal(bash.target?.length, 160);
    assert.equal(bash.shape, `Bash, 1 line, ${long.length} chars`);
    assert.ok(!bash.shape.includes('secret'));
    for (const [name, input] of Object.entries({
      Read: { file_path: 'c:/private/name.txt' }, Grep: { pattern: 'private' }, WebFetch: { url: 'https://private.example' },
      WebSearch: { query: 'private' }, Agent: { description: 'private' }, SendMessage: { to: 'private', message: 'private' },
      Skill: { skill: 'private' }, mcp__x__y: { arg: 'private' },
    })) {
      assert.ok(!summarizeTool(name, input, null).shape.includes('private'), name);
    }
  });

  it('never reads a value it does not know, and survives odd inputs', () => {
    assert.deepEqual(summarizeTool('NewTool', { a: 1 }, null), { target: null, shape: 'NewTool, 7 chars' });
    assert.equal(summarizeTool('Bash', { command: 5 }, null).target, null);
    assert.equal(summarizeTool('Read', {}, null).target, null);
    assert.equal(summarizeTool('Bash', { command: '\n\n  ls  \nrm x' }, null).target, 'ls');
  });
});
