# One fleet, several clients

Implemented 2026-11-01. The client is the application running a session, independent of the model it selected. Cursor running Sonnet is a Cursor craft; Codex running Sol is a Codex craft. A repo remains one world across clients and worktrees remain its moons.

## Sources

| Client | Local source | What is observed |
|---|---|---|
| Claude Code | Existing read-only Observer and owned SDK stream | Existing activity, tools, usage, context, history and owned controls |
| Codex | `$CODEX_HOME/sessions`, default `~/.codex/sessions`, dated `rollout-*.jsonl` files | Thread identity, cwd, model, effort, explicit parent threads, tool lifecycle, cumulative token usage, context and turn lifecycle |
| Cursor | `%APPDATA%/Cursor/User/globalStorage/state.vscdb`, opened with SQLite `readOnly: true` | Composer identity, workspace, model, state, explicit subagent ids and context percentage when supplied |

The Codex location is documented in [OpenAI troubleshooting](https://learn.chatgpt.com/docs/reference/troubleshooting). Record and Cursor store schemas were inspected locally on this machine. They are internal formats and may change; missing or unsupported data stays unknown. [Cursor hooks](https://cursor.com/docs/hooks) are a possible future source of richer events; this implementation installs no hooks and changes no client settings.

The additional plane is `packages/kernel/src/sources`. It polls at 1.5 seconds and looks for new Codex rollouts every 10 seconds. Discovery considers files updated within 24 hours and Cursor composers updated within 24 hours, with bounds of 512 Codex files and 256 Cursor composers. History observed by this adapter is retained for 30 days; this is not an import of the clients' entire past history.

Forked Codex rollouts contain copied parent history. The first session metadata owns the thread identity, and earlier inherited records cannot replace its state or usage. Explicit native parent ids attach children to the same session tree. New clients use namespaced ids; existing Claude ids are preserved for the SDK/Observer join. Repeated observations update the same craft.

These sources cannot prove a process is alive. Their liveness is `unknown`; a generating or tool-running observation older than two minutes becomes unknown activity. A completed main turn becomes idle, not a closed session. Output speed is derived from token counter differences and expires after five seconds. Cursor token speed, cost and absolute context size are not invented.

## Privacy and control

Only structured metadata enters the bus, history database and UI. Codex message contents, reasoning, tool inputs/outputs and base instructions are discarded. Cursor queries project only the status, model and child ids from composer data, never bubble or credential keys. The adapters do not read credential files or write to either client's storage.

External sessions are observation only. Input, stop and approvals remain with their original client. Transcript text is unavailable in NAOS for these two disk adapters. `SessionSource.capabilities` makes this visible in the UI and prevents unsupported transcript requests. Separately, NAOS now starts its own Codex App Server and Cursor ACP conversations through the official local interfaces, with streaming text, queued follow-ups, stop, resume and human decisions. Owned native main threads outrank disk observations. See [NATIVE-AGENTS.md](NATIVE-AGENTS.md).

## Visual language

- The hole's energy follows fleet activity, with a stable base light. Claude's quota cannot extinguish Codex or Cursor. Quota and cost readouts identify Claude explicitly; external costs remain unavailable.
- Codex quota windows, when present in rollout metadata, are kept separately and shown on its client chip. Missing, expired or stale readings stay unknown. A Codex limit never freezes Claude admission.
- The context ruler uses window percentages, so different model windows and Cursor's percentage-only signal share an honest scale. Unknown context has no mark on the ruler. Project and history cost readouts identify their Claude coverage.
- The Home composition uses one true 3D space. Historical orbit traces leave the working overview, and faint project paths remain for depth.
- World focus shows its planet, moons and local craft. The approach faces the lit hemisphere; hidden worlds neither catch clicks nor occlude labels.
- `CraftLayer` supplies silhouettes at distance and lit procedural ships nearby. Model family and role set the body; state still owns colour, fill, rings and movement. Claude, Codex and Cursor get separate compact client marks in the Manifest.
- Client filters affect the visible fleet and keyboard walk. Global approval and source-wait panels remain reachable, including requests from a filtered client.
- A close-up reserves the actual channel width in the scene geometry, so a rail cannot cover the chased craft. Camera input still ends a flight immediately.
- Initial still-craft seats also consider projected hulls from neighbouring worlds at Home. Their chosen places then stay fixed; camera movement does not move tokenless craft to resolve overlap.
- A first coarse planet bake survives an early zoom. Higher resolution is requested once that first surface exists. Mapping progress remains visible while worlds are prepared, and `shot --settled` waits for those first surfaces for visual review.
- A pending display callback from before graphics loss cannot reveal the lost canvas. Recovery reveals a newly rendered frame; repeated loss still leaves the working 2D fallback until reload.
- Actual fan-outs feed the disk's hot arcs and short flares. Reduced motion holds disk rotation and disables flares; it does not hide attention states.
- Live subagent formations rank drawable siblings separately from historical child order, so new waves remain visible in Fleet and World. Their spacing has a screen-size minimum. Selection and fresh departures bypass the overview density cap; nested and missing-parent cases retain a visible anchor.
- Fresh discovery has a thirty-second allowance for source polling. Snapshots, seeks and old records do not replay departures. The corner's Ship demo supplies a repeatable local preview of all three clients without creating sessions or calling a model; see `INTERSTELLAR.md`.

## Validation

Parser and projection tests use synthetic data, a read-only SQLite source and the real reducer. They cover simultaneous tools, cumulative counters, inherited fork records, partial appended lines, explicit child joins, malformed records, source identity and client filters without hiding decisions.

`npm run shot` captures the real app through headless Edge on the Intel Arc GPU. Screenshots and reports for this work live in `.shots/fleet/`. They are fixture sessions, so capture does not expose private transcript text. A direct read-only source probe also found the local Codex main thread, its child and a Cursor session without opening a client or starting a model call.

`npm run e2e:clients` reviews System, World, Craft, Codex filtering, 2560-wide layout and reduced motion. It checks the reserved chase viewport, visible craft, filtered keyboard navigation and global attention panels, then saves a PNG and JSON for each view.

Final checks: 806 unit tests passed (`node --test --test-concurrency=2`), along with the production build, typecheck, six client/browser views, fleet navigation/picking/Veil and the scene lifecycle suite. Graphics-loss comparisons wait for completed planet surfaces on both sides of the loss. The restored picture matched pixel for pixel; reloading after a second loss restored 3D.

The controlled mains run on Intel Arc, at 1280 × 800 CSS px with DPR 1.5 and the Umbra tier, rendered 364 frames in 12.008 seconds. GPU time was 5.11 ms mean / 7.03 ms p95; CPU time was 2.37 ms mean / 4.00 ms p95, with 33 draws and 4,766 triangles. See `.shots/fleet/lifecycle/numbers.json`. An earlier run under the laptop's default power state measured 8.84 ms GPU p95; the 8 ms target is not a guarantee across power states or window sizes. No model calls were started for validation.
