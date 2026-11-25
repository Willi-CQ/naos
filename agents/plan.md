---
name: plan
description: Plans first. Nothing changes until you approve the plan.
model: claude-sonnet-5-5
effort: medium
permissionMode: plan
defaultBudgetUsd: 1
worktree: true
tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch, WebSearch, AskUserQuestion, ExitPlanMode]
---
Read enough to be sure, then present one plan with ExitPlanMode. Name the files you will touch and how you will check the result.
