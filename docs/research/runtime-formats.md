# Claude Code runtime formats for the Observer plane

Measured on 2026-10-30 on this machine: Windows 11, Node 24.14, Bun 1.3.13.
Running session: build 2.1.314. `claude` on PATH: 2.1.224. Agent SDK read: 0.3.314.

**How claims are marked.** Everything here is VERIFIED unless it carries the word UNVERIFIED. The bracket says how it was verified:

| Tag | Meaning |
|---|---|
| `[run]` | Measured or executed on this machine during this research |
| `[census]` | Counted from all transcripts: 302,287 records in 2,016 transcript files, 2.2 GB, version range 2.1.261 to 2.1.314 |
| `[code]` | Read as text inside the 2.1.314 native binary or the SDK 0.3.314 package. Nothing from them was run for this reading |
| `[docs]` | Read in code.claude.com/docs on 2026-10-30 |

The on-disk format is internal. The docs say scripts that parse these files "can break on any release" `[docs]`. One transcript can hold up to 6 CLI versions `[census]`. Every parser below must ignore unknown types and fields.

Transcripts hold private work. This report contains structure only. The UI should also keep message text out of default views, logs and telemetry.

---

## 0. What changes the plan

| # | Finding | Consequence for the build |
|---|---|---|
| 1 | Assistant blocks reach disk only when the API response ends, not while they stream. In main transcripts, 10,258 of 10,263 non-final block records already carry the final `stop_reason`, across responses up to 411 s long `[run]` `[code]` | "Thinking" and "writing text" cannot be shown live from disk. Show `generating`, and label the block type after the fact |
| 2 | Workflow agent records were up to 46 s old when they reached disk, main session records at most 1.3 s `[run]` | A live agent view is live per API response, not per token. Do not raise stall alarms under 120 s |
| 3 | A running workflow has no state file. `<sid>/workflows/<runId>.json` appears only at the end `[run]` `[census]` | Running means journal present, no state file, owner session alive |
| 4 | `api-request` is written at request start: 13 to 77 ms after its timestamp on agents, 28 to 643 ms on main `[run]` | It is the only on-disk marker for "model call in flight". Present since 2.1.300 `[census]` |
| 5 | `updatedAt` in the pid file is not a heartbeat. It was 30 minutes old on a busy session `[run]` | Never derive liveness from it. Use `process.kill(pid, 0)` plus the pipe listing |
| 6 | `open` + `close` costs 1.68 ms here, `stat` 0.06 ms `[run]` | Stat first, open only when size changed. Eagerly reading 1,991 `meta.json` files took 1.9 to 3.2 s |
| 7 | `cwd` is not constant: up to 19 distinct values in one main transcript `[census]` | Project root comes from the first `cwd`, never the last |
| 8 | One session's folder can exist under several project slugs: 3 of 14 session trees did `[census]` | Find agent files by `projects/*/<sid>/`, not only under the main file's slug |
| 9 | The input and output prices in the brief are right, but cache prices are model specific, and haiku-5-5 has a long prompt tier `[code]` | Use the formula in 3.4. It matched `cost-state` to within 0.4 % on 7 of 9 clean sessions |
| 10 | `claude agents --json` takes 536 to 1,148 ms and no longer than the pid file gives you `[run]` | Do not poll it. The sessions folder answers in 0.24 ms |
| 11 | A read-only observer cannot message a running session. On Windows the inbox needs a per-session key `[docs]` | Reaching foreign sessions needs an OS-owned Claude session using `SendMessage`, see section 8 |
| 12 | The PATH CLI (2.1.224) is older than the Windows minimum for cross-session messaging (2.1.234) `[run]` `[docs]` | The control plane must run the SDK's bundled binary, not the PATH CLI |

### Corrections to the brief

| Brief said | Measured |
|---|---|
| `<sessionId>/.brain` | It is `<slug>/memory/.brain/` `[run]` |
| Max line about 1.2 MB, files reach 6 MB | Max line 1,888,981 bytes. Main transcripts reach 94.4 MB, workflow agents 21.3 MB `[census]` |
| Journal records `launched`, `started`, `result` | Also `failed` (95 seen). Code adds `restoring`, `restored`, `resumed` `[census]` `[code]` |
| 24 main transcripts | True at census time. Other agents in this workflow ran SDK sessions, so it was 50 at index time `[run]` |
| "VS Code session" | The process runs from the Cursor extension folder. `entrypoint` is still `claude-vscode` `[run]` |
| 16 record types | 21 seen, 41 known to the 2.1.314 reader `[census]` `[code]`, see 3.1 |

---

## 1. Map of `~/.claude`

`~` is `%USERPROFILE%`. Honor `CLAUDE_CONFIG_DIR`: everything below moves with it, including `.claude.json` `[docs]`.

### Read by the Observer

| Path | Holds | Size here |
|---|---|---|
| `sessions/<pid>.json` | One record per live process | 600 bytes each |
| `projects/<slug>/<sid>.jsonl` | Main transcript | median 4.8 MB, max 94.4 MB |
| `projects/<slug>/<sid>/subagents/agent-<id>.jsonl` | Subagent transcript | 46 files, median 1.2 MB, max 4.2 MB |
| `.../subagents/agent-<id>.meta.json` | Subagent metadata | 45 files, about 200 bytes |
| `.../subagents/workflows/wf_<id>/agent-<id>.jsonl` | Workflow agent transcript | 1,946 files, 1.86 GB, median 545 KB, max 21.3 MB |
| `.../subagents/workflows/wf_<id>/agent-<id>.meta.json` | Workflow agent metadata | 1,946 files |
| `.../subagents/workflows/wf_<id>/journal.jsonl` | Run journal | 75 files, 15.1 MB, max 2.6 MB |
| `projects/<slug>/<sid>/workflows/wf_<id>.json` | Final run state | 73 files, 10 MB |
| `projects/<slug>/<sid>/workflows/scripts/<name>-wf_<id>.js` | Run script | 63 files |
| `~/.claude.json`, key `cachedUsageUtilization` only | Plan usage snapshot, see 7 | 84 KB file |

Sizes are `[run]`.

### Present but not needed

| Path | Holds |
|---|---|
| `projects/<slug>/<sid>/tool-results/` | Spilled tool output: `.txt`, `.jpg`, `.pdf`, `.bin`, `.html`, `pdf-<uuid>/`. Private content. Use its size at most |
| `projects/<slug>/memory/*.md`, `memory/.brain/` | Auto memory. Private |
| `projects/<slug>/bridge-pointer.json` | Remote Control pointer: `sessionId`, `environmentId`, `source` |
| `projects/<slug>/<sid>/auto-mode-classifier-error.txt` | Error dump, private |
| `projects/<slug>/<sid>/custom-title.json` | Title sidecar read by the SDK `[code]`. None on this machine |
| `projects/<slug>/<sid>/mcp-tasks/` | MCP task state `[docs]`. None here |
| `projects/<slug>/<sid>.orphaned-*.jsonl`, `<sid>.jsonl.superseded-*` | Set-aside transcripts `[docs]`. Skip. None here |
| `file-history/<sid>/` | Pre-edit file snapshots. Private |
| `session-env/<sid>/` | 53 folders, all empty |
| `telemetry/1p_failed_events.<sid>.<uuid>.json` | Failed uploads of `ClaudeCodeInternalEvent`. Keys `event_type`, `event_data` |
| `cache/model-catalog/*.json` | Model metadata such as `max_input_tokens`. No prices |

### Off limits

| Path | Why |
|---|---|
| `.credentials.json`, `.credentials.json.tmp.*` | Login credentials |
| `sessions/<pid>.<hash>.key`, `sessions/*.key.tmp*` | Per-session messaging key. Written through a temp file, so watchers see these names `[run]` |
| `daemon/pipe.key` | Supervisor pipe key |
| `ide/*.lock` value of `authToken` | IDE auth token. Read `pid`, `ideName`, `transport`, `workspaceFolders`, `runningInWindows` only |
| `backups/.claude.json.backup.*` | Full copies of `.claude.json`, may hold secrets |
| `shell-snapshots/` | Captured shell environment |
| `history.jsonl` | Typed prompts in plain text |
| `sessions/.fleetview-heartbeat` | Never write it. See 2.3 |

### Documented but absent here `[docs]`

Agent view: `jobs/<id>/state.json`, `jobs/<id>/tmp/`, `daemon/roster.json`, `daemon.log`, `daemon.lock`. The docs state that `jobs/<id>/` is "not a stable interface".
Agent teams: `teams/<team>/config.json`, `teams/<team>/inboxes/<agent>.json`, `tasks/<team>/`. Teams are off by default, and the team config directory is removed at session end.

Retention: transcripts and their session folders are deleted after `cleanupPeriodDays`, default 30 `[docs]`. Files vanishing is normal.

---

## 2. `sessions/<pid>.json`

### 2.1 Fields

Reader rules from `[code]`: accept only names matching `^\d+\.json$`, and only if `String(parseInt(stem))` equals the stem. Cap the read at 262,144 bytes.

The first table is what a 2.1.314 file holds on this machine `[run]`.

| Field | Type | Meaning |
|---|---|---|
| `pid` | number | Process id |
| `sessionId` | string | Current conversation. **Mutates** on `/clear` and `/resume` while the pid stays `[code]` |
| `cwd` | string | **Current** directory. Mutates on directory change `[code]` |
| `startedAt` | number | Epoch ms |
| `procStart` | string | Process creation time as a decimal Windows FILETIME, 18 digits, see 2.4 |
| `version` | string | CLI version |
| `peerProtocol` | number | `1` |
| `peerFeatures` | string[] | Seen: `notify_idle`, `artifact_yield` |
| `kind` | string | See 2.2 |
| `entrypoint` | string | See 2.2 |
| `pidDomain` | string | `win32:<lowercased hostname>` on Windows |
| `asksForConvertedSkills` | boolean or null | Internal |
| `messagingSocketPath` | string | `\\.\pipe\LOCAL\cc-msg-<hex>`. Used for liveness, never connect to it |
| `name` | string | Display name. Default is `<dirname>-<2 chars>` `[docs]` |
| `nameSource` | string | `user`, `peer`, `derived`, `collision`, `auto`, `hook` `[code]` |
| `nameSince` | number | Epoch ms |
| `status` | string | See 2.3. Absent for the first tens of ms `[run]` |
| `updatedAt` | number | Last write of certain fields. Not a heartbeat |
| `statusUpdatedAt` | number | Set whenever `status` is written `[code]` |

Optional fields the 2.1.314 reader accepts `[code]`, none seen here: `waitingFor` (seen live, see 2.3), `procStartFt`, `formerNames`, `jobId`, `parkedJobId`, `spare`, `bridgeSessionId`, `logPath`, `hostSessionId`, `agent`, `tmux`, `state`, `detail`, `tempo` (`active|idle|blocked`), `needs`.

### 2.2 `kind` and `entrypoint`

`kind` values: `interactive`, `bg`, `daemon`, `daemon-worker` `[code]`. Only `interactive` seen `[run]`. `claude agents --json` documents `interactive` and `background`, so map `bg` to `background` `[docs]`.

`kind: "interactive"` does not mean a human is there. SDK sessions also report it `[run]`.

`entrypoint` comes from `CLAUDE_CODE_ENTRYPOINT` `[code]`.
Seen: `claude-vscode`, `sdk-ts` `[run]`.
Also in code: `sdk-cli`, `sdk-py`, `claude-desktop`, `claude-desktop-3p`, `local-agent`, `local_agent`, `remote`, `remote_desktop`, `remote_mobile`, `remote_projects`, `remote_cowork`, `remote_trigger`, `ssh-remote`, `claude-in-slack`, `claude_in_slack`, `claude-in-teams`, `claude-coworker`, `claude-coworker-terminal` `[code]`.
A plain terminal value of `cli` is UNVERIFIED on this machine. Treat the field as an open string.

### 2.3 `status` and `waitingFor`

| `status` | Meaning `[code]` |
|---|---|
| `busy` | Loading, or a delegated run is active. Stayed `busy` for 30+ minutes on the session that launched this workflow `[run]` |
| `idle` | Nothing running, ready for input |
| `shell` | Idle, but a `local_bash` background task is running |
| `waiting` | Blocked on the user. `waitingFor` says why |

Terminal sessions compute it as follows `[code]`. First match wins:
1. a queued elicitation gives `waiting` + `input needed`
2. the top dialog's `waitingFor` value
3. a pending worker request gives `worker request`
4. a pending sandbox request gives `sandbox request`
5. a local dialog with no response streaming gives `dialog open`
6. otherwise `busy` if loading or delegated, else `idle`, and `idle` becomes `shell` if a background bash task runs

VS Code and SDK sessions derive it from `session_state_changed`: `running` to `busy`, `requires_action` to `waiting`, `idle` to `idle` `[code]`. There `waitingFor` is `input needed` for one specific tool and for tools named `dialog:*`, otherwise `permission prompt` `[code]`. That the specific tool is AskUserQuestion is UNVERIFIED, because the name is minified.

`waitingFor` values: `permission prompt`, `input needed`, `sandbox request`, `worker request`, `dialog open` `[docs]` `[code]`.

Observed sequence on an SDK session: `(no status)` → `idle` → `busy` → `waiting` + `permission prompt` for 175 ms → `busy` → `idle` → file gone. Writes reached disk 22 to 162 ms before the reader saw them `[run]`.

**State fields.** `state`, `detail`, `tempo` and `needs` are written for interactive sessions only while `sessions/.fleetview-heartbeat` is younger than 5,000 ms `[code]`. Agent view writes that file. Writing it from the OS would modify `~/.claude` and change other sessions' behaviour, so do not. Whether it also causes model calls is UNVERIFIED.

**Write safety.** Pid file updates are a plain read-modify-`writeFile`, not atomic `[code]`. The CLI itself re-reads on a torn record `[code]`. 0 parse failures in about 5,000 reads here `[run]`, but retry once after 20 ms on a parse failure anyway.

### 2.4 Lifecycle, stale files, liveness, PID reuse

**Lifecycle** `[code]` `[run]`: the file is created at start and removed by a synchronous unlink on process exit. After a crash it stays until another Claude process sweeps it. The sweep requires `pidDomain` to match and the pid to return `ESRCH`. A read-only Observer never deletes these files. It marks them dead.

**Foreign records.** If `pidDomain` differs from `win32:${os.hostname().toLowerCase()}`, the record belongs to another host or WSL. Skip liveness checks and show it as `foreign` `[code]`.

**Liveness without spawning** `[run]`:

| Probe | Result | Cost p50 |
|---|---|---|
| `process.kill(pid, 0)` on a live pid | no throw | 0.003 ms |
| on a dead pid | `ESRCH` | 0.010 ms |
| on a protected pid | `EPERM`, means alive | 0.012 ms |
| `fs.readdirSync('\\\\.\\pipe\\')` | 273 entries, includes `LOCAL\cc-msg-<hex>` for every live session | 0.31 ms |
| sessions folder read + parse + kill for 2 sessions | | 0.24 ms |
| PowerShell CIM query of one process | Do not use. It is what the CLI spawns on the slow path | 214 ms plus process start |

Listing `\\.\pipe\` enumerates names without connecting to any pipe. `fs.readdirSync('\\\\.\\pipe\\LOCAL\\')` fails with `ENOENT`, so match against the root listing.

**PID reuse.** `kill(pid, 0)` alone cannot detect it. The pipe name is unique per session, so it is the cheap answer:

```ts
function classify(rec: PidRecord, pipes: Set<string>, hostDomain: string): Liveness {
  if (rec.pidDomain && rec.pidDomain !== hostDomain) return 'foreign';
  try { process.kill(rec.pid, 0); }
  catch (e: any) { if (e.code !== 'EPERM') return 'dead'; }
  if (!rec.messagingSocketPath) return 'unknown';            // bare mode or older CLI
  const leaf = rec.messagingSocketPath.replace(/^\\\\\.\\pipe\\/, '');
  return pipes.has(leaf) ? 'alive' : 'recycled';
}
```

Require `recycled` on 2 consecutive ticks, because a fresh session can write its pid file before the pipe is listening. That startup ordering is UNVERIFIED.

**`procStart` as a fallback** `[run]` `[code]`: value 134378702327497017 decodes to the process creation time. CIM reports 134378702327497010, because it has microsecond resolution, so compare with a tolerance of 10 ticks. Older CLIs wrote `.CreationDate.Ticks`, about 6.39e17 and in local time. A value above 3e17 is that format and cannot be compared with a FILETIME, so treat that case as unknown. Node has no API for process creation time, so reading it needs FFI to `GetProcessTimes` or a spawn. The pipe check removes the need on 2.1.314.

---

## 3. Transcript spec

Every line is one JSON object, terminated by `\n` with no `\r` `[census]`. 0 of 302,287 lines failed to parse, and every file ended in a newline `[census]`.

### 3.1 Record types

Counts are `[census]`. Transcript records start with `{"parentUuid":`. Metadata records start with `{"type":"`, so `api-request*` can be skipped by prefix without parsing `[run]`.

| Type | Count | Bytes | Purpose | Fields a live view needs |
|---|---:|---:|---|---|
| `assistant` | 103,086 | 449 MB | One model content block per record | see 3.2 |
| `user` | 66,399 | 861 MB | Prompt, tool result, injected message | see 3.2 |
| `attachment` | 79,588 | 483 MB | Harness context, 34 subtypes | `attachment.type`, see below |
| `system` | 61 | 56 KB | `api_error`, `compact_boundary`, `local_command` | see below |
| `api-request` | 15,833 | 196 MB | Request record, written at request start | `timestamp`, `params.model`, `querySource`, `agentId` |
| `api-request-blob` | 20,282 | 116 MB | Content-addressed message body | Skip. Holds prompts |
| `api-request-shape` | 1,429 | 98 MB | System prompt and tool shape | Skip |
| `last-prompt` | 3,256 | 1 MB | Tail metadata: `lastPrompt`, `leafUuid` | Title fallback. Sensitive text |
| `ai-title` | 3,176 | 372 KB | `aiTitle` | Title |
| `custom-title` | 1 | | `customTitle` | Title |
| `atis-latch` | 3,248 | 297 KB | Internal hash latch | Ignore |
| `queue-operation` | 2,182 | 2 MB | Main thread prompt queue | see 3.6 |
| `mode` | 1,937 | 159 KB | `mode`, only `normal` seen | Ignore |
| `frame-link` | 640 | 85 KB | Artifact link | Ignore |
| `file-history-snapshot` | 491 | 6 MB | Checkpoint. Keys of `trackedFileBackups` are file paths | Ignore |
| `file-history-delta` | 494 | 266 KB | Checkpoint delta | Ignore |
| `tools-used` | 48 | 8 KB | `tools[]` | Optional chip |
| `bridge-session` | 48 | 13 KB | Remote Control link | Show "remote" |
| `cost-state` | 40 | 28 KB | Session cost snapshot | see 3.4 |
| `artifact-autoreact-ledger` | 30 | 12 KB | Internal | Ignore |
| `artifact-comment-monitor` | 19 | 5 KB | Internal | Ignore |

Known to the 2.1.314 reader but unseen `[code]`: `progress`, `summary`, `tag`, `relocated`, `continued-in`, `ended-by-model`, `agent-name`, `agent-color`, `agent-setting`, `pr-link`, `worktree-state`, `permission-mode`, `isolation-latch`, `content-replacement`, `fork-context-ref`, `observer-ref`, `history-suppression`, `attribution-snapshot`, `dev-mods`, `memory-mode`.

`system/turn_duration` and `system/stop_hook_summary` do not occur in this data at all `[census]`. No record marks a turn end. Derive it, see 3.5.

### 3.2 `user` and `assistant` fields

Common envelope, present on `user`, `assistant`, `system`, `attachment` `[census]`: `uuid`, `parentUuid`, `isSidechain`, `sessionId`, `cwd`, `gitBranch`, `version`, `entrypoint`, `userType`, `timestamp`, and `agentId` on sidechains. `slug` is on about 55 % of records. It is a session word slug, not the project folder.

**Order.** Use file order, never `timestamp`. 19,278 records in the census had a timestamp older than an earlier record in the same file, 876 in one file `[census]`.

**`assistant`** `[census]`:
- `message`: `id`, `model`, `role`, `content`, `stop_reason`, `stop_sequence`, `usage`, plus `container`, `context_management`, `diagnostics`, `input_transformations`, `stop_details`
- `content` has exactly one block in 99.995 % of records. One API message spans several records sharing `message.id`, and 37,487 of 44,787 messages did
- Block types: `thinking`, `text`, `tool_use`. A `tool_use` block has `id`, `name`, `input`, `caller`
- `stop_reason` values seen: `tool_use`, `end_turn`, `stop_sequence`, `null`
- Also: `requestId`, `apiBlockIndex`, `effort`, `perTurnEffort`, `requestedModel`, `advisorModel`, `thinkingDisplay`, `thinkingDurationMs`, `attributionAgent`, `attributionSkill`
- Errors: `isApiErrorMessage`, `error` (`rate_limit` seen), `apiError` (`usage_limit_reached` seen), `apiErrorStatus` (`429` seen), `apiErrorParams.rate_limit_info`, `quotaLimits`

**`user`** `[census]`:
- `message.content` is a string or an array of `tool_result`, `text`, `image` blocks
- `tool_result` has `tool_use_id`, `content`, `is_error`
- `toolUseResult`: tool-specific result object or string
- `sourceToolAssistantUUID`: on tool results, uuid of the assistant record with the `tool_use`
- `permissionDecision`: `decision` (`accept`, `reject`), `source` (`config`, `user_permanent`, `user_temporary`), `reasonType`, `reasonCode`, `ruleSource`, `circuitBreaker`
- `toolDenialKind`: `user-rejected`, `automode-blocked`, `permission-rule`
- `origin.kind`: `human`, `task-notification`, `peer`, `coordinator`
- `turnOrigin`: `human`, `task_notification`, `peer`, `sdk`, `scheduled`
- `promptSource`: `sdk`, `system`
- `permissionMode`: `auto`, `default` seen
- `turnPosition.{promptIndex,turnIndex}`, `promptId`, `isMeta`, `isCompactSummary`, `toolEndsTurn`, `wakeupSource`
- `serverClassifierContext.context.git_state`: `root`, `cwd`, `branch`, `default_branch`, `status`, `visibility`. On 54 % of records

**`system` subtypes** `[census]`:
- `api_error`: `retryAttempt`, `maxRetries`, `retryInMs`, `source` (`request_retry`), `error.{message,formatted,isNetworkDown,connection,rateLimits,noResponse}`, `level: "error"`
- `compact_boundary`: `compactMetadata.{trigger,preTokens,postTokens,durationMs,cumulativeDroppedTokens,preservedSegment,preservedMessages}`, `logicalParentUuid`, `parentUuid: null`. `trigger` is `manual` (20) or `auto` (1)
- `local_command`: `commandRun.{command,args}`, `commandOutcome.kind`

**`attachment` types worth reading** `[census]`:
- `queued_command`: queue item absorbed mid-turn. `commandMode` (`task-notification`, `prompt`), `origin.kind`, `usage.{durationMs,toolUses,totalTokens}`
- `environment`: `snapshot.{workingDirectory,isGitRepo,isWorktree,additionalWorkingDirectories,platform,shell}`
- `model`: `identity.{modelId,marketingName,knowledgeCutoff}`
- `budget_usd`: SDK runs with a budget `[run]`

All others are harness context or prompt material. Skip them.

### 3.3 Field derivations

**Title.** This is the SDK's rule `[code]`:
1. last `customTitle` in the tail, else `<sid>/custom-title.json`, else `customTitle` in the head
2. last `aiTitle` in the tail, else in the head
3. fallbacks for display: `lastPrompt`, then `summary`, then the first user prompt

For a live session, show `name` from the pid file as secondary text. Title coverage from head and tail was 50 of 50 main files `[run]`.

Why head and tail are enough: the writer re-appends title, `last-prompt`, `mode` and more once 32,768 bytes have been written since the last re-append, so they always sit in the last 64 KB `[code]`. Measured: `ai-title` was at most 32,273 bytes from EOF, `last-prompt` 9,753 bytes, `cost-state` 1,320 bytes `[census]`.

**Project root.** The SDK rule for `cwd` is: `relocatedCwd` from a `relocated` record in the tail, else the **first** `cwd` in the head, else the project dir `[code]`. Then:

1. Normalize: forward slashes, lowercase drive letter. Slugs here exist as both `C--…` and `c--…`, and a slug only replaces non-alphanumerics with `-` while preserving case `[run]` `[docs]`.
2. Never decode the slug. It is lossy, and names over 200 characters are truncated with a hash `[docs]`.
3. Walk up from `cwd` looking for `.git`. A folder means this is the repo root.
4. A `.git` **file** means a worktree. Parse `gitdir: <main>/.git/worktrees/<name>` and take `<main>` as the project root, keeping the worktree path as a sub-identity. Parsing was not run on a real worktree here, because this machine has no worktree transcripts: UNVERIFIED in practice.
5. Cross-checks when present: `worktree-state.worktreeSession.{originalCwd,worktreePath,worktreeName,worktreeBranch,originalBranch,originalHeadCommit}` `[code]`, `attachment/environment.snapshot.isWorktree` and `git_state.root` `[census]`, `.meta.json` `worktreePath`, `worktreeBranch` for isolated subagents `[code]`.
6. A path containing `/.claude/worktrees/<name>` is a Claude worktree of the path before it `[docs]`.

Current directory for display: pid file `cwd` when alive, else last `cwd` in the tail.

**Git branch.** Last `gitBranch` in the tail, else first in the head `[code]`. Each transcript here held exactly one value `[census]`. `HEAD` is common, on 28,126 records, and should display as detached or no branch. No empty string was seen `[census]`.

**Model.** Last `assistant.message.model` that is not `<synthetic>`. `<synthetic>` marks harness-made messages, 112 seen, mostly rate limit errors `[census]`. `requestedModel` keeps the alias with a suffix like `[1m]`, and `cost-state.modelUsage` keys use that form too `[census]`. Before the first response: `api-request.params.model`.

**Token usage per message.** It lives in `assistant.message.usage` `[census]`:

```
input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
cache_creation.ephemeral_5m_input_tokens, cache_creation.ephemeral_1h_input_tokens,
output_tokens_details.thinking_tokens, server_tool_use.web_search_requests,
server_tool_use.web_fetch_requests, service_tier, speed, inference_geo, iterations
```

Group by `message.id` and take the **last** record of the group. It held the maximum `output_tokens` in 44,785 of 44,787 groups `[census]`. Summing all records would multi-count.

**Context size now:** `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` of the last message, the same input-only formula the status line uses `[docs]`.

**Known undercount.** In subagent and workflow agent transcripts from 2.1.261 to 2.1.303, the last record often has `stop_reason: null` and a partial `output_tokens`: 21,594 messages, median 8 tokens against 578 `[census]`. Main transcripts are unaffected, and 2.1.310+ agent transcripts show 0 such messages `[census]`. The sidechain writer now holds records until `stop_reason` is set `[code]`. Mark such messages `partialOutput` and treat the cost as a lower bound.

### 3.4 Cost

**`cost-state` fields** `[census]`: `totalCostUSD`, `totalAPIDuration`, `totalAPIDurationWithoutRetries`, `totalToolDuration`, `totalLinesAdded`, `totalLinesRemoved`, `totalDuration`, `startTime`, `hasUnknownModelCost`, `sessionId`, and `modelUsage[model]` with `inputTokens`, `outputTokens`, `thinkingTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `cacheCreationEphemeral5mInputTokens`, `cacheCreationEphemeral1hInputTokens`, `webSearchRequests`, `costUSD`.

**When it is written.** Only at these points, in main transcripts `[code]`:
- at shutdown
- when moving the session to the background
- on switching conversation through resume or fork

Live evidence: an SDK session wrote `last-prompt` and `cost-state` as its pid file vanished `[run]`. In 21 of 24 main files it sat within 1,320 bytes of EOF, with 1 to 5 records per file `[census]`. A session that has not exited has none.

**How to read it.**
- Cumulative across resumes, for example 33.06 → 164.35 → 201.47 → 340.42 `[census]`
- It covers subagents, workflow agents and untranscribed side requests
- It can be falsely low: 4 sessions show `0` against estimates of $3 to $800, because the last process did no API work and earlier versions never wrote one. One shows $7.06 against about $76 `[census]`
- Use `max()` across all `cost-state` records, and treat `0` with non-zero usage as absent

**Estimate.** Per request, never on totals. The 2.1.314 formula `[code]`:

| Model | Input | Output | Write 5m | Write 1h | Cache read |
|---|---:|---:|---:|---:|---:|
| `claude-opus-5-5` | 4 | 20 | 5 | 8 | 0.20 |
| `claude-sonnet-5-5` | 2 | 10 | 2.5 | 4 | 0.10 |
| `claude-fable-5-1` | 10 | 50 | 12.5 | 20 | 0.25 |
| `claude-haiku-5-5` | 0.10 | 0.50 | 0.125 | 0.20 | 0.01 |
| `claude-haiku-5-5`, prompt over 100,000 tokens | 0.50 | 2.50 | 0.625 | 1 | 0.05 |

USD per MTok. Input and output match the brief. The other tiers in the binary: `claude-opus-5` 5/25 with read 0.5, `claude-sonnet-5` 2/10 with read 0.2, `claude-fable-5` 10/50 with read 1, `claude-haiku-4-5` 1/5 with read 0.1 `[code]`. An unknown model falls back to 5/25 `[code]`. "Over 100,000" compares input + cache read + cache write of that one request, which is why totals cannot be priced.

```ts
interface Rate { in: number; out: number; write5m: number; write1h: number; read: number }
interface Price extends Rate { longPrompt?: Rate & { above: number } }
interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  server_tool_use?: { web_search_requests?: number };
  inference_geo?: string | null;
}

const PRICES: Record<string, Price> = {
  'claude-opus-5-5':   { in: 4,   out: 20,  write5m: 5,     write1h: 8,   read: 0.2 },
  'claude-sonnet-5-5': { in: 2,   out: 10,  write5m: 2.5,   write1h: 4,   read: 0.1 },
  'claude-fable-5-1':  { in: 10,  out: 50,  write5m: 12.5,  write1h: 20,  read: 0.25 },
  'claude-haiku-5-5':  { in: 0.1, out: 0.5, write5m: 0.125, write1h: 0.2, read: 0.01,
    longPrompt: { above: 100_000, in: 0.5, out: 2.5, write5m: 0.625, write1h: 1, read: 0.05 } },
};

function requestCostUsd(model: string, u: Usage, table = PRICES): number | null {
  const base = table[model];
  if (!base) return null;
  const prompt = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const p = base.longPrompt && prompt > base.longPrompt.above ? base.longPrompt : base;
  const write = u.cache_creation_input_tokens ?? 0;
  const write1h = Math.min(u.cache_creation?.ephemeral_1h_input_tokens ?? 0, write);
  const tokens = (u.input_tokens * p.in + u.output_tokens * p.out
    + (u.cache_read_input_tokens ?? 0) * p.read
    + (write - write1h) * p.write5m + write1h * p.write1h) / 1e6;
  const geo = u.inference_geo === 'us' ? 1.1 : 1;
  return tokens * geo + (u.server_tool_use?.web_search_requests ?? 0) * 0.01;
}
```

**Validation against `cost-state`** `[run]`, estimate over cost-state, all transcripts of a session included:

| Session group | Ratio |
|---|---|
| 9 sessions over $0.10, all messages final: 7 of them | 0.996 to 1.000 |
| same group: 1 session | 0.965 |
| same group: 1 session on sonnet-5-5 | 0.835. It becomes 1.000 with cache read at 0.20 instead of 0.10 |
| Sessions with partial `output_tokens`, see 3.3 | 0.60 to 0.92, 1 at 1.067 |
| Tiny haiku sessions, $0.001 to $0.003 | 0.73 to 0.96 |

The sonnet case suggests that session was priced with an older table, so prices do change between versions. Read them from config, not constants. That the rate changed is inferred.

The tiny sessions differ by 19 to 26 output tokens each, which fits one untranscribed title request. That cause is inferred, not proven. Transcripts do not hold side requests, so an estimate runs slightly low on principle.

Fast mode pricing exists in code, with `usage.speed` only ever `standard` here, so it is UNVERIFIED and left out of the table.

**Display rule.** `costUsd = max(estimate, maxCostState)`. Label it `estimate` until a non-zero `cost-state` exists.

### 3.5 Activity states

Inputs: the pid record, plus a tail state with `openTools` (`tool_use` ids without `tool_result`), the last record, and the last error.

| State | Signal | Visible | Confidence |
|---|---|---|---|
| `generating` | `busy`, and last relevant record is `api-request`, or a `tool_result` awaiting the next request | 13 to 640 ms after request start `[run]` | High |
| thinking | An `assistant` record with a `thinking` block | **Only after the response ended** `[run]` | Label after the fact |
| writing text | An `assistant` record with a `text` block | **Only after the response ended** `[run]` | Label after the fact |
| `tool_running` | `openTools` not empty | After the response ended | High for tools that outlive the response. A tool finished during streaming appears already resolved |
| `waiting` (permission) | pid `status: waiting` + `waitingFor: permission prompt` | 22 to 162 ms `[run]` | High for the session. It does not say which subagent asked |
| `idle` | pid `idle` or `shell`, `openTools` empty | same | High |
| `interrupted` | Last `user` text is `[Request interrupted by user]` or `[Request interrupted by user for tool use]` | Immediately | High. 57 and 14 seen `[census]` |
| `compacting` | **No live signal.** `compact_boundary` and an `isCompactSummary` user record appear after it ended | After | Report as an event `compacted`. Live state only for OS-owned sessions, through the SDK |
| `retrying` | Last record is `system/api_error`. `retryInMs` gives the next attempt | Immediately | High |
| `errored` | `assistant` with `isApiErrorMessage: true`, then pid `idle` | Immediately | High. 109 seen, all 429 `[census]` |
| `finished` | Pid file gone or dead | Tick | See below |

**Turn end.** The last message has a non-null `stop_reason` other than `tool_use`, and `openTools` is empty. Seen: `end_turn`, `stop_sequence` `[census]`. All blocks of one response normally carry the same final `stop_reason`, because they are serialized after the response ended `[run]`. The exception: 5 non-final and 2 final records on 2.1.314 main transcripts have `null`. Aborted responses are the likely cause, which is UNVERIFIED. So treat `null` as "response ended without a stop reason", not as "still streaming".

**Finished outcome for a main session:** `clean` if the file ends in `cost-state` or at a turn end. `abandoned` if `openTools` is not empty or the last record is `api-request`. All tool uses were resolved in all 24 main files, and 2 of 2,016 transcripts had an unresolved one `[census]`, so `abandoned` should be rare.

**Agents have no pid file.** Their state comes from their own tail plus section 4. If the owning session is dead and the agent has no terminal record, mark it `orphaned`.

Priority order:

```
dead pid                     -> finished(clean | abandoned)
pid file present, no status  -> starting
status == waiting            -> waiting(waitingFor)
status in {idle, shell}      -> errored | interrupted | idle, from the last records
status == busy               -> retrying | tool_running | generating
```

### 3.6 `queue-operation`

The main thread's input queue. Main transcripts only. Counts below come from a later pass with 2,314 records `[run]`.

| `operation` | Count | Extra fields | Meaning |
|---|---:|---|---|
| `enqueue` | 1,157 | `content` on 643, none on 514 | Prompt or notification queued. Even an idle SDK prompt goes through it `[run]` |
| `dequeue` | 815 | none | Taken for a new turn. 686 times the next record is the `user` turn start `[census]` |
| `remove` | 342 | `reason`, usually `content`, `commandUuid`, `deliveryId` | Taken without a new turn |

`reason` values: `absorbed_mid_turn` (328), `delivered_to_agent` (11) `[census]`.

810 queue `content` values start with `<task-notification>` `[census]`. That is the harness format for a finished background agent, bash task or workflow, with `<task-id>`, `<tool-use-id>`, `<output-file>`, `<status>`, `<summary>` `[run]`. Parse only `tool-use-id`, `task-id` and `status`.

Wait from enqueue to the next dequeue or remove, paired first in first out: median 30 ms, p90 25.5 s, max 789 s `[census]`. Pending count is enqueues minus dequeues and removes. Show it as "queued".

---

## 4. Agent tree

### 4.1 Links

| From | To | Key | Join rate |
|---|---|---|---|
| Subagent file | Parent `Agent` tool call | `.meta.json` `toolUseId` = `tool_use.id` in the main transcript | 45 of 45 `[census]` |
| Subagent file | Its id | Filename `agent-<id>.jsonl` = `agentId` on every record | 1,992 of 1,992 `[census]` |
| `Agent` result | Subagent | `toolUseResult.agentId` | 59 results `[census]` |
| Workflow run | Parent `Workflow` tool call | `toolUseResult.runId` = folder `wf_<id>` | 75 of 75 `[census]` |
| Workflow agent file | Journal | `started.agentId` = filename | 1,946 of 1,946 both ways `[run]` |
| Workflow agent | Phase | `.meta.json` `workflowPhase` = `started.phase` | 1,946 of 1,946 `[run]` |
| State progress entry | Journal | `workflowProgress[].agentId` | 1,660 of 1,660 `[run]` |
| Tool result | Its assistant record | `sourceToolAssistantUUID` | 61,445 records `[census]` |

Facts on agent transcripts `[census]`:
- `isSidechain: true` on every record, `false` on every main record
- `sessionId` is the parent session
- First record is a `user` record with `parentUuid: null`, in 1,991 of 1,992 files
- Agent ids are 17 hex characters today. Treat them as opaque
- `sourceToolUseID` is **not** the parent link. It appears on 16 records only

### 4.2 `.meta.json`

Seen on subagents: `agentType` (`general-purpose`, `Explore`), `description`, `toolUseId`, `spawnDepth`, `requestShape`, `requestNonInteractive`, `isBuiltIn`, `launchedWithDefaults`, `finished` (on 15 of 45) `[census]`.
Seen on workflow agents: `agentType` (`workflow-subagent`, `general-purpose`), `description`, `workflowPhase`, `spawnDepth`, `requestShape`, `requestNonInteractive`, `isBuiltIn`. No `toolUseId` `[run]`.

The 2.1.314 writer can also emit `[code]`: `isFork`, `worktreePath`, `inheritedWorktreePath`, `spawnedWithWorktree`, `worktreeBranch`, `pluginSteered`, `cwd`, `spawnMode`, `name`, `parentAgentId`, `stoppedByUser`, `taskKind`, `teamName`, `color`, `planModeRequired`, `customAgentType`, `spawnedAgentType`, `model`, `effort`.

**Nesting.** All 1,991 agents here have `spawnDepth: 1`, and no `Agent` tool call occurs inside an agent transcript `[census]`. Nested agents are depth-limited to 3 by default `[docs]`, and `parentAgentId` should be the link `[code]`. The nested path and join are UNVERIFIED. Implement `parentAgentId` first, then `toolUseId` looked up in all of the session's agent transcripts.

### 4.3 Building the tree

```
root: main node for <sid>
for each projects/*/<sid>/subagents/agent-*.jsonl:
    parent = meta.parentAgentId ?? main-or-agent holding meta.toolUseId ?? root
for each projects/*/<sid>/subagents/workflows/<runId>/:
    run node under the main node, parent tool call found by toolUseResult.runId
    for each agent-*.jsonl: child of the run, label and phase from the journal
```

Sessions in several slugs are normal: 23 session folders collapse to 14 session ids `[census]`. Each of them had its main transcript in one of those slugs. Still handle a missing main transcript, because transcripts can age out or move `[docs]`.

### 4.4 Workflows

**`Workflow` tool result** `[census]`: `runId`, `taskId`, `taskType` (`local_workflow`), `status` (`async_launched`), `scriptPath`, `transcriptDir`, `workflowName`, `summary`. 107 of 112 calls returned this. The other 5 returned a plain string, presumably an error, and left no run to link.

**`journal.jsonl`.** Append only, no timestamps at all `[census]`. `key` is `v<N>:<hex>` and identifies a call for replay `[census]`.

| Type | Count | Fields | Meaning |
|---|---:|---|---|
| `launched` | 75 | `hiddenScriptSha256` possible `[code]` | Run started. Always the first line |
| `started` | 1,946 | `key`, `agentId`, `label`, `phase`, `remoteSessionId` possible `[code]` | Agent started |
| `result` | 1,802 | `key`, `agentId`, `result`, `toolsUsed`, `foreignArtifactContent` possible `[code]` | Agent finished. `result` is object or string, and holds private content |
| `failed` | 95 | `key`, `agentId`, which can be empty `[code]` | Agent failed or was stopped |
| `restoring`, `restored`, `resumed` | 0 | | Replay markers `[code]` |

Reconstruct as follows:
- Phases: distinct `started.phase` in order of first appearance. Lines of different phases can interleave, so group by value and do not assume contiguous runs
- Labels: `started.label`
- Status per agent: `running` if `started` has no later `result` or `failed` for that `agentId`
- Retries: a repeated `key` with a new `agentId`. 21 keys had 2 agents `[run]`, and `workflowProgress[].attempt` and `lastAttemptReason` (`stalled`) confirm it at the end
- Resume: completed keys return their saved result without a new agent `[docs]`, shown as `workflowProgress[].cached` in the final file

**`<sid>/workflows/`** `[census]`:
- `scripts/<workflowName>-<runId>.js`: the run script. Private
- `<runId>.json`: final state, 73 files:

```
runId, taskId, workflowName, status, summary, result, error, args, script, scriptPath,
defaultModel, startTime, timestamp, durationMs, agentCount, totalTokens, totalToolCalls,
logs[], phases[{title, detail}],
workflowProgress[]:
  workflow_phase entries: type, index, title
  workflow_agent entries: type, index, agentId, label, phaseIndex, phaseTitle, state, attempt,
    model, tokens, toolCalls, startedAt, queuedAt, durationMs, lastProgressAt,
    lastToolName, lastToolSummary, promptPreview, resultPreview, cached, error, kind
```

Values: `status` is `completed` (66), `killed` (6), `failed` (1). `state` is `done`, `progress`, `start`, `error`. `script`, `args`, `result`, `promptPreview`, `resultPreview` and `summary` hold private content.

**Running or finished:**

| State file | Owner session | Journal | Result |
|---|---|---|---|
| exists | any | any | terminal, use `status` |
| absent | alive | `launched` present | `running` |
| absent | dead | `launched` present | `orphaned`. 1 such run exists here: owner dead, journal 10 days old, 4 agents started and 1 ended `[run]` |

The state file is absent for the running workflow of this session, and only the script exists `[run]`. Open agents also occur outside running runs: 49 `started` had no end record in the journal `[run]`, which includes this run's live agents, the orphaned run, and presumably killed runs. So once a state file exists, it overrides the journal.

Live per-agent tokens and last tool from `workflowProgress` exist only in memory until the run ends `[run]`. During a run, sum `message.usage` from the agent tails. In `/workflows`, a retry shows as `(retry 1)` `[docs]`.

**Limits** `[docs]`: 16 concurrent agents by default, fewer on small machines. 1,000 agents per run. So at most about 16 agent files are hot per run.

---

## 5. Tailing on Windows, measured

Setup: four processes ran concurrently against real writes for 75 s, then one for 180 s. Other agents of this workflow supplied load, and this agent deliberately produced large records. Scripts and raw results are in `scratchpad/runtime-bench/`. Load was light, so peak behaviour under a large fan-out is UNVERIFIED.

### 5.1 Detection

| Method | Latency | CPU in 75 s | RSS |
|---|---|---|---|
| `fs.watch(root, {recursive:true})` | 17.7 ms p50, 35.8 ms p90, behind a sub-millisecond stat loop (n=58, 180 s run). Pairing outliers to 443 ms. The 75 s run had p50 -0.2 ms, p90 40 ms (n=12) | 63 ms | 38 MB |
| mtime poll 250 ms, plus full walk every 5 s | 125 ms mean, 250 ms max | 2,781 ms | 49 MB |
| mtime poll 1,000 ms, plus full walk every 5 s | 500 ms mean, 1,000 ms max | 2,562 ms | 49 MB |

Poll CPU is mostly the walk: 14 walks at about 175 ms each. One `stat` costs about 45 µs of CPU.

Watch details:
- Setup 1.6 ms
- 16 events in 75 s, 79 in 180 s, 1.36 events per real append. Debounce them
- `change` on appends, `rename` on creation
- Controlled write-to-event: p50 17 ms with a Bun writer, 5 ms with a Node writer, clock error about ±4 ms
- No events were lost in these runs: 0 of 70 size changes had no watch event

### 5.2 Age of a record when it reaches disk

Age = time seen on disk minus the record's `timestamp`, 180 s run `[run]`:

| Class | Flushes | Age p50 | Age p90 | Age max |
|---|---:|---:|---:|---:|
| Main transcript | 17 | 136 ms | 790 ms | 1.3 s |
| Workflow agent | 39 | 110 ms | 11.6 s | 43.6 s |

The 75 s run reached 46.1 s on a workflow agent and 1.2 s on main.

Why `[code]`: the session writer drains a per-file queue every 100 ms. The sidechain recorder holds records until the assistant message has a `stop_reason`, then flushes at `message_stop` and `message_start`. Main transcripts behave the same way for blocks, see finding 1 in section 0. Tools can run while the response streams, so one flush can hold several tool calls together with their results `[run]`. `api-request` is not held: age 13 to 77 ms on agents.

Per-file gaps between flushes on workflow agents: p50 4.6 s, p90 24 s, max 72.6 s `[run]`.

### 5.3 Are appends whole-line atomic?

In practice yes, but do not rely on it.

| Evidence | Result |
|---|---|
| Writer `[code]` | Up to 100 MiB of queued lines joined and passed to one `appendFile` call per flush, on Bun |
| Real reads `[run]` | 68 of 68 ended on a newline, 1 to 18 lines per chunk, including a real 593,145-byte line |
| Census `[census]` | 0 bad lines, 0 files without a final newline |
| Bun writer, lines up to 2 MiB `[run]` | 0 torn views in 258 observed size steps |
| Node `fs.promises.appendFile`, same test `[run]` | 84 torn views in 355 observed size steps, at 512 KiB multiples |

So a reader **can** see a partial line if a writer ever runs on Node, and a crash can leave a torn tail. The CLI seals it on the next append by prepending a newline `[code]`, so a broken line can then sit mid-file. Rule: parse only up to the last `\n`, keep the rest as carry, and skip unparsable lines.

Files are not append-only forever `[code]`: `performRemoveByUuid`, `performCompactTranscript` (local GC, for `-p` and SDK sessions) and `/cd` relocation rewrite or move them. A shrink means reset the cursor. 0 shrinks were seen `[run]`, so this path is UNVERIFIED in practice.

### 5.4 Walk and index

All warm cache. Cold numbers are UNVERIFIED, but they will be worse. Files at this time: 5,337 total, 257 folders, 2.43 GB.

| Operation | Time | Notes |
|---|---:|---|
| Full stat walk, sync | 142 to 178 ms | |
| Full stat walk, async | 106 to 123 ms | |
| Shallow walk of `projects/*/*.jsonl` | 2.2 to 2.9 ms | 50 files |
| Index main only, 8 KB head + 64 KB tail | 39 ms | 2.8 MB read, coverage same as below |
| Index main only, 64 + 256 KB | 53 ms | 9.1 MB |
| Index main + subagents, 64 + 256 KB | 133 ms | 96 files, 23.9 MB |
| **Index everything, 64 + 256 KB** | **4.11 s** | 2,042 files, 647 MB, 5.8 s CPU, 161 MB RSS |
| Index everything, 64 + 64 KB | 1.08 s | 265 MB, last model found in 1,719 of 1,946 workflow agents, against 1,940 |
| All `meta.json` | 1.9 to 3.2 s | 1,991 files, cost is the opens |
| All journals | 355 ms | 3,918 lines, 15 MB |
| All workflow state files | 234 to 301 ms | 73 files |
| Full parse for comparison | 42 s | Not acceptable at startup |

Coverage at 64 + 256 KB `[run]`: title 50 of 50 main files, model 50 of 50 main and 1,940 of 1,946 workflow agents, `cwd` and branch 100 %. `cost-state` was found in 41 of 50 main files. Census positions show every existing one lies within 1,320 bytes of EOF, so the other 9 have none on disk.

Unit costs `[run]`: `stat` 60 µs, `open` + `close` 1.68 ms. The open cost is presumably antivirus or filter drivers, which is UNVERIFIED. It dominates small file reads.

### 5.5 Recommended hybrid

**Startup, target under 200 ms to first paint:**

1. Read `sessions/`, list `\\.\pipe\`: under 1 ms.
2. Shallow walk: 3 ms.
3. Index main transcripts, 8 KB head + 64 KB tail: 40 to 50 ms. Paint here.
4. For alive sessions and those active in the last 24 h: stat walk of `<sid>/`, journals, tail of agent files with mtime under 10 min.
5. Everything else on demand when a session is expanded.
6. Optional background worker fills the remaining 4 s of agent indexing once, and caches by `(path, size, mtimeMs)`, so restarts only touch changed files.

**Runtime:**

| Loop | Interval | Cost | Purpose |
|---|---|---|---|
| `fs.watch(projects, {recursive:true})` | events | 0.08 % of a core | Primary trigger, 18 ms latency |
| `fs.watch(sessions)` | events | | Filter to `^\d+\.json$`. It also fires for `*.key.tmp*` and `*.key` `[run]`. Never open those |
| Per-path debounce | 25 ms | | Absorbs 1.36 events per append |
| Reconcile stat of hot files | 1 s | 2 ms for 40 files | Catches lost events. Hot: mtime under 10 min, or session alive. 23 to 41 files here |
| Liveness: sessions + `kill(0)` + pipe list | 1 s | under 1 ms | Status, death, PID reuse |
| Shallow walk | 5 s | 3 ms | New main transcripts |
| Full stat walk | 60 s, async, and after any watcher error | 120 ms | Last resort |

Estimated total from measured unit costs: under 0.5 % of one core while idle. Worst-case staleness is 1 s from a lost event. The agent flush lag in 5.2 adds to any of this and cannot be removed from outside.

**Tail read rules:**

```ts
async function drain(c: Cursor, onLine: (l: Buffer) => void): Promise<'none' | 'data' | 'reset' | 'gone'> {
  const st = await fsp.stat(c.path, { bigint: true }).catch(() => null);
  if (!st) return 'gone';
  const size = Number(st.size);
  if (c.ino !== undefined && st.ino !== c.ino || size < c.offset) {  // rewritten or relocated
    c.ino = st.ino; c.offset = Math.max(0, size - 64 * 1024); c.carry = null; c.skipFirst = c.offset > 0;
    return 'reset';
  }
  c.ino = st.ino;
  if (size === c.offset) return 'none';
  const fh = await fsp.open(c.path, 'r');                            // short lived, never keep open
  try {
    const buf = Buffer.allocUnsafe(size - c.offset);
    const { bytesRead } = await fh.read(buf, 0, buf.length, c.offset);
    c.offset += bytesRead;
    let data = buf.subarray(0, bytesRead);
    if (c.carry) data = Buffer.concat([c.carry, data]);
    let s = 0;
    for (let i; (i = data.indexOf(10, s)) !== -1; s = i + 1) {
      if (c.skipFirst) { c.skipFirst = false; continue; }
      if (i > s) onLine(data.subarray(s, i));
    }
    c.carry = s < data.length ? Buffer.from(data.subarray(s)) : null;
    return 'data';
  } finally { await fh.close(); }
}
```

- Skip by prefix before parsing: lines starting `{"type":"api-request` are 410 MB of the 2.2 GB and never needed `[census]`
- Parse lines up to 2 MB. The largest seen is 1.9 MB `[census]`
- Never hold a file handle. The CLI renames and rewrites these files
- Treat `ENOENT` as normal: retention, relocation, `purge`
- `st.ino` stability across rewrites on NTFS is UNVERIFIED, the size check is the safety net

The SDK exposes supported readers with the same head and tail approach: `listSessions`, `getSessionInfo`, `getSessionMessages`, `listSubagents`, `getSubagentMessages` `[code]`. Use them for transcript detail views where latency does not matter, and as a compatibility fallback if a release breaks the parser.

---

## 6. `claude agents --json` compared with the sessions folder

| Source | Time | Runs |
|---|---:|---:|
| Sessions folder: read, parse, `kill(0)` for 2 sessions | **0.24 ms p50**, 1 ms p99 | 200 `[run]` |
| `claude agents --json`, PATH 2.1.224 | **965 to 1,148 ms** | 6 `[run]` |
| `claude agents --json`, 2.1.314 binary | **536 to 558 ms** | 3 `[run]` |

**Verdict: do not poll it.** It is 2,000 to 5,000 times slower, and each call starts a binary of about 300 MB.

It added nothing here. Both versions returned `pid`, `cwd`, `kind`, `startedAt`, `sessionId`, `name`, `status`, which the pid file already has `[run]`. `--all` was accepted by both versions and changed nothing, because no background sessions exist `[run]`.

It has a side effect. The first run of each binary changed `migrationVersion` in `~/.claude.json` `[run]`, so with two CLI versions on one machine, polling flips that value. It did not change `numStartups`, did not add a project entry, and left no supervisor process `[run]`.

Where it does add value: background sessions. Per docs it adds `id`, `state`, and `waitingFor`, and includes sessions whose process has exited `[docs]`. No background session exists here, so those fields are UNVERIFIED locally. The docs recommend polling it for scripts, and call `jobs/<id>/` unstable.

Recommendation: only when `~/.claude/jobs/` exists, call it at most every 30 s using the newest binary available, and merge by `sessionId`. Never at startup.

---

## 7. Other local signals

**`ide/<port>.lock`** `[run]`: 26 files. Fields: `authToken` (never use or log), `ideName`, `pid`, `runningInWindows`, `transport`, `workspaceFolders`. Only 1 of 26 is from today, and the oldest are from August, so they are not cleaned up. The filename looks like a port, which is UNVERIFIED. Use only to link a session to an IDE, after a `kill(0)` check on `pid`.

**`session-env/`** `[run]`: 53 session folders, all empty. No value.

**`telemetry/`** `[run]`: 2 files of failed internal event uploads. No value. OpenTelemetry export is a separate, opt-in path, see below.

**Plan usage and rate limits.** Yes, four sources exist:

| Source | Content | Freshness |
|---|---|---|
| `~/.claude.json` `cachedUsageUtilization` `[run]` | `fetchedAtMs`, `accountUuid`, `utilization.five_hour.{utilization,resets_at}`, `utilization.seven_day.{…}`, `extra_usage.{is_enabled,monthly_limit,used_credits,utilization}`, `spend.*`, `limits[]{kind,group,percent,severity,resets_at,scope,is_active}`, `seven_day_breakdown.rows[]{key,display_name,percent}` | 849 s old at test. Check `fetchedAtMs`, and show it as "as of". `utilization` is on a 0 to 100 scale |
| `assistant.quotaLimits` `[census]` | `status`, `rateLimitType`, `resetsAt`, `overageStatus`, `overageDisabledReason`, `isUsingOverage`, `unifiedRateLimitFallbackAvailable` | 109 records, **only when a limit was hit**. `status` was always `rejected`, `rateLimitType` `five_hour` (106) or `seven_day` (3) |
| `assistant.apiErrorParams.rate_limit_info` `[census]` | Same family | 26 records |
| Status line input `[docs]` | `rate_limits.five_hour.{used_percentage,resets_at}`, `seven_day`, `spend_limit` | Live per session. Needs a status line script, which means a settings change. Not for now |

For the control plane, the SDK emits `rate_limit_event` with `status` (`allowed`, `allowed_warning`, `rejected`), `resetsAt`, `rateLimitType`, `utilization`, overage fields `[code]`.

`~/.claude.json` rules: parse it, pick that one key, and discard the rest in memory. It also holds `oauthAccount`, `mcpServers` and more. It is rewritten often, 5 backups in about 9 minutes here `[run]`, so retry on a parse failure and read at most every 30 s. Never call the usage API with stored credentials: credentials are off limits.

**`cache/model-catalog/`** `[run]`: `max_input_tokens`, `max_output_tokens`, effort levels per model. Useful for a context-window gauge. No prices.

**OpenTelemetry** `[docs]`: `CLAUDE_CODE_ENABLE_TELEMETRY=1` with OTLP env vars gives per-request `claude_code.api_request` with `cost_usd` and tokens, plus `tool_decision`, `tool_result`, `api_error`. It is opt-in per process, so it cannot reach existing sessions. It suits the control plane: set the env on spawned sessions, with no global settings change. No rate limit metric or event appears in the page.

**Hooks and status line** `[docs]`: both receive `session_id` and `transcript_path`. They are the supported push path but need settings changes, so they stay out of the read-only Observer.

---

## 8. What a read-only observer can do to a session it did not start

Everything here is `[docs]` unless tagged.

| Action | Read-only observer | Supported route |
|---|---|---|
| See status, transcript, agents, cost | Yes | Files, this report |
| **Send a message to a running session** | **No** | An OS-owned Claude session calls `ListAgents`, then `SendMessage` |
| Post into the inbox pipe directly | **No** | On native Windows the first line must be `{"type":"auth","token":"<token>"}`, or the connection closes. The token is `CLAUDE_CODE_MESSAGING_TOKEN`, exported only to that session's own hooks and Bash commands. The documented script use is a session's own child posting to its own socket |
| Use `sessions/*.key` to authenticate | **No** | Off limits by project rule. Connecting an unauthenticated client is pointless too |
| Answer a permission prompt | **No** | Nothing can, for a foreign session. A peer message "can't approve anything". Only the owning UI or that session's `canUseTool` host |
| Run a slash command in it | **No** | Peer text never executes commands |
| Interrupt or stop an interactive session | **No** | Only the user. Killing the pid is not a supported stop and is not read-only |
| Stop a background session | Not read-only | `claude stop <id>` |
| Prompt a running background session | Not read-only | `claude --resume <session> "prompt"` from a terminal, v2.1.285+. **Piped or redirected output sends nothing and exits 1**, so a daemon cannot use this form |
| Read a background session's output | Partly | `claude logs <id>`, or its transcript |
| **Resume a session that has exited** | Not read-only | `claude --resume <id>`, `claude -p --resume <id>`, or SDK `resume` |
| Resume a session still alive elsewhere | **Do not** | "messages from both interleave into one transcript". Add `--fork-session` or SDK `forkSession`. Check the pid files for that `sessionId` first |
| Be told when a session goes idle | **No** | `SendMessage` with `notify_when_idle`, main conversation only, this machine only, v2.1.236+, expires after 12 h |

**Rules for the broker route:**

- Requires v2.1.234+ on native Windows. PATH CLI 2.1.224 is too old `[run]`. Both sessions need it
- A session appears in `ListAgents` only if it bound an inbox socket. Bare mode does not
- Delivery: between tool calls in an active turn, or a new turn if idle
- Inbound control per receiver: `crossSessionInbound` is `accept`, `hold` or `refuse`. Default: a prompting session delivers unless the sender claims bypass, and a bypass session holds unless the sender is also bypass
- VS Code, Desktop and `-p` sessions cannot show the approval dialog: a held message waits until `dialogExpiry`, 5 minutes by default, then is dropped
- For an unattended `-p` worker, start it with `crossSessionInbound: accept` in its `--settings`
- A message is plain text, capped around one million characters, and counts as usage
- At most 50 accepted messages queue per session. Bursts are refused at the sender. Loops are rate limited
- `peerFeatures` in the pid file advertises `notify_idle` and `artifact_yield` `[run]`

**For the MCP spawn tool.** "Claude prompts Claude" works without any of this for sessions the OS spawned, because it holds their SDK stream. Only foreign sessions need the broker. The UI should show foreign sessions as read-only, with a "send through broker" action that names the hold and refuse outcomes.

---

## 9. Normalized TypeScript types

Parsing rule: unknown record types and fields are ignored and counted, never fatal. No type below carries message text. Text fetches are explicit, on-demand calls.

```ts
export type EpochMs = number;
export type SessionId = string;      // UUID
export type AgentId = string;        // Opaque, 17 hex characters today
export type WorkflowRunId = string;  // Opaque, "wf_xxxxxxxx-xxx" today
export type ToolUseId = string;
export type NodeId = string;         // sessionId, or `${sessionId}/${agentId}`

export const makeNodeId = (sessionId: SessionId, agentId?: AgentId): NodeId =>
  agentId ? `${sessionId}/${agentId}` : sessionId;

export type Liveness = 'alive' | 'dead' | 'recycled' | 'foreign' | 'unknown';
export type SessionKind = 'interactive' | 'bg' | 'daemon' | 'daemon-worker' | 'unknown';
export type PidStatus = 'busy' | 'shell' | 'idle' | 'waiting';
export type WaitReason =
  | 'permission prompt' | 'input needed' | 'sandbox request'
  | 'worker request' | 'dialog open' | 'unknown';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  webSearchRequests: number;
  messages: number;
  /** Messages whose final record has stop_reason null, so output is a lower bound. */
  partialOutputMessages: number;
}

export interface CostEstimate {
  /** max(estimateUsd, costStateUsd ?? 0) */
  usd: number;
  estimateUsd: number;
  /** Highest non-zero cost-state value, null while the session has none. */
  costStateUsd: number | null;
  isEstimate: boolean;
  isLowerBound: boolean;
  unpricedModels: string[];
}

export interface ActiveTool {
  toolUseId: ToolUseId;
  name: string;
  startedAt: EpochMs;
}

export type Activity =
  | { state: 'starting'; since: EpochMs }
  /** A model call is in flight. Thinking and text cannot be told apart on disk. */
  | { state: 'generating'; since: EpochMs; lastBlock?: 'thinking' | 'text' | 'tool_use' }
  | { state: 'tool_running'; since: EpochMs; tools: ActiveTool[] }
  | { state: 'waiting'; since: EpochMs; reason: WaitReason }
  | { state: 'retrying'; since: EpochMs; attempt: number; maxRetries: number; nextAttemptAt?: EpochMs }
  /** Only for sessions the OS owns. On disk, compaction is known after it ended. */
  | { state: 'compacting'; since: EpochMs }
  | { state: 'idle'; since: EpochMs; backgroundShell: boolean }
  | { state: 'interrupted'; since: EpochMs }
  | { state: 'errored'; since: EpochMs; kind: 'rate_limit' | 'api' | 'unknown'; httpStatus?: number; resetsAt?: EpochMs }
  | { state: 'finished'; since: EpochMs; outcome: 'clean' | 'abandoned' | 'unknown' }
  | { state: 'unknown'; since: EpochMs };

export interface ObservedSession {
  sessionId: SessionId;
  /** 'observer' for foreign sessions, 'control' for those the OS spawned. */
  origin: 'observer' | 'control';

  title: string | null;
  titleSource: 'custom' | 'ai' | 'lastPrompt' | 'summary' | 'firstPrompt' | null;
  displayName: string | null;

  /** Normalized main repo root, or start cwd outside git. The grouping key for projects. */
  projectRoot: string | null;
  startCwd: string | null;
  currentCwd: string | null;
  worktree: { path: string; name?: string; branch?: string } | null;
  gitBranch: string | null;

  /** All slugs holding this session. There can be several. */
  slugs: string[];
  transcriptPath: string | null;
  transcriptBytes: number;

  pid: number | null;
  liveness: Liveness;
  kind: SessionKind;
  entrypoint: string | null;
  version: string | null;
  pidStatus: PidStatus | null;
  remoteControlled: boolean;
  /** True when a broker session could reach it. */
  acceptsPeerMessages: boolean | null;

  activity: Activity;
  queuedInputs: number;

  model: string | null;
  requestedModel: string | null;
  effort: string | null;
  permissionMode: string | null;

  startedAt: EpochMs | null;
  lastRecordAt: EpochMs | null;
  lastWriteAt: EpochMs | null;
  endedAt: EpochMs | null;

  /** Main thread only. */
  usage: TokenUsage;
  /** Whole tree including all agents. */
  usageTree: TokenUsage;
  cost: CostEstimate;
  contextTokens: number | null;
  contextWindow: number | null;

  rootNodeId: NodeId;
  agentCount: number;
  runningAgentCount: number;
  workflowRunIds: WorkflowRunId[];
  lastRateLimit: { type: string; status: string; resetsAt: EpochMs | null } | null;
}

export type AgentNodeKind = 'main' | 'subagent' | 'workflow-agent' | 'teammate';
export type AgentStatus =
  | 'running' | 'completed' | 'failed' | 'stopped' | 'orphaned' | 'unknown';

export interface ObservedAgentNode {
  nodeId: NodeId;
  sessionId: SessionId;
  kind: AgentNodeKind;
  /** null for the main node. */
  agentId: AgentId | null;

  /** null only for the main node. */
  parentNodeId: NodeId | null;
  childNodeIds: NodeId[];
  /** How the parent was found. 'inferred' means no join key resolved. */
  linkedBy: 'root' | 'parentAgentId' | 'toolUseId' | 'workflowRun' | 'inferred';
  parentToolUseId: ToolUseId | null;
  spawnDepth: number;

  agentType: string | null;
  name: string | null;
  /** From meta.json. Written by the model, so treat it as private text. */
  description: string | null;
  model: string | null;
  effort: string | null;
  cwd: string | null;
  worktreePath: string | null;
  worktreeBranch: string | null;
  background: boolean | null;

  workflow: {
    runId: WorkflowRunId;
    key: string;
    label: string | null;
    phase: string | null;
    attempt: number;
  } | null;

  transcriptPath: string | null;
  metaPath: string | null;
  transcriptBytes: number;

  status: AgentStatus;
  activity: Activity;
  /** Age of the newest record when it reached disk. Agents can lag by a whole response. */
  flushLagMs: number | null;

  startedAt: EpochMs | null;
  lastRecordAt: EpochMs | null;
  endedAt: EpochMs | null;

  usage: TokenUsage;
  cost: CostEstimate;
  toolCalls: number;
  errors: number;
}

export type WorkflowStatus = 'running' | 'completed' | 'failed' | 'killed' | 'orphaned';

export interface ObservedWorkflowPhase {
  index: number;
  title: string;
  agentNodeIds: NodeId[];
  running: number;
  completed: number;
  failed: number;
}

export interface ObservedWorkflow {
  runId: WorkflowRunId;
  sessionId: SessionId;
  parentNodeId: NodeId;
  parentToolUseId: ToolUseId | null;
  taskId: string | null;
  name: string | null;

  status: WorkflowStatus;
  statusSource: 'state-file' | 'journal+liveness';

  journalPath: string;
  statePath: string | null;
  scriptPath: string | null;
  transcriptDir: string;

  phases: ObservedWorkflowPhase[];
  counts: { started: number; completed: number; failed: number; open: number; retried: number };

  startedAt: EpochMs | null;
  endedAt: EpochMs | null;
  durationMs: number | null;
  /** From the state file when finished, otherwise summed from agent tails. */
  totalTokens: number | null;
  totalToolCalls: number | null;
  cost: CostEstimate;
}

interface EventBase {
  /** Stable: `${path}:${byteOffset}` for transcript events, so replays deduplicate. */
  id: string;
  /** The record's timestamp, or observedAt if it has none. */
  at: EpochMs;
  /** When the kernel saw it. observedAt - at shows the flush lag. */
  observedAt: EpochMs;
  sessionId: SessionId;
  nodeId: NodeId;
}

export type ObservedEvent = EventBase & (
  | { type: 'session.discovered'; session: ObservedSession }
  | { type: 'session.changed'; patch: Partial<ObservedSession> }
  | { type: 'session.ended'; outcome: 'clean' | 'abandoned' | 'unknown'; reason: 'exit' | 'pid-recycled' }
  | { type: 'activity.changed'; activity: Activity }
  | { type: 'agent.started'; node: ObservedAgentNode }
  | { type: 'agent.ended'; status: AgentStatus }
  | { type: 'turn.started'; origin: 'human' | 'task_notification' | 'peer' | 'sdk' | 'scheduled' | 'unknown' }
  | { type: 'turn.ended'; stopReason: string }
  | { type: 'request.started'; model: string; querySource: string | null }
  | { type: 'message.completed'; messageId: string; model: string; blocks: Array<'thinking' | 'text' | 'tool_use'> ; usage: TokenUsage }
  | { type: 'tool.started'; toolUseId: ToolUseId; name: string }
  | { type: 'tool.finished'; toolUseId: ToolUseId; name: string; isError: boolean; decision: 'accept' | 'reject' | null }
  | { type: 'usage.changed'; usage: TokenUsage; cost: CostEstimate }
  | { type: 'workflow.changed'; workflow: ObservedWorkflow }
  | { type: 'compacted'; trigger: 'manual' | 'auto' | 'unknown'; preTokens: number; postTokens: number; durationMs: number }
  | { type: 'api.retry'; attempt: number; maxRetries: number; retryInMs: number }
  | { type: 'api.error'; httpStatus: number | null; kind: string | null }
  | { type: 'rate_limit.hit'; limit: string; resetsAt: EpochMs | null }
  | { type: 'tail.reset'; path: string; reason: 'shrunk' | 'replaced' | 'relocated' }
);
```

**Record to event mapping:**

| Record | Event |
|---|---|
| New pid file | `session.discovered` or `session.changed` |
| Pid file gone or dead | `session.ended`, `activity.changed` |
| Pid `status` or `waitingFor` changed | `activity.changed` |
| `api-request` | `request.started`, `activity.changed` |
| `user` with text and no `isMeta` | `turn.started`, origin from `turnOrigin` |
| `assistant` | Buffer by `message.id`. `tool_use` block gives `tool.started`. A changed `message.id`, or a final `stop_reason`, gives `message.completed` |
| `user` with `tool_result` | `tool.finished`, decision from `permissionDecision` |
| `assistant` with final stop reason and no open tools | `turn.ended` |
| `system/api_error` | `api.retry` |
| `assistant` with `isApiErrorMessage` | `api.error`, plus `rate_limit.hit` if `quotaLimits` is present |
| `system/compact_boundary` | `compacted` |
| `cost-state` | `usage.changed` |
| New `agent-*.meta.json` or `agent-*.jsonl` | `agent.started` |
| `journal.jsonl` line, or a new state file | `workflow.changed`, and `agent.ended` on `result` or `failed` |
| Enqueued `<task-notification>` with a terminal `status` | `agent.ended`, if not already seen |

---

## Appendix: side effects of this research

- `claude agents --json` was run 9 times by this research, 6 on 2.1.224 and 3 on 2.1.314. The first run of each binary changed `migrationVersion` in `~/.claude.json`. The last run was 2.1.314, the value is `14`, and it stayed stable on the following runs. Whether the flip re-runs migrations is UNVERIFIED. Other keys were unchanged across these runs, no project entry was added for the scratchpad, and no supervisor stayed running.
- Two noise images were read through the Read tool to produce large real records. That added about 2 MB to this session's own transcript.
- No file under `~/.claude` was written by these scripts. `.credentials.json`, `*.key` and `pipe.key` were not opened.
- Two files that can hold secrets were parsed in memory, with no secret value printed. `ide/*.lock`: key names and types only, so `authToken` values were loaded but never output. `~/.claude.json`: key names, `migrationVersion`, per-key hashes for the diff, and the shape of `cachedUsageUtilization`.
- Organization and account UUIDs appeared as key names in one tool output, which is in this session's transcript. They are not in this report.

## Appendix: open items

UNVERIFIED and worth testing once the kernel exists:

1. Peak event rate and watcher overflow under a 16-agent fan-out.
2. Cold cache startup times.
3. Nested subagents: path and `parentAgentId` join.
4. Agent teams, `jobs/`, `daemon/roster.json`: no samples on this machine.
5. Worktree session transcripts: no samples on this machine.
6. Pid file and pipe startup ordering, for the `recycled` check.
7. Stale pid file after a real crash. Read from code, not reproduced.
8. Transcript shrink, compaction and `/cd` relocation handling.
9. `usage.speed: "fast"` pricing.
