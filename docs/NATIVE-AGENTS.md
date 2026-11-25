# Codex and Cursor project agents

Reviewed against the official documentation on 2026-11-03. NAOS is a private, local application, bound to loopback and used by its owner.

## Supported integration and account boundaries

OpenAI documents Codex App Server as the interface for custom clients, including authentication, conversations, streamed events and approvals. Its authentication section explicitly allows local and open-source applications to continue using app-server authentication and distinguishes them from commercial or hosted services, for which that authentication is not permitted. Codex supports signing in with ChatGPT for subscription access and API keys for usage-based access. This implementation uses the CLI-managed existing login; it never reads or copies authentication files or supplies external OAuth tokens. These documents support this local integration, not a guarantee against account enforcement or an assessment of any earlier Claude account action.

- [Codex App Server and authentication boundary](https://learn.chatgpt.com/docs/app-server#auth-endpoints)
- [Codex authentication methods](https://learn.chatgpt.com/docs/auth)
- [OpenAI Europe Terms of Use](https://openai.com/policies/eu-terms-of-use/)

Cursor explicitly documents `agent acp` for custom clients over stdio and JSON-RPC, with session creation, prompts, streamed updates, permissions and cancellation. Its CLI documentation supports browser login and API keys. NAOS uses these documented interfaces and leaves authentication with Cursor CLI. It does not use private editor endpoints or an extracted editor token.

- [Cursor ACP integration](https://cursor.com/docs/cli/acp)
- [Cursor CLI authentication](https://cursor.com/docs/cli/reference/authentication)
- [Cursor Terms of Service](https://cursor.com/terms-of-service)

Both providers retain their account limits and applicable policies. NAOS neither bypasses limits nor automatically retries rate-limited turns. Recheck the documentation before changing this application into a hosted, commercial, shared-account or resale service.

## UI and launch behavior

Project chats offer Codex, Claude Code and Cursor. Codex is the default. `L` opens the same project workspace. Claude Code uses the existing Agent SDK integration; Codex uses App Server and Cursor uses ACP. The model selector uses the returned native catalog when a provider exposes one; it is not a guarantee that every listed model is entitled for every request. An empty model choice follows the provider's configured default. Cursor currently follows its CLI's default model unless a supported model ID is supplied through the typed command API.

Build uses Codex workspace-write with on-request human approvals. Plan first and Read only use its read-only sandbox; plan mode adds planning instructions. Cursor uses ACP agent, plan or ask mode. The provider's own local configuration applies. Neither integration uses force, yolo, automatic MCP approval or a sandbox bypass. Advanced filesystem permission grants require an explicit human decision.

The shared project workspace supports provider-aware installed workflow selection. It reads bounded workflow metadata first; selected instructions are fetched only on explicit choice. Trusted project workflows and commands stay unavailable until the project is trusted. Selected instructions travel with the user prompt; providers still own their permission and session semantics.

Native controls support launch, queued follow-ups, stop, resume, status, history and one-time tool decisions. A follow-up never silently interrupts a native turn; use Stop explicitly. Forks, worktree launches, multi-copy missions, dollar budgets, remembered permissions and in-place edits of pending approvals remain unsupported for native agents and return explicit errors. Existing Claude conversations retain their legacy controls. Shift+L remains the legacy Claude mission form.

Native admission allows two simultaneous active turns and eight connected conversations per provider. Provider quota readings remain separate from Claude admission. Native records have a client identity, so filters, ships and project chat labels show the actual provider. A read-only disk observer cannot overwrite an owned native main thread.

Automatic Claude planet designers are disabled by default. They require explicitly setting `NAOS_AUTO_CLAUDE_DESIGN=1`; this is independent of choosing Codex or Cursor. Manual legacy Claude actions remain explicitly available.

## CLI discovery and login

Codex discovery recognizes a native executable, the official npm entry point and the installed OpenAI IDE extension's binary. `NAOS_CODEX_BIN` can explicitly select a CLI executable.

Cursor discovery recognizes `agent`/`cursor-agent` executables and official Windows runtime packages. `NAOS_CURSOR_AGENT_BIN` can explicitly select a CLI executable. The project-local Windows package is installed under `.naos/bin/cursor/dist-package/`; it is ignored by git, adds no global installation and changes no PATH setting. It was downloaded from the official Cursor installer’s archive URL, with extraction paths checked before unpacking. The provider card copies the appropriate CLI login command for this installation.

Provider inspection performs initialization, account status and model-catalog reads only. It does not run an inference turn or start an authentication flow. Cursor's desktop login and CLI login can differ; a missing CLI login is shown in the provider card. The user completes login in the provider's own flow, then clicks recheck. NAOS never handles passwords, browser cookies or authentication tokens.

## Persistence and verification

Native metadata and up to 120 user/assistant messages per conversation are retained in the private local `.naos/naos.db`, with message text bounded to 16,000 characters per row. Text stays out of structural fleet events and logs. Live deltas go only to explicit transcript watchers. The privacy veil hides messages and paths and stops transcript reads. Restart restores native conversations as disconnected, resumable records; it never automatically restarts a turn or replays queued prompts.

`packages/kernel/test/control/native.test.ts` uses fake official protocol peers and real routing, reducer and SQLite storage. It covers both protocols, human-only approvals, admission and quota separation, idempotency, queued sends, cancellation, resume and retained history. `npm run e2e:project` checks the actual provider picker and launch behavior through the fixture kernel. Connection probes against the installed real CLIs use no model inference; Cursor must be signed in before testing a real task.
