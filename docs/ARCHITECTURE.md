# NAOS architecture

## Map

```text
packages/
  protocol/   @naos/protocol. The contract: types, wire frames, commands, scopes, the reducer. No runtime dependencies
  kernel/     @naos/kernel. Node 24 daemon, runs from source through type stripping
    src/
      context.ts          what the parts share. Observer, Control and Server meet only here
      main.ts cli.ts      composition and the `naos` command
      config.ts bus.ts db.ts worlds.ts log.ts
      app/                what a click needs: `naos open`, the window, idle exit, the shortcut
      server/             HTTP, WebSocket, auth, static files, command router, GET /open, GET /identity
      notify/             Windows notification
      fixture/            scripted fleet, same WebSocket, no model calls
      observer/           read-only view of ~/.claude
      sources/            read-only Codex rollout and Cursor metadata adapters; MULTICLIENT.md
      control/            agents NAOS spawned, approvals, budgets, worktrees, MCP
        native/           official Codex App Server and Cursor ACP subprocesses, native lifecycle and local chat persistence
    test/
  ui/         @naos/ui. Vite + React + three
    src/
      core/               laws.ts layout.ts tiers.ts state.ts. Pure, tested in Node
                          observatory.ts projects safe atlas data, activity counts and schematic positions
                          cartography.ts builds deterministic folder territories and topographic contours
      store/              slices, selectors, the Veil, the WebSocket client
      hud/                the DOM of DESIGN section 8
                          Observatory.tsx and PlanetEmblem.tsx supply the project atlas and constellation
                          project/ supplies interactive project surfaces and managed agent conversations (PROJECTS.md)
      scene/              Live (the lazy chunk), controller (outside React), fleet (the engine), rig (the camera), Stage, passes, instanced layers, labels
      scene/shaders/      the 22 files of DESIGN 7.6, imported with ?raw
      plate/              Plate and BootPlate, shared by boot, Sky and the no-WebGL path
      audio/              DESIGN 9.6
      bench/              Slice 0 page
agents/       Role definitions in Markdown, one per `#profile`. Claude writes these, the kernel hot reloads them
scripts/      shot.mjs and other headless tooling, naos-launch.js for the shortcut, make-icon.mjs
.claude/skills/   six vetted design skills, SKILL.md and references only
.naos/        Kernel data, gitignored: tokens, naos.db, audit, layout.json, logs, the app window's browser profile
```

## Two planes, one stream

```text
~/.claude/sessions, projects/**  ──> observer/ ──┐
                                                 ├──> bus ──> reduce(FleetState) ──> /ws ──> store ──> hud, scene
Agent SDK frames ──> control/ ───────────────────┘                                    ^
                         ^                                                            │
UI, naos CLI, MCP ───────┴───────────────── POST /api/cmd ── Host, Origin, auth, scope┘
```

- **Observer plane.** Read only, across every Claude session on the machine. Latency is what the disk gives: 1.3 s for main threads, up to 46 s for workflow agents, and per response, not per token (`RF 0`).
- **External sources.** Codex rollouts and Cursor's local SQLite metadata normalize into the same session/node events. Client identity and capabilities are separate from the model. The adapters own no agent processes. `docs/MULTICLIENT.md` describes coverage and telemetry limits.
- **Control plane.** Agents NAOS spawned through the SDK. Frames are live, and they can be steered.
- **Dedupe (`AC 13`).** Control assigns `sessionId` and registers it in `ManagedRegistry` before `query()`. For a managed session the Observer stays quiet on the main node, and still reports its subagents and workflows, because only the disk has those. The managed title prefix is `naos:`.
- **One salvo detector.** It lives in the Observer, which closes and stores salvos. Fan-outs on disk feed it directly. `agent_spawn` and `xN` copies reach it as new `managed.upserted` events, so the planes still meet only on the bus. Copies have no parent, so they gather on the first copy, `ManagedAgentView.copyOf`.
- **One reducer.** `reduce(state, events)` lives in `@naos/protocol`. The kernel uses it to answer snapshots and the UI store runs the same code, so a replay and a snapshot cannot disagree.
- **Three clocks (`DESIGN 7.10`).** Events batch at most once per 16 ms into a store outside React. `useFrame` reads it with `getState()`. React rows re-render at 4 Hz, never per event. `rates` frames are separate from the event log, at 4 Hz.
- **Text is never in the stream.** Events carry structure. Message text is an explicit `craft.text` fetch, plus `craft.watchText` for one craft. Tool `summary.target` and approval `input` are sensitive and go through the Veil at the selector layer.
- **Worlds.** A world is a project root. `Worlds` assigns its slot on first sight and persists it in `.naos/layout.json`, so `1` means the same project every day. Its name is the folder made readable, or the user's own from `world.rename`. A root under the system temp folder and a session with no root go to the Belt straight from the path. A root that is gone goes after a 15 minute grace, measured by a sweep that reads the disk off the event loop and takes a drive that is away, or a share, as no verdict. The Belt holds no slot: `slot` is 0, `kind` is `belt`, and the world's id, spend and history stay. A root that returns takes its slot back if it is free.
- **Lifetime of state.** `FleetState` holds what is live plus the last hour. Older sessions leave with `fleet.evicted` and live on as `HistoryDigest` rows, fetched with `history.get`.

## App lifecycle

NAOS is a kernel and a window. The user clicks one thing and thinks about neither.

```text
NAOS.lnk ──> wscript ──> scripts/naos-launch.js ──> naos open ──┬─ kernel answers: attach
             no console  node, hidden window                    └─ none: lock, start detached, wait
                                                                         │
                         Edge or Chrome --app, profile in .naos/app-profile  <──┘
```

- **`naos open`** attaches to the kernel of this home, or starts one. A pid can be reused and any program can hold a port, so a kernel counts only if it passes a challenge, and the token is never what is sent. The opener gives `GET /identity` a nonce, and the kernel answers with an HMAC of port, mode and nonce under the UI token. The port in it stops a listener from relaying the real kernel, and the mode stops a fixture from passing for live. The CLI's other commands pass the same check before they send a bearer. A stale `kernel.json` therefore blocks nothing. `open.lock`, created atomically, lets one of two simultaneous opens start the kernel, and the other joins it and leaves the window to the winner. A dead lock is taken over behind a second file, `open.lock.stale`, so that two opens finding it stale cannot delete each other's fresh lock. A port held by a stranger, a kernel that hangs and a fixture on this home each end in a plain sentence of their own. A kernel that cannot listen closes what it opened and exits, so a detached one never stays hidden.
- **No console, anywhere.** The shortcut targets `wscript.exe` with the absolute Node path as an argument, so PATH does not matter. The kernel is detached and has no console, so every child it starts sets `windowsHide`, or it would flash one. The Agent SDK does this itself. Stdout goes nowhere, because the ready line carries the token.
- **A failure has no terminal to land in.** `naos open` writes the reason to `<home>/logs/open.log` and raises a toast that opens that file, then exits with 3. The launcher speaks only for failures before that: Node moved, or dependencies are missing.
- **A fresh clone** has no `packages/ui/dist`, so the first open announces a wait and runs vite itself. Without dependencies it says to run `npm install`.
- **Lifetime.** Closing the window stops nothing, because agents work behind it. A kernel from `naos open` exits by itself after `--idle-exit` minutes, 30 by default, with no UI client, no live owned craft and no open decision. It never leaves while a craft is alive. `npm run up` has no idle exit. `naos quit` is the command `kernel.quit`, UI scope only, refused while a craft is alive.
- **The window** gets `--app` and `--user-data-dir`, so its cookie and history stay out of the user's browser. Without Edge or Chrome the default browser opens a plain tab. `NAOS_APP_BROWSER` replaces the browser, and nothing opens under the test runner, whatever is set.
- **A toast click** lands in the default browser, which has no cookie. So it goes to `GET /open?docket=<id>&sig=<mac>`, a link only the kernel can write, which holds no data and makes the kernel open the app window on `/auth?token=…#docket=<id>`. The fragment outlives the 302, and `main.tsx` opens the decision. Each click opens a new window, because a page cannot raise an existing one.

## Ownership

Parallel builders share one working tree. Each owns its folders and does not edit anyone else's. A change to `packages/protocol` must keep all packages compiling.

| Area | Paths |
|---|---|
| Contract | `packages/protocol/**` |
| Kernel core | `packages/kernel/src/{main,cli,config,bus,db,worlds,log}.ts`, `app/**`, `server/**`, `notify/**`, `fixture/**` |
| Observer | `packages/kernel/src/observer/**` |
| Control | `packages/kernel/src/control/**`, `agents/**`, `.mcp.json` |
| Scene | `packages/ui/src/scene/**`, `src/bench/**`, `src/core/{laws,layout,tiers}.ts` |
| Instrument | `packages/ui/src/{main.tsx,App.tsx}`, `store/**`, `hud/**` except the Hand's files, `plate/**`, `src/core/state.ts` |
| Hand | `packages/ui/src/hud/{docket,launch,ledger,sheets}/**` |

## Security model

The kernel can start processes on this machine, so a web page must never reach it.

| Threat | Defence |
|---|---|
| Remote access | Binds `127.0.0.1` only |
| DNS rebinding | `Host` must be `127.0.0.1:<port>` or `localhost:<port>`, on every request and on upgrade |
| CSRF, malicious pages | `Origin` must be the kernel's own or a configured dev origin, on every request and on upgrade. `POST /api/cmd` takes `application/json` only |
| Other local pages | Auth on every route but `/auth`, `/identity`, `/open` and static files. A per-install token is exchanged once at `/auth?token=` for an `HttpOnly`, `SameSite=Strict` cookie, and that session cookie opens the WebSocket too |
| A web page opening windows | `GET /open` needs no auth, so it returns no data and takes only a link the kernel signed, with an HMAC of the id under the UI token. That signature is the guard, because no header tells a cross-site redirect from a click: a browser keeps `Sec-Fetch-Site: none` through one. Fetch metadata is the second layer, for a link that got out of the toast: `Sec-Fetch-Site: none`, `Sec-Fetch-Mode: navigate` and no `Sec-Purpose`, which is what tells speculation rules from a click. `Sec-Fetch-User` is not required: it is sent only with user activation, and whether a toast's protocol activation counts as that is up to the default browser, so requiring it could turn every toast click into a bare 403. It also passes the Host check, takes a strictly validated id, and allows 5 opens a minute, counted after every refusal so that nothing unsigned can use up a real click. The answer is the same for any id, so it reveals nothing about the fleet |
| A program on the kernel's port | Idle exit frees the port, and the UI token approves decisions, so the token is never sent to find out who is there. `GET /identity` needs no auth and gives away nothing but an HMAC bound to the caller's nonce, and its prefix keeps it apart from the session cookie and the `/open` signature. A window with the token in its URL opens only after that proof, milliseconds later, so the gap is too short to aim at but not zero. The MCP shim still sends its bearer to the port in `kernel.json`: it cannot prove anything without the UI token, and that bearer has no route to a decision |
| Agents approving themselves | Two scopes, `COMMAND_SCOPES` in the contract. MCP bearer scope has no route to `approval.answer`, `world.trust`, `agent.stopAll` or `kernel.quit`. The agent environment never contains a token, and managed agents get deny rules on `.naos/**` |
| Runaway fan-out | Limits in the handler, never in a prompt: depth, children, live per tree, spawns per minute, tree budget (`AC 12.3`). Global admission limits and a hold-to-fire All stop |
| Prompt injection between agents | Child output returns as a tool result, never as a user message. `agent_send` is stamped with `origin`, `verbatimPrompts` stops `@path` expansion |
| Shell in a prompt | Prompts go through the SDK's input stream. Nothing is ever interpolated into a command line |

This does not contain a local process running as the user: there is no command sandbox on native Windows (`AC 7.14`). Against a tool call from a model, human approval on Bash and PowerShell is the real gate. Say so plainly wherever it matters.

## Verification

- `npm test`: pure logic and kernel behaviour against recorded structure. Fixtures hold no real transcript content.
- `npm run e2e:app`: the app lifecycle on a scratch home with a stub in place of the browser: start, attach, a race of opens, stale files, a stranger and an impostor on the port, a failed listen, idle exit, quit, `/open` with a redirect and speculation rules in real headless Edge, the launcher and the `.lnk` read back. It opens no window, so what a window looks like stays with the user. `--build` adds a fresh clone's first start.
- `npm run e2e:scene`: Layer 3 in the real app on the real GPU: zero frames at rest, the Plate swap in both directions, the lazy chunk, labels under the Veil, reduced motion, link loss, GPU time.
- `npm run e2e:fleet`: Layer 4 in the real app: `S20`, any key ends any flight, a flight keeps its goal in frame, picking, the Veil on every level, what a draw allocates, and one crop or filmstrip per row of DESIGN 6, as `--out <dir>/sheet.json` with its PNGs. `--only s20,flights,pick,veil,alloc,sheet` picks parts, `--rows "Spark|Lost"` picks rows.
- `npm run fixture` then `npm run shot`: the real UI on the real GPU, in headless Edge, with no window. `Intel Arc` through ANGLE D3D11 was confirmed on 2026-10-31, so frame times and shaders can be measured here, and DESIGN's `[U]` items can become `[V]`. Compositing differs from a visible window, so report that caveat with any number.
- Read the PNG. A screenshot nobody looked at proves nothing.
