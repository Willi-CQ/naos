# Agent control: how the Control plane spawns and steers Claude

Spike run 2026-10-30 and 2026-10-31 on this machine: Windows 11, Node 24.14.1, Intel Core Ultra 7 155H, 31 GB RAM.
SDK `@anthropic-ai/claude-agent-sdk` 0.3.314, bundled `claude.exe` 2.1.314, model `claude-haiku-5-5`, low effort, Claude Max login.
Companion report for the Observer plane: `docs/research/runtime-formats.md`.

**How claims are marked.** Everything here is VERIFIED unless it carries the word UNVERIFIED. The bracket says how it was verified:

| Tag | Meaning |
|---|---|
| `[run]` | Executed on this machine during this spike. Section 2 is `[run]` unless a line is tagged otherwise |
| `[code]` | Read in the SDK 0.3.314 package, `sdk.d.ts` or `sdk.mjs`. Not executed for that claim |
| `[docs]` | Read in code.claude.com/docs on 2026-10-30 |

Default limits and recommendations are engineering judgement and are marked UNVERIFIED where they are a number nobody tested.

**Measured spike spend: $0.0839** on the ledger, against the 0.50 USD cap. $0.0738 is the sum of reported `total_cost_usd` values and $0.0101 is an estimate for 13 runs that were killed before a `result` frame. An independent check from the transcripts gives $0.0778 (section 15). These are list-price estimates on a Max login, not a bill.

---

## 1. What changes the plan

| # | Finding | Consequence for the build |
|---|---|---|
| 1 | `tools: []` and `settingSources: []` still gave a child 38 tools, because the user's claude.ai connectors load regardless, including Gmail. That was 32,517 prompt tokens on the first turn | Every managed agent sets `settings: { disableClaudeAiConnectors: true }` or `strictMcpConfig: true`. Section 2.9 |
| 2 | With `project` in `settingSources`, a repo's `SessionStart` hook ran at spawn before any prompt, and its `.mcp.json` server started, in a folder that was never trusted. Only `permissions.allow` was gated by trust | `settingSources` is a trust decision, not a convenience. Unknown repos get `settingSources: []`. Section 2.9 |
| 3 | `close()` and `abort()` do not stop a running tool on Windows. The SDK kills only `claude.exe` after about 7 s. The Bash tree is orphaned and finishes its command | Stop is always `interrupt()`, then end of input, then `taskkill /T /F` as a fallback. Section 2.4, `stop()` in section 3 |
| 4 | `close()` does not stop spending either. After it, the CLI kept calling the model, and the kernel never saw those messages | Never use `close()` as the first stop step |
| 5 | If the kernel dies, `claude.exe` dies within 300 ms and its MCP servers die with it, but the Bash tree survives | The kernel must record tool trees and sweep orphans at boot, before any resume. Section 5.3 |
| 6 | `q.streamInput(finiteIterable)` closes stdin when the iterable ends, and the child exits | One never-ending generator per agent. Never call `streamInput` |
| 7 | `result.subtype` is `success` on aborted turns, and a synthetic empty `result` appears on some resumes | State comes from `terminal_reason`. Results bind to sends by `user_message_uuid`, never as "the next result". Section 5.2 |
| 8 | A daemon-managed `git worktree` plus `cwd` does not confine an agent: a host-approved write landed in the main checkout. The CLI `--worktree` flag blocks that write, even after approval | Use the hybrid: the kernel creates the worktree, and `extraArgs: { worktree }` makes the binary enforce it. Section 10 |
| 9 | `projectConfigRoot` makes hooks and settings come from the main checkout, so hooks a branch carries do not run. `CLAUDE.md` still comes from the worktree | Always set it for worktree agents |
| 10 | Without an env scrub, a child started from inside a Claude session reports `entrypoint: claude-vscode` and inherits that session's messaging token | Always pass a scrubbed `env` |
| 11 | `kind` is `interactive` and `entrypoint` is `sdk-ts` for managed children. Neither tells them apart from other SDK hosts | Dedupe on assigned `sessionId` and `pid`, with the `agentos:` title as a fallback. Section 13 |
| 12 | `echo` and other read-only Bash commands never reach `canUseTool` | `canUseTool` is an approval gate, not an audit log. Audit with a `PreToolUse` hook |
| 13 | The model generalizes a policy-sounding deny message and then refused every similar later request in that session, without trying | Deny messages must name the single call, not a rule. Section 9 |
| 14 | The command sandbox does not run on native Windows `[docs]` | `canUseTool`, deny rules and worktree checks are the only gates on this machine. `bypassPermissions` is not an option here |
| 15 | Agent teams do not spawn in SDK sessions `[docs]` | Do not build on teams. Section 11 |

**Policy.** This is a private tool on the user's machine under the user's own Max login. The control plane runs the unmodified binary, sets no auth variable, and never reads or stores credentials. If it were ever distributed to other people it would have to move to API keys: "Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK" `[docs]`.

---

## 2. Verified behaviours

### 2.1 Streaming input and turns (spike a)

One `query()` with an async generator stayed open across turns. Same `pid` and same `session_id` across three turns, and the follow-up recalled a codeword from the first turn.

```text
query() called
  initializationResult() resolves at 1.26 s, before any prompt, with no model call
input.push(prompt, uuid)
  command_lifecycle {state: queued}
  command_lifecycle {state: started}
  system/init                         re-emitted at the start of every turn
  system/status {status: requesting}
  rate_limit_event                    once per process, on the first API response
  stream_event ...                    only with includePartialMessages
  assistant                           one per completed content block
  result/success
  command_lifecycle {state: completed}
input.push(follow-up)                 same process, same frames, no rate_limit_event
```

`command_lifecycle` is not in the public `SDKMessage` type, and it appeared only for sends that carried a `uuid`. Treat it as useful but unstable.

Cold start: `initializationResult()` at 1.26 s. Six agents started at the same time each reached `system/init` in 1.24 to 1.34 s and finished in 3.2 to 3.4 s, with no contention. Time to first token was 1.2 to 2.9 s.

The system prompt does not go on the command line. The child's arguments were:

```text
--output-format stream-json --verbose --input-format stream-json --effort=low --max-budget-usd=0.05
--model=claude-haiku-5-5 --tools= --setting-sources= --permission-mode=default --include-partial-messages
```

What a send does depends on when it arrives. Letters are sends in order:

| Situation | Result |
|---|---|
| A and B sent back to back while idle | Two turns. A started, B queued |
| D and E both queued while a turn runs | One merged turn. `user_message_uuids: [D, E]`, `user_message_uuid` is E |
| G sent with `priority: 'now'` while D+E run, F queued earlier | D+E abort at once and are **cancelled, not retried**. G runs next, then F. So `now` interrupts and jumps the queue |
| End of input during a turn | The turn finishes, then the process exits, 2.3 s later here. EOF does not abort work. Sends still queued at EOF were not tested, UNVERIFIED |

The aborted turn reported `subtype: success`, `is_error: false`, `stop_reason: null`, `terminal_reason: aborted_streaming`, with the partial text in `result`.

`queued_turn_count` read 0 while two sends were queued. Do not use it. `command_lifecycle` showed the truth: `queued`, `started`, `completed`, `cancelled`.

**`streamInput()` trap.** `q.streamInput(finiteIterable)` delivered its message, then the child exited after that turn. The code confirms it: after the iterable ends, `streamInput` waits for the run to end and calls `transport.endInput()` `[code]`.

`priority: 'next'` and `'later'` were not exercised, UNVERIFIED. Folding a queued send into a running turn between tool rounds is `[code]` `[docs]`, not observed here.

### 2.2 `canUseTool` (spike b)

**Which calls reach it.** `permissionMode: 'default'` sends a call to the callback only when nothing earlier resolved it. `echo spike-b` ran with no callback at all, because read-only Bash commands are auto-approved. `touch` reached it. Use a state-changing command when testing denials.

**Exact arguments.** Paths shortened. `signal` is an `AbortSignal`, shown here as its state.

`Write` inside `cwd`:

```json
{ "toolName": "Write",
  "input": { "file_path": "C:\\...\\spike-workspace\\b1-approved.txt", "content": "hello" },
  "options": {
    "suggestions": [{ "type": "setMode", "mode": "acceptEdits", "destination": "session" }],
    "displayName": "Write",
    "description": "b1-approved.txt",
    "toolUseID": "toolu_013saxx7cmbhTPXQWhkC6tz7",
    "requestId": "97cc9225-b530-4bbf-8a9f-08b4c73cf97a",
    "signal": { "aborted": false } } }
```

`Bash` that needs approval:

```json
{ "toolName": "Bash",
  "input": { "command": "touch b1-denied.txt", "description": "Create empty file b1-denied.txt" },
  "options": {
    "suggestions": [
      { "type": "addRules", "rules": [{ "toolName": "Bash", "ruleContent": "touch b1-denied.txt" }], "behavior": "allow", "destination": "localSettings" },
      { "type": "addDirectories", "directories": ["C:\\...\\spike-workspace"], "destination": "session" },
      { "type": "setMode", "mode": "acceptEdits", "destination": "session" } ],
    "blockedPath": "C:\\...\\spike-workspace\\b1-denied.txt",
    "displayName": "Bash",
    "description": "Create empty file b1-denied.txt",
    "toolUseID": "toolu_015bgZ4tVEfP37PzcWTNVZZ9",
    "requestId": "c4fb0610-2b67-4a30-ae9c-d0f420dc4a36" } }
```

Other shapes, `options` only:

| Call | Extra fields seen |
|---|---|
| Write outside `cwd` | `decisionReason: "Path is outside allowed working directories"`, `decisionReasonType: "workingDir"`, `addDirectories` suggestion, `description` with a `~\...` path |
| MCP tool, stdio | `mcpServer: { name: "spike", source: "dynamic" }`, `serverPolicyAskOnly: true`, `addRules` suggestion to `localSettings` |
| MCP tool, in-process | Same with `source: "sdk"` |
| `AskUserQuestion` | `requiresUserInteraction: true`, no suggestions. `input.questions[]` has `question`, `header`, `options[{label, description}]`, `multiSelect` |
| `ExitPlanMode` | `requiresUserInteraction: true`. `input` has `plan` and `planFilePath` |
| Tool inside a subagent | `agentID: "a4e5720faece7a39f"`, equal to the `task_id` of the `task_started` frame |

`decisionReasonType`, `requiresUserInteraction` and `serverPolicyAskOnly` are not in `sdk.d.ts`. Read them defensively. Other typed fields never appeared in these runs: `title`, `defaultToNo`, `suppressAlwaysAllowRule`, `matchedAskRule` `[code]`.

**Return shapes and what they did:**

| Return | Effect |
|---|---|
| `{ behavior: 'allow', updatedInput: input }` | Tool runs |
| `{ behavior: 'allow' }` | Tool runs with the original input |
| `{ behavior: 'allow', updatedInput: { ...input, content: 'rewritten-by-host' } }` | File holds `rewritten-by-host`. The model still reported the original content, so it is not told |
| `updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Write' }], behavior: 'allow', destination: 'session' }]` | Later `Write` calls skip the callback. No settings file was written |
| A suggested `addRules` entry copied with `destination: 'session'` | The same `touch` command skipped the callback the second time. `.claude/settings.local.json` was not created |
| `ruleContent: 'touch b2-ruled:*'` | Did not match `touch b2-ruled2.txt`. The `:*` form did not cover that command. Echo suggested rules rather than writing your own |
| `{ behavior: 'deny', message }` | `tool_result` with `is_error: true` and exactly that text. The turn continues, the model reports it, `result.subtype` is `success`, and `permission_denials[]` holds `{tool_name, tool_use_id, tool_input}` |
| `{ behavior: 'deny', message, interrupt: true }` | **The message is dropped.** The model gets stock text ("The user doesn't want to proceed...") plus `[Request interrupted by user for tool use]`. Result: `error_during_execution`, `is_error: true`, `stop_reason: tool_use`, `terminal_reason: aborted_tools`, `errors: ["[ede_diagnostic] ..."]`. Later runs also ended a deny with interrupt on `aborted_streaming`, so handle both. The next prompt works in the same process |
| Callback throws | `tool_result` error `Tool permission request failed: Error: handler exploded`. The turn continues and the model retried once. No crash. Counted as a denial |
| Returns `null` | Means "answered out of band". An accidental `null` leaves the tool blocked forever `[code]` |

Omitting `canUseTool` in `default` mode denies with a `system/permission_denied` frame and an error `tool_result`.

**Parallel tool calls.** One assistant message carried two `Write` calls. The second callback fired only after the first was answered: 9 s later, still one callback open. Approvals within one agent are serial.

**Pending callback.** The callback may wait forever: "permission prompts have no park deadline" `[code]`. While it waits, the session file shows `status: waiting`, `waitingFor: "permission prompt"`.

| Trigger while pending | `signal` | Frames that follow | Result | Process |
|---|---|---|---|---|
| `q.interrupt()` | Aborts at once | Error `tool_result` with stock text, `[Request interrupted by user for tool use]` | `error_during_execution`, `aborted_tools`, 1 denial | Alive, next prompt works |
| Send with `priority: 'now'` | Aborts at once | Error `tool_result`: `Tool permission request aborted` | `success`, `is_error: false`, `aborted_tools`, empty `result` | Alive, runs the new message |
| `q.close()` | Aborts synchronously | None. Iterator ends with no error | None | Alive at 1 s, gone by 3 s. **Transcript gained further assistant entries after close** |
| `abortController.abort()` | Fires later | `Tool permission request failed: AbortError: Tool permission stream closed before response received`, then **another model turn**, then `result/success` | Then iterator throws `Operation aborted` | Gone within 1 s |
| `taskkill /F` on the child | Aborts | None | Iterator throws `Claude Code process exited with code 1` | Dead |
| End of input | Not fired | None | None after 6 s | Alive, still waiting. SDK holds stdin open while the run needs a callback `[code]` |
| Kernel dies, detached child | n/a | Transcript shows the call failed and more model calls | n/a | Exited within 3 s, `cost-state` written |

In every kill case the callback's promise stayed pending forever. **The `signal` is the only notification.** Resolving a stale callback after an interrupt did nothing, and the file was not written.

### 2.3 Partial messages and usage (spike c)

With `includePartialMessages: true`:

| `stream_event.event` | Notes |
|---|---|
| `message_start` | `message.usage` has input and cache tokens. `output_tokens` is a placeholder |
| `content_block_start` | `text`, `thinking` |
| `content_block_delta` | `text_delta`, `thinking_delta`, `signature_delta` |
| `content_block_stop` | |
| `message_delta` | Final `usage`, including `output_tokens_details.thinking_tokens`, and `stop_reason` |
| `message_stop` | |

The wrapper has `ttft_ms` on the first frame of a turn, plus `api_message_id`, `user_message_uuid`, `user_message_uuids`, `thinking_display`, `parent_tool_use_id`.

**`message_delta` arrives once per API response, at the end.** It gave 3 frames for 3 responses and cannot drive a live rate. Live tokens per second must be estimated. This formula follows from the measurements below, but it was not run as a live meter, so it is UNVERIFIED:

```ts
// In a 1 s sliding window of text_delta characters and thinking_tokens frames:
const liveTps = (windowChars / charsPerToken + windowThinkingTokens) / windowSeconds; // charsPerToken about 3.5 for prose, UNVERIFIED
// At message_delta, replace the estimate with usage.output_tokens.
```

Measured on one 601-token response: 76 deltas, 1,091 characters, 1.518 s first to last delta, so 396 tokens/s while streaming, against 207 tokens/s over the 2.9 s turn. That output was digits at 1.82 characters per token, so the ratio depends on content. Deltas arrive in bursts, with gaps of 0 to 171 ms, so smooth over at least 1 s.

Thinking is hidden text. `assistant` thinking blocks carried `thinking: ""` with a signature. One response had 328 of its 362 output tokens in thinking and only 66 visible characters. `system/thinking_tokens` frames carry `estimated_tokens` and `estimated_tokens_delta`, so feed them into the live rate or the agent looks stalled.

**Which field carries what:**

| Field | Scope |
|---|---|
| `assistant.message.usage` | Input and cache tokens are right, `output_tokens` is a placeholder. Parallel blocks share `message.id`, so dedupe by id |
| `stream_event` `message_delta.usage` | Real output for one API response |
| `result.usage` | This turn, main loop only. Excludes subagents and helper calls `[docs]` |
| `result.modelUsage` | Cumulative per model, includes helpers and subagents. Has `costUSD`, `contextWindow`, `maxOutputTokens`, `thinkingTokens`, `costBasis: "list"` |
| `result.model_usage_since_last_result` | Same shape, this turn only. Not in `sdk.d.ts` |
| `result.total_cost_usd` | Cumulative for the query. Read the latest, do not sum. Restored on resume |
| `result.subagent_stats` | `spawned`, `max_depth`, `completed`, `failed`, `killed`, `refused{depth_limit, concurrency_limit, budget}`. Not in `sdk.d.ts` |

### 2.4 Stop paths and the process tree (spike d)

The tree while a Bash tool runs, working sets as measured:

```text
node (kernel)
└─ claude.exe                        195 to 205 MB
   ├─ conhost.exe                    8 to 9 MB     hidden console
   ├─ node.exe  stdio MCP server     38 to 43 MB
   │  └─ conhost.exe                 7 MB
   └─ bash.exe  Git\bin wrapper      6 MB          Bash tool
      └─ bash.exe  usr\bin           10 MB
         ├─ conhost.exe              7 MB
         └─ bash.exe  fork           8 MB
            └─ the actual command
```

Each test ran `node -e` with a 30 s timer that writes a marker file, so a written marker proves the shell outlived the stop. Results while that tool ran:

| Stop path | `claude.exe` | Bash tree | MCP server | Iterator | Session file after | Marker |
|---|---|---|---|---|---|---|
| `q.interrupt()` | Alive, next prompt works | **Killed** | Alive until exit | Continues. `result` in 57 to 80 ms | Normal | Absent |
| End of input | Alive | Runs to completion | Alive | Continues | Normal | Written, expected |
| `q.close()` | Killed at about 7 s | **Orphaned** | Dies with `claude.exe` | Ends quietly, no result | **Stale**, `busy` | **Written** |
| `abortController.abort()` | Killed at about 7 s | **Orphaned** | Dies with `claude.exe` | Throws `Operation aborted` after the kill | **Stale**, `busy` | **Written** |
| `taskkill /PID child /F` | Dead | **Orphaned** | Gone by 500 ms | Throws `...exited with code 1` | **Stale**, `busy` | **Written** |
| `taskkill /PID child /T /F` | Dead | **Killed**, 9 processes | Killed | Throws `...exited with code 1` | **Stale**, `busy` | Absent |
| Parent `taskkill /F` | Gone by 300 ms | **Orphaned** | Gone by 300 ms | n/a | **Stale**, `busy` | **Written** |
| Parent `process.exit(0)` | Gone by 300 ms | **Orphaned** | Gone by 300 ms | n/a | **Stale**, `busy` | **Written** |
| Reference `stop()`, section 3 | Exits in 2.0 to 2.25 s | **Killed** | Exits | Throws `exited with code 1`, handled | Removed | Absent |

Other parent-death cases:

| Parent killed while | Result |
|---|---|
| Idle | Everything gone by 300 ms, session file stale at `idle` |
| Model streaming | Everything gone by 300 ms. Transcript had 0 `assistant` entries, so the partial reply is lost. Stale at `busy` |
| Tool running, child spawned `detached: true` | **Child survives.** Tool finished, one more model call ran, then it exited cleanly with `cost-state` written and the session file removed |
| Idle, `detached: true` | Child exited within 1 s, clean |
| Approval pending, `detached: true` | Call failed, model ran, child exited within 3 s, clean |

Background tasks: with `run_in_background`, end of input alone does not end the process. It stayed alive until the 30 s task finished, then ran **another model turn** on the `task_notification`, then exited. An `interrupt()` during a turn stopped the background task within about 95 ms (`task_notification` status `stopped`). An `interrupt()` on an idle agent stopped it right after end of input. Nothing was left running in either case, so interrupt first even when the agent looks idle.

An `interrupt()` on an idle agent emits no `result`, so do not wait for one. With queued sends, `interrupt()` returns `{ still_queued: [...] }` and those sends still run unless cancelled `[code]`. `q.interrupt()` takes no argument for `cancel_queued` `[code]`, which is one reason the kernel should hold its own queue.

**Exit code.** After an error result (interrupt, budget), the child exits 1 at end of input and the SDK throws `Claude Code process exited with code 1`. After a success result it exits 0 and the iterator ends quietly. A throw alone does not mean a crash.

**How the SDK closes** `[code]`: stdin EOF, then a 2,000 ms timer, then on Windows a 5,000 ms timer, then `kill('SIGKILL')`, which on Windows is `TerminateProcess` on one PID. Both timers are `unref()`'d. There is no `taskkill` and no tree kill anywhere in `sdk.mjs`. The `process.on('exit')` handler on win32 only ends stdin.

**Why the parent's death kills the child.** Behaviour is `[run]`. The mechanism is UNVERIFIED: libuv puts non-detached children in a job object with kill-on-close, which matches all results here, including `detached: true` escaping it. The Bash tree surviving suggests the binary spawns tools detached.

**Resume after a hard kill.** `resume` worked after a parent kill, and the model said the outcome of the last command was unknown. A session that died mid-turn can also continue with no prompt: with `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1`, the turn restarted on its own, the result carried `resume_reason: "interrupted_turn"`, and **the model re-issued the interrupted Bash command**. Kill orphans first, or the same side effect runs twice at once.

### 2.5 Resume and fork (spike e)

| Action | Result |
|---|---|
| `resume: sid` in a new process | New child, same `session_id`, recalled the codeword, appended to the same transcript |
| `resume` + `forkSession: true` | New `session_id`, new file, original line count unchanged. Resuming the original did not know the fork's new fact |
| `sessionId: randomUUID()` | Honoured on `system/init` and `result`. **The kernel can know the id before spawn** |
| `resume` with a different `cwd` | Worked. `init.cwd` is the new cwd, and the transcript stayed in the original project folder |
| Unknown id | `result/error_during_execution`, `errors: ["No conversation found with session ID: ..."]`, then the iterator throws. Cost 0 |
| `persistSession: false` | Runs normally. No transcript file, so it cannot be resumed |
| Resume after a background task died | `task_notification`, then a **synthetic `result`**: `subtype: success`, `num_turns: 0`, `result: ""`, no `user_message_uuid`, cost 0. The real turn follows |
| Resume with the worktree deleted, `cwd` = repo root | Worked |
| Resume with a `cwd` that no longer exists | Spawn fails, section 7 item 7 |

`total_cost_usd` on a resumed result includes earlier spend. `maxBudgetUsd` counts only the current call `[docs]`.

Do not resume a session that is still alive elsewhere: "messages from both interleave into one transcript" `[docs]`.

Read helpers ran on the spike workspace: `getSessionInfo` returns `sessionId, summary, lastModified, fileSize, customTitle, firstPrompt, gitBranch, cwd, tag, createdAt`. `getSessionMessages`, `listSessions`, `listSubagents` and `getSubagentMessages` also work. `tagSession` and `renameSession` write into the transcript, so they were not run, UNVERIFIED.

### 2.6 Transcript and session file (spike f)

**Transcript.** `~/.claude/projects/<encoded cwd>/<sessionId>.jsonl`, where every non-alphanumeric character of the absolute cwd becomes `-`. It is created by the first send, not at spawn, so an agent that never received a prompt leaves no file. Subagents: `<sessionId>/subagents/agent-<id>.jsonl` plus `.meta.json`. A worktree agent's transcript sits under the encoded **worktree** path. This answers open item 5 of `runtime-formats.md`.

Record types in one short run: `custom-title, queue-operation, user, attachment, atis-latch, api-request-shape, api-request-blob, api-request, tools-used, assistant, last-prompt, cost-state`. The `title` option writes `custom-title`, and no `ai-title` appeared.

`cost-state` is written only on a clean exit. It has `totalCostUSD`, `modelUsage` and durations. After any hard kill it is missing, and the transcript ends on a dangling `tool_use`.

**Session file.** `~/.claude/sessions/<pid>.json` exists from spawn. Spawn alone costs nothing, so these variants made no model call:

| Spawn variant | `kind` | `entrypoint` | `name` | `nameSource` |
|---|---|---|---|---|
| Scrubbed env | `interactive` | `sdk-ts` | `spike-workspace-e1` | `derived` |
| `title: 'agentos:demo-1'` | `interactive` | `sdk-ts` | `agentos:demo-1` | `auto` |
| `extraArgs: { name: 'agentos-demo-2' }` | `interactive` | `sdk-ts` | `agentos-demo-2` | `user` |
| `CLAUDE_AGENT_SDK_CLIENT_APP` set | `interactive` | `sdk-ts` | derived | `derived` |
| `CLAUDE_CODE_ENTRYPOINT=agent-os` | `interactive` | `agent-os` | derived | `derived` |
| Env inherited from this Claude session, or `env` omitted | `interactive` | **`claude-vscode`** | derived | `derived` |

Status over one run: `idle` before the first prompt, `busy` within 350 ms of a send, `waiting` plus `waitingFor: "permission prompt"` during an approval, `idle` after the result, file gone after a clean exit.

After a hard kill the file stays, then disappears after other Claude processes start. This reproduces open item 7 of `runtime-formats.md`, and matches the sweep it read from code.

`claude.exe` used 186 MB after one full turn. Growth over long sessions is UNVERIFIED.

### 2.7 MCP injection (spike g)

```ts
const stdio = (extra = {}) => ({ spike: { type: 'stdio', command: process.execPath, args: [`${SP}/spike/mcp-server.mjs`], env: { AGENT_ID: 'agent-7f3a', SPIKE_MCP_LOG: LOG }, ...extra } });
```

| Check | Result |
|---|---|
| Env var | Arrived. The tool returned `agent_id: "agent-7f3a"`. The server's `ppid` was `claude.exe` |
| Tool name | `mcp__spike__whoami` |
| No allow rule | Goes through `canUseTool`, with `mcpServer` set |
| `allowedTools: ['mcp__spike__whoami']` or `['mcp__spike__*']` | Skips `canUseTool`. The SDK emits process warning `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` |
| `tools/call` metadata | `_meta` has `claudecode/toolUseId` and `progressToken`, so a server can tie a call to the transcript |
| `mcpServerStatus()` right after init | stdio: `pending`. In-process: `connected`. A stdio server with `alwaysLoad: true`: `connected` |
| `ToolSearch` available, no `alwaysLoad` | Tool deferred. The model made a `ToolSearch` call first, one extra API call |
| `alwaysLoad: true` | Called directly |
| Shutdown | Clean exit closes the server's stdin, then the server is gone even though it ignored EOF |

**In-process server.** `createSdkMcpServer` plus `tool()` worked. The handler ran in the host process (`handler_pid` equals the host), a closure carried the agent id, and there is no extra process to orphan. `extra` has `signal, sessionId, _meta, sendNotification, sendRequest, authInfo, requestId, requestInfo, taskId, taskStore, ...`. `extra.sessionId` was undefined, so identity must come from the closure. `McpSdkServerConfig` has no `alwaysLoad` field `[code]`.

### 2.8 Auth and binary (spike h)

| Check | Result |
|---|---|
| Env | No `ANTHROPIC_*`, Bedrock, Vertex or Foundry variable present |
| `system/init.apiKeySource` | `none` |
| `accountInfo()` | Keys `email, organization, subscriptionType, apiProvider`. `subscriptionType` is `Claude Max`. Never persist these |
| Binary | `node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe`, 301 MB, `claude_code_version` 2.1.314 |
| `pathToClaudeCodeExecutable` = PATH CLI | Ran, session file showed 2.1.224, `initializationResult()` had 12 keys against 21 and no `claude_code_version` |

The bundled binary is pinned to the SDK version `[docs]`. Pin the SDK exactly and upgrade on purpose. `runtime-formats.md` shows 2.1.224 is also below the Windows minimum for messaging.

`initializationResult().pid` equals the `claude.exe` PID, so no process scan is needed. It is not in the public type.

### 2.9 `settingSources` (spike i)

Omitted `settingSources` means all sources `[code]`. Measured with no model call, using `initializationResult()`, `getContextUsage({ detail: 'summary' })` and `mcpServerStatus()`, in a workspace holding a `CLAUDE.md`, a project skill, a project agent, a project hook and a `.mcp.json`:

| `settingSources` | CLAUDE.md | Skills | Project agent | MCP servers | Hooks at spawn | Context tokens |
|---|---|---|---|---|---|---|
| Omitted | User, project | 46, project skill yes | Yes | 14, project server connected | User and project `SessionStart` | 23,716 |
| `[]` | None | 14 built-in | No | 4 claude.ai connectors | None | 22,245 |
| `['project']` | Project | 15, project skill yes | Yes | 5, project plus connectors | Project | 22,275 |
| `['user']` | User | 45, project skill no | No | 13 | User | 23,697 |
| `['user','project','local']` | User, project | 46 | Yes | 14 | Both | 22,275 |
| Same with `strictMcpConfig: true` | User, project | 46 | Yes | **0** | Both | 22,275 |

Real prompts confirmed it: `['project']` answered with the `CLAUDE.md` codeword, `[]` answered `NONE`. Full defaults cost $0.0055 for one word, 27,064 cache-write tokens. A minimal agent cost $0.0003, 694 to 957 tokens.

**Connectors** (no model call):

| Options | MCP result |
|---|---|
| `settingSources: ['project'], settings: { disableClaudeAiConnectors: true }` | Project server only |
| `settingSources: ['project']`, env `ENABLE_CLAUDEAI_MCP_SERVERS=false` | Project server only |
| `settingSources: [], mcpServers: {}` | **Connectors still load** |
| `settingSources: [], strictMcpConfig: true` | None |

`strictMcpConfig` also drops `.mcp.json` and user servers. Use `disableClaudeAiConnectors` when project servers should stay.

**Trust.** The workspace was never opened interactively.

| Project input | Result in the SDK |
|---|---|
| `SessionStart` hook in `.claude/settings.json` | **Ran at spawn, before any prompt** |
| `.mcp.json` server | **Started and connected** |
| `permissions.allow` | Ignored, stderr: `Ignoring 1 permissions.allow entry from .claude/settings.json: this workspace has not been trusted...` |

None of this passes through `canUseTool`. Pointing an agent with `project` in `settingSources` at an unknown repo runs that repo's code. Project allow rules the kernel wants can be passed through the `settings` option instead `[code]`. Writing `hasTrustDialogAccepted` would modify `~/.claude.json`, so do not.

**Permission mode when omitted.** `current_permission_mode` was `default`, which matches the docs for v2.1.302 and later. The comment in `sdk.d.ts` that says `auto` is stale. A `permissions.defaultMode` in loaded settings wins `[docs]`, so always pass `'default'`.

**Keeping config with a chosen `cwd`.** `cwd` selects the project. `settingSources: ['user','project','local']` keeps skills, hooks and `CLAUDE.md` for that folder. Inputs read regardless of `settingSources`: managed policy, `~/.claude.json`, auto memory, claude.ai connectors `[docs]`. `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` turns auto memory off `[docs]`.

`resolveSettings({ cwd })` gives the same answer without spawning, so the UI can show what an agent will load. It reported sources `user,project` and hook events `PostToolUse, SessionStart`.

### 2.10 Limits, modes, defer, subagents

| Test | Frames and result |
|---|---|
| `maxBudgetUsd: 0.00001` | `result/error_max_budget_usd`, `is_error: true`, `stop_reason: null`, `terminal_reason: budget_exhausted`, `errors: ["Reached maximum budget ($0.00001)"]`. Actual cost $0.00012, so **the cap overshoots by one API call**, and no `assistant` frame was delivered |
| Next prompt after that | Same error at once, no model call. Process alive until end of input, then exit 1 |
| `maxTurns: 1` with a tool | Tool ran, then `error_max_turns`, `stop_reason: tool_use`, `terminal_reason: max_turns`, `num_turns: 2`. The next prompt worked: the limit is per send |
| `setPermissionMode('acceptEdits')` | Resolved in 9 ms. Next `Write` skipped the callback |
| `setModel(...)` | Worked mid-session, a `user` frame with `<local-command-stdout>`. Running cost jumped from $0.00077 to $0.00305 on a one-word reply. A cache miss on switch is the likely cause, UNVERIFIED |
| `dontAsk` | `system/permission_denied`, error `tool_result`, callback never called |
| `auto` with Haiku 5.5 | `touch` ran with no callback. Classifier latency was not separated from Bash startup. Classifier calls are excluded from `modelUsage` `[code]` |
| `PreToolUse` callback hook | Saw every call, including auto-approved `echo`. Second argument is the tool use id |
| `plan` mode | Model wrote its plan to `~/.claude/plans/` with no callback, then `ExitPlanMode` reached the callback. After approval the mode returned to `default` |

**Defer.** A `PreToolUse` hook returning `permissionDecision: 'defer'` ended the turn: `result/success`, `stop_reason: tool_deferred`, `terminal_reason: tool_deferred`, `deferred_tool_use: {id, name, input}`, session file `idle`. The process can then exit.

| Resume with no prompt | Result |
|---|---|
| With `canUseTool` | Same `toolUseID` re-fired, `updatedInput` applied, no model retry. **The callback ran twice for one call**, so be idempotent |
| With only a callback `PreToolUse` hook | The replay hit `system/permission_denied` without reaching the hook. It succeeded only because the model retried with a new id. Do not rely on this |

Defer needs a single tool call in the turn `[docs]`.

**Subagents.** `agents: {...}` plus `tools: ['Agent', ...]`. Stream frames:

```text
assistant tool_use:Agent
system/task_started   {task_id, task_type: local_agent, subagent_type, spawn_depth: 1, is_backgrounded: false, tool_use_id}
assistant/user        with parent_tool_use_id and agent_id
system/task_progress  {description, usage, last_tool_name}
system/task_updated
system/task_notification {status: completed, output_file, summary, usage}
user tool_result, assistant, result
```

The session file stays one entry per process. Subagents do not get their own.

---

## 3. Snippets that ran

### 3.1 Reference driver

`driver.ts` below passed `tsc --strict` against `sdk.d.ts` and ran under Node 24 type stripping, in `driver-e2e.ts`: approvals with a double-answer check, a follow-up, a background task plus a live foreground tool, `stop()`, resume, idle stop. Results of the final code: `stop` graceful in 2,031 ms, no process left, no extra assistant entries, `cost-state` written, session file removed, both 30 s markers absent, idle stop in 619 ms.

It uses `erasableSyntaxOnly`, so it runs directly on Node 24. `base-check.ts` ran the same driver with the section 8 options as one block, also under `tsc --strict`.

```ts
// Reference driver for one managed agent.
// Typechecked against SDK 0.3.314 and run on Windows 11 / Node 24 via type stripping, binary 2.1.314.
import { query, type Options, type PermissionResult, type PermissionUpdate, type Query, type SDKResultMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { execFileSync } from 'node:child_process';
import { randomUUID, type UUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

/** Parent environment minus anything a surrounding Claude session exported. Adds no auth of any kind. */
export function agentEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of Object.keys(env)) {
    const u = k.toUpperCase();
    if (u === 'CLAUDECODE' || u === 'CLAUDE_PID' || u === 'CLAUDE_EFFORT' || u.startsWith('CLAUDE_CODE_') || u.startsWith('CLAUDE_AGENT_SDK_')) delete env[k];
  }
  return { ...env, ...extra };
}

/** One never-ending input stream per agent. A finite iterable closes stdin when it ends, so the child exits. */
class InputQueue {
  #q: SDKUserMessage[] = [];
  #wake: (() => void) | null = null;
  #ended = false;
  push(text: string, extra: Partial<SDKUserMessage> = {}): UUID {
    const uuid = randomUUID();
    this.#q.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, uuid, ...extra });
    this.#wake?.();
    return uuid;
  }
  end(): void { this.#ended = true; this.#wake?.(); }
  async *stream(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while (this.#q.length) yield this.#q.shift()!;
      if (this.#ended) return;
      await new Promise<void>((r) => { this.#wake = r; });
      this.#wake = null;
    }
  }
}

const within = <T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> =>
  Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);

export type AgentState = 'spawning' | 'running' | 'awaiting_approval' | 'idle' | 'stopping' | 'exited' | 'crashed';
export type Decision =
  | { kind: 'once'; input?: Record<string, unknown> }
  | { kind: 'session'; input?: Record<string, unknown> }
  | { kind: 'deny'; message?: string }
  | { kind: 'stop'; message?: string };
export interface ApprovalRequest {
  agentId: string; requestId: string; toolUseID: string; toolName: string; input: Record<string, unknown>;
  displayName?: string; description?: string; title?: string; blockedPath?: string; decisionReason?: string;
  subagentId?: string; mcpServer?: { name: string; source: string }; suggestions: PermissionUpdate[];
  defaultToNo?: boolean; suppressAlwaysAllowRule?: boolean;
}
export interface AgentSpec { id: string; cwd: string; model: string; budgetUsd: number; sessionId?: UUID; resume?: string; options?: Options }

export class ManagedAgent extends EventEmitter {
  state: AgentState = 'spawning';
  sessionId: string;
  pid: number | null = null;
  cost = 0;
  lastResult: SDKResultMessage | null = null;
  readonly id: string;
  readonly approvals = new Map<string, { resolve: (r: PermissionResult) => void; request: ApprovalRequest }>();
  #input = new InputQueue();
  #q: Query;
  #done: Promise<void>;
  #waiters = new Map<string, (r: SDKResultMessage | null) => void>();

  constructor(spec: AgentSpec) {
    super();
    this.id = spec.id;
    const sessionId = spec.sessionId ?? randomUUID();
    this.sessionId = spec.resume ?? sessionId;
    this.#q = query({
      prompt: this.#input.stream(),
      options: {
        cwd: spec.cwd, model: spec.model, maxBudgetUsd: spec.budgetUsd,
        ...(spec.resume ? { resume: spec.resume } : { sessionId, title: `agentos:${spec.id}` }),
        permissionMode: 'default',
        includePartialMessages: true,
        env: agentEnv(),
        canUseTool: (toolName, input, o) => this.#onPermission(toolName, input, o),
        ...spec.options,
      },
    });
    this.#done = this.#pump();
  }

  #set(state: AgentState, detail?: unknown): void { this.state = state; this.emit('state', state, detail); }

  async #pump(): Promise<void> {
    try {
      for await (const m of this.#q) {
        this.emit('message', m);
        if (m.type === 'system' && m.subtype === 'init') { this.sessionId = m.session_id; if (this.state === 'spawning') this.#set('running'); }
        if (m.type === 'result') {
          // Resuming a session whose background task died yields a synthetic result first: no uuid, no turns, no cost.
          if (m.num_turns === 0 && !m.user_message_uuid) continue;
          this.cost = m.total_cost_usd; this.lastResult = m;
          if (this.state !== 'stopping') this.#set('idle', { subtype: m.subtype, terminal: m.terminal_reason });
          for (const u of m.user_message_uuids ?? (m.user_message_uuid ? [m.user_message_uuid] : [])) { this.#waiters.get(u)?.(m); this.#waiters.delete(u); }
          this.emit('result', m);
        }
      }
      this.#set('exited', { clean: true });
    } catch (e) {
      // The CLI exits 1 when its last result was an error (interrupt, budget), so that exit is not a crash.
      const expected = this.state === 'stopping' || this.lastResult?.is_error === true;
      this.#set(expected ? 'exited' : 'crashed', { clean: false, error: String((e as Error).message) });
    }
    for (const f of this.#waiters.values()) f(null);
    this.#waiters.clear();
  }

  #onPermission(toolName: string, input: Record<string, unknown>, o: Parameters<NonNullable<Options['canUseTool']>>[2]): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const request: ApprovalRequest = {
        agentId: this.id, requestId: o.requestId, toolUseID: o.toolUseID, toolName, input,
        displayName: o.displayName, description: o.description, title: o.title,
        blockedPath: o.blockedPath, decisionReason: o.decisionReason,
        subagentId: o.agentID, mcpServer: o.mcpServer, suggestions: o.suggestions ?? [],
        defaultToNo: o.defaultToNo, suppressAlwaysAllowRule: o.suppressAlwaysAllowRule,
      };
      this.approvals.set(o.requestId, { resolve, request });
      // Fires on interrupt, close, abort and child death. The SDK never settles this promise itself.
      o.signal.addEventListener('abort', () => {
        if (this.approvals.delete(o.requestId)) this.emit('approvalCancelled', o.requestId);
        resolve({ behavior: 'deny', message: 'cancelled' });
      }, { once: true });
      this.#set('awaiting_approval', request);
      this.emit('approval', request);
    });
  }

  /** Answer once. A late or second answer returns false and has no effect. */
  answer(requestId: string, d: Decision): boolean {
    const a = this.approvals.get(requestId);
    if (!a) return false;
    this.approvals.delete(requestId);
    const { request } = a;
    let r: PermissionResult;
    if (d.kind === 'deny' || d.kind === 'stop') {
      r = d.kind === 'stop'
        ? { behavior: 'deny', message: d.message ?? 'Stopped by operator.', interrupt: true }
        : { behavior: 'deny', message: d.message ?? 'Not approved for this call.' };
    } else {
      r = { behavior: 'allow', updatedInput: d.input ?? request.input };
      // Session scope only. Suggestions default to localSettings, which writes .claude/settings.local.json.
      if (d.kind === 'session') r.updatedPermissions = request.suggestions.filter((s) => s.type === 'addRules').map((s) => ({ ...s, destination: 'session' as const }));
    }
    a.resolve(r);
    if (!this.approvals.size && this.state === 'awaiting_approval') this.#set('running');
    return true;
  }

  async ready(): Promise<void> {
    const init = await this.#q.initializationResult();
    this.pid = (init as unknown as { pid?: number }).pid ?? null;
  }

  /** Default priority queues behind the running turn. priority 'now' aborts the running turn and jumps the queue. */
  send(text: string, opts?: Partial<SDKUserMessage>): UUID {
    const uuid = this.#input.push(text, opts);
    if (this.state === 'idle') this.#set('running');
    return uuid;
  }

  /** Resolves with the result that consumed this send, never simply the next result frame. */
  waitFor(uuid: string): Promise<SDKResultMessage | null> {
    return new Promise((r) => this.#waiters.set(uuid, r));
  }

  /**
   * Stop without orphans. Order matters on Windows: interrupt kills the tool tree and stops the model, end of input
   * lets the CLI write cost-state and remove its session file, the tree kill is the last resort, close() frees the SDK.
   */
  async stop({ interruptMs = 2000, exitMs = 6000 } = {}): Promise<'graceful' | 'forced'> {
    const wasIdle = this.state === 'idle';
    this.#set('stopping');
    const result = new Promise<void>((r) => this.once('result', () => r()));
    await within(this.#q.interrupt().catch(() => undefined), interruptMs);
    if (!wasIdle) await within(result, interruptMs); // an idle agent emits no result for an interrupt
    this.#input.end();
    if ((await within(this.#done, exitMs)) === 'timeout') {
      if (this.pid) { try { execFileSync('taskkill', ['/PID', String(this.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* already gone */ } }
      this.#q.close();
      await within(this.#done, 1500);
      return 'forced';
    }
    return 'graceful';
  }
}
```

The kernel should hold its own send queue and call `send` only when the agent is idle or for `priority: 'now'`. `stop()` assumes nothing is queued inside the CLI.

In one run `stop()` took the `forced` path, because the interrupt raced a send made milliseconds earlier. The fallback left nothing running.

### 3.2 Spawning with a hybrid worktree

Ran as ESM in `x-misc.mjs`, with `session()` wrapping `baseOptions`:

```ts
git(REPO, 'worktree', 'add', `${REPO}/.claude/worktrees/pre-1`, '-b', 'agent/pre-1', 'HEAD');
const x = await session('hybrid', { cwd: REPO, settingSources: ['project'], tools: ['Write'], extraArgs: { worktree: 'pre-1' }, projectConfigRoot: REPO });
```

### 3.3 Claude prompts Claude

Ran as ESM in `x-misc.mjs`. A real agent called `agent_spawn`, the child tried to spawn again, the host refused it at the depth limit, and the parent read the refusal through `agent_wait`.

```ts
const MAX_DEPTH = 1;
const registry = new Map();
const costs = [];
const mkServer = (depth, parent) => createSdkMcpServer({
  name: 'os', version: '0.0.1',
  tools: [
    tool('agent_spawn', 'Start a child agent with the given prompt. Returns its id immediately.', { prompt: z.string() }, async ({ prompt }, extra) => {
      console.log(`  agent_spawn called by depth=${depth} parent=${parent} toolUseId=${extra?._meta?.['claudecode/toolUseId']?.slice(-6)} sessionId=${extra?.sessionId}`);
      if (depth >= MAX_DEPTH) return { isError: true, content: [{ type: 'text', text: `refused: depth limit ${MAX_DEPTH} reached` }] };
      const id = 'agent-' + randomUUID().slice(0, 6);
      const child = { status: 'running', result: null };
      registry.set(id, child);
      (async () => {
        for await (const m of query({ prompt, options: baseOptions({ thinking: { type: 'disabled' }, systemPrompt: SYS, mcpServers: { os: mkServer(depth + 1, id) }, allowedTools: ['mcp__os__agent_spawn'], title: `agentos:${id}` }) })) {
          if (m.type === 'result') { child.status = m.subtype; child.result = m.result; costs.push(m.total_cost_usd); console.log(`  child ${id} done: ${JSON.stringify(m.result)?.slice(0, 160)}`); }
        }
      })().catch((e) => { child.status = 'error'; child.result = String(e.message); });
      return { content: [{ type: 'text', text: JSON.stringify({ agent_id: id, status: 'running' }) }] };
    }),
    tool('agent_wait', 'Wait for a child agent to finish. Returns status and result.', { agent_id: z.string() }, async ({ agent_id }) => {
      const c = registry.get(agent_id);
      if (!c) return { isError: true, content: [{ type: 'text', text: 'unknown agent' }] };
      for (let i = 0; i < 300 && c.status === 'running'; i++) await sleep(100);
      return { content: [{ type: 'text', text: JSON.stringify(c) }] };
    }),
  ],
});
```

### 3.4 Process snapshot for sweeps

Ran as ESM in `lib.mjs`. One call took about 1.2 s, so use it at boot and for sweeps, not for polling. `runtime-formats.md` has cheaper liveness checks for sessions.

```ts
const PS = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate,WorkingSetSize,ExecutablePath,CommandLine | ConvertTo-Json -Compress -Depth 2';
export function snap() {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS], { encoding: 'utf8', maxBuffer: 256e6, windowsHide: true });
  return JSON.parse(out).map((p) => ({
    pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, created: String(p.CreationDate),
    mb: Math.round((p.WorkingSetSize ?? 0) / 1048576), exe: p.ExecutablePath ?? '', cmd: p.CommandLine ?? '',
  }));
}
export function tree(rootPid, procs = snap()) {
  const out = []; const seen = new Set();
  const walk = (pid, depth) => {
    for (const p of procs) if (p.ppid === pid && !seen.has(p.pid)) { seen.add(p.pid); out.push({ ...p, depth }); walk(p.pid, depth + 1); }
  };
  walk(rootPid, 0);
  return out;
}
/** Which of a saved process list are still alive (same pid AND same creation time). */
export function alive(saved, procs = snap()) {
  return saved.filter((s) => procs.some((p) => p.pid === s.pid && p.created === s.created));
}
```

---

## 4. Permission flow

Order for every tool call `[docs]`. The right column is what the kernel uses at that step.

| Step | Decides | Kernel use |
|---|---|---|
| 1. `PreToolUse` hooks | Can deny, defer, or pass. An `allow` does not skip deny or ask rules | **Audit log of every call** `[run]`. Hard policy that must run even for auto-approved calls |
| 2. Deny rules | `disallowedTools`, settings | Tool bans per profile. A bare name removes the tool. `Bash(rm *)` scopes it |
| 3. Ask rules | Falls through to `canUseTool`, even in bypass | Force a human for chosen patterns, through `settings` |
| 4. Permission mode | `acceptEdits` approves edits inside `cwd`. `plan` routes edits to the callback | `default` for supervised agents, `auto` for unattended ones |
| 5. Allow rules | `allowedTools`, settings. Read-only calls resolve here with no rule `[run]` | Orchestrator tools, safe read tools |
| 6. `canUseTool` | Everything left | **The human approval path** |

Calls no mode or rule auto-approves: `AskUserQuestion`, MCP tools marked `requiresUserInteraction`, recognized critical-path `rm`, reads from network paths `[docs]`.

```text
tool_use
  ├─ PreToolUse hook ── audit row written ──────────────── deny or defer ──> done
  ├─ worktree check (only under --worktree) ────────────── tool_use_error ─> model
  ├─ deny rule ─────────────────────────────────────────── permission_denied
  ├─ mode, allow rule, read-only ───────────────────────── runs, kernel sees only the frames
  └─ canUseTool ── record ── UI ── human ── answer ─────── allow or deny ──> model
                     └─ signal aborts ── record cancelled, card removed
```

Ordering of the worktree check relative to deny rules is UNVERIFIED. It fired before `canUseTool` `[run]`.

`allowedTools` does not restrict tools. To remove a tool use `tools` or `disallowedTools` `[docs]`.

---

## 5. State machine

### 5.1 States

| State | Meaning | Enter when | Leave when |
|---|---|---|---|
| `queued` | Waiting for admission | Created | Limits allow |
| `spawning` | Process starting | `query()` | `initializationResult()` resolves, or spawn failure goes to `crashed` |
| `ready` | Process up, no prompt yet | Init done | First send |
| `running` | A turn is active | Send, or approval answered | `result`, or approval needed |
| `awaiting_approval` | Blocked on a human | `canUseTool` entered | Answered, or `signal` aborts |
| `idle` | Process up, turn done | `result` bound to a send | Send, stop |
| `parked` | Turn ended on `tool_deferred` | `terminal_reason: tool_deferred` | Resume with an answer |
| `budget_exhausted` | Cap hit | `terminal_reason: budget_exhausted` | Resume with more budget |
| `rate_limited` | Plan limit | `rate_limit_event.status: rejected`, UNVERIFIED trigger | `resetsAt` passes |
| `stopping` | Stop in progress | `stop()` | Exit |
| `exited` | Process gone cleanly, resumable | Iterator ends, or exit 1 after an error result | Resume |
| `crashed` | Process gone unexpectedly, resumable | Iterator throws with no error result | Sweep, then resume |
| `lost` | Kernel restarted while live | Boot reconcile | Sweep, then resume or close |
| `closed` | Done, worktree handled | User or policy | Terminal |

`awaiting_approval` needs a counter, not a flag, in case several requests overlap across subagents.

### 5.2 `result` to state

Read `terminal_reason`, not `subtype`.

| `terminal_reason` | `subtype` seen | Next state |
|---|---|---|
| `completed` | `success` | `idle` |
| `aborted_streaming` | `success` | `idle`, turn marked aborted |
| `aborted_tools` | `error_during_execution`, or `success` with `priority: 'now'` | `idle`, turn marked aborted |
| `max_turns` | `error_max_turns` | `idle`, UI offers continue |
| `budget_exhausted` | `error_max_budget_usd` | `budget_exhausted` |
| `tool_deferred` | `success` | `parked` |

Others exist `[code]`: `blocking_limit, rapid_refill_breaker, prompt_too_long, image_error, model_error, api_error, malformed_tool_use_exhausted, stop_hook_prevented, hook_stopped, background_requested, structured_output_retry_exhausted, tool_deferred_unavailable, turn_setup_failed`. Treat unknown values as `idle` with an error badge.

Ignore a `result` with `num_turns: 0` and no `user_message_uuid`.

`session_state_changed` frames (`running`, `requires_action`, `idle`) appeared only with `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`, and that variable is not in the docs pages read. The session file derives from the same signal `runtime-formats.md`. The driver does not need them.

### 5.3 Kernel restart

Default spawn means agents do not survive the kernel `[run]`.

**Planned shutdown:** call `stop()` on every agent and persist state. UNVERIFIED as a whole, each step is `[run]`.

**Boot reconcile.** UNVERIFIED as a whole.

1. Load agents in live states and mark them `lost`.
2. Check each recorded `pid` and `procStart`, using the liveness rules in `runtime-formats.md`.
3. Kill orphans. While agents run, the kernel records each Bash tree as `{pid, creationDate}` from section 3.4, on Bash start. At boot, kill each row still alive with the same creation date, using `taskkill /PID <pid> /T /F`.
4. Only then offer resume: with a prompt, or with `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1`, knowing the interrupted command may be re-issued.
5. Approvals that were pending are gone. The resumed model asks again.

**Should agents survive a kernel restart?** `detached: true` through `spawnClaudeCodeProcess` does keep the child alive `[run]`. Do not use it by default:

- The stdio pipes die anyway, so the agent cannot be reattached. It finishes its current turn blind and exits.
- That turn can be long and it spends unsupervised.
- Nothing can answer a permission request, so those calls fail.

If agents must outlive the kernel, for example because agents will restart the kernel while rebuilding it, put `query()` in a small per-agent host process that owns the pipes and talks to the kernel over a named pipe. UNVERIFIED: not built here. `ManagedAgent` has the right shape to move behind that boundary.

---

## 6. Budget and rate limit handling

**Two different limits.** On Max, `total_cost_usd` is a list-price estimate and no money moves per call. What ends work is the plan window. Show both, and treat the plan window as the real constraint.

**Per agent** `[run]`:

- `maxBudgetUsd` is a soft cap. It overshoots by up to one API call. Set it below the real limit.
- After the cap every send fails at once. Recover by resuming with a new budget, which counts only new spend `[docs]`.
- `maxTurns` is per send. Use it for runaway control.
- `result` is the only reliable total, and it is missing after a kill. Then use `cost-state`, else sum `assistant` usage. Output tokens are unrecoverable that way `[docs]`.

**Per tree, in the kernel.** UNVERIFIED design.

- Keep `treeSpent = sum(latest total_cost_usd per agent)`. Do not add resumed totals twice.
- Give a child `min(requested, parentRemaining)` at spawn.
- At 100 % of a tree budget, refuse spawns and stop the tree.
- `subagent_stats.refused.budget` shows native subagent refusals.

**Rate limits.** `rate_limit_event.rate_limit_info` as seen:

```json
{ "status": "allowed", "resetsAt": 1793414400, "rateLimitType": "five_hour",
  "overageStatus": "rejected", "overageDisabledReason": "out_of_credits", "isUsingOverage": false,
  "unifiedWindows": { "five_hour": { "utilization": 0.08, "resetsAt": 1793414400, "status": "allowed" },
                      "seven_day": { "utilization": 0.03, "resetsAt": 1793890800, "status": "allowed" } } }
```

It came once per process, on the first API response, in all 4 runs checked. `unifiedWindows` is not in `sdk.d.ts`. Utilization is 0 to 1 here, while `~/.claude.json` uses 0 to 100 `runtime-formats.md`.

So the event alone does not refresh a long-lived agent. Use it at each spawn, plus the `cachedUsageUtilization` source in `runtime-formats.md`. `q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })` works with no model call, but its name is a warning and its shape contains code-named keys. Use it only as a last resort.

| Signal | Reaction, UNVERIFIED because no limit was hit |
|---|---|
| `status: allowed_warning` | Banner. Stop admitting new agents at high utilization |
| `status: rejected` | Freeze admission. Mark agents `rate_limited`. Schedule at `resetsAt` |
| `system/api_retry {attempt, max_retries, retry_delay_ms, error_status, error}` `[code]` | Show `retrying`. Do not call it stalled |
| `assistant.error` `rate_limit`, `overloaded`, `billing_error` `[code]` | Show on the turn |

The CLI retries transient failures up to 10 times, and retries `429` throttles without plan quota headers `[docs]`. `CLAUDE_CODE_RETRY_WATCHDOG=1` retries `429` and `529` indefinitely for unattended sessions `[docs]`, and can then wait for a usage limit to reset `[docs]`. Whether a Max window hit fails or waits by default is UNVERIFIED.

**Fan-out and quota.** "Each session uses your subscription quota independently" `[docs]`. Six concurrent agents ran with no contention `[run]`. RAM is not the constraint at about 200 MB per idle agent `[run]`, though docs suggest planning 1 GiB per agent `[docs]`. Quota is the constraint.

Starting limits, UNVERIFIED judgement: 6 running agents, 16 alive, stop admitting at 80 % of the five-hour window.

---

## 7. Windows gotchas

| # | Gotcha | What to do |
|---|---|---|
| 1 | The SDK never kills a tree. `kill` is `TerminateProcess` on one PID `[code]` `[run]` | `stop()` order from section 3, `taskkill /T /F` as fallback |
| 2 | `close()` and `abort()` during a tool leave orphans `[run]` | Never as the first step |
| 3 | The kernel dying kills `claude.exe` and MCP servers but not Bash trees `[run]` | Record trees, sweep at boot |
| 4 | A killed process leaves a stale `<pid>.json` `[run]`, until another Claude process sweeps it `[code]` | Check liveness, never trust `status` alone |
| 5 | Exit code 1 after an error result, and the SDK throws `[run]` | Not a crash. See `#pump` in the driver |
| 6 | `taskkill` output is localized: `ERFOLGREICH...` on this machine `[run]` | Use the exit code, not the text |
| 7 | A missing `cwd` fails as `ReferenceError: Claude Code native binary at ... exists but failed to launch` `[run]`. Misleading | Check that `cwd` exists before spawn |
| 8 | Hook commands run through Git Bash, which eats backslashes. The user's own `SessionStart` hook fails with exit 127 for this reason `[run]` | Use forward slashes in hook commands. Reported in the final summary |
| 9 | Bash tool guard: `Blocked: sleep 30 followed by: echo done`, with a hint to use `Monitor` or `run_in_background` `[run]` | Not a kernel bug. The model sees the error and adapts. Use another command in tests |
| 10 | Tool output gains `Shell cwd was reset to <cwd>` `[run]` | Harmless. Hide it in the UI if it is noisy |
| 11 | Paths use backslashes in tool input, and `~\...` in `description` `[run]` | Normalize before comparing. Compare case-insensitively |
| 12 | PIDs get reused | Pair with creation time. `procStart` and CIM differ slightly, see `runtime-formats.md` |
| 12a | `ParentProcessId` keeps a dead parent's pid, and that pid gets reused | A user's app can name one of our shells as its parent. 2 of 324 processes were in that state on a normal day, and a chat client appeared in a craft's tree in a real run. Any walk must drop a child older than the holder of its parent pid (`descendants`). `taskkill /T` is assumed to follow the same chain, unproven, so `treeKill` uses it only when the walk finds no stranger, and otherwise kills the real tree pid by pid |
| 13 | `Get-CimInstance` costs about 1.2 s here `[run]` | Boot and sweeps only |
| 14 | No command sandbox on native Windows `[docs]` | Do not set `failIfUnavailable`, Claude Code exits at startup `[docs]`. Rely on section 4 |
| 15 | Worktree checks do not track what shell commands write, and for PowerShell only the working-directory check applies `[docs]` | Keep human approval on Bash and PowerShell for write operations |
| 16 | Each child binds an inbox pipe and appears to other sessions as a peer. `messagingSocketPath` is set `[run]`. Inbound is accepted by default `[docs]` | Set `crossSessionInbound: 'refuse'` in `settings` unless wanted. A run accepted the setting, but its effect was not exercised, UNVERIFIED |
| 17 | A plugin list on argv can hit the 32,767 character limit `[code]` | `pluginDelivery: 'initialize'` |
| 18 | The binary sits in an optional dependency, 301 MB `[run]` | Do not install with optional dependencies omitted |
| 19 | Deep worktree paths and `node_modules` can hit path limits. UNVERIFIED | Keep ids short. Project folder names over 200 characters are hashed `[docs]` |

---

## 8. Recommended options per use case

Base for every managed agent. These options passed `tsc --strict` and ran together once in `base-check.ts`, with the trusted-repo row below: all three setting sources, the hybrid worktree and `projectConfigRoot`.

```ts
const base: Partial<Options> = {
  model, effort, cwd, maxBudgetUsd, maxTurns,
  sessionId, title: `agentos:${id}`,            // known before spawn, visible to the Observer
  permissionMode: 'default',                    // never leave it to settings
  canUseTool, includePartialMessages: true,
  env: agentEnv({ CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2', CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '5' }),
  hooks: { PreToolUse: [{ hooks: [audit] }] },  // sees auto-approved calls too
  settings: { disableClaudeAiConnectors: true, crossSessionInbound: 'refuse' },
  disallowedTools: ['CronCreate', 'CronDelete', 'RemoteTrigger', 'ScheduleWakeup', 'PushNotification',
                    'SendToProject', 'SendToProjectContext', 'EnterWorktree', 'ExitWorktree', 'Bash(claude *)'],
  stderr: logToAgentFile,
};
```

Why that deny list: these tools create state outside the kernel's view, such as schedules, cloud triggers and nested Claude runs. The default built-in tools seen were `Task, Bash, CronCreate, CronDelete, CronList, DesignSync, Edit, EnterWorktree, ExitWorktree, Glob, Grep, ListAgents, Monitor, NotebookEdit, PowerShell, PushNotification, Read, RemoteTrigger, ReportFindings, ScheduleWakeup, SendMessage, SendToProject, SendToProjectContext, Skill, TaskStop, ToolSearch, WebFetch, WebSearch, Workflow, Write` `[run]`. `AskUserQuestion` and `ExitPlanMode` were not in that list, which had no callback, and both worked when a callback was present and named in `tools` `[run]`.

Results of `base-check.ts`: `cwd` was the worktree, `name` was `agentos:base-1`, the assigned `sessionId` matched, claude.ai connectors were absent, no denied tool was offered, the approved `touch` wrote only into the worktree, the main checkout's hook ran rather than a branch's, and `claude --version` was denied by `Bash(claude *)` without reaching the callback. Plugin and user MCP servers still load under `user` settings, so 9 entries appeared with `needs-auth` or `failed` status. That rule matches commands as written, so indirection can get past it `[docs]`.

`SendMessage` is also how subagents talk, so denying it has a cost `[docs]`. Leave it in by default, and set `crossSessionInbound: 'refuse'` for inbound.

| Use case | Add to base |
|---|---|
| **Build in a trusted repo** | `settingSources: ['user','project','local']`, hybrid worktree, `projectConfigRoot: repoRoot`. Costs about 23k context tokens at start. One two-command turn cost $0.0050 `[run]` |
| **Unknown repo** | `settingSources: []`, `strictMcpConfig: true`, no worktree hooks run, tighter `tools` |
| **Read-only analyst** | `permissionMode: 'dontAsk'`, `tools` and `allowedTools` = `['Read','Glob','Grep']` `[docs]` |
| **Unattended long job** | `permissionMode: 'auto'` `[run]`, hybrid worktree, low `maxBudgetUsd`, `CLAUDE_CODE_RETRY_WATCHDOG=1` `[docs]`. Keep `canUseTool` for what the classifier refers on |
| **Plan first** | `permissionMode: 'plan'`, include `ExitPlanMode`. Plan text arrives at the callback `[run]`. Plan files land in `~/.claude/plans/` `[run]` |
| **Orchestrator** | `tools` minimal, `mcpServers: { os: inProcess }`, `allowedTools: ['mcp__os__*']`, section 12 |
| **Scratch, no history** | `persistSession: false`, invisible to transcript readers `[run]` |
| **Mass parallel inside one agent** | Native `Agent` tool or `Workflow`, with the env caps above |

Never: `bypassPermissions` on this machine, an omitted `permissionMode`, `allowedTools` used as a restriction, `localSettings` suggestions passed through unfiltered, or a finite `streamInput`.

For long sessions, `CLAUDE_CODE_TRANSCRIPT_LOCAL_GC=1` caps transcript size `[docs]`, and there is no top-level session timeout `[docs]`, so the kernel owns that.

---

## 9. Approvals in the UI

### 9.1 Kernel flow

The driver holds the mechanics. The event names here are a design, UNVERIFIED. The mapping to SDK calls is `[run]`.

```ts
// kernel to UI
{ type: 'approval.requested', agentId, requestId, toolUseID, toolName, input, displayName, description,
  blockedPath, decisionReason, subagentId, mcpServer, canRememberForSession, createdAt }
{ type: 'approval.cancelled', agentId, requestId, reason }   // from the abort signal
// UI to kernel
{ type: 'approval.answer', agentId, requestId, decision: { kind, input?, message? } }
```

1. `canUseTool` fires. Persist the record, set `awaiting_approval`, push to the UI.
2. The UI answers. `answer()` applies the first answer and returns `false` for any later one `[run]`, so two open tabs are safe.
3. On `signal` abort, delete the record and tell the UI to remove the card. Otherwise the UI shows a dead approval forever.
4. Key records by `requestId`. A deferred resume can ask twice for one `toolUseID` `[run]`.
5. On a kernel restart, records are void. Show them as expired, section 5.3.

There is no timeout `[code]`. The UI shows age, and any auto-deny is policy, not protocol. Waiting costs nothing, but the process stays in memory. For overnight waits use `defer`, then let the process exit and resume with `canUseTool` `[run]`.

### 9.2 Decision to return value

| Button | Return | Note |
|---|---|---|
| Approve | `{ behavior: 'allow', updatedInput: input }` | |
| Edit and approve | `updatedInput` changed | Model is not told `[run]`. Show this in the audit log |
| Always this session | Add `updatedPermissions` | Copy `addRules` suggestions with `destination: 'session'` `[run]`. `Write` offers only `setMode`, so send `{ type: 'addRules', rules: [{ toolName: 'Write' }], behavior: 'allow', destination: 'session' }` `[run]` |
| Deny | `{ behavior: 'deny', message }` | Text reaches the model exactly `[run]` |
| Deny and stop turn | `{ behavior: 'deny', message, interrupt: true }` | Message is lost `[run]`. Send guidance as the next prompt |
| Redirect | Send with `priority: 'now'` | Cancels the approval and runs the new message `[run]` |

Rules:

- **Never pass `localSettings` suggestions through by default.** They write `.claude/settings.local.json` into the repo or worktree `[docs]`. Offer that only as an explicit "always in this project" action.
- **Word denials for one call**, such as "Not approved for this call." A policy-like sentence made the model refuse six later prompts without calling the tool `[run]`.
- Honour `defaultToNo` by opening on decline, and hide "always" for `suppressAlwaysAllowRule` `[code]`.
- `mcpServer.name` is untrusted text unless `source` is `sdk` `[code]`. Escape it.
- `decisionReason: "Path is outside allowed working directories"` is how a host spots an escape in a plain-`cwd` agent `[run]`. Default that card to deny.

### 9.3 Rendering by tool

| Tool | Show |
|---|---|
| `Bash`, `PowerShell` | `command`, `description`, `blockedPath` |
| `Write` | `file_path`, content preview |
| `Edit` | `file_path`, diff from `old_string` and `new_string` `[docs]` |
| MCP | Server, source, tool, arguments |
| `AskUserQuestion` | A form from `questions[]`. Answer with `updatedInput: { questions, answers: { [question]: label } }`. Model replied "Your answer is blue" `[run]` |
| `ExitPlanMode` | `plan` as Markdown. Approve to proceed `[run]` |
| Inside a subagent | Tag with `agentID` and the subagent type from `task_started` |

Limits: `AskUserQuestion` is not available in subagents, and takes 1 to 4 questions with 2 to 4 options `[docs]`.

---

## 10. Isolation: decision

**Use the hybrid.** The kernel creates the worktree, and the binary adopts and enforces it.

| Property | Plain `git worktree` + `cwd` | CLI flag `extraArgs: { worktree }` | **Hybrid: kernel creates, flag adopts** |
|---|---|---|---|
| Branch | Any | `worktree-<name>` from the default branch | Any, kept: `agent/pre-1` |
| Location | Anywhere | `<repo>/.claude/worktrees/<name>` | Same as flag |
| Host-approved write to main checkout | **Succeeds** | Blocked | Blocked, before `canUseTool` |
| Block text | None | `<tool_use_error>This session is isolated in the worktree <path>. Edit the worktree copy of this file instead of the shared-checkout path.</tool_use_error>` | Same. The model then wrote inside its worktree when not told otherwise |
| Project hooks | Worktree's, so a branch can run its own hook | Not tested | Main checkout's with `projectConfigRoot` |
| Transcript store | Encoded worktree path | Encoded worktree path | Encoded worktree path |
| Resume from repo root | Stays at repo root | Not tested | **Re-enters the worktree** |
| Git lock | None | `locked claude session <name> (pid N)`, stays after exit | Same |
| Base branch choice | Any | `worktree.baseRef`: `fresh` or `head` only `[docs]` | Any |

All rows `[run]` except where tagged.

```text
1. git worktree add <repo>/.claude/worktrees/<id> -b agent/<id> <base>
2. query({ cwd: repo, extraArgs: { worktree: id }, projectConfigRoot: repo, ... })
3. resume with cwd: repo. The binary returns to the worktree
4. cleanup: git worktree unlock, git worktree remove, then the branch
```

Details:

- **Unlock first.** SDK runs leave the lock in place `[run]` `[docs]`.
- `extraArgs` is an untyped pass-through, so pin the SDK and retest on upgrades. There is no typed SDK worktree option `[code]`.
- `.claude/` shows as untracked in the main checkout `[run]`. Add `.claude/worktrees/` to `.git/info/exclude` so the repo itself is not touched. UNVERIFIED in a run.
- A reused worktree that is clean and on a Claude-created branch can reset to the default branch `[docs]`. Using the `agent/<id>` branch avoids that condition. Not separately tested, UNVERIFIED.
- Worktrees are fresh checkouts, so install steps are the agent's job. `.worktreeinclude` copies ignored files like `.env` for worktrees Claude creates `[docs]`. Hybrid worktrees are created by git, so the kernel must copy them. UNVERIFIED.
- `main-skill`, untracked in the main checkout, was visible from a worktree with no `.claude/skills` `[run]`. The main checkout's `CLAUDE.md` was not `[run]`.
- `CLAUDE.md` always comes from the worktree `[run]`, even with `projectConfigRoot`. A branch can change instructions, though not hooks.
- Subagent `isolation: worktree` works in file-based agent definitions `[docs]`. `AgentDefinition` in the SDK has no `isolation` field `[code]`.
- Non-git folders get no isolation. `--worktree` errors there unless a `WorktreeCreate` hook exists `[docs]`.

---

## 11. Native features: build on, do not rebuild

| Feature | Decision | Why |
|---|---|---|
| Agent loop, tools, compaction, retries, MCP client | **Do not rebuild** | The binary owns them |
| Permission evaluation | **Do not rebuild** | Kernel only answers step 6 and adds hooks |
| Transcripts and resume | **Build on** | Kernel stores ids and state, not conversations. Retention is 30 days `[docs]`, so copy out what must last |
| Budget enforcement per query | **Build on** `maxBudgetUsd` | Kernel adds the tree layer |
| Native subagents | **Build on, for work inside one agent** | Observable through `task_*` frames and `agentID` `[run]`. Default depth 3, 20 concurrent `[docs]`. Do not recreate per-agent delegation |
| Dynamic workflows | **Build on** for wide jobs, behind a profile | Available in the SDK as `Workflow` `[docs]`. Not run here |
| Worktree enforcement | **Build on** | Section 10 |
| `permissionMode: auto` classifier | **Build on** for unattended work | `[run]` |
| Hooks | **Build on** in-process callbacks | Filesystem hooks need settings changes |
| Agent view and `claude --bg` | **Observe only** | Research preview `[docs]`. Approvals need attaching to a terminal, so a daemon cannot drive them. A running background session rejects a daemon's prompt: piped output exits 1 `[docs]`. Show through `runtime-formats.md` section 6 |
| Agent teams | **Do not build on** | Experimental, off by default. "In non-interactive mode with the `-p` flag, including Agent SDK sessions, Claude doesn't spawn teammates" `[docs]`. Split panes do not work in Windows Terminal or VS Code `[docs]`. No resume for in-process teammates, one team per session, no nesting `[docs]` |
| Cross-session messaging | **Later, for foreign sessions** | Plan in `runtime-formats.md` section 8. Managed agents do not need it, because the kernel holds their streams `[run]` |
| Multi-agent across projects, approvals UI, tree budgets, live view | **This is what we build** | Nothing native covers them |

Do not parse `~/.claude/jobs/` as an API: "not a stable interface" `[docs]`.

---

## 12. Orchestrator MCP tools

### 12.1 Shape

A managed agent gets an in-process server per agent, `createSdkMcpServer`, created in the closure that knows its identity `[run]`.

- **Identity cannot be spoofed.** It comes from the closure, not from tool arguments. `extra.sessionId` is undefined, so it cannot serve here `[run]`.
- **No process to orphan** `[run]`.
- **Connected immediately** `[run]`.

Foreign sessions, such as the user's own CLI or VS Code session, need a stdio or HTTP shim that talks to the kernel. Env injection works for stdio `[run]`, but a user-configured shim cannot carry a kernel-issued identity, so treat those callers as `external` with lower limits. The shim itself is UNVERIFIED.

### 12.2 Tools

Design, UNVERIFIED. `agent_spawn` and `agent_wait` ran in minimal form.

| Tool | Input | Returns | Notes |
|---|---|---|---|
| `agent_spawn` | `prompt, project?, profile?, model?, budget_usd?, worktree?, title?, idempotency_key?` | `{agent_id, status}` at once | Never blocks |
| `agent_status` | `agent_id` | State, cost, last activity, pending approval count | Cheap |
| `agent_wait` | `agent_id, timeout_s` (max 60) | Status and result if done | Bounded, returns `running` on timeout |
| `agent_send` | `agent_id, text, interrupt?` | Send uuid | `interrupt` maps to `priority: 'now'` |
| `agent_stop` | `agent_id` | Final state | Runs `stop()` |
| `agent_list` | `scope: children, tree` | Rows | Own tree only |

Rules:

- **Do not block for long.** The default `MCP_TOOL_TIMEOUT` is about 28 hours `[docs]`, but a long call can be moved to the background automatically `[docs]`. Bound `agent_wait`.
- **Push completion when asked.** The kernel can enqueue a line such as `agent 123 finished, see agent_status` into the parent's input, which starts a turn if it is idle `[run]` for the mechanism. It costs a turn, so make it opt-in.
- **`alwaysLoad`** on stdio shims avoids a `ToolSearch` turn `[run]`. For in-process servers leave `ToolSearch` out of `tools`, or set per-tool `_meta` `[code]`.
- **Allow-list `mcp__os__*`** for orchestrator profiles, because limits sit in the handlers. Others go through approval.
- **`idempotency_key`** stops a duplicate spawn when the model retries after an error.

### 12.3 Recursion and fan-out

Enforce every limit in the handler. Prompts only suggest. The spike's guard refused a real grandchild with `isError: true` and the text `refused: depth limit 1 reached` `[run]`.

| Limit | Start value, UNVERIFIED | Enforced by |
|---|---|---|
| Depth of OS-spawned agents | 2 | Closure `depth` |
| Children per agent | 4 | Handler |
| Live agents per tree | 8 | Kernel |
| Running agents, global | 6 | Admission |
| Alive agents, global | 16 | Admission |
| Spawns per tree per minute | 10 | Handler |
| Child budget | `min(requested, parent remaining)` | Handler |
| Tree budget | Set at root | Kernel |
| Native subagents per agent | Depth 2, 5 concurrent | `CLAUDE_CODE_MAX_*` env |

Native and OS depth multiply: 2 OS levels with 2 subagent levels is 4 layers. Native limits cannot be disabled, only adjusted `[docs]`.

### 12.4 Authority

- **A parent cannot approve for a child.** Approvals always go to the human. Peer messages are not consent `[docs]`, and the kernel must not build a route around that.
- A child's profile is the parent's profile or stricter. `agent_spawn` cannot widen it.
- Child output returned to a parent is data, and may contain injected instructions. Return it as tool results, never as a user message.
- `agent_send` text arrives as a user message. Stamp `origin` on it: `{ kind: 'peer', from, name }` for agents, `{ kind: 'human' }` for the UI. An absent origin is treated as unattributed `[code]`. Behaviour in a run is UNVERIFIED.
- `verbatimPrompts: true`, or `client_composed` per message, stops `@path` expansion and slash-command dispatch on agent-composed prompts `[code]`. It also skips turn-start context `[code]`. Recommended for `agent_send`, UNVERIFIED in a run.
- Nested `claude` in Bash escapes all of this. `Bash(claude *)` denied `claude --version` `[run]`, but it matches commands as written `[docs]`, so treat it as best effort.

---

## 13. Observer dedupe contract

The kernel keeps a `managed_sessions` table: `agentId, sessionId, pid, procStart, cwd, worktree, parentAgentId, startedAt, endedAt`.

| Rule | Evidence |
|---|---|
| Assign `sessionId` at spawn and write the row before calling `query()` | Honoured `[run]` |
| Match pid files on `sessionId`, then `pid` | `kind` and `entrypoint` cannot separate them `[run]` |
| Fallback: `name` starts with `agentos:`, `nameSource: auto` | `[run]` |
| After exit, `custom-title` in the transcript carries the same marker | `[run]` |
| Resume keeps `sessionId` with a new `pid`. Update the row | `[run]` |
| Fork makes a new `sessionId`. Add a row | `[run]` |
| `/clear` gives a new `session_id` `[docs]`. Follow `system/init` | Driver updates `sessionId` from init |
| Worktree agents live under the encoded worktree path. Group by repo | `[run]` |
| A stale pid file with a dead process is not a live agent | `[run]` |

Do not spoof `CLAUDE_CODE_ENTRYPOINT`. It works `[run]`, but `sdk.mjs` branches on the value `[code]`, so behaviour may change.

The kernel feed outranks the transcript for managed agents: frames arrive live, while transcript blocks reach disk only when a response ends `runtime-formats.md`.

Answers for `runtime-formats.md` open items: item 5, worktree transcripts sit under the encoded worktree path. Item 7, a stale pid file reproduces after a hard kill, and is later removed.

---

## 14. What we could not verify

| Topic | Why |
|---|---|
| Behaviour at a real plan limit: `rejected`, wait or fail, `api_retry` frames | Could not reach a limit at this spend. Section 6 reactions are UNVERIFIED |
| Whether a `rate_limit_event` re-fires on status change | Saw only the first one per process |
| Memory growth, compaction and long sessions | Spike sessions lasted seconds |
| Stop behaviour with a running subagent, or background subagents | Only Bash tool trees were tested |
| PowerShell tool trees under stop and kill | Only Bash tested |
| Background Bash when the parent dies | Foreground only. Expect orphans |
| Folding a queued send between tool rounds; `priority: 'next'` and `'later'` | Not observed |
| `origin`, `verbatimPrompts`, and the effect of `crossSessionInbound` | Read, or accepted by a run, but never exercised |
| `startup()`, `prewarm()`, `sessionStore`, `forwardSubagentText`, `agentProgressSummaries`, `onElicitation`, `rewindFiles` | Read, not run |
| HTTP or stdio shim for foreign sessions | Built as `control/mcp-shim.ts`, stdio. Ran for real: six tools, `approval.answer` refused with 403 |
| Per-agent host process | Not built |
| Agent teams, dynamic workflows, `claude --bg` | Docs only, by design |
| Job-object mechanism behind parent-death kills | Behaviour is `[run]`, cause is inferred |
| Console windows with `detached: true` | Ran with `windowsHide: true`. Nothing can be seen from here |
| Scale past 6 concurrent agents, sustained load | Not tested |
| Long worktree paths | Not tested |
| Accuracy of `total_cost_usd` against real plan consumption | Estimate by definition. Classifier calls are excluded `[code]` |
| Exact Haiku cache-read price | Input $0.10, output $0.50 and 1 h cache write $0.20 per MTok fit two results exactly. See `runtime-formats.md` section 3.4 for the full formula |

---

## 15. Side effects and spend

**Spend.** 92 ledger entries.

| Source | Amount |
|---|---|
| Reported `total_cost_usd` | $0.0738 |
| Estimated, 13 runs with no `result` | $0.0101 |
| **Ledger total** | **$0.0839** |
| Independent check: `cost-state` of 70 sessions plus usage of 12 others | $0.0778 |

The ledger is the higher and the headline figure. The most expensive single run was the first one, $0.0079, with connectors loaded by accident.

**Left behind by design.** Rules said not to clean the scratchpad, and not to modify `~/.claude`.

- Spike code, logs and ledger: `scratchpad/spike`. Raw frames are in `spike/out/`.
- `~/.claude/projects/`: 7 project folders for spike working directories, 84 files, 3.7 MB. The binary wrote these as part of running.
- `~/.claude/plans/plan-how-to-create-unified-oasis.md`: written by the plan-mode test agent. Not expected, and not deleted, since the rule forbids modifying `~/.claude`.
- `~/.claude.json` and other binary bookkeeping may have changed through normal operation. Not inspected, UNVERIFIED.
- `spike-wt-repo`: a shallow clone of `octocat/Hello-World`, used so worktree tests had a base commit without making one. It holds 5 worktrees, 4 of them locked. `spike-workspace` has no commits. No commit was made anywhere.

No process from the spike is still running: a final scan found none. `.credentials.json` and `sessions/*.key` were never opened. A directory listing showed the file name `daemon/pipe.key`, which was not opened either. The `SessionStart` hook script was read before any child could run it, and it ran in the settings spike and `base-check.ts`, failing with exit 127 each time. The `PostToolUse` hook was not read, and could not fire, because no `Edit` or `Write` ran under user settings. No message text from other projects was read.
