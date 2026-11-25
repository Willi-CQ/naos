# Profiles

One file per role. Claude writes these, and the kernel reloads them when they change. `#build` in the launch line names `agents/build.md`.

```markdown
---
name: build
description: One line for the launch sheet.
model: claude-sonnet-5-5
effort: low
permissionMode: default
defaultBudgetUsd: 2
worktree: true
tools: [Read, Glob, Grep, Edit, Write, Bash]
orchestrator: false
---
You are building in this repository. This body is added to the system prompt.
```

Save it and it is live. An agent keeps the profile it started with, so an edit never changes a running tree.

## Fields

Everything but the frontmatter markers is optional.

| Field | Default | Meaning |
|---|---|---|
| `name` | file name | Lower case, digits and dashes. Launch names it with `#name` |
| `description` | empty | Shown in the launch sheet |
| `model` | `claude-haiku-5-5` | Any model id |
| `effort` | `low` | `low`, `medium`, `high`, `xhigh`, `max`, or `null` to send none |
| `permissionMode` | `default` | `default`, `plan`, `dontAsk` or `auto`. A file with `bypassPermissions` is refused |
| `defaultBudgetUsd` | `0.5` | Soft cap per craft. It can overshoot by one API call |
| `worktree` | `false` | A hybrid worktree on branch `agent/<id>`. Folders outside git get none |
| `tools` | base set | Built-in tools, as `[A, B]` or as `- A` lines. Leave it out for the base set |
| `orchestrator` | `false` | Gets the `os` tools: `agent_spawn` and the five others |
| `maxTurns` | none | Per send. Runaway control |
| `settings` | `world` | `none` keeps repo settings out even in a trusted world |
| `persist` | `true` | `false` keeps no transcript, so the craft cannot resume or fork |

The frontmatter is `key: value` lines, plus `- item` lists. Nothing else of YAML. A file that does not parse is logged and skipped, and if it worked before, its last good version stays. This README is not a profile. `first-flight` and `world-designer` are written in the kernel, not here, so an edit cannot widen them.

## What a profile cannot change

The kernel sets these on every agent, and no file can turn them off. Each was a real failure, `docs/research/agent-control.md` section 1.

- Permission mode is always explicit, and `bypassPermissions` does not exist here.
- claude.ai connectors are off, inbound session messages are refused, the environment is scrubbed.
- `.naos/` is denied, and the base tool bans hold: schedules, cloud triggers, `EnterWorktree`, nested `claude`.
- Every tool call is audited, including ones nothing had to approve.
- An unknown repo never gets its settings, hooks or MCP servers loaded, and its tool set is tighter. Trust is the operator's call, per world.

## How a child's profile is limited

`agent_spawn` cannot widen authority. A child's `permissionMode` must rank at or below its parent's, in the order `dontAsk`, `plan`, `default`, `auto`, and a parent with `settings: none` can only start children with `settings: none`. The tool list does not count, because an orchestrator is meant to hold fewer tools than the agents it starts. Depth, children, live agents per tree, spawns per minute and the tree budget are enforced in the handler, and a parent can never approve for a child.
