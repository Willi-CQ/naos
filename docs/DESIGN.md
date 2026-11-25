# NAOS design specification

The single source of truth for the agents that build the UI. Where this document and a concept disagree, this document wins.
Written 2026-10-31. Inputs: `docs/design/concept-cosmos.md`, `concept-organism.md`, `concept-warroom.md`, `docs/research/*.md`, and two jury verdicts.

**How claims are marked.**

| Tag | Meaning |
|---|---|
| `[V]` | VERIFIED. I ran it, or read it in source, a report or a verdict, in this session. Report references: `RF` runtime-formats, `AC` agent-control, `DS` design-skills |
| `[U]` | UNVERIFIED. A judgement, a starting value, or anything that needs a real GPU, a browser or a person |

Design decisions are proposals, not claims, so they carry no tag unless they assert something testable. **Nothing here has run on a GPU, in a browser, or with a person.** Every statement about frame rate, motion or feel is `[U]`.

**What the code blocks are.** All 22 shaders in section 7 pass a strict GLSL ES 3.00 parse and a semantic compile through glslang, and negative controls fail. `[V]` All TypeScript passes `tsc --strict` with `noUncheckedIndexedAccess` against the exact dependency set in Appendix B, and a negative control fails. `[V]` `layout.ts` and `tiers.ts` also ran in simulation, which found three real bugs that are fixed here. `[V]` None of it has run in a browser. `[U]`

**Reference renders.** CPU renders that apply the final rules of this document at the real viewport, with the real fonts in the HUD. The sky is this machine's history from file sizes and times only. Worlds, fleet and every name are placeholders. They show composition and layout, and they prove nothing about speed.

| Image | Shows |
|---|---|
| `docs/design/naos-system.png` | 20 agents on 5 worlds at 1280 x 800 CSS, 1.5 device pixel ratio |
| `docs/design/naos-docket.png` | The docket locked on a decision |
| `docs/design/naos-idle.png` | 0 agents, the Almanac |
| `docs/design/naos-wave.png` | The wavefront crossing the sky |
| `docs/design/naos-salvo.png` | A salvo in flight, corona flaring toward its world |
| `docs/design/naos-plate.png` | Frame one of the boot, the month as ink on dim amber |
| `docs/design/naos-wide.png` | The same fleet at 2560 x 1440 |

---

## 0. Point of view and rulings

**NAOS is a poster you can operate.** The scene is built for peripheral vision and for clips. The rails are built for reading and for hands. Both show the same truth at different speeds, and neither ever waits for the other.

The spine is the NAOS concept, because the brief asks for flashy, cool and truly insane, and it is the only concept with a frame that stops the scroll. CONN supplies the discipline: DOM first, plain words, dark means normal, and a build order in which spectacle comes last. Golgi supplies key safety and the discipline of loudness.

Every disagreement between the judges is ruled here. Sections below only state the result.

| # | Disagreement | Ruling | Why |
|---|---|---|---|
| 1 | Spectacle chose NAOS, Operator chose CONN | NAOS is the spine. CONN's rails, lamps and build order are grafted whole | The brief asks for spectacle. The operator requirements are all achievable in DOM, and the composite shows the two coexist at 1280 x 800 `[V]` |
| 2 | Observed wells: Spectacle counted the bent sky in their favour, Operator killed them | **The sky bends only for what you can answer here.** An observed wait keeps its broken ring and its rail row. It gets no lens at all | A bent sky becomes a promise: press Space and you can act. The kill's reasons both vanish: no warp for unanswerable prompts, no starving of a fresh answerable well. The render shows a plain broken ring with no lens `[V]`. That it reads clearly is `[U]` |
| 3 | So what does an observer-only build have? | **Two heroes, one per plane.** The Salvo belongs to the Observer plane, the Bend to the Control plane | 113 fan-outs in October against 49 one-off human answers, plus up to 2,589 `user_permanent` decisions of unknown origin (verdicts, read `[V]`). The frequent event needs no control plane. First Flight gives the Bend a real signal on day one |
| 4 | The Bend is the hero, but it is weak on arrival: 6.2 px at 900 px | Separate the alert from the hero. Alert: rail row, lamp, title, OS notification, all at t = 0. Hero: the Bend. New: the **wavefront**, one ripple through every meridian at t = 0 and again at 30 s, 2 min and 10 min | Peripheral vision catches motion. The render shows every meridian rippling across the disc `[V]`. Whether it is noticed in real use is `[U]` |
| 5 | Bent sky must also read when fresh | Lens strength rises: 7.8 px at 400 px on arrival, against 4.3 in the concept at the same viewport, and 25 px at 60 s `[V]` arithmetic | Ring stays at a sane size: capped at 150 px radius at 720 px free height |
| 6 | Full-bleed `always` at 606 MP/s against a screen that must feel alive | **Cadence governor** and an **inset canvas**. Four cadences, 0, 15, 30 and 60 Hz, chosen by what is moving. The canvas covers only the free rect | Sustained load on this panel is 74 MP/s drifting, 148 cruising, 287 in events at native resolution, the same class as CONN's 70 and 301 on the judge's model `[V]` arithmetic |
| 7 | Agents are specks, but motion costs | Every live craft is at least 15 CSS px with a plume of 30 to 68 px, and agents are the brightest moving things in the frame. Motes leave system zoom | The composite shows 20 countable craft `[V]`. Plumes cost a few arc segments, motes cost a buffer |
| 8 | "Motion is tokens" as an odometer against "decoration with a data alibi" | Law 3 survives as a statement, the odometer dies. A craft moves only while tokens flow, at a compressed rate. World spin, one mote per 10 tokens and `siteHash` geography are gone | Motion stays honest and the build shrinks. `siteHash` also needed a full parse `[V]` |
| 9 | Altitude linear or log | Log, with exact numbers on the Altimeter | 90 % of agents end with over 75 % of a 1M window left, so linear stacks the fleet on one radius (verdict, read `[V]`) |
| 10 | AgX as specified | The stills' own curve ships as `FinishEffect`. AgX only if an A/B in Slice 0 proves it keeps the ring and the black disc | Every winning frame used that curve, `plate.mjs` lines 487 to 491 `[V]`. A/B run: AgX keeps ring and disc, but crushes the void below the rails, so the inset canvas shows as a rectangle. `FinishEffect` ships `[V]`, `docs/bench/README.md` |
| 11 | Golgi's central contact patch against a fixed panel | Fixed right rail. The docket opens from there, never moves, and hides no cell. No flesh | Hands learn one place. The patch read as a pink blob and was a modal in disguise (verdict) |
| 12 | Approval speed against key safety | Golgi's rule, tightened: keys work only with the docket focused, arm after 350 ms, re-arm for every new request, Enter never approves, Esc decides nothing. No focus stealing, ever | A sentence typed elsewhere must never become a session-wide grant |
| 13 | Tab as attention walk, proposed by a graft | `J` and `K` walk attention order. `Tab` stays native | Hijacking Tab breaks keyboard access, section 13. The attention order itself is kept |
| 14 | Replay: Day Reel at idle against "explicit command only" | Explicit only, `P` in Sky view. Its own colour, `replay`, never used live | At rest the screen is still. Stillness is the honest state and it costs nothing |
| 15 | History needs its own look, but a new look costs a build | Sky view **is** the Plate: the month as ink on dim amber, the same artefact as boot frame one and the no-WebGL fallback | The past reads as ink and the present as light, so one cannot be mistaken for the other. One artefact, three uses, and the canvas can rest |
| 16 | Sound off by default against an alert nobody hears | Two switches. First Flight asks once about the alert. Geiger stays off until asked for. Nothing below 300 Hz | Laptop speakers. Browsers need a gesture to start audio `[U]` |
| 17 | `spend30d` claimed from a 4 s index, which cannot provide it | World mass starts from bytes, which `stat` gives at once, and crossfades to spend when the usage index ends | Message usage needs a full parse, 42 s here `[V]` `RF 5.4`. Cached after that |
| 18 | B612 Mono against Martian Mono | Martian Mono at 75 % width for numbers. B612 stays for words | B612 Mono failed a render test on `.` and `:` (`CONN`, read `[V]`). Both have the same glyph gaps `[V]`, section 5.2 |
| 19 | Military vocabulary, radar, plot | None of it enters. The salvo event, the unroll maths, lamps and the lock arrive under NAOS names | The event is good, the costume is generic |

**Killed outright, and not to be reintroduced:** the blank bright boot frame; the 5 s sweep ring; the low drone and any tone under 300 Hz; live display of cached beads; tumbling for retries; sub-10 px craft; the 1 Hz heartbeat; flesh in any form; dashboard radar; ScrambleText on anything you are trying to read; bloom `resolutionScale` as a quality step; preflight rows that claim a spawn-derived number came from `resolveSettings`.

---

## 1. Name, pitch, principles

**Name:** NAOS. **CLI:** `naos`.

It reads Native Agent OS, the phrase in the brief. Naos is also zeta Puppis, a blue supergiant in the old constellation of the ship Argo, and in Greek architecture the inner chamber of a temple. Four letters, no shift key, the same on QWERTY and QWERTZ. `[V]`, web sources read by the concept. The unscoped npm name `naos` is taken, which matters only if this is ever published. `[V]` No trademark search was done. `[U]`

**Wordmark.** `N A O S` in Cormorant Light, tracked 5 px at 22 px, the O drawn as a hairline ring with one bright bead at one o'clock: the diamond ring of an eclipse. The app icon is that O alone. No rays, because a warm radial burst is Anthropic's visual territory.

**Pitch.**

> NAOS turns every Claude on your machine into a craft in a living solar system lit by an eclipse. You see them all, live, across every project, and the only thing in the universe that can bend the sky is an agent you can answer right now.

**Principles.**

1. **A bent sky is a promise.** The sky distorts only when something here can be answered now. Nothing else ever distorts it, so nobody has to scan for what needs them.
2. **The instrument never waits for the cinema.** Every job works in the DOM, with no GPU, from the first paint. Any input ends any animation at once and applies. The canvas is a view, never a route.
3. **Loud means rare, and every mark is real.** Loudness is the inverse of base rate: shell calls are nearly silent, a fan-out shakes the corona. Nothing is drawn that has no signal behind it.
4. **Honest light.** Show what is known, when it became known, and who can act on it. Late is labelled late, estimates say `est`, and a craft NAOS cannot steer gets no controls.
5. **The metaphor stops at the trigger.** Worlds and craft are for the eye. States and buttons use plain words: `APPROVE`, `DENY`, `STOP`. Agents may prompt agents. Approval stays with the human, and no key lands by accident.

---

## 2. Metaphor and entity map

The whole product is an eclipse. The kernel is a small dark disc in front of a star, and the star is the raw power of the model. The light that gets past the disc lights everything else, and you run the fleet by that light.

Three research findings became parts of the metaphor. Assistant blocks reach disk only when a response ends, and workflow agent records can be 46 s old (`RF 0`) `[V]`, so light is late. The plan window is the real limit, not dollars (`AC 6`) `[V]`, so the limit is the sun. Transcripts expire after 30 days (`RF 1`) `[V]`, so the observable universe has an edge.

### 2.1 The seven laws

They fit on the `?` overlay. An operator needs none of them: every value is also text.

| # | Law | Meaning |
|---|---|---|
| 1 | **Mass is spend** | A world's size is its spend over the retained 30 days, log scale. Bytes stand in until the usage index ends |
| 2 | **Altitude is context** | A low orbit is a nearly full context window, log scale |
| 3 | **Motion is tokens** | A craft moves only while tokens flow. Corona flow advances only with fleet tokens |
| 4 | **Only need you can answer bends the sky** | Nothing else distorts it: not errors, not worlds, not need you must answer elsewhere |
| 5 | **Light is late** | Observed craft show their real signal delay, and say so |
| 6 | **Work leaves light** | Every finished agent becomes a city light (where) and a sky star (when). Every fan-out burns a spoke |
| 7 | **The sun is your quota** | The sliver of sun past the disc is what is left of the five hour window. The system dims with it |

### 2.2 Owned and observed

**Owned** craft belong to the Control plane: NAOS spawned them through the SDK and can steer them. **Observed** craft are sessions NAOS only reads (`RF 8`) `[V]`. The word `foreign` keeps its report meaning, a process on another host.

| | Owned | Observed |
|---|---|---|
| Hull | Filled | Outline |
| Motion | Continuous, per token | Still, then one burn when a response lands |
| Plume | Solid, 30 to 68 px, length follows live rate | 30 px and dashed while a call is in flight |
| Thinking and writing | Told apart | Unknown until after the fact, label `MODEL` |
| Waiting | Closed ring, sky bends, answer here | Broken ring, no lens, answer in its own window |
| Delay tag | Hidden, near zero | `lag 11.6 s` at World and Craft level |
| Arrival | Ejected from the corona | First light at its orbit |
| Controls | Follow-up, stop, budget, fork, resume | None. A `READ ONLY` strip says who owns it |

### 2.3 Entity map

| Entity | Object | Rule | Signal |
|---|---|---|---|
| **Project** | **World**: a black sphere with a hairline lit limb | Screen radius from mass, 8 to 46 CSS px on the attached panel. Azimuth fixed by slot for life. Distance from the star by recency, in three bands. Worlds never orbit: spatial memory beats realism | `projectRoot` (`RF 3.3`) |
| **Session** | **Vessel**: a kite hull in its world's one orbital plane | Altitude from context. Greek letter by launch order within the world, Flamsteed numbers past 24 | `ObservedSession` (`RF 9`) |
| **Subagent** | **Tender**: a small dart on an epicycle around its parent | Depth is an epicycle on an epicycle. Nested links are `[U]` in `RF 4.2`, so use `parentAgentId` first | `parentNodeId`, `spawnDepth` |
| **Workflow** | **Armillary**: tilted hoops around the world, tethered to the owning vessel | Built from `journal.jsonl`. When the state file appears the hoops close | `ObservedWorkflow` (`RF 4.4`) |
| **Workflow phase** | **Hoop** | One per distinct `started.phase`, in order of first appearance. No percent, because no total exists until the run ends `[V]` | `started.phase` |
| **Workflow agent** | **Bead** on its hoop | Running beads move, finished beads stop and light an arc. A retry leaves a hollow ghost. `cached` shows only after the run ended, because it exists only in the final state file `[V]` | `started`, `result`, `failed` |
| **Tool call** | **Beam** from hull to surface | Shape by family, section 2.4 | `tool.started`, `tool.finished` |
| **Approval request** | **Well**, and the event is **the Bend** | Lens strength from age. Owned only | `approval.requested` |
| **Observed wait** | **Broken ring**, no lens | `status: waiting` debounced 400 ms, because a 175 ms wait was seen (`RF 2.3`) `[V]`. Sits on the vessel, because the pid file does not say which subagent asked (`RF 3.5`) `[V]` | pid `waiting`, `waitingFor` |
| **Token stream** | **Plume** on each craft, **corona** for the fleet, **motes** at Craft level only | The corona is a polar chart of token load per world | `text_delta`, `thinking_tokens`, `message.completed` |
| **Cost** | **Mass**, plus exact text | Every printed number says `est` and a lower bound gets `+`. Budget is a **fuel arc** on owned craft at World level and closer | `CostEstimate` (`RF 9`), `maxBudgetUsd` |
| **Error** | Tiered, section 6 | Spark, flameout, breakup, derelict | `isError`, `api.error`, `crashed` |
| **Idle** | **Moored**: drive off, beacon ticking on the 1 s probe | The blink is the real liveness probe | pid `idle`, `process.kill(pid, 0)` |
| **Finished** | **Re-entry**, then a **city light** and a **sky star** | One cluster per session, placed by hash of `sessionId`. No full parse needed | `session.ended`, `agent.ended` |
| **Fan-out** | **Salvo**, then a **burned spoke** | 3 launches under one parent within 1 s open it, later ones join for 10 s | `agent.started`, `task_started`, `agent_spawn` |
| Kernel | **The Disc** | Always there while the daemon runs | WebSocket link |
| Orchestrator | **Sungrazer**, a craft in a tight orbit inside the corona | It has no world of its own, and it launches from there | profile with `mcp__os__*` (`AC 8`) |
| Claude prompts Claude | **Ejection** | A transfer arc to the target world, in the real spawn time, about 1.26 s (`AC 2.1`) `[V]` | `agent_spawn`, `system/init` |
| Refused spawn | **Fallback**: the arc falls back into the star | A tag names the limit | `refused`, `subagent_stats.refused` |
| Plan window | **The Sliver**, and two **rim arcs** around the disc | The sliver is the poster. The arcs are the gauge: five hour outside, seven day inside, reading what is left, dashed when `fetchedAtMs` is older than 10 minutes. Exact values stay in the masthead | `cachedUsageUtilization`, `rate_limit_event` |
| Limit reached | **Totality** | Sliver gone, limbs at minimum, countdown on the disc | `rejected`, `rate_limit.hit` |
| Window reset | **Diamond ring** | One bead flares, light returns | `resets_at` passes |
| Worktree | **Moon** of its world | Worktree craft orbit the moon | `worktree`, `worktreeBranch` |
| Admission queue | **The Pad**, a holding ring near the star | Craft waiting for a slot sit here | `queued` (`AC 5.1`) |
| Queued prompts | **Pods** ahead of the hull | One per pending prompt, World level and closer | `queuedInputs` (`RF 3.6`) |
| Compaction | **Reboost** | Altitude jumps up with a short flash. Observed craft show it after the fact | `compacted`, `preTokens`, `postTokens` |
| Lineage | **Filament** | Selected craft only | `parentNodeId` |
| History | **The Almanac Sky** | Section 7.1 | `history.digest` |
| Retention | **The Horizon** | The 30 day meridian. Stars thin toward it and go out with the file | `cleanupPeriodDays` (`RF 1`) |
| Delay | **Light lag** | Tag at World and Craft level, `LAG MAX` in the bar | `flushLagMs` (`RF 9`) |
| Standing grant | **Standing grants** list and a tag | DOM only. Delegated authority is never invisible | `updatedPermissions` |
| Other host | **Off-world contact** at the free rect edge | No liveness check is possible (`RF 2.4`) `[V]` | `liveness: foreign` |
| No project | **Rogue body** in the outer band | A session outside any repo | `projectRoot: null` |

### 2.4 Tool families

Tool names come from `AC 8` and the census in Golgi section 0. `[V]` An unknown tool falls to `other`, because parsers must ignore what they do not know. **Loudness is the inverse of base rate.** The two highest base rates are invisible at System level.

| Family | Tools | Share `[V]` | Beam | Loudness | Visible from |
|---|---|---:|---|---|---|
| `shell` | Bash, PowerShell, Monitor, TaskStop, TaskOutput | 53.7 % | Dashed lance, gain 0.8 | Faintest | World |
| `read` | Read, Glob, Grep, ToolSearch, Skill, ListAgents | 32.5 % | Wide pale cone | Faint | World |
| `edit` | Edit, Write, NotebookEdit | 10.2 % | Thin hot lance, leaves a 10 s ember | Bold | System |
| `web` | WebFetch, WebSearch | in `read` above | Lance off the world into the sky | Medium | World |
| `mcp` | any `mcp__*` | 0.03 % | Arc to a limb tick, or to the star for `mcp__os__*` | Medium | World |
| `launch` | Agent, Task, Workflow, `mcp__os__agent_spawn` | 0.28 % | No beam: a streak and a new craft | Boldest | System |
| `send` | SendMessage, SendToProject, `mcp__os__agent_send` | 0.10 % | Line from craft to craft | Bold | System |
| `ask` | AskUserQuestion, ExitPlanMode | 0.02 % | No beam: a well | Maximum | System |
| `other` | everything else | 3.1 % | 120 ms tick at the hull | Faint | World |

One flush from an observed craft can hold several tool calls with their results (`RF 5.2`) `[V]`. They replay as a stagger, 120 ms apart, 8 at most, then a `+n` tag, marked `replay` at World level and closer.

### 2.5 Two heroes

**The Salvo, Observer plane.** One Claude launches others, and you see it from across the room. It needs only journal data. It fired 113 times in October on 18 of 31 days, and 74 of those were 3 to 5 agents, so it is designed for 3 to 5, not 16. `[V]`, spectacle verdict census.

**The Bend, Control plane.** An owned agent needs you. Its craft stops dead, one wave crosses the sky, an Einstein ring closes around it, and the sky stays bent until you answer. Then the ring collapses and the whole sky rebounds. It belongs to this product alone, because the effect and the signal are the same thing.

Choreography for both is in section 9.

---

## 3. Information architecture

### 3.1 Levels and overlays

Three zoom levels, and overlays that work at every level. There are no pages.

| Name | Kind | Shows | Enter | Leave |
|---|---|---|---|---|
| **System** | Level 0 | Every world and craft | App start, `0`, `Esc` | |
| **World** | Level 1 | One world: orbits, altitudes, hoops, moons, all beams | `1` to `9`, `Enter` on a world, double click | `Esc` |
| **Craft** | Level 2 | One craft in chase view, full Channel | `Enter` on a craft | `Esc` |
| **Unroll** | Sublevel of World | A workflow flattened into phase rows | `Enter` on an armillary | `Esc` |
| **Docket** | Overlay, right edge | One decision | `Space`, `Ctrl+.`, click a row | Answer, `Esc` |
| **Launch** | Sheet, right edge | One command line, parsed | `L`, or `Shift+L` for a mission | `Esc`, launch |
| **Ledger** | Sheet, right edge | Cost and plan windows | `C` or `$`, click the 5H readout | `Esc` |
| **Sky** | Mode | 30 days of history as ink on amber, the Plate at full size | `T` | `Esc` |
| **Find** | Palette, top centre | Worlds, craft, sessions, commands | `F` or `/` | `Esc` |
| **Laws** | Dialog | The seven laws and all keys | `?` | `Esc` |
| **Settings** | Sheet | Boot, sound, notifications, quality, comfort | `,` | `Esc` |
| **Cinema** | Mode | Scene full viewport, lamps only | `H` | `H`, `Esc` |
| **Plate** | Scene substitute | SVG chart, same rails | Automatic, or Settings | Automatic |

### 3.2 Navigation rules

- **Rails never leave.** The right rail keeps `NEEDS YOU` at the top at every level, in every mode except Cinema, where any new decision brings the row back at once. A decision is never hidden by a view state.
- **The camera moves only when you move it.** A new decision never flies the camera.
- **Input always wins.** Any key during a flight ends the flight at once and applies. A move repeated within 60 s plays at under a third of its length.
- **Selection is free.** `J`, `K` and a click select and open the Channel in the rail, with no flight. `Enter` is what flies.
- **One live craft needs no zoom.** With exactly one live craft it is auto-selected, and its Channel shows in the rail.

### 3.3 Attention order

The right rail, `J` and `K`, and the Manifest highlight all use one order:

1. Answerable decisions, oldest first
2. Waits at source, oldest first
3. Faults
4. Low context, at or above 80 % of the window
5. Out of budget, parked
6. Everything else, most recently active first

Answerable always sits above read-only, on the same panel, so a stale observed wait can never hold the top slot.

### 3.4 Keyboard map

The attached keyboard is German QWERTZ (layout 00000407). `[V]` So nothing here needs `AltGr`, and `[` and `]` are not used. Match characters on `event.key`, which follows the layout. Match the stop keys on `event.code === 'Period'`, so that `Shift` still matches, because `Shift+.` is `:` on QWERTZ. Global letters never reuse a docket letter (`A D E S X R`), so a double tap outside the docket does nothing dangerous. All single keys are inert while focus is in a text field.

**Global**

| Key | Action |
|---|---|
| `Space` | Attend: open the oldest answerable decision in the docket, focused. With none, select the oldest wait at source. Types a space in text fields, and presses a focused button |
| `Ctrl+.` | Attend from anywhere, including text fields |
| `Enter` | Open the selection: fly to the world or craft. Never approves anything |
| `Esc` | Up one level, or close the top overlay. Decides nothing |
| `J` `K`, `Down` `Up` | Next and previous in attention order. Selects, no flight |
| `1` to `9`, `0` | Fly to a world by slot, `0` for System |
| `L`, `Shift+L` | Launch one craft, or start a mission |
| `F`, `/` | Find |
| `M` | Manifest: per craft or per world, `Shift+M` collapses the rail |
| `T` | Sky |
| `C`, `$` | Ledger |
| `V` | Veil, recording mode |
| `H` | Cinema |
| `Q` | Cycle the Tape filter: all, writes and damage, needs |
| `G` | Geiger on or off |
| `N` | Mute all sound |
| `?` | Laws and keys |
| `,` | Settings |
| `.` hold 600 ms | Stop the selected owned craft |
| `Shift+.` hold 1200 ms | All stop, every owned craft |

**Selected craft**

| Key | Action |
|---|---|
| `I` | Focus the follow-up box |
| `W` | Show text in the Channel for this craft. Explicit fetch, section 7.10 |
| `B` | Add budget |
| `O` | Fork |
| `U` | Resume an exited craft, after the orphan sweep |

**Docket focused**

| Key | Action | Return value (`AC 9.2`) `[V]` |
|---|---|---|
| `A` | Approve | `{ behavior: 'allow', updatedInput: input }` |
| `E` | Edit, then approve | `updatedInput` changed. The model is not told, so it goes to the audit log |
| `S` | Always, this session | `updatedPermissions`: `addRules` suggestions copied with `destination: 'session'`. For `Write`, send `{ type: 'addRules', rules: [{ toolName: 'Write' }], behavior: 'allow', destination: 'session' }` |
| `Shift+S` | Always in this project | Explicit only, because it writes `.claude/settings.local.json` |
| `D` | Deny | `{ behavior: 'deny', message }`. Default text names the one call: `Not approved for this call.` |
| `X` | Deny and stop the turn | `interrupt: true`. The message is lost, so focus moves to the follow-up box for guidance |
| `R` | Redirect | A send with `priority: 'now'`, which cancels the request |
| `1` to `4` | Pick a question option | `updatedInput: { questions, answers }` |
| `J` `K` | Next or previous decision | |
| `O` | Open wide, for a diff or plan | |
| `V` hold | Read through the veil | |
| `Esc` | Leave undecided | Nothing is sent |
| `Enter` | Nothing | Never approves |

**Text fields:** `Enter` queues a follow-up, `Ctrl+Enter` sends now and interrupts the turn, `Esc` leaves the field. In Launch: `Ctrl+Enter` launches, `Shift+Enter` plan first, `Alt+Enter` read-only analyst, hold `Alt+T` to trust a world.

**Pointer:** click selects, double click flies, wheel steps one level, drag tilts the view up to 18 degrees and springs back on release.

### 3.5 Operator jobs

Each job works with no WebGL, because each is DOM.

| Job | Fastest path | What you see | With the mouse |
|---|---|---|---|
| **See the fleet** | Nothing, it is the default screen | Lamps in 1 s. Sky and plumes in 5 s. Manifest rows with a plain state word in 30 s | |
| **Follow an agent** | `J` or `K` to select, `Enter` to chase | Filament and orbit highlight, chase camera on `Enter` | Click, then double click |
| **Read its live stream** | Select: the Channel opens in the rail. `Enter` for the wide one | Structure by default. `W` shows text. Thinking shows a token count, because thinking text is hidden (`AC 2.3`) `[V]`. Observed craft show per-response rows and `generating` | Click a row |
| **Approve or deny** | `Space`, wait for the arm bar, `A` or `D` | Lock, leader line, docket. Answering re-arms for the next request | Click the row, then a button after it arms |
| **Spawn an agent** | `L`, type `@world #profile $2 prompt`, `Ctrl+Enter` | Transfer arc drawn as you type, ejection on launch | `L` then the form rows |
| **Send a follow-up** | Select, `I`, type, `Enter` | Queued until the turn ends. `Ctrl+Enter` interrupts. A pod docks ahead of the hull | Click the box |
| **Stop one** | Select, hold `.` 600 ms | Ring fills under the row. The hull shows each stop step: interrupt, end of input, tree kill. It takes about 2 s (`AC 2.4`) `[V]` | Hold the row's `STOP` |
| **Stop all** | Hold `Shift+.` 1200 ms, or hold `ALL STOP` | Stops every owned craft. Observed craft are listed as out of reach. A pointer or assistive route opens a confirm dialog instead of a hold | Hold `ALL STOP` |
| **Start a mission** | `Shift+L` | Same sheet with `#orchestrator` set and a tree budget. A sungrazer enters the corona and prompts Claudes under the limits in `AC 12.3` | `Shift+L` |
| **Check cost** | `C` | Masthead always shows windows left. Ledger shows today, burn, 30 days, plan windows, per world, tree budgets, per model. Every number says `est` | Click the 5H readout |

### 3.6 Decision rules

These are enforced in the docket, from `AC 9`. `[V]`

- **No focus stealing.** A new decision lights the lamp and adds a row. Focus stays where it was. Text you are typing can never reach a card.
- **Arming.** Keys work only with the docket focused, and only 350 ms after focus or after a new request appears in it, shown by a filling bar. A serial next call re-arms, so a double tap cannot approve an unread call. Pointer clicks and assistive activation obey the same arm.
- **Enter never approves,** even on a focused button: the docket swallows it. Focus enters on the docket region, never on a button. `Space` on a button you tabbed to still works once armed, so keyboard and assistive routes exist.
- **Danger.** `decisionReason: "Path is outside allowed working directories"` or `defaultToNo`: the ring turns `halpha`, the docket opens on Deny, and Approve needs `A` held for 700 ms. `suppressAlwaysAllowRule` hides `S`.
- **Rendering by tool.** `command`, `description`, `blockedPath` for Bash and PowerShell. A diff from `old_string` and `new_string` for Edit. `file_path` and a preview for Write. `plan` as Markdown for ExitPlanMode. A form from `questions[]` for AskUserQuestion. Server, source, tool and arguments for MCP, and `mcpServer.name` is escaped unless `source` is `sdk`. Inside a subagent, tag with `agentID` and its type.
- **Never** pass `localSettings` suggestions through by default.
- **Lifecycle.** Requests are keyed by `requestId`. A second tab sees `ANSWERED ELSEWHERE`. On `approval.cancelled` the card shows `WITHDRAWN` and leaves. After a kernel restart it shows `EXPIRED`, and the resumed model asks again. There is no timeout (`AC 9.1`), so the UI shows age.
- **Queue.** Oldest first across all projects. New cards join at the bottom and never swap under your finger. Approvals never aggregate.

### 3.7 Out of the page

With one attached display, NAOS is likely to sit behind the editor. `[U]` Prompts have no deadline, so an approval could wait unseen for hours.

| Channel | When | Content |
|---|---|---|
| Document title | Always, instantly, also on a hidden tab, because WebSocket events still fire there `[U]` | `(2) NAOS, kestrel needs approval` |
| Favicon | Same | Icon with a `nad` dot |
| Windows notification | The kernel raises it when no connected client reports visible and focused. Repeats at 2 min and 10 min, at most 3 per decision | `kestrel β needs approval: Bash`. No message text. Click opens the app window on that decision, through a signed `/open?docket=<requestId>` link |
| Sound | If the alert was enabled at First Flight | `ping` |

Toast route, click activation and throttling are `[U]`. See Appendix A.

### 3.8 Launch grammar

The command line is the whole form. `@world #profile $budget x2 moon prompt`. Everything below it shows what was parsed and can be edited in place. On QWERTZ `@` needs `AltGr`, so a leading word that matches a world counts as `@world`.

| Token | Meaning | Default |
|---|---|---|
| `@name` or a leading world name | World | Selected world |
| `#name` | Profile from `AC 8`: `build`, `recon`, `analyst`, `long`, `plan`, `orchestrator`, `scratch` | `build` in a trusted repo, `recon` otherwise |
| `$n` | Budget per craft, soft cap | Profile default |
| `x2` | Copies, as a salvo inside the spawn limits | 1 |
| `moon` | New worktree per craft | On for `build` |
| rest | Prompt | |

Preflight shows only what `resolveSettings` really returns: `effective`, `provenance` and `sources`. `[V]` Skill, MCP and context numbers come from a spawned process (`AC 2.9`) `[V]`, so they appear under `LOADOUT, measured at last spawn in this repo`, and only for trusted repos. A spawn with `project` sources runs repo hooks.

---

## 4. Layout

### 4.1 Layout classes

The attached display is a 30 x 19 cm panel at 1920 x 1200 and 150 % scaling. `[V]` That gives 1280 x 800 CSS, about 1280 x 752 of work area `[V]`, and less inside a browser window. So **1280 x 800 is the primary target**, and 2560 x 1440 is the secondary one.

Class by viewport width, exact values in CSS px:

| | Compact `C` | Regular `R` | Wide `W` |
|---|---|---|---|
| Width | 1280 to 1599 | 1600 to 2199 | 2200 and up |
| Left rail | 236 | 280 | 320 |
| Right rail | 296 | 340 | 400 |
| Masthead | 36 | 40 | 44 |
| Bottom strip | 44 | 48 | 52 |
| Docket | 420 | 480 | 560 |
| Channel at Craft level | 420 | 520 | 640 |
| Sheet (Launch, Ledger) | 640 | 720 | 840 |
| Row height | 20 | 20 | 22 |
| Body type | 12 | 12 | 13 |
| Micro type | 10 | 11 | 11 |
| `craftK` | 1 | `clamp(free.h / 720, 1, 1.4)` | same |

**The free rect** is the viewport minus the rails, masthead and bottom strip. **The canvas is exactly the free rect.** Rails sit on opaque `void`, so text contrast is exact and no pixel is shaded behind them. The sky globe is fitted to the free rect, so the rails were on empty sky anyway.

```text
free.x = left rail      free.w = vw - left rail - right rail
free.y = masthead       free.h = vh - masthead - bottom strip
```

| Viewport | Class | Free rect | Canvas at Umbra | `craftK` |
|---|---|---|---|---|
| 1280 x 800, 1.5 | C | 748 x 720 | 1122 x 1080, 1.21 MP | 1.00 |
| 1280 x 665, 1.5 | C, short | 748 x 605 | 1122 x 908, 1.02 MP | 1.00 |
| 1920 x 1080, 1 | R | 1300 x 992 | 1300 x 992, 1.29 MP | 1.38 |
| 2560 x 1440, 1 | W | 1840 x 1344 | 1840 x 1344, 2.47 MP | 1.40 |

All `[V]`, computed by `hud()` and `renderDpr()` in section 7.

### 4.2 Width behaviour from 1280 to 2560

Between breakpoints rails stay fixed and only the free rect grows. So nothing reflows while dragging a window, except at the two class boundaries.

| Width | Behaviour |
|---|---|
| Below 1024 | **Instrument mode.** No canvas. One column: `NEEDS YOU`, Manifest, Tape. Every job still works |
| 1024 to 1279 | Left rail collapses to a 44 px strip of slots and marks. `M` opens it as an overlay |
| 1280 to 1599 | Class C. Manifest row: mark, letter, title, state word and metric. `CHANNEL` shares the rail |
| 1600 to 2199 | Class R. Manifest adds the world's burn. Channel gains 8 rows |
| 2200 to 2560 | Class W. Type steps up 1 px. Right rail gives all remaining height to the Channel, about 900 px. Manifest world rows add a burn sparkline |
| Above 2560 | Class W. Rails stay, the free rect grows. Canvas capped by the tier's `maxMP` |

The sky scale is `max(free.w, free.h) / 2` at 90 degrees from the view axis, so the month fits the free rect at C and R, and meridians run off the top and bottom at W, where the rect is wider than tall. `[V]`, seen in the renders.

### 4.3 Height behaviour

| Height | Behaviour |
|---|---|
| 800 and up | As specified |
| Below 720 (`short`) | Bottom strip collapses to one 24 px row: the Ephemeris. Tape moves into the right rail's `LANDED` slot. A normal browser window on this panel probably lands here `[U]` |
| Rail overflow | Rails scroll internally. Manifest first collapses healthy worlds to one row, least attention first. `NEEDS YOU` never scrolls away: it is sticky |

The Manifest needs 631 px for 20 craft on 5 worlds with 20 px rows, so it fits at 800 high and collapses one or two healthy worlds at 665. `[V]` arithmetic

### 4.4 Reading the wireframes

Column = 8 CSS px, row = 16 CSS px, so 160 x 50 is 1280 x 800. A generator built them on a checked grid and fails on any string longer than its slot. `[V]` Latin letters `a b g d` stand for Greek designators. Marks are ASCII stand-ins for the SVG marks in section 6: `(o)` closed ring, `(:)` broken ring, `>` kite, `...` three dots, `--` dashes, `#` and `[]` tool, `x` fault, `~` retry, `.` beacon.

### 4.5 System

Compare `docs/design/naos-system.png`, which uses the same geometry with real type.

```text
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
| N A O S  [YOU 1][SOURCE 1][FAULT 1][RETRY 1][LOW 1] LIMIT SENSOR   RUN 13 IDLE 1  5H 58 % left  7D 82 % left  as of 14:02                  * LINK [ALL STOP] |
+----------------------------+--------------------------------------------------------------------------------------------+------------------------------------+
| MANIFEST          20 craft |                            ......                         ......                           | NEEDS YOU                       1  |
| -------------------------- |                        .....                                   .....                       | ---------------------------------  |
| 1 kestrel        $4.20 est |                     ....                                           ....                    | 0:41 kestrel b               Bash  |
| (o) b flaky   APPROVE 0:41 |    [F] meridians: one per day, now at right, Horizon at left           ...                 | npm install --save-dev vitest@4    |
| >   a limiter  WRITE 388/s |                ...                                                       ...               | SPACE answer here      ENTER dive  |
| ... g docs      THINK 41 s |              ...                                                3 harbor   ...             |                                    |
| #   d types      EDIT 0:06 |            ..                                                  ==========    ...           | AT SOURCE                       1  |
|                            |          ...                                                ::: @@@@@@@ ==     ...         | ---------------------------------  |
| 2 tundra obs     $1.10 est |         ..5 lumen                                          == @@::     @@ =[C] armillary   | 0:12 lumen a    permission prompt  |
| --  a ledger   MODEL 4.8 s |        ..    @@@@@                                         = @   :::    @@ =      ..       | answer in its own window           |
| []  b callers   SHELL 12 s |      ..      @   @      :::::::                            = @     :::   @ =        ..     |                                    |
| .   g change     IDLE 12 m |      .       @@@@@    ::       ::                          = @@      ::: @ =         .     | TROUBLE                         2  |
|                            |     .                 :  <a     0:12 [D]                   == @@       @@ ==          .    | ---------------------------------  |
| 3 harbor         $5.30 est |    .                  ::       ::                           === @@@@@@@ ::             .   | x mosaic b       API 529, read it  |
| >   a invoices WRITE 212/s |   ..                    :::::::                                =========               ..  | ~ mosaic g     retry 3 of 10, 8 s  |
| o   repo-audit     7 of 12 |   .                                                                                     .  |                                    |
|                            |  .                                                   ~~~ [G] streamer          @        .. | LOW CONTEXT                     1  |
| 4 mosaic         $0.70 est |  .                                          ### / sliver                     @@ @@6 quill. | ---------------------------------  |
| >   a tiles    WRITE 140/s |  .           =====>  [E] wake and plume ####   ####                            @         ..| kestrel d         812k of 1M used  |
| x   b shader     ERROR 529 | .                                      ##         ##                                      .|                                    |
| ~   g bundle    RETRY 3/10 | .                                     #             #   OOOOOOOOOOO                       .| LANDED, LAST HOUR              12  |
|                            | .                 @ @                 #  kernel     #OOO           OO                     .| ---------------------------------  |
| 5 lumen obs      $0.10 est | .               @@   @@               # [A] disc    OO               OO                   .| harbor           11 lit, 1 failed  |
| (:) a offline  SOURCE 0:12 | .              @       @               ##         #OO    0:41         OO                  .| kestrel                     1 lit  |
| --  b lint      MODEL 11 s | ..              @@   @@                 ####   ####O                   O   *--- beam     ..|                                    |
|                            |  .                @ @                       ###    O       <b [B]      O                 . | CHANNEL                 kestrel a  |
|                            |  ..            2 tundra                            O                  @@@ @@@           .. | ---------------------------------  |
|                            |   .                                                OO               @@OO     @@         .  | 14:06:04 text            ~210 tok  |
|                            |   ..                                                OO              @OO       @        ..  | 14:06:06 Read      timer.ts 0.2 s  |
|                            |    .                                                 OOO           O@@       @@        .   | 14:06:09 Edit      +4 -2 approved  |
|                            |     .                                                   OOOOOOOOOOO   @@@ @@@         .    | 14:06:11 Bash      running 12.4 s  |
|                            |     ..             :::                                                               .     | 14:06:18 tender   Explore started  |
|                            |       .              :::                                              1 kestrel     ..     |                                    |
|                            |        ..              :::                                                        ..       |                                    |
|                            |         ..               ::::                                                    ..        |                                    |
|                            |          ...                ::::                @@@  <=====                    ...         |                                    |
|                            |            ...                  ::::          @@   @@                        ...           |                                    |
|                            |              .@@                              @     @                      ...             |                                    |
|                            |               @.@.                            @@   @@                    ...               |                                    |
|                            |               @@ ....                           @@@                    ...                 |                                    |
|                            |        7 ferro      ....                   4 mosaic  API 529       ....                    |                                    |
|                            |                        .....                                   .....                       |                                    |
|                            |                            ......                         ......                           |                                    |
+----------------------------+--------------------------------------------------------------------------------------------+------------------------------------+
| RATE 1,840 tok/s est   BURN $3.20/h est   TODAY $11.40 est   RESETS 17:40   OWNED 4 of 6 running   LAG MAX 11.6 s  L launch  F find  T sky  C ledger  ? laws |
| TAPE  14:06:21 harbor tender landed   14:06:19 mosaic API 529   14:06:18 kestrel tender launched   14:06:11 kestrel needs approval, Bash                     |
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
```

- **[A] Disc.** Centre of the free rect, radius `0.082 * min(free.w, free.h)`, 59 px here. Sliver at one o'clock.
- **[B] Closed well.** Owned craft needs approval. Meridians bow around it. Label shows letter and age.
- **[C] Armillary.** A running workflow: hoops are phases, beads are agents.
- **[D] Broken ring.** An observed wait. No lens. Age beside it.
- **[E] Wake and plume.** The arc behind a craft, plus a tapered plume of 30 to 68 px.
- **[F] Meridians.** One per day. Now is the bright arc at the right edge of the globe, the Horizon the arc at the left.
- **[G] Streamer.** A corona streamer points at each loaded world.

**Labels.** World name and slot always show, on the outward side from the star. If that spot hits a craft, try 0.9 and 1.8 radians either way, then the far side. Craft labels show only for waiting, failed and selected craft, 30 labels at most. Labels sit under rails, docket and sheets in the z order, so they can never overlap them.

### 4.6 World

```text
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
| N A O S  [YOU 1][SOURCE 1][FAULT 1][RETRY 1][LOW 1] LIMIT SENSOR   RUN 13 IDLE 1  5H 58 % left  7D 82 % left  as of 14:02                  * LINK [ALL STOP] |
+----------------------------+--------------------------------------------------------------------------------------------+------------------------------------+
| 1 kestrel         esc back |                                                                                            | NEEDS YOU                       1  |
| C:/dev/kestrel  git  main  |                          ==                                                                | ---------------------------------  |
| -------------------------- |                      =====         .................                                       | 0:41 kestrel b               Bash  |
| ALTIMETER     context used |                   ====       ......                 ......                @@@@@@@          | SPACE answer here      ENTER dive  |
|                            |  [L] hoops open up=      ....                             ....           @      @@         |                                    |
|    25k |       a ---       |  ENTER unrolls them  ....    [J] rings are altitude           ....       @       @         | AT SOURCE, elsewhere            1  |
|                            |            ===     ..               ...............              ...     @      @@         | ---------------------------------  |
|   100k | g --              |           ==    ...            .....               .....            ..    @@@@@@@          |                                    |
|                            |         ==     ..          ....                         ....       [K] moon agent/q7       | kestrel           est, list price  |
|   250k | b ------          |        ==    ..         ...        (o) <b  well             ...         ..                 | ---------------------------------  |
|                            |       ==    .         ...            @@@@@@@@@@@@@             ..         .                | MASS                $412, 30 days  |
|   500k |                   |     ==     .        ..          @@@@@             @@@@@          ..        ..              | TODAY                      $11.40  |
|                            |     =    ..        .         @@@                       @@@         .   <a=====             | LIGHTS             492, 18 failed  |
|     1M | d -  low          |    =    ..        .        @@@                           @@@        ..       ..            | MOONS                  1 worktree  |
|                            |   ==   ..       ..        @                                 @        ..       ..           | CRAFT                4, 2 tenders  |
|       == limit             |  ==    .       ..       @@                                   @@       ..       .           |                                    |
|                            |  =    .       ..       @                                      @@       ..       .          | ARMILLARY  repo-audit        live  |
|                            |       .       .       @@                                       @@       .       .          | ---------------------------------  |
| -------------------------- |      ..      ..       @                                         @       ..      ..         | phase 1 survey             6 of 6  |
| CRAFT 4           J K walk |      .       .       @                                           @       .       .         | phase 2 verify    4 of 6, 1 retry  |
| (o) b flaky   APPROVE 0:41 |      .       .       @                                           @       .       .         | phase 3 report           none yet  |
| >   a limiter  WRITE 388/s |      .       .       @              [H] city lights              @       .       .         | no total until the run ends        |
| ... g docs      THINK 41 s |      .       .       @                                           @       .       .         |                                    |
| #   d types      EDIT 0:06 |      .       .       @             night side, one per           @       .       .         | CHANNEL                 kestrel a  |
|                            |      ..      ..       @            finished agent               @       ..      ..         | ---------------------------------  |
| WORKTREES 1       agent/q7 |       .       .       @@                                       @@       .       .          | 14:06:09 Edit      +4 -2 approved  |
|                            |       .       ..       @@                                      @       ..       .          | 14:06:11 Bash      running 12.4 s  |
|                            |        .       ..       @@                                   @@       ..       .           | 14:06:18 tender   Explore started  |
|                            |        ..       ..        @                                 @<d  *--- beam    ..           |                                    |
|                            |         ..   <g==..        @@@                           @@@        .        ..            |                                    |
|                            |          ..        .         @@@                       @@@         .        ..             |                                    |
|                            |           ..        ..          @@@@@             @@@@@          ..        .               |                                    |
|                            |             .         ..             @@@@@@@@@@@@@            ...         .                |                                    |
|                            |              ..         ...                                 ..          ..                 |                                    |
|                            |                ..          ....                         ....          ..                   |                                    |
|                            |                  ..            .....               .....            ...                    |                                    |
|                            |                    ...              ...............               ..                       |                                    |
|                            |                      ....                                     ....                         |                                    |
|                            |                          ....                             ....                             |                                    |
|                            |                              ......                 ......                                 |                                    |
|                            |                                    .................                                       |                                    |
|                            |                                                                                            |                                    |
|                            |                                                                                            |                                    |
+----------------------------+--------------------------------------------------------------------------------------------+------------------------------------+
| RATE 1,840 tok/s est   BURN $3.20/h est   TODAY $11.40 est   RESETS 17:40   OWNED 4 of 6 running   LAG MAX 11.6 s  L launch  F find  T sky  C ledger  ? laws |
| TAPE  14:06:21 harbor tender landed   14:06:19 mosaic API 529   14:06:18 kestrel tender launched   14:06:11 kestrel needs approval, Bash                     |
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
```

- **[H] City lights.** One per finished agent, one cluster per session.
- **[J] Rings.** Altitude. The Altimeter gives the exact, labelled scale.
- **[K] Moon.** A worktree, with its own craft.
- **[L] Hoops.** Opened up. `Enter` unrolls them into flat rows.

### 4.7 Craft

The right rail widens to the Channel width and overlays the canvas, and the view offset recentres the craft in what is left. Canvas size does not change.

```text
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
| N A O S  [YOU 1][SOURCE 1][FAULT 1][RETRY 1][LOW 1] LIMIT SENSOR   RUN 13 IDLE 1  5H 58 % left  7D 82 % left  as of 14:02                  * LINK [ALL STOP] |
+----------------------------+-----------------------------------------------------------------------------+---------------------------------------------------+
| kestrel a         esc back |                                                                             | NEEDS YOU 1   0:41 kestrel b  Bash  SPACE answer  |
| rate limiter               |                                                                             | ------------------------------------------------  |
| -------------------------- |                                                                             | CHANNEL  structure           W show text  V veil  |
| STATE                WRITE |                                                                             | ------------------------------------------------  |
| MODEL   sonnet-5-5 class G |                                                                             | 14:05:58 turn 7    from you                       |
| EFFORT                 low |                                                                             | 14:06:01 thinking  ~410 tokens, text hidden       |
| MODE               default |                                                                             | 14:06:04 text      [####################]  66 ch  |
| BRANCH      agent/q7  moon |                                                                             | 14:06:06 Read      src/queue/timer.ts  0.2 s      |
| OWNER     owned, live link |                                                                             | 14:06:07 Grep      useFakeTimers  0.1 s           |
|                            |                                                                             | 14:06:09 Edit      src/queue/timer.ts  +4 -2      |
| CONTEXT     74k of 1M used |                                                                             |                    approved, this session         |
| [###-------------------]   |                                                                             | 14:06:11 Bash      npm test -- queue  12.4 s      |
| alt 0.60  orbit, log scale |      . . .  [O] motes, this craft only                                      |                    running ......                 |
|                            |                                                                             | 14:06:12 tender t2 Explore started                |
| DRIVE        388 tok/s est |                                                                             |                                                   |
| BUDGET      $0.42 of $2.00 |                                                                             |                    generating_                    |
| TURN               7 of 40 |                                                                             |                                                   |
| TOOLS         31, 1 failed |                              ______                                         | tape  |tt|xxx|T|T|E|B========|  blocks of turn 7  |
| QUEUED                   0 |                             /      \                                        |                                                   |
| LAG           0, live link |                             \______/>>>>> plume                             |                                                   |
|                            |                                                                             |                                                   |
| LINEAGE                    |                              [M] hull mesh, 300 tris, selected only         |                                                   |
| -------------------------- |                                                                             |                                                   |
| you                        |                                                                             |                                                   |
|   sungrazer  mission m2    |                                |  [N] current beam                          |                                                   |
|     a  this craft          |                                |                                            |                                                   |
|       tender t1 Explore    |                                |                                            |                                                   |
|       tender t2 running    |                                |                                            |                                                   |
|                            |                                |                                            |                                                   |
| STANDING GRANTS 2          |                                |                                            |                                                   |
| Write         this session |                                |                                            |                                                   |
| Bash(npm test)this session |                                                                             | ------------------------------------------------  |
|                            |                                                                             | FOLLOW-UP                                I focus  |
|                            |                            ######################                           | > queued until this turn ends_                    |
|                            |                   #########                     #########                   |                                                   |
|                            |              ######                                     ######              | ENTER queue      CTRL+ENTER now, stops the turn   |
|                            |          #####                                               #####          | hold . stop   B budget   O fork   U resume        |
|                            |       ####                                                       ####       |                                                   |
|                            |    ###                                                               ###    | stop: interrupt, end of input, tree kill last     |
|                            | ###                                                                     ### | observed craft: READ ONLY, no input, no stop      |
|                            |##                                                                         ##|                                                   |
|                            |      night side, cities below, eclipse past the limb                        |                                                   |
|                            |                                                                             |                                                   |
+----------------------------+-----------------------------------------------------------------------------+---------------------------------------------------+
| RATE 1,840 tok/s est   BURN $3.20/h est   TODAY $11.40 est   RESETS 17:40   OWNED 4 of 6 running   LAG MAX 11.6 s  L launch  F find  T sky  C ledger  ? laws |
| TAPE  14:06:21 harbor tender landed   14:06:19 mosaic API 529   14:06:18 kestrel tender launched   14:06:11 kestrel needs approval, Bash                     |
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
```

- **[M] Hull.** A real mesh, about 300 triangles, selected craft only.
- **[N] Beam.** The current tool, in its family's shape.
- **[O] Motes.** The only level where motes exist.

Observed craft show the same layout with a `READ ONLY` strip in place of the follow-up box, naming the owner, such as `claude-vscode, pid 21744`.

The Channel is structure by default. `W` fetches text for this craft only, and moving away seals it again unless pinned. Thinking shows an estimated token count and no text. Sealed text rows are bars of true length, which needs `blockSizes`, Appendix A.

### 4.8 Docket

The docket opens over the rail at a fixed place at every level. Compare `docs/design/naos-docket.png`. The scene dims to 45 %, the ring stays at full level, the view offset shifts the scene left by half the docket's overhang, and a hairline joins the ring to the docket header.

```text
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
| N A O S  [YOU 1][SOURCE 1][FAULT 1][RETRY 1][LOW 1] LIMIT SENSOR   RUN 13 IDLE 1  5H 58 % left  7D 82 % left  as of 14:02                  * LINK [ALL STOP] |
+----------------------------+-----------------------------------------------------------------------------+--------------+------------------------------------+
| MANIFEST          20 craft |                                                                             #  NEEDS YOU                                1 of 1  |
| -------------------------- |                                                                             #  -----------------------------------------------  |
| 1 kestrel        $4.20 est |    Scene at 45 %. Ring stays at full level.                                 #                                                   |
| (o) b flaky   APPROVE 0:41 |    Brackets close in 180 ms. Hairline joins ring and docket.                #  kestrel b  fix flaky queue                 0:41  |
| >   a limiter  WRITE 388/s |                                                                             #  owned   tender t2, Explore          call 2 of 2  |
| ... g docs      THINK 41 s |                                                                             #                                                   |
| #   d types      EDIT 0:06 |                                                                             #  Bash  wants to run                               |
|                            |                                                                             #  +---------------------------------------------+  |
| 2 tundra obs     $1.10 est |                                                                          ---#  | npm install --save-dev vitest@4             |  |
| --  a ledger   MODEL 4.8 s |                                                                         /   #  +---------------------------------------------+  |
| []  b callers   SHELL 12 s |                                                                        /    #                                                   |
| .   g change     IDLE 12 m |                                                                       /     #  Install the test runner upgrade                  |
|                            |                                                                      /      #  blocked path                                     |
| 3 harbor         $5.30 est |                                                                     /       #  C:/dev/kestrel/.claude/worktrees/q7/package.json |
| >   a invoices WRITE 212/s |                                                                    /        #                                                   |
| o   repo-audit     7 of 12 |                                                                   /         #  -----------------------------------------------  |
|                            |                                                                  /          #  [A Approve    ] [D Deny       ] [X Deny, stop ]  |
| 4 mosaic         $0.70 est |                               ###                               /           #  [E Edit first ] [S This sessn ] [R Redirect   ]  |
| >   a tiles    WRITE 140/s |                           ####   ####  [-                      /    -]      #                                                   |
| x   b shader     ERROR 529 |                          ##         ##                        /             #  ========================================= armed  |
| ~   g bundle    RETRY 3/10 |                         #             #         OOOOOOOOOOO  /              #  Enter never approves. Esc leaves this undecided. |
|                            |                         #  kernel     #      OOO           OO               #                                                   |
| 5 lumen obs      $0.10 est |                         #             #     OO               OO             #  Shift+S  always in this project, writes a file   |
| (:) a offline  SOURCE 0:12 |                          ##         ##     OO                 OO            #  Deny sends: "Not approved for this call."        |
| --  b lint      MODEL 11 s |                           ####   ####      O                   O            #  Edit is not told to the model, it is audited     |
|                            |                               ###          O       <b          O            #                                                   |
|                            |                                            O                   O            #  -----------------------------------------------  |
|                            |                                            OO                 OO            #  STANDING GRANTS                               2  |
|                            |                                             OO               OO             #  Write                              this session  |
|                            |                                              OOO           OO               #  Bash(npm test)                     this session  |
|                            |                                                 OOOOOOOOOOO                 #                                                   |
|                            |                                                                             #  -----------------------------------------------  |
|                            |                                        [-                           -]      #  AT SOURCE                                     1  |
|                            |                                                                             #  0:12 lumen a           answer in its own window  |
|                            |                                                                             #                                                   |
|                            |                                                                             #                                                   |
|                            |                                                                             #                                                   |
|                            |                                                                             #                                                   |
|                            |                                                                             #                                                   |
|                            |                                                                             #                                                   |
|                            |                                                                             #                                                   |
|                            |                                                                             #                                                   |
|                            |                                                                             #                                                   |
+----------------------------+-----------------------------------------------------------------------------+--------------+------------------------------------+
| RATE 1,840 tok/s est   BURN $3.20/h est   TODAY $11.40 est   RESETS 17:40   OWNED 4 of 6 running   LAG MAX 11.6 s  L launch  F find  T sky  C ledger  ? laws |
| TAPE  14:06:21 harbor tender landed   14:06:19 mosaic API 529   14:06:18 kestrel tender launched   14:06:11 kestrel needs approval, Bash                     |
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
```

| Variant | Change |
|---|---|
| Danger | `DEFAULT DENY` header, ring `halpha`, Deny preselected, `A` is a 700 ms hold |
| AskUserQuestion | Form of 1 to 4 questions, keys `1` to `4` |
| ExitPlanMode | Plan as Markdown, `APPROVE PLAN` |
| Edit, Write | Diff or preview. `O` opens wide to `max(720, 56 vw)` |
| MCP | Server, source, tool, arguments. Server name escaped and marked unless `sdk` |
| Serial next call | Body swaps, `call 2 of 2`, arm bar restarts |
| Veiled | Body shows structure only, `Bash, 1 line, 31 chars`. Hold `V` to read |
| Kernel lost | Buttons disabled, `cannot be answered now` |

### 4.9 Launch and mission

Transfer arcs draw while you type `@world`, one per craft.

```text
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
| N A O S  [YOU 1][SOURCE 1][FAULT 1][RETRY 1][LOW 1] LIMIT SENSOR   RUN 13 IDLE 1  5H 58 % left  7D 82 % left  as of 14:02                  * LINK [ALL STOP] |
+----------------------------+-------------------------------------------------+------------------------------------------+------------------------------------+
| MANIFEST          20 craft |                                                 |  LAUNCH                                                           ESC cancel  |
| -------------------------- |                                                 |  ---------------------------------------------------------------------------  |
| 1 kestrel        $4.20 est |    Scene stays live.                            |  > @kestrel #build $2 x2 moon  fix the flaky queue test and add a regressi_   |
| (o) b flaky   APPROVE 0:41 |                                                 |                                                                               |
| >   a limiter  WRITE 388/s |    [P] transfer arcs draw                       |  WORLD     kestrel   C:/dev/kestrel   git repo   trusted                      |
| ... g docs      THINK 41 s |    while you type @world,                       |  PROFILE   build: permission mode default, approvals on Bash and PowerShell   |
| #   d types      EDIT 0:06 |    one per craft                                |  MODEL     sonnet-5-5   effort low                                            |
|                            |                                                 |  BUDGET    $2.00 each, soft cap, can overshoot by one API call. Tree $4.00    |
| 2 tundra obs     $1.10 est |                                                 |  MOON      new worktree per craft, branch agent/<id>                          |
| --  a ledger   MODEL 4.8 s |                                                 |            Shell writes are not confined, so Bash stays on approval           |
| []  b callers   SHELL 12 s |                                         (k)     |                                                                               |
| .   g change     IDLE 12 m |                                 ......>         |  PREFLIGHT                                           no spawn, no model call  |
|                            |                                                 |  ---------------------------------------------------------------------------  |
| 3 harbor         $5.30 est |                          ......                 |  SOURCES     user  project  local   from resolveSettings                      |
| >   a invoices WRITE 212/s |                                                 |  HOOKS       PostToolUse  SessionStart: run at spawn, outside approvals       |
| o   repo-audit     7 of 12 |                    .....                        |  CWD         exists, git repo, worktree possible                              |
|                            |               ###                               |  ADMISSION   running 4 of 6   alive 9 of 16                                   |
| 4 mosaic         $0.70 est |            ###   ###                            |  WINDOW      5H 42 % used, launch freezes at 80 %                             |
| >   a tiles    WRITE 140/s |           ##       ##                           |  CONNECTORS  off for every managed agent                                      |
| x   b shader     ERROR 529 |           #  disc   #                           |                                                                               |
| ~   g bundle    RETRY 3/10 |           ##       ##                           |  LOADOUT, measured at last spawn in this repo             trusted repos only  |
|                            |            ###   ###                            |  ---------------------------------------------------------------------------  |
| 5 lumen obs      $0.10 est |               ###                               |  skills 46   MCP servers 14   context about 23k tokens at start               |
| (:) a offline  SOURCE 0:12 |                                                 |                                                                               |
| --  b lint      MODEL 11 s |                                                 |  Unknown world: no settings, strict MCP, no project hooks.                    |
|                            |                                                 |  Hold ALT+T to trust: its hooks and MCP servers then run at spawn.            |
|                            |                                                 |                                                                               |
|                            |                                                 |  ---------------------------------------------------------------------------  |
|                            |                                                 |  CTRL+ENTER launch 2    SHIFT+ENTER plan first    ALT+ENTER read-only         |
|                            |                                                 |                                                                               |
|                            |                                                 |  terminal  naos launch --world kestrel --profile build --budget 2 -n 2 "..."  |
|                            |                                                 |  agent     agent_spawn { project, profile, budget_usd, worktree, prompt }     |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
+----------------------------+-------------------------------------------------+------------------------------------------+------------------------------------+
| RATE 1,840 tok/s est   BURN $3.20/h est   TODAY $11.40 est   RESETS 17:40   OWNED 4 of 6 running   LAG MAX 11.6 s  L launch  F find  T sky  C ledger  ? laws |
| TAPE  14:06:21 harbor tender landed   14:06:19 mosaic API 529   14:06:18 kestrel tender launched   14:06:11 kestrel needs approval, Bash                     |
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
```

- **[P] Transfer arcs.** The sky answers the command before you commit.

The panel exists to surface three findings at the moment they matter. `settingSources` is a trust decision: a repo's hooks and `.mcp.json` run at spawn, before any prompt and outside `canUseTool` (`AC 2.9`) `[V]`. The budget is a soft cap that overshoots by one API call (`AC 2.10`) `[V]`. A worktree does not confine what shell commands write (`AC 7`) `[V]`.

A mission adds `TREE BUDGET`, `CHILD LIMIT` and `DEPTH`, with the start values from `AC 12.3`: depth 2, 4 children, 8 live per tree, 10 spawns a minute. Those numbers are `[U]` in the report.

### 4.10 Ledger

Headline numbers are stat tiles, single ratios are meters, ranked spend is a single-hue bar, and the model breakdown is a table, per the dataviz method. There are no dual axes and no pies. Values stay in text tokens. Bars carry `bone`, `nad` never appears here, and every bar has a hover readout and sits above a table view.

```text
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
| N A O S  [YOU 1][SOURCE 1][FAULT 1][RETRY 1][LOW 1] LIMIT SENSOR   RUN 13 IDLE 1  5H 58 % left  7D 82 % left  as of 14:02                  * LINK [ALL STOP] |
+----------------------------+-------------------------------------------------+------------------------------------------+------------------------------------+
| MANIFEST          20 craft |                                                 |  LEDGER                       list price estimates, not a bill     ESC close  |
| -------------------------- |                                                 |  ---------------------------------------------------------------------------  |
| 1 kestrel        $4.20 est |    Scene stays live behind the sheet.           |                                                                               |
| (o) b flaky   APPROVE 0:41 |                                                 |  Today                     Burn                      30 days                  |
| >   a limiter  WRITE 388/s |                                                 |  $11.40 est                $3.20/h est               $1,204 est               |
| ... g docs      THINK 41 s |                                                 |                                                                               |
| #   d types      EDIT 0:06 |                                                 |  PLAN WINDOWS                                    the real limit. as of 14:02  |
|                            |                                                 |  ---------------------------------------------------------------------------  |
| 2 tundra obs     $1.10 est |                                                 |  5H  [#####################-----------------]  42 % used  resets 17:40        |
| --  a ledger   MODEL 4.8 s |                                                 |  7D  [#######-----------------------------------]  18 % used  resets Tue      |
| []  b callers   SHELL 12 s |                                                 |                                                                               |
| .   g change     IDLE 12 m |                                                 |  BY WORLD, 30 DAYS                                         mass in the scene  |
|                            |                                                 |  ---------------------------------------------------------------------------  |
| 3 harbor         $5.30 est |                                                 |  3 harbor    ##############################                         $640 est  |
| >   a invoices WRITE 212/s |                                                 |  1 kestrel   #####################                                  $412 est  |
| o   repo-audit     7 of 12 |                                                 |  2 tundra    ##                                                      $51 est  |
|                            |               ###                               |  4 mosaic    #                                                       $11 est  |
| 4 mosaic         $0.70 est |            ###   ###                            |  5 lumen                                                              $3 est  |
| >   a tiles    WRITE 140/s |           ##       ##                           |                                                                               |
| x   b shader     ERROR 529 |           #  disc   #                           |  TREE BUDGETS                                                     owned only  |
| ~   g bundle    RETRY 3/10 |           ##       ##                           |  ---------------------------------------------------------------------------  |
|                            |            ###   ###                            |  kestrel a     [########------------]                         $0.42 of $2.00  |
| 5 lumen obs      $0.10 est |               ###                               |  mission m2    [################----]                         $3.20 of $4.00  |
| (:) a offline  SOURCE 0:12 |                                                 |                                                                               |
| --  b lint      MODEL 11 s |                                                 |  BY MODEL, 30 DAYS                                                     table  |
|                            |                                                 |  ---------------------------------------------------------------------------  |
|                            |                                                 |  model                         input          output                     usd  |
|                            |                                                 |  opus-5-5                       412M            6.1M                $742 est  |
|                            |                                                 |  sonnet-5-5                     318M            4.8M                $388 est  |
|                            |                                                 |  haiku-5-5                       96M            1.2M                 $74 est  |
|                            |                                                 |                                                                               |
|                            |                                                 |  BLOCKED ON YOU today 41 min, exact. Earlier days are marked ~                |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
|                            |                                                 |                                                                               |
+----------------------------+-------------------------------------------------+------------------------------------------+------------------------------------+
| RATE 1,840 tok/s est   BURN $3.20/h est   TODAY $11.40 est   RESETS 17:40   OWNED 4 of 6 running   LAG MAX 11.6 s  L launch  F find  T sky  C ledger  ? laws |
| TAPE  14:06:21 harbor tender landed   14:06:19 mosaic API 529   14:06:18 kestrel tender launched   14:06:11 kestrel needs approval, Bash                     |
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
```

### 4.11 Sky

Compare `docs/design/naos-plate.png` for the look of the month.

```text
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
| N A O S  [YOU 1][SOURCE 1][FAULT 1][RETRY 1][LOW 1] LIMIT SENSOR   RUN 13 IDLE 1  5H 58 % left  7D 82 % left  as of 14:02                  * LINK [ALL STOP] |
+----------------------------+--------------------------------------------------------------------------------------------+------------------------------------+
| SKY               esc back |                               .......        |        .......                              | NEEDS YOU                       1  |
| retained 30 days           |                           .The Plate: the month as ink on dim amber. Rails stay live.      | ---------------------------------  |
| -------------------------- |                        ...                                      ....                       | 0:41 kestrel b               Bash  |
|                            |                     ...                                             ...                    | npm install --save-dev vitest@4    |
| Tue 27 Oct                 |                   ..:                :::            :                 ...                  | SPACE answer here      ENTER dive  |
| -------------------------- |                 ..              ::::::               ::::::              ..                |                                    |
| SESSIONS                14 |               ..             ::::                         ::::             ..              | AT SOURCE                       1  |
| AGENTS                 212 |             :..           :::                                 :::           ...            | ---------------------------------  |
| FAN-OUTS     5, largest 16 |            ..           :::                                     :::           ..           | 0:12 lumen a    permission prompt  |
| SPEND              $88 est |           ..          :::              :::       ::| selected day  ::          ..          | answer in its own window           |
| BLOCKED            ~41 min |          ..         :::            :::::           | spokes: fan-outs::         ..         |                                    |
| FAILED                   3 |         ..         ::           :::                     :::           ::         ..        | TROUBLE                         2  |
|                            |        ..         ::          :::                         :::          ::         ..       | ---------------------------------  |
| WORLDS THAT DAY            |        .         ::         :::                             :::         ::         .       | x mosaic b       API 529, read it  |
| -------------------------- |       .:        ::         ::            :::   :::            ::         ::        ..      | ~ mosaic g     retry 3 of 10, 8 s  |
| harbor          9 sessions |       .         :         ::          :::         :::          ::         :         .      |                                    |
| kestrel         4 sessions |      ..        ::         :         :::             :::         :         ::        ..     | LOW CONTEXT                     1  |
| tundra           1 session |      .         :         ::         :                 ::        ::         :         .     | ---------------------------------  |
|                            |      .         :         :         :                   :         :         :         .     | kestrel d         812k of 1M used  |
| P play this day as a reel  |      .         :         :         :                   :         :         :         .     |                                    |
|                            |      .         :         :         :                   :         :         :         .     | LANDED, LAST HOUR              12  |
|                            |      .         :         ::        ::                 ::        ::         :         .     | ---------------------------------  |
|                            |      ..        ::         :         :::             :::         :         ::        ..     | harbor           11 lit, 1 failed  |
|                            |       .         :         ::          ::::        :::          ::         :         .      | kestrel                     1 lit  |
|                            |       .         ::         ::            :::   :::            ::         ::        ..      |                                    |
|                            |        .         ::         :::                             :::         ::         .       | CHANNEL                 kestrel a  |
|                            |        ..         ::          :::                         :::          ::         ..       | ---------------------------------  |
|                            |         ..         ::      stars: one per transcript    :::           ::         ..        | 14:06:04 text            ~210 tok  |
|                            |          ..         :::            :::::            ::::            :::         ..         | 14:06:06 Read      timer.ts 0.2 s  |
|                            |           ..          ::               ::        :::               ::          ..          | 14:06:09 Edit      +4 -2 approved  |
|                            |            ..           ::                                      :::           ..           | 14:06:11 Bash      running 12.4 s  |
|                            |             ...           :::                                 :::           ...            | 14:06:18 tender   Explore started  |
|                            |               ..             ::::                         ::::             ..              |                                    |
|                            |                 ..              ::::::               ::::::              ..                |                                    |
|                            |                   ...                 :             :                 ...                  |                                    |
|                            |                     ...                                             ...                    |                                    |
|                            |                       ....                                      ....                       |                                    |
|                            |                           .....                              ....                          |                                    |
|                            |  horizon                      .......                 .......                           now|                                    |
|                            |  |....|....|.::.|.||.|....|..:.|.||:|.^..|.::.|....|..|...|....|..:.|.||.|....|.::.|..|    |                                    |
|                            |  30 days, one tick per day, height is work done.  LEFT RIGHT scrub  SHIFT walks weeks      |                                    |
|                            |                                                                                            |                                    |
|                            |                                                                                            |                                    |
+----------------------------+--------------------------------------------------------------------------------------------+------------------------------------+
| RATE 1,840 tok/s est   BURN $3.20/h est   TODAY $11.40 est   RESETS 17:40   OWNED 4 of 6 running   LAG MAX 11.6 s  L launch  F find  T sky  C ledger  ? laws |
| TAPE  14:06:21 harbor tender landed   14:06:19 mosaic API 529   14:06:18 kestrel tender launched   14:06:11 kestrel needs approval, Bash                     |
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
```

The free rect becomes the Plate: the month as ink on dim amber, stars and dust drawn once in Canvas 2D, meridians as SVG paths. The canvas drops to `rest`, so history costs almost nothing. The rails stay live, and live craft keep running in them. **An answerable well keeps bending the meridians through this mode and through a replay**, with the same lens equation at 4 Hz, because an approval is never hidden by a view state. `P` plays the selected day as a reel in 40 s, launches and landings only, always in `replay` colour with the label `REPLAY 27 OCT 14:10`. Any input stops it.

### 4.12 Plate, no WebGL

The rails are unchanged. The canvas is replaced by an SVG chart.

```text
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
| N A O S  [YOU 1][SOURCE 1][FAULT 1][RETRY 1][LOW 1] LIMIT SENSOR   RUN 13 IDLE 1  5H 58 % left  7D 82 % left  as of 14:02                  * LINK [ALL STOP] |
+----------------------------+--------------------------------------------------------------------------------------------+------------------------------------+
| MANIFEST          20 craft |                            ......                         ......                           | NEEDS YOU                       1  |
| -------------------------- |                        .....                                   .....                       | ---------------------------------  |
| 1 kestrel        $4.20 est |    PLATE: SVG chart, 4 Hz. No WebGL needed. Meridians still bend,  ....                    | 0:41 kestrel b               Bash  |
| (o) b flaky   APPROVE 0:41 |    computed with the same lens equation. Every job works unchanged.    ...                 | npm install --save-dev vitest@4    |
| >   a limiter  WRITE 388/s |                ...                                                       ...               | SPACE answer here      ENTER dive  |
| ... g docs      THINK 41 s |              ...                                                           ...             |                                    |
| #   d types      EDIT 0:06 |            ..                                                                ...           | AT SOURCE                       1  |
|                            |          ...                                                    ooooooo        ...         | ---------------------------------  |
| 2 tundra obs     $1.10 est |         ..                                                    oo       oo        ..        | 0:12 lumen a    permission prompt  |
| --  a ledger   MODEL 4.8 s |        ..    ooooo                                           o          oo        ..       | answer in its own window           |
| []  b callers   SHELL 12 s |      ..      o   o                                           o           o          ..     |                                    |
| .   g change     IDLE 12 m |      .       ooooo                                           oo          o           .     | TROUBLE                         2  |
|                            |     .                                                         oo       oo             .    | ---------------------------------  |
| 3 harbor         $5.30 est |    .       5 lumen                                              ooooooo                .   | x mosaic b       API 529, read it  |
| >   a invoices WRITE 212/s |   ..                                                           3 harbor                ..  | ~ mosaic g     retry 3 of 10, 8 s  |
| o   repo-audit     7 of 12 |   .                                                                                     .  |                                    |
|                            |  .                                                                                      .. | LOW CONTEXT                     1  |
| 4 mosaic         $0.70 est |  .                                          OOO                                          . | ---------------------------------  |
| >   a tiles    WRITE 140/s |  .                                      OOOO   OOOO                                      ..| kestrel d         812k of 1M used  |
| x   b shader     ERROR 529 | .                                      OO         OO                                      .|                                    |
| ~   g bundle    RETRY 3/10 | .                                     O             O   ooooooooooo                       .| LANDED, LAST HOUR              12  |
|                            | .                 o o                 O  kernel     Oooo           oo                     .| ---------------------------------  |
| 5 lumen obs      $0.10 est | .               oo   oo               O             oo               oo                   .| harbor           11 lit, 1 failed  |
| (:) a offline  SOURCE 0:12 | .              o       o               OO         Ooo                 oo                  .| kestrel                     1 lit  |
| --  b lint      MODEL 11 s | ..              oo   oo                 OOOO   OOOOo                   o                 ..|                                    |
|                            |  .                o o                       OOO    o       <b          o                 . | CHANNEL                 kestrel a  |
|                            |  ..            2 tundra                            o                  ooo ooo           .. | ---------------------------------  |
|                            |   .                                                oo               oooo     oo         .  | 14:06:04 text            ~210 tok  |
|                            |   ..                                                oo              ooo       o        ..  | 14:06:06 Read      timer.ts 0.2 s  |
|                            |    .                                                 ooo           ooo       oo        .   | 14:06:09 Edit      +4 -2 approved  |
|                            |     .                                                   ooooooooooo   ooo ooo         .    | 14:06:11 Bash      running 12.4 s  |
|                            |     ..                                                                               .     | 14:06:18 tender   Explore started  |
|                            |       .                                                              1 kestrel      ..     |                                    |
|                            |        ..                                                                         ..       |                                    |
|                            |         ..                                                                       ..        |                                    |
|                            |          ...                                    ooo                            ...         |                                    |
|                            |            ...                                oo   oo                        ...           |                                    |
|                            |              ...                              o     o                      ...             |                                    |
|                            |                ...                            oo   oo                    ...               |                                    |
|                            |                  ....                           ooo                    ...                 |                                    |
|                            |                     ....                     4 mosaic              ....                    |                                    |
|                            |    Scene unavailable: WebGL2 missing. The fleet is fully operable...                       |                                    |
|                            |                            ......                         ......                           |                                    |
+----------------------------+--------------------------------------------------------------------------------------------+------------------------------------+
| RATE 1,840 tok/s est   BURN $3.20/h est   TODAY $11.40 est   RESETS 17:40   OWNED 4 of 6 running   LAG MAX 11.6 s  L launch  F find  T sky  C ledger  ? laws |
| TAPE  14:06:21 harbor tender landed   14:06:19 mosaic API 529   14:06:18 kestrel tender launched   14:06:11 kestrel needs approval, Bash                     |
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
```

### 4.13 Wide, 2560 x 1440

One column here is 16 CSS px and one row is 28.8 CSS px. Compare `docs/design/naos-wide.png`.

```text
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
| N A O S  [YOU 1][SOURCE 1][FAULT 1][RETRY 1][LOW 1] LIMIT SENSOR  RUN 13 IDLE 1  5H 58 % left  7D 82 % left  as of 14:02                  * LINK  [ALL STOP] |
+-------------------+-----------------------------------------------------------------------------------------------------------------+------------------------+
| MANIFEST 320 px   |  ..                                                                                                             | RAIL 400 px            |
|                   |...                                                                                                              |                        |
| always per craft  |.                                                                                                                | NEEDS YOU              |
| rows 22 px        |         Free rect 1840 x 1344. The sky globe is wider than it is tall, so meridians run off the top and bottom. | AT SOURCE              |
|                   |         Canvas 2.47 MP at Umbra. craftK 1.4. Body type 13 px.                         3 harbor                  | TROUBLE                |
| world rows also show                                                                                                                | LOW CONTEXT            |
| a burn sparkline  |                                                                                      @@@@@@@@@@                 | LANDED                 |
|                   |                                                                                     @@         @@               |                        |
|                   |                                                                                    @@           @@              | CHANNEL takes all      |
|                   |                                                                                    @             @              | remaining height,      |
|                   |                                                                                    @@           @@              | about 900 px of log    |
|                   |                                                                                     @@         @@               |                        |
|                   |                                                                                      @@@@@@@@@@                 |                        |
|                   |                                                                                                                 |                        |
|                   |                                                                                                                 |                        |
|                   |                                                                                                                 |                        |
|                   |                                                   ###########                                                   |                        |
|                   |                                                ###           ##                                                 |                        |
|                   |                                               ##               ##                                               |                        |
|                   |                                              ##                 ##                                              |                        |
|                   |                                              #                   #                                              |                        |
|                   |                                              #     kernel        #             OOOOOOOOOOO                      |                        |
|                   |                          @@@                 #                   #          OOO           OOO                   |                        |
|                   |                       @@@   @@@              ##                 ##        OO                 OO                 |                        |
|                   |                      @@       @@              ##               ##       OO                     OO               |                        |
|                   |                      @         @               ###           ##        O                        OO              |                        |
|                   |                      @@       @@                  ###########         OO                         OO             |                        |
|                   |                       @@@   @@@                                       O                           O             |                        |
|                   |                          @@@                                          O           <b         @@@@@@@            |                        |
|                   |                       2 tundra                                        O                    @@     O @@          |                        |
|                   |                                                                       OO                  @      OO  @@         |                        |
|                   |                                                                        OO                 @      O    @         |                        |
|                   |                                                                         OO                @@   OO     @         |                        |
|                   |                                                                           OO               @@OO     @@          |                        |
|                   |                                                                             OOO           OOO@@@@@@@            |                        |
|                   |                                                                                OOOOOOOOOOO   1 kestrel          |                        |
|                   |                                                            @ @                                                  |                        |
|                   |                                                          @@   @@                                                |                        |
|                   |                                                         @       @                                               |                        |
|                   |                                                          @@   @@                                                |                        |
|                   |.                                                           @ @                                                  |                        |
|                   |...                                                      4 mosaic                                                |                        |
|                   |  ..                                                                                                             |                        |
+-------------------+-----------------------------------------------------------------------------------------------------------------+------------------------+
| RATE 1,840 tok/s est   BURN $3.20/h est   TODAY $11.40 est   RESETS 17:40   OWNED 4 of 6 running   LAG MAX 11.6 s                                            |
| TAPE  14:06:21 harbor tender landed   14:06:19 mosaic API 529   14:06:18 kestrel tender launched   14:06:11 kestrel needs approval, Bash                     |
+--------------------------------------------------------------------------------------------------------------------------------------------------------------+
```

---

## 5. Design tokens

Define these once on `:root` and mirror them in Tailwind through `@theme`. The scene reads the same hex values through `new THREE.Color()`, so DOM and WebGL can never drift.

### 5.1 Colour

Nothing reflects in NAOS. Everything visible is emitting, and everything emitting means something. The palette is black, pearl and three real emission lines, on a warm black that is neither navy nor violet. Hues of the three lines come from O III 500.7 nm, Na D 589.3 nm and H-alpha 656.3 nm through the CIE 1931 functions, with lightness tuned for contrast. `[V]`, concept.

```css
:root {
  /* surfaces */
  --void: #060504;      /* page, rails, canvas clear */
  --scrim: #0E0B09;     /* docket, sheets */
  --raised: #1A1512;    /* focused row, code wells */
  --hairline: #4A3F33;  /* decorative rules only */
  --rule: #7C7062;      /* boundaries that carry meaning */
  /* text */
  --paper: #F4ECDF;     /* primary */
  --bone: #BFB3A1;      /* secondary */
  --slag: #94897A;      /* tertiary */
  /* state */
  --oiii: #21E3BE;      /* the model is working */
  --pearl: #EAF0F2;     /* a tool is running */
  --nad: #FD9D4E;       /* needs a human. Used for nothing else */
  --halpha: #FC5466;    /* failure and danger */
  --lamp: #B47800;      /* finished */
  --ash: #665F57;       /* idle, scene marks only */
  --replay: #9D8CFF;    /* the past. Never used live */
  /* boot plate and sky scrub */
  --plate-paper: #4A3518;
  --plate-wash: #6B4E24;
  --plate-ink: #120A04;
}
```

**State and text.** WCAG contrast on each surface, plus the APCA magnitude on `void`. `[V]`, computed.

| Token | Hex | Role | `void` | `scrim` | `raised` | APCA |
|---|---|---|---:|---:|---:|---:|
| `paper` | `#F4ECDF` | Primary text | 17.37 | 16.73 | 15.44 | 96 |
| `bone` | `#BFB3A1` | Secondary text | 9.87 | 9.51 | 8.77 | 62 |
| `slag` | `#94897A` | Tertiary text | 5.93 | 5.72 | 5.27 | 40 |
| `oiii` | `#21E3BE` | Drive, plume, streamers | 12.41 | 11.95 | 11.03 | 75 |
| `pearl` | `#EAF0F2` | Tool beams, corona at rest, limbs | 17.69 | 17.04 | 15.73 | 97 |
| `nad` | `#FD9D4E` | Needs a human: rings, `NEEDS YOU`, the `YOU` lamp | 9.80 | 9.44 | 8.72 | 62 |
| `halpha` | `#FC5466` | Failure and danger | 6.40 | 6.16 | 5.69 | 44 |
| `lamp` | `#B47800` | Finished: lit arcs, marks. Not for text | 5.46 | 5.26 | 4.85 | 37 |
| `ash` | `#665F57` | Idle hull in the scene. DOM idle marks use `slag` | 3.24 | 3.12 | 2.88 | 21 |
| `replay` | `#9D8CFF` | Replay and its label | 7.40 | 7.13 | 6.58 | 49 |
| `rule` | `#7C7062` | Meaningful boundaries | 4.22 | 4.06 | 3.75 | 28 |
| `hairline` | `#4A3F33` | Decorative rules, dark lamp legends | 1.99 | 1.91 | 1.77 | 9 |

Fills: `void` on `nad` 9.80, on `halpha` 6.40, on `oiii` 12.41, on `lamp` 5.46. `[V]` Lamp text on a fill is always `void`.

**Validator.** The dataviz validator ran on the six state colours plus `replay`, all pairs, on `void`. `[V]`

| Check | Result | Note |
|---|---|---|
| CVD separation | PASS, worst 8.1 (deutan, `lamp` and `halpha`), tritan 12.4 | Target 8 |
| Normal vision floor | PASS, worst 16.3 (`halpha` and `nad`) | Floor 15 |
| Contrast | PASS, all at least 3:1 | |
| Lightness band | FAIL, reported as such | A chart-fill rule. These are emissive marks on black |
| Chroma floor | FAIL on `pearl` and `ash`, reported as such | Neutral on purpose |

`replay` was chosen over `#7FB2FF`, which cut tritan separation to 9.4. `[V]`

**Scene emission.** Never used as text. Display targets were sampled from the renders, on a 1 px line. `[V]`

| Token | Hex | Role | Displayed peak |
|---|---|---|---|
| `meridian` | `#8C7A66` | Day lines | day `#2C261E`, week `#5B4F43` |
| `now` | `#FFE7D0` | The now meridian | `#B3A79B` |
| `city` | `#FFC77A` | City lights, long exposure arcs | |
| `sliver-full` | `#9FB8FF` | Sliver with the window fresh | |
| `sliver-low` | `#FFB96E` | Sliver near the limit: the sun cools as it runs out | |

**Stellar class of a sky star, by input price.** Read from the same table as the cost estimate, not hard-coded (`RF 3.4`).

| Class | Input price per MTok | Today | Hex |
|---|---|---|---|
| O | 8 and up | fable | `#A2BBFF` |
| A | 3 to under 8 | opus | `#CDD9FF` |
| G | 1 to under 3 | sonnet | `#FFF2EB` |
| M | under 1 | haiku | `#FFB96E` |

**Rules.** `nad`, `halpha` and `replay` each hold exactly one meaning. Text wears text tokens, and a coloured mark beside it carries state. The one exception is the age of a decision, in `nad`, because age is the decision's urgency. No terracotta, no warm off-white page, no starburst.

### 5.2 Type

Six files, 128 KB in all. `[V]` All packages are OFL-1.1 at 5.3.0. `[V]`

```ts
import '@fontsource/b612/latin-400.css';               // 21.2 KB. Words
import '@fontsource/b612/latin-700.css';               // 13.2 KB. Labels
import '@fontsource-variable/martian-mono/wdth.css';   // 38.5 KB latin. Numbers, code
import '@fontsource/cormorant/latin-300.css';          // 21.7 KB. Wordmark
import '@fontsource/cormorant/latin-300-italic.css';   // 23.2 KB. Almanac
import '@fontsource/eb-garamond/greek-500-italic.css'; // 10.9 KB. Greek designators
```

CSS families, read from the packages: `'B612'`, `'Martian Mono Variable'`, `'Cormorant'`, `'EB Garamond'`. `[V]` Set `font-stretch: 75%` on Martian Mono. Set `font-variant-numeric: tabular-nums` on B612 numerals.

| Role | Family, weight | C and R | W | Line | Case and tracking | Use |
|---|---|---:|---:|---:|---|---|
| `display` | Cormorant 300 italic | 28 | 32 | 34 | Sentence | Almanac. Never below 28: its hairlines vanish |
| `wordmark` | Cormorant 300 | 22 | 24 | | Caps, 5 px | Masthead |
| `boot` | Cormorant 300 | 56 | 72 | | Caps, 14 px | Boot wordmark |
| `title` | B612 700 | 14 | 15 | 18 | Sentence | World name at the docket head |
| `body` | B612 400 | 12 | 13 | 16 | Sentence | Rows, prose |
| `body-b` | B612 700 | 12 | 13 | 16 | Sentence | World names in rails |
| `label` | B612 700 | 11 | 12 | 14 | Caps, 0.3 px | Section heads, lamps, keys |
| `micro` | B612 400 | 10, 11 at R | 11 | 13 | Sentence | Hints, footnotes |
| `num` | Martian Mono 400, 75 % | 12 | 13 | 16 | | Metrics, ages |
| `num-s` | Martian Mono 400, 75 % | 11 | 12 | 14 | | State words with metric, tape |
| `code` | Martian Mono 400, 75 % | 13 | 14 | 20 | | Commands and paths in the docket |
| `designator` | EB Garamond 500 italic | 14 | 15 | | | Greek letter of a craft |

**Glyph limits.** The Latin subsets of B612, Martian Mono and Cormorant all lack `≥ ≤ → ← ≈` and all Greek, and none has `▲ ■ ● ○`. `[V]`, cmap read from the woff2 files in this session. All three have `↑ ↓ · − × … • ~ ± % $ ° – —`. `[V]` So:

- A lower bound is a `+` suffix, `$4.20+ est`. An estimate on a rate is a `~` prefix, `~210 tok`.
- Direction uses `to` in prose and `>` in compact rows.
- Greek comes only from EB Garamond.
- State marks are SVG, never Unicode glyphs.

**Text in the scene** is DOM, always. Nothing uses troika, so its woff2 rejection and CDN fallback (`DS 2.5`) never arise.

**Numbers.** Times are 24 h. Ages are `0:41`, `12 m`, `1h 12m`. Tokens are `74k`, `1M`. Money is `$4.20 est`. Plan windows say what is left, `58 % left`, in the masthead, and what is used in the Ledger, labelled either way. `AS OF` shows on any value older than 60 s.

**Language.** All strings live in one module, so a German set is a swap later.

### 5.3 Spacing, radii, borders

| Token | Value | Use |
|---|---|---|
| `--s-1` | 4 px | Mark to text, lamp gap |
| `--s-2` | 8 px | Row inner gap |
| `--s-3` | 12 px | Rail side padding at the right, section gap |
| `--s-4` | 16 px | Docket and sheet padding |
| `--s-5` | 24 px | Between docket blocks |
| `--s-6` | 32 px | Sheet head to body |
| `--row` | 20 px, 22 at W, 24 with Comfort on | List rows |

The left rail pads 10 px. All sizes step in whole CSS px.

**Radii:** 0 everywhere. The HUD is annotation on a photographic plate: no cards, no glass, no rounded corners, no blur, no shadows. One exception: Ledger bars have a 4 px rounded data end, square at the baseline, per the dataviz mark spec.

| Border | Value | Use |
|---|---|---|
| `--edge-hair` | 1 px `hairline` | Rail edges, section rules |
| `--edge-rule` | 1 px `rule` | Buttons, inputs |
| `--edge-need` | 3 px `nad` | Left edge of the docket |
| `--edge-source` | 1 px dashed `nad`, 3 on 2 | `SOURCE` lamp |
| `--focus` | 2 px solid `paper`, 1 px offset in `void` | Keyboard focus on everything |

### 5.4 Emission

The DOM has no glow. All glow in NAOS is HDR emission above 1.0 in the scene, passed through bloom at threshold 1, so glow can only mean "this is emitting now". Peak linear gains:

| Element | Gain | | Element | Gain |
|---|---:|---|---|---:|
| Sliver | 16 | | Hull, working | 2.8 |
| World limb | 9 | | Hull, idle | 0.5 |
| Streak head | 6 | | Ring | 2.5 |
| Plume, writing | 4.2 | | Plume, thinking | 2.5 |
| Lance, `edit` | 4 | | Plume, observed | 2.2 |
| City | 3 | | Lance, `shell` | 0.8 |

Starting values, to be tuned on a real GPU against the reference renders. `[U]`

### 5.5 Z layers

| Layer | z | Contains |
|---|---:|---|
| Canvas or Plate | 0 | The scene |
| Labels | 10 | Pooled world and craft labels. Clipped to the free rect |
| Leader | 20 | One SVG path from ring to docket, brackets |
| Rails | 30 | Masthead, left rail, right rail, bottom strip |
| Sheets | 40 | Launch, Ledger, Settings, Sky strip |
| Docket | 50 | Above sheets: a decision is never hidden |
| Palette | 60 | Find |
| Banners | 70 | Kernel lost, scene lost, limit reached |
| Dialogs | 80 | Laws, All stop confirm |
| Boot plate | 90 | Above all, input passes straight through it |

---

## 6. Agent state table

State is carried by motion and shape first, by a plain word always, and by colour third. So every row is readable with colour removed. The `Mark` is the 12 px SVG in the Manifest and rail. Marks are filled for owned craft and outlined for observed ones wherever the shape allows.

Sound names are defined in section 9.6. `none` means silence. The state a craft shows comes from one pure function, so the scene, the rails and the Plate can never disagree:

```ts
// One pure function decides what a craft shows. Every view reads it, so the scene, the rails and the Plate can never disagree.
// Order follows the priority in RF 3.5, with the control plane first, because its frames are live and outrank the transcript.

export type VisualState =
  | 'queued' | 'spawning' | 'starting' | 'ready'
  | 'thinking' | 'writing' | 'generating' | 'tool'
  | 'approve' | 'answer' | 'plan' | 'source' | 'parked'
  | 'idle' | 'idle-shell' | 'interrupted' | 'compacting' | 'retrying' | 'no-signal'
  | 'rate-limited' | 'errored' | 'no-budget' | 'stopping' | 'crashed' | 'orphaned' | 'lost'
  | 'finished' | 'exited' | 'abandoned' | 'failed' | 'stopped' | 'unknown';

export interface CraftFacts {
  owned: boolean;
  /** AC 5.1, owned craft only. */
  control?: 'queued' | 'spawning' | 'ready' | 'running' | 'awaiting_approval' | 'idle' | 'parked' | 'budget_exhausted'
    | 'rate_limited' | 'stopping' | 'exited' | 'crashed' | 'lost' | 'closed';
  /** Activity from RF 9. */
  activity: 'starting' | 'generating' | 'tool_running' | 'waiting' | 'retrying' | 'compacting' | 'idle'
    | 'interrupted' | 'errored' | 'finished' | 'unknown';
  backgroundShell?: boolean;
  errorKind?: 'rate_limit' | 'api' | 'unknown';
  outcome?: 'clean' | 'abandoned' | 'unknown';
  agentStatus?: 'running' | 'completed' | 'failed' | 'stopped' | 'orphaned' | 'unknown';
  /** Tool of the oldest open decision, owned craft only. */
  decisionTool?: string;
  /** Kind of the newest live delta within the last second, owned craft only. */
  liveBlock?: 'thinking' | 'text';
  /** Since the last record, while generating. */
  silentMs: number;
  /** A stale pid file: the process is gone and nobody wrote an end. */
  dead?: boolean;
}

const FROM_CONTROL: Partial<Record<NonNullable<CraftFacts['control']>, VisualState>> = {
  queued: 'queued', spawning: 'spawning', ready: 'ready', parked: 'parked', budget_exhausted: 'no-budget',
  rate_limited: 'rate-limited', stopping: 'stopping', exited: 'exited', crashed: 'crashed', lost: 'lost',
};

export function visualState(c: CraftFacts): VisualState {
  const fromControl = c.control && FROM_CONTROL[c.control];
  if (fromControl) return fromControl;
  if (c.decisionTool) return c.decisionTool === 'AskUserQuestion' ? 'answer' : c.decisionTool === 'ExitPlanMode' ? 'plan' : 'approve';
  if (c.agentStatus === 'orphaned' || c.dead) return 'orphaned';
  if (c.agentStatus === 'stopped') return 'stopped';
  if (c.agentStatus === 'failed') return 'failed';
  if (c.agentStatus === 'completed') return 'finished';
  switch (c.activity) {
    case 'starting': return 'starting';
    case 'waiting': return c.owned ? 'approve' : 'source';
    case 'tool_running': return 'tool';
    case 'retrying': return 'retrying';
    case 'compacting': return 'compacting';
    case 'interrupted': return 'interrupted';
    case 'idle': return c.backgroundShell ? 'idle-shell' : 'idle';
    case 'errored': return c.errorKind === 'rate_limit' ? 'rate-limited' : 'errored';
    case 'finished': return c.outcome === 'abandoned' ? 'abandoned' : 'finished';
    case 'generating':
      if (c.owned && c.liveBlock === 'thinking') return 'thinking';
      if (c.owned && c.liveBlock === 'text') return 'writing';
      return c.silentMs >= 120_000 ? 'no-signal' : 'generating';
    default: return 'unknown';
  }
}
```

### 6.1 Working

| State | Hull | Colour | Motion | Sound | Label | Mark |
|---|---|---|---|---|---|---|
| **Thinking**, owned only | Kite, filled | `oiii`, plume gain 2.5 | Moves at `orbitRate(tps)`. Plume 3.4 px wide, length pulses 70 to 100 % at 0.8 Hz | none | `THINK 41 s` | Three dots |
| **Writing**, owned only | Kite, filled | `oiii`, plume gain 4.2 | Moves. Plume 4.6 px wide, steady, length `plumeCss(tps)` | `tick` per response, if Geiger on | `WRITE 388/s` | Kite |
| **Generating**, observed: a call is in flight, type unknown | Kite, outline | `oiii`, plume gain 2.2 | Still. Plume 30 px, dashed, dashes flow back at 1.5 Hz. On flush, a `burn` through `burnAngle(tokens)` | `tick` per response, if Geiger on | `MODEL 4.8 s` | Dashes |
| **Tool, `shell`** | Kite | `pearl`, gain 2.8 | Still. World level and closer: dashed lance, flow toward the surface | none | `SHELL 12 s` | Square |
| **Tool, `read`** | Kite | `pearl` | Still. World level and closer: wide pale cone sweeping 12 degrees at 0.5 Hz | none | `READ 0:02` | Open triangle |
| **Tool, `edit`** | Kite | `pearl` | Still. Every level: thin hot lance, gain 4. A 10 s ember at the impact | `tick`, high, if Geiger on | `EDIT 0:06` | Lance with tip |
| **Tool, `web`** | Kite | `pearl` | Still. World level and closer: lance off the world into the sky, dashes flow out | none | `WEB 1.2 s` | Diagonal arrow |
| **Tool, `mcp`** | Kite | `pearl` | Still. World level and closer: arc to a limb tick, or to the star for `mcp__os__*` | none | `MCP 0:03` | Arc |
| **Tool, `launch`** | Kite | `pearl` | Still. Every level: a streak and a new craft | `salvo` if it opens one | `LAUNCH 3` | Fork |
| **Tool, `send`** | Kite | `pearl` | Still. Every level: line to the other craft | none | `SEND` | Two dots joined |
| **Tool, `other`** | Kite | `pearl` | Still. 120 ms tick at the hull | none | `TOOL 0:01` | Dot in square |
| Several tools | Kite | `pearl` | One beam per open call, 64 at most | as above | Count, `SHELL +2` | As first |

### 6.2 Needs a human

| State | Hull | Colour | Motion | Sound | Label | Mark |
|---|---|---|---|---|---|---|
| **Waiting for approval**, owned | Kite, filled | `nad`, ring 2.5 | Halts in 120 ms, drive off. Wavefront, then ring closes, sky bends, strength grows with age. No blink | `ping`, repeats at 2 min and 10 min | `APPROVE 0:41` | Ring with dot |
| Same, tool is `AskUserQuestion` | as above | `nad` | as above | as above | `ANSWER 0:41` | Ring with dot |
| Same, tool is `ExitPlanMode` | as above | `nad` | as above | as above | `PLAN 0:41` | Ring with dot |
| Same, danger | as above | `halpha` ring | as above, docket opens on Deny | as above | `APPROVE 0:41`, with `DEFAULT DENY` in the rail | Ring with cross |
| **Waiting at source**, observed | Kite, outline | `nad`, ring 1.25 | Still. Broken ring of 8 dashes, radius 30 px times `craftK`. Never bends the sky, never grows | `source`, once | `SOURCE 0:12`, reason in the rail: `permission prompt`, `input needed`, `sandbox request`, `worker request`, `dialog open` | Broken ring |
| Parked, owned | Kite, outline, far holding orbit | `nad`, gain 0.6 | Still. Thin hollow ring, no lens | none | `PARKED` | Hollow ring |

### 6.3 Resting and passing

| State | Hull | Colour | Motion | Sound | Label | Mark |
|---|---|---|---|---|---|---|
| **Idle** | Kite, outline | `ash`, hull gain 0.5 | Still. Beacon dot pulses 120 ms on each 1 s probe | none | `IDLE 12 m` | Dot |
| Idle with a background shell | as above | `ash` | Plus a dim dashed lance, World level and closer | none | `IDLE, SHELL` | Dot in square |
| **Interrupted** | Kite | `bone` | Drive cuts in one frame. A slash lies across the hull for 4 s, then idle | none | `INTERRUPTED` | Slash |
| **Compacting**, owned only | Kite | `pearl`, hull gain 4 | Still, then climbs to its new altitude with `settle` as tokens fall | none | `COMPACTING` | Up arrow |
| Compacted, observed, after the fact | Kite | `pearl`, one flash | Altitude jumps with a 120 ms flash | none | Tag `630k to 15k`, 8 s | Up arrow |
| Retrying | Kite, tilted 30 degrees | `pearl` | Drive flickers at a stepped 2 Hz. Countdown arc drains over `retryInMs`. Never called stalled | none | `RETRY 3/10` | Dashed arc |
| No signal: generating, no flush for 120 s | Unchanged | `slag` tick | Dim tick beside the hull. No alarm below 120 s (`RF 0`) `[V]` | none | `NO SIGNAL 2 m` | Hollow dot |
| Queued | Kite on the Pad | `bone` | Still | none | `QUEUED` | Hollow kite |
| Spawning | Kite on a transfer arc | `oiii` | `ejection` for the real spawn time | none | `SPAWNING` | Kite |
| Starting, ready | Kite | `bone` | Present, no drive | none | `STARTING`, `READY` | Hollow kite |
| Stopping | Kite, turned 180 degrees | `bone` | Retro burn. Shows each step | none | `STOPPING, interrupt`, `end of input`, `tree kill` | Slash |
| Rate limited | Kite, outline | `pearl`, gain 0.6 | Still. Countdown arc to `resetsAt` | none | `LIMIT 1h 12m` | Dashed arc |

### 6.4 Failure and ending

The operator never needs to act on a spark or a stutter. The tiers exist so that a glance tells them apart from something that needs reading.

| State | Hull | Colour | Motion | Sound | Label | Mark |
|---|---|---|---|---|---|---|
| Spark: a tool failed, the model handles it | Unchanged | `halpha` flare | Beam tip flares once | none | Tape tick only | |
| **Errored** | Kite, filled | `halpha` | Drive dead. Slow tumble, 6 s per turn. Retrying never tumbles | `fault`, once | `ERROR 529` | Cross |
| **Budget exhausted** | Kite, outline | `bone`, empty arc `rule` | Still, no tumble. An empty fuel arc lies under the hull | `fault`, once | `NO BUDGET` | Empty bar |
| Crashed | Five shards | `halpha` | Hull breaks. Debris holds the orbit until acknowledged | `fault`, once | `CRASHED` | Cross |
| Orphaned, derelict | Kite, outline, unlit | `ash` | Drifts off its orbit at 1 px/s, no beacon | none | `ORPHANED` | Hollow dot |
| Lost, kernel restarted | Kite, dashed outline | `slag` | Frozen | none | `LOST` | Hollow dot |
| **Finished**, clean | Kite | `lamp` trail | `reentry` streak, then a city light and a sky star | `land` | `DONE`, 10 s, then the row leaves | Down arrow |
| Exited, resumable | as above | `lamp` | Same, the city light keeps a small ring | `land` | `EXITED` | Down arrow |
| Abandoned, failed | Kite | `halpha` | Hard landing: an ember, no city light | `fault`, once | `ABANDONED`, `FAILED` | Cross |
| Stopped, workflow agent | Bead | `slag` | Bead stops, no light | none | `STOPPED` | Slash |
| Unknown | Kite, outline | `slag` | Still | none | `UNKNOWN` | Hollow dot |

---

## 7. 3D scene

Stack and pins are in Appendix B. Every material is unlit. There are no lights, shadows or environment maps, and MSAA is off, because every line is antialiased analytically.

### 7.1 Render graph

```text
useFrame -2   CoronaPass        half res target, at the tier's corona rate, only while fleet tokens move
useFrame -1   SkyPass           sky target, half float, only if the camera moved or the sky changed
scene         LensBackground    sky through the lens, wavefronts, rings. The only distortion that exists
              CoronaQuad        samples the corona target, additive
              Disc              full res quad of 1.3 star radii
              Worlds            impostors, depth write on
              Cities            points, additive, depth test
              Arcs              three LODs, additive, depth test, no depth write
              Hulls             screen facing quads, additive
              Beams             additive
              CraftMesh         selected craft, Craft level only
              Motes             Craft level only
composer      Bloom             mipmap, threshold 1, ADD
              Finish            disc occluder, tone curve, dim, desaturate, then sRGB and dither
DOM           labels, leader, rails
```

**The Almanac Sky** is the set, and there is not one decorative star in it. Real data here: 2,177 `.jsonl` files, 2.09 GB, 34,244 dust motes at 64 KiB, 36,346 points in all. `[V]`, concept survey.

- **Frame.** `e1` is the system camera's forward vector. `e3` is camera up tilted by -16 degrees toward camera right. `e2 = e3 × e1`. Fixed at boot.
- **Meridians.** One per day, 6 degrees apart. `ra(age) = (-90 + 6 * age)` degrees, so now is at the right edge and the Horizon, day 30, at the left. Every seventh day is brighter. The rest of the sphere is empty: that is the future, and it lies behind the rails.
- **Stars.** One per transcript. `ra` is its last write plus 0.25 degrees of gaussian jitter. `dec` is a lane per project in plus or minus 15 degrees, plus gaussian spread of 4 degrees for main transcripts, 6.5 for agents. Diameter `0.62 + 0.09 * log2(1 + MB)` px, flux `0.75 + 0.36 * log2(1 + 4 * MB)`. Colour by stellar class.
- **Dust.** One point per 64 KiB, `ra` spread 1.5 degrees, `dec` spread 7, flux 0.1, colour `#FFD4A6`.
- **Burned spokes.** One segment per closed salvo on its day's meridian, half length `1.6 + 0.9 * log2(n)` degrees. Permanent, quiet, and static after the sky redraw.
- **Cost.** One static target, redrawn only on camera moves.

Meridians matter: scattered stars do not show curvature well, and straight lines do. Without them the Bend would be invisible wherever history is sparse. `[V]`, concept stills.

### 7.2 Scene graph

```text
<Stage>                                        canvas equals the free rect
  CadenceDriver, TierController, ContextGuard
  SkyPass       skyScene: SkyLines, Stars, Dust
  CoronaPass    coronaScene: fullscreen triangle
  LensBackground     renderOrder -1000   depthTest off
  CoronaQuad         renderOrder  -900   additive
  Disc               renderOrder  -800   premultiplied
  Worlds             renderOrder     0   depthWrite on
  Cities             renderOrder    10
  Arcs x 3           renderOrder    20   24, 48, 96 segments
  Hulls              renderOrder    30
  Beams              renderOrder    40
  CraftMesh          renderOrder    50   about 300 triangles, always mounted, visible only at Craft level
  Motes              renderOrder    60
  EffectComposer: Bloom, Finish
```

Keep expensive parts mounted and toggle `visible`, so nothing compiles at the moment of an approval. `[U]` Sky view is the Plate above the canvas, so the canvas simply rests.

### 7.3 Cameras and flights

| View | Target | Camera | Fov |
|---|---|---|---|
| **System** | Star | Elevation 32 degrees, distance `D = (free.h / 2) / tan(10 deg)`, so 1 world unit is 1 CSS px at the star | 20 |
| **World** | World centre | Same elevation, distance so the outermost orbit spans 0.8 of `min(free.w, free.h)` | 24 |
| **Craft** | Hull | Chase, behind and above, 6 hull lengths back, sky always in frame | 34 |
| **Dive** | Well | Night side, low, past the hull toward the star. With `L = max(worldRadius, 40)`: `pos = c - 2.75 L toStar + 0.22 L up + 0.78 L side`, `target = c + 1.1 L toStar + 0.02 L up + 0.46 L side` | 40 |

A long lens keeps worlds close to their mass size at any depth. Worlds are placed in screen space and unprojected onto the ecliptic, then the world radius is divided by the local pixels per unit, so size on screen always means mass at System level.

**The dive never frames a well against its own world.** Found by rendering: a well on black has nothing to bend, and looks like a flat orange circle. `[V]`, concept.

**Flights.** A Catmull-Rom path, GSAP drives one parameter, `useFrame` reads it. Paths curve around bodies and never pass through a world. The camera never rolls. Any input jumps to the end state.

**View offset.** Docket, sheets and the Channel overlay the canvas. `camera.setViewOffset` shifts the scene by half the overhang over 180 ms with `settle`, so the focus stays clear. The canvas never resizes for an overlay.

**Tilt.** Drag tilts up to 18 degrees of azimuth and 10 of elevation, and springs back on release over 700 ms. No free orbit: spatial memory is worth more. Off under reduced motion.

### 7.4 Layout

Pure TypeScript, no WebGL, shared by the scene, the Plate and tests.

**Worlds.** Azimuth comes from the slot by the golden angle, so every prefix of worlds is well spread and a new world moves nobody. Recency picks a band. A world that wakes falls inward along its azimuth over 1.4 s. Bands move outward only at the first boot of a day. Slots persist in `layout.json` per `projectRoot`, so `1` means the same project every day.

Stress result: 3,840 random layouts, 15 and 32 worlds, four viewports, four mass distributions from heavy tail to all equal. Minimum gap 3.7 px, no overlap. `[V]` The first version overlapped by 23 px when many worlds had large masses. A simulation caught it, and the fix is the shared shrink. `[V]`

**Craft.** Each world has one orbital plane, inclined 14 to 30 degrees by slot, because giving each orbit its own inclination was unreadable scribble. `[V]`, concept. Altitude is a plain radius within that plane, `orbitCss()` divided by the pixels per unit at that world.

| Body | Placement |
|---|---|
| Vessel | Start angle from a hash of `nodeId`, so a craft does not jump on reconnect. Then it advances with tokens |
| Tender | Epicycle around its parent, radius `10 + 6 * depth` CSS px, angle by launch order. 8 at most on one parent, then a count |
| Bead | Next free angle on its hoop, in steps of the golden angle, so a run of unknown length never bunches |
| Moon | At 1.9 world radii, azimuth from a hash of the worktree path. Worktree craft orbit it by the same rules |
| Pad | A ring at 1.7 disc radii. Held craft sit at even spacing, in queue order |
| Sungrazer | A tight orbit at 1.35 disc radii |
| Shoal | Vessels past 24 on a world merge into one density band on their altitude ring. Waiting and failed craft never merge |
| Off-world, rogue | Fixed spots at the free rect edge, in the outer band |

**Armillary.** Hoop `i` has radius `(1.5 + 0.22 i) * worldRadius`, with inclination from a fixed table by phase index.

**Unroll.** `iUnroll` drives `uncurl()` in `arc.vert`, which keeps arc length constant as curvature falls to zero, so nothing cuts away and the eye never loses a hoop. Rows lie in the ecliptic plane from `iRow`, phase order top to bottom. In CONN the same idea held length to under 0.00001 % at every stop. `[V]`, read.

```ts
// HUD geometry and world placement. Pure. Used by the scene, the Plate and tests. Nothing here depends on WebGL.
import { worldRadius } from './laws';

export interface Rect { x: number; y: number; w: number; h: number }
export type LayoutClass = 'C' | 'R' | 'W';

export const LAYOUT = {
  C: { left: 236, right: 296, top: 36, bot: 44, docket: 420, channel: 420, sheet: 640 },
  R: { left: 280, right: 340, top: 40, bot: 48, docket: 480, channel: 520, sheet: 720 },
  W: { left: 320, right: 400, top: 44, bot: 52, docket: 560, channel: 640, sheet: 840 },
} as const;

export interface Hud { cls: LayoutClass; free: Rect; craftK: number; short: boolean }

export function hud(vw: number, vh: number, leftRailOpen = true): Hud {
  const cls: LayoutClass = vw < 1600 ? 'C' : vw < 2200 ? 'R' : 'W';
  const l = LAYOUT[cls];
  const short = vh < 720;
  const left = leftRailOpen ? l.left : 44;
  const bot = short ? 24 : l.bot;
  const free = { x: left, y: l.top, w: vw - left - l.right, h: vh - l.top - bot };
  return { cls, free, craftK: Math.min(1.4, Math.max(1, free.h / 720)), short };
}

export interface WorldSeed {
  /** Index in first-seen order. Persisted in layout.json, never reassigned. */
  slot: number;
  mass: number;
  /** Days since activity. */
  ageDays: number;
}
export interface WorldPlace { slot: number; /** CSS px from the centre of the free rect, y down. */ x: number; y: number; r: number; band: 0 | 1 | 2 }

const GOLDEN = 137.508;
const BANDS = [0.6, 0.76, 0.92] as const;
const RHO_STEPS = [0, 0.05, -0.05, 0.1, -0.1, 0.15, -0.15, 0.2, -0.2] as const;
const bandOf = (d: number): 0 | 1 | 2 => (d <= 1 ? 0 : d <= 7 ? 1 : 2);

/**
 * Azimuth comes from the slot, so a world stays where you remember it. Band follows recency.
 * Lower slots win: a new world never pushes an old one. If the worlds cannot fit, all shrink together.
 */
export function placeWorlds(seeds: readonly WorldSeed[], free: Rect, gap = 6): WorldPlace[] {
  const m0 = Math.min(free.w, free.h);
  const Rx = free.w / 2 - 24;
  const Ry = free.h / 2 - 24;
  const keepOut = 0.082 * m0 * 2.1;                       // disc radius plus the bright inner corona
  const massMax = seeds.reduce((a, s) => Math.max(a, s.mass), 0);
  const field = Math.PI * (Rx * Ry - keepOut * keepOut);
  const want = seeds.reduce((a, s) => a + Math.PI * (worldRadius(s.mass, massMax, m0) + gap / 2) ** 2, 0);
  const shrink = Math.min(1, Math.sqrt((0.3 * field) / want));   // 0.3 is a density greedy placement reaches
  const placed: WorldPlace[] = [];
  for (const s of [...seeds].sort((a, b) => a.slot - b.slot)) {
    const r = Math.max(6, worldRadius(s.mass, massMax, m0) * shrink);
    const band = bandOf(s.ageDays);
    const base = 28 + s.slot * GOLDEN;
    const rho0 = BANDS[band] + 0.05 * (((s.slot * 5) % 7) / 6 - 0.5);
    let best: WorldPlace | null = null;
    let bestClear = -Infinity;
    search: for (let i = 0; i <= 15; i++) {
      for (const sign of i === 0 ? [1] : [1, -1]) {
        const a = ((base + sign * i * 6) * Math.PI) / 180;
        for (const dr of RHO_STEPS) {
          const rho = Math.min(1, Math.max(0.42, rho0 + dr));
          const x = rho * Rx * Math.cos(a);
          const y = rho * Ry * Math.sin(a);
          let clear = Math.hypot(x, y) - keepOut - r;
          for (const q of placed) clear = Math.min(clear, Math.hypot(q.x - x, q.y - y) - q.r - r - gap);
          if (clear > bestClear) { bestClear = clear; best = { slot: s.slot, x, y, r, band }; }
          if (clear >= 0) break search;
        }
      }
    }
    placed.push(best as WorldPlace);
  }
  return placed;
}
```

The mapping laws, one module, used by every view:

```ts
// Every mapping from data to picture. Pure functions, no three.js, shared by the scene and the Plate.

/** Law 2. 1 is an empty context window, 0 is a full one. Log scale, because agents end at p50 71k and p90 245k of a 1M window. */
export const altitude = (used: number, window: number): number =>
  Math.max(0, 1 - Math.log1p(used / 20_000) / Math.log1p(window / 20_000));

/** Law 3, owned craft. rad/s from live tokens per second. Compressed, so a craft never crawls and never spins. */
export const orbitRate = (tps: number): number => ((2 * Math.PI) / 18) * (1 - Math.exp(-tps / 40));

/** Law 3, observed craft. Radians to burn through when a response lands. Half an orbit at most. */
export const burnAngle = (tokens: number): number => Math.PI * (1 - Math.exp(-tokens / 3000));

/** Length of the drive plume in CSS px, before craftK. A generating craft is never below 30. */
export const plumeCss = (tps: number): number => 30 + 38 * (1 - Math.exp(-tps / 120));

/** Law 4. Einstein radius in CSS px from the age of the request. Age is the only urgency, because prompts have no deadline. */
export const thetaE = (ageS: number, freeH: number): number =>
  (freeH / 720) * Math.min(150, 56 * (1 + 0.4 * Math.log2(1 + ageS / 20)));

/** Ages at which a waiting well sends another wavefront, and repeats its alert. */
export const WAVE_AGES_S = [0, 30, 120, 600] as const;

/** Law 1. World radius in CSS px. Log of mass, because two stores hold 95 % of the bytes here. */
export const worldRadius = (mass: number, massMax: number, freeMin: number): number => {
  const rMin = 8;
  const rMax = 0.064 * freeMin;
  return massMax <= 0 ? rMin : rMin + ((rMax - rMin) * Math.log10(1 + mass)) / Math.log10(1 + massMax);
};

/** Law 7. Everything the star lights dims with the window. */
export const quotaLight = (sunLeft: number): number => 0.28 + 0.72 * sunLeft;

/** Radius of a craft's orbit in CSS px at system zoom, from its altitude. */
export const orbitCss = (worldR: number, alt: number, craftK: number): number => {
  const span = Math.min(66, Math.max(34, 1.3 * worldR)) * craftK;
  return worldR + 14 + alt * span;
};

/** Salvo rule. Measured on this machine: 113 fan-outs in October, launch gaps p25 3 ms, p50 1.9 s. */
export const SALVO = { openCount: 3, openWindowMs: 1_000, joinWindowMs: 10_000, maxStreaks: 16 } as const;
```

| Law | Sample | Result `[V]` |
|---|---|---|
| Altitude, 1M window | 14.6k, 71k, 245k, 500k, 800k used | 0.86, 0.61, 0.34, 0.17, 0.06. Linear would be 0.99, 0.93, 0.75, 0.50, 0.20 |
| Orbit period | 10, 25, 50, 100, 396 tok/s | 81, 39, 25, 20, 18 s. The concept was 800 to 20 s |
| Speed at 70 px radius | 50 and 396 tok/s | 17 and 24 px/s. The concept gave 6 px/s at an assumed 150 px radius |
| Observed burn | 66, 578, 2000, 8000 tokens | 5, 39, 107, 205 px at 70 px radius |
| Plume | 0, 50, 120, 396 tok/s | 30, 43, 54, 67 px |
| `thetaE` at 720 free height | 0, 20, 60, 134, 400 s | 56, 78, 101, 122, 150 px. Cap reached at 347 s |
| Deflection at 400 px | same ages | 7.8, 15, 25, 37, 56 px |
| Wavefront at C, R, W | | Speed 1154, 1817, 2532 px/s. Amplitude 15, 21, 28 px. Width 46, 63, 86 px |

Wavefront speed is `hypot(free.w, free.h) / 0.9 s`, so it crosses the free rect in 900 ms at any size.

### 7.5 Shader inputs

All materials use `glslVersion: THREE.GLSL3`. `ShaderMaterial` injects `position`, `modelViewMatrix`, `projectionMatrix` and `viewMatrix`. Blending is additive unless noted, and every material sets `toneMapped: false`.

| Shader | Instance or vertex data | Uniforms, from | Updated |
|---|---|---|---|
| `sky-point` | `aDir aColor aSize` from `history.digest` | `uBasis` camera. `uSkyR = max(free.w, free.h) / 2 * dpr * skyScale`. `uCentre`, `uRes` | Index growth |
| `sky-line` | `iRa iDec iColor iFade`: 31 meridians plus spokes | as above, plus `uFrame`, `uWidthPx` | New day, salvo closed |
| `lens` | Fullscreen | `uSky`, `uNoise`. `uWell` from open decisions, craft projected to px. `uWave` from the wavefront list. `uWaveShape`, `uRes`, `uVoid`, `uNad`, `uHalpha` | Every rendered frame |
| `corona` | Fullscreen, half res | `uStream`: azimuth of each loaded world, load from `node.rate` plus salvo flare. `uTokenClock += outputTokens * 1e-5`, wrapped. `uStarPx`, `uStarR` | Tier corona rate while tokens move. Frozen at 0 agents |
| `disc` | Quad | `uSunLeft` from `plan.changed`. `uSliver` lerped from `sliver-full` to `sliver-low`. `uStar`, `uRadius` | On change |
| `limb` | `iCentre iRadius` from layout | `uStar`. `uQuota = quotaLight(sunLeft)` | On layout or plan change |
| `city` | `aDir` from a hash of `sessionId`, then `nodeId`. `aWorld aFail` | `uWorld[32]`, `uStar`, `uPx`, `uCity`, `uHalpha` | On landing |
| `arc` | `iCenter iA iB iSpan iColor iStyle iLife iUnroll iRow` | `uRes`, `uPxPerCss`, `uNow` | `iSpan` per moving craft, the rest on change |
| `hull` | `iPos iHeading iSize iColor iShape` | `uRes`, `uPxPerCss` | `iPos` per moving craft |
| `beam` | `iFrom iTo iBeam iColor` | `uRes`, `uPxPerCss`, `uNow` | On tool start and finish |
| `mote` | `aPath aMeta`, ring buffer | `uPlane`, `uNow`, `uPx`, `uOiii` | On birth |
| `finish` | Effect | `uDisc`, `uFocus`, `uDim`, `uDesat`, `uVoid`, `aspect` from `postprocessing` | Every rendered frame |

`uPxPerCss` is `renderDpr`, so lines keep their CSS width at any tier. `laws.ts` returns CSS px, and `uWell` and `uWave` are canvas px, so multiply by `renderDpr` before writing them. Line gains are starting values: tune them to the displayed peaks in section 5.1. `[U]`

**Arc uses.** Everything curved is one primitive, so one draw per LOD.

| Use | Width px | Taper | Dash cycles, flow Hz | Colour, gain | Life |
|---|---:|---:|---|---|---|
| Orbit, World level or selected | 0.75 | 0 | | `pearl` 0.1 | static |
| Wake | 1 | 1 | | `oiii` 0.6 | re-spanned |
| Plume, writing | 4.6 | 1 | | `oiii` 4.2 | re-spanned |
| Plume, thinking | 3.4 | 1 | | `oiii` 2.5 | re-spanned |
| Plume, observed | 3 | 1 | 9, 1.5 | `oiii` 2.2 | re-spanned |
| Hoop | 0.8 | 0 | | `pearl` 0.2 | static |
| Lit arc | 1.1 | 0 | | `lamp` 0.6 | static |
| Long exposure | 0.6 | 1 | | `city` 0.05 | static |
| Transfer arc, drafting | 1.25 | 0 | 24, 0 | `pearl` 0.8 | while typing |
| Streak | 2 | 1 | | `pearl` 6 | 420 ms |
| Filament, tether | 0.75 | 0 | 40, 0 for filament | `bone` 0.3 | static |
| Fuel arc | 1.5 | 0 | | `bone` 1 | static |

**Hull kinds.** `iShape.x` selects the SDF. Half extents in CSS px, times `craftK`.

| Kind | Used for | Half extent |
|---|---|---:|
| `KITE` | Vessel | 7.5 |
| `DART` | Tender | 5 |
| `BEAD` | Workflow agent, 8 px across at System level | 5.5 |
| `BROKEN` | Observed wait, `iShape.w` is 8 dashes | 30 |
| `HOLLOW` | Parked, expired | 12 |
| `COUNTDOWN` | Retry, rate limit, fuel: `iShape.z` is progress. Rim arcs use it too, sized to the disc, at System level only | 15 |
| `SLASH` | Interrupted, stopping | 9 |
| `SHARD` | Crash debris | 3 |
| `POD` | Queued prompt | 3 |

### 7.6 Shaders

Lens composite. The sky renders to its own target, and this triangle draws it through the point lens equation as the scene background. Worlds and craft draw on top, so the hull stays sharp in the middle of the ring. A composer `mainUv` effect would warp the craft, and `postprocessing` refuses to combine `mainUv` with a convolution effect in one pass. `[V]`, source.

```glsl
// Fullscreen triangle. position.xy is -1..3.
out vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
```

```glsl
// The Bend. The scene background: it draws the sky through the point lens equation, so hulls stay sharp in the ring.
uniform sampler2D uSky;     // sky target, half float
uniform sampler2D uNoise;   // 256 x 256 tiling noise, built at boot
uniform vec4 uWell[8];      // xy: centre px, z: signed thetaE px, w: ring colour, 0 sodium, 1 H-alpha
uniform int uWellCount;
uniform vec4 uWave[4];      // xy: centre px, z: crest radius px, w: amplitude px
uniform int uWaveCount;
uniform vec2 uWaveShape;    // x: crest width px, y: peak amplitude px
uniform vec2 uRes;          // canvas px
uniform vec3 uVoid;
uniform vec3 uNad;
uniform vec3 uHalpha;
in vec2 vUv;
out vec4 o;

void main() {
  vec2 p = vUv * uRes;
  vec2 s = p;
  float shadow = 1.0;
  float gain = 1.0;
  vec3 ring = vec3(0.0);
  for (int i = 0; i < uWellCount; i++) {
    vec2 d = p - uWell[i].xy;
    float te = uWell[i].z;
    float r2 = dot(d, d) + 1.0;
    float r = sqrt(r2);
    s -= d * te * abs(te) / r2;                            // point lens, wells add. Negative te is the rebound
    if (te < 1.0) continue;
    shadow *= smoothstep(0.34 * te, 0.62 * te, r);         // dark inner disc
    float k = (r - te) / (0.3 * te);
    gain *= 1.0 + 2.6 * exp(-k * k);                       // caustic brightening
    float a = atan(d.y, d.x);
    float m = texture(uNoise, vec2(cos(a), sin(a)) * 0.17 + float(i) * 0.31).r;
    float arc = pow(clamp((m - 0.3) / 0.42, 0.0, 1.0), 1.5);
    float e = (r - te) / ((0.85 + 3.4 * arc) * sqrt(te / 104.0));
    ring += mix(uNad, uHalpha, uWell[i].w) * 2.5 * (0.14 + 1.3 * arc) * exp(-e * e);
  }
  for (int j = 0; j < uWaveCount; j++) {
    vec2 d = p - uWave[j].xy;
    float r = length(d) + 1e-3;
    float k = (r - uWave[j].z) / uWaveShape.x;
    float g = exp(-k * k);
    s -= d / r * uWave[j].w * (1.0 - 2.0 * k * k) * g;     // Ricker profile: push, then pull
    gain *= 1.0 + 1.4 * g * uWave[j].w / uWaveShape.y;     // the crest catches light
  }
  vec3 sky = texture(uSky, s / uRes).rgb;
  o = vec4(uVoid + sky * shadow * gain + ring, 1.0);
}
```

Each frame, project every waiting craft to pixels and write `uWell`. On answer, drive a multiplier on `thetaE` through `snapback`: it passes through zero and overshoots negative, so the whole sky ripples back. A well off the frame still bends the frame edge toward itself, and a chevron on the rail edge names it.

**Well slots.** 8 at most. The newest always bends, then the oldest 7. **Wave slots.** 4 at most, newest first.

Sky.

```glsl
// Stars and dust on the celestial sphere. Drawn into the sky target only when the camera moved or the sky changed.
in vec3 aDir;          // unit vector, world space
in vec3 aColor;        // linear colour times flux
in float aSize;        // point diameter in device px of the sky target
uniform mat3 uBasis;   // rows: camera right, up, forward
uniform float uSkyR;   // px at psi = 90 degrees
uniform vec2 uCentre;  // principal point in sky target px, GL origin
uniform vec2 uRes;     // sky target size in px
out vec3 vColor;

void main() {
  vec3 v = uBasis * aDir;
  float psi = acos(clamp(v.z, -1.0, 1.0));
  float rho = tan(0.5 * psi) * uSkyR;                     // stereographic: circles stay circles
  vec2 px = uCentre + normalize(v.xy + vec2(1e-6)) * rho;
  gl_Position = psi > 2.75 ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = aSize;
  vColor = aColor;
}
```

```glsl
in vec3 vColor;
out vec4 o;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  o = vec4(vColor * exp(-dot(d, d) * 12.0), 1.0);         // additive, gaussian disc
}
```

```glsl
// Meridians, the Horizon, the now line and burned spokes. All are segments of a meridian, so all are one draw.
// position.x runs 0..1 along the segment, position.y is the side, -1 or 1.
in float iRa;          // right ascension, radians
in vec2 iDec;          // declination range, radians
in vec4 iColor;        // linear rgb, gain
in float iFade;        // 1 fades toward the poles, 0 does not
uniform mat3 uBasis;   // rows: camera right, up, forward
uniform mat3 uFrame;   // columns: sky axes e1, e2, e3 in world space. Fixed at boot
uniform float uSkyR;
uniform vec2 uCentre;
uniform vec2 uRes;
uniform float uWidthPx;
out float vSide;
out vec3 vColor;

vec3 skyDir(float ra, float dec) {
  return uFrame * vec3(cos(dec) * cos(ra), cos(dec) * sin(ra), sin(dec));
}

vec2 stereo(vec3 d) {
  vec3 v = uBasis * d;
  float psi = acos(clamp(v.z, -1.0, 1.0));
  return uCentre + normalize(v.xy + vec2(1e-6)) * tan(0.5 * psi) * uSkyR;
}

void main() {
  float dec = mix(iDec.x, iDec.y, position.x);
  vec2 p0 = stereo(skyDir(iRa, dec));
  vec2 p1 = stereo(skyDir(iRa, dec + 0.01));
  vec2 t = normalize(p1 - p0 + vec2(1e-5, 0.0));
  vec2 px = p0 + vec2(-t.y, t.x) * position.y * uWidthPx;
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
  vSide = position.y;
  float e = abs(dec) / 1.5;
  vColor = iColor.rgb * iColor.a * (1.0 - iFade * e * e * e);
}
```

```glsl
in float vSide;
in vec3 vColor;
out vec4 o;

void main() {
  o = vec4(vColor * (1.0 - smoothstep(0.35, 1.0, abs(vSide))), 1.0);
}
```

Corona and disc. Streamers cover most of the frame, so they render to a half resolution target at a low rate. The disc and sliver stay at full resolution in a small quad. At 0 agents `uTokenClock` stops, so the corona is a photograph and costs nothing.

```glsl
// Streamers. Half resolution target, updated at the tier's corona rate. A polar chart of token load.
uniform sampler2D uNoise;
uniform vec2 uStream[16];    // x: screen azimuth of a world, y: token load 0..1, plus salvo flare, at most 1.3
uniform int uStreamCount;
uniform float uTokenClock;   // advances with fleet output tokens, never with wall time
uniform vec2 uStarPx;        // star centre in target px
uniform float uStarR;        // disc radius in target px
uniform vec3 uPearl;
uniform vec3 uOiii;
out vec4 o;

float tap(float a, float r, float f) {
  return texture(uNoise, vec2(cos(a), sin(a)) * f + vec2(0.0, r * 0.06 - uTokenClock)).r;
}

void main() {
  vec2 q = (gl_FragCoord.xy - uStarPx) / uStarR;
  float r = length(q);
  if (r < 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float a = atan(q.y, q.x);
  float s = 0.0;
  for (int i = 0; i < uStreamCount; i++) {
    float d = atan(sin(a - uStream[i].x), cos(a - uStream[i].x));
    float sig = 0.1 + 0.05 * uStream[i].y;
    s += uStream[i].y * exp(-(d * d) / (sig * sig));
  }
  s = min(s, 1.25);
  float c = min(s, 1.0);
  float n = pow(clamp((tap(a, r, 0.41) - 0.24) / 0.5, 0.0, 1.0), 2.2);
  float h = pow(clamp((tap(a, r, 2.6) - 0.2) / 0.6, 0.0, 1.0), 1.6);
  float fade = 1.0 - smoothstep(3.6 + 2.6 * c, 5.2 + 3.6 * c, r);
  float I = pow(r, -(3.9 - 1.9 * c)) * (0.1 + 1.45 * n * (0.45 + 1.1 * h)) * (0.62 + 1.5 * s) * fade * 1.05;
  o = vec4(mix(uPearl, uOiii, clamp(0.62 * s, 0.0, 1.0)) * I, 1.0);
}
```

```glsl
// A quad of 1.3 star radii, full resolution. position.xy is -1..1.
uniform vec3 uStar;      // world position
uniform float uRadius;   // world units
out vec2 vP;

void main() {
  vP = position.xy * 1.3;
  vec4 c = viewMatrix * vec4(uStar, 1.0);
  c.xy += vP * uRadius;
  gl_Position = projectionMatrix * c;
}
```

```glsl
// The kernel disc, the sliver of sun past it, the thin limb. The sliver is the five hour gauge.
uniform float uSunLeft;      // five hour window left, 0..1
uniform vec3 uSliver;        // lerps from sliver-full to sliver-low as the window burns
uniform vec3 uPearl;
in vec2 vP;                  // position in star radii
out vec4 o;

void main() {
  float r = length(vP);
  vec2 sp = vP - vec2(0.469, 0.883) * (0.012 + 0.11 * uSunLeft);   // the sun, displaced toward one o'clock
  float aa = fwidth(r) * 1.2;
  float past = smoothstep(1.0 - aa, 1.0 + aa, r);
  float sun = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, length(sp));
  float e = (r - 1.0) / 0.008;
  vec3 col = uSliver * sun * past * 16.0 + uPearl * exp(-e * e) * 0.5;
  o = vec4(col * past, 1.0 - past);                                // premultiplied: the disc occludes, the rim adds
}
```

Worlds. A billboard at the sphere's centre plane: the limb stays perfect at any zoom with no MSAA, and a world costs 2 triangles. It writes depth at the centre plane, and nothing orbits inside a sphere, so early-z stays on. `[V]`, concept. Blending is premultiplied: `CustomBlending`, `One`, `OneMinusSrcAlpha`.

```glsl
// Worlds and moons as analytic impostors. position.xy is -1..1, scaled to 1.16 radii.
in vec3 iCentre;
in float iRadius;      // world units
uniform vec3 uStar;
out vec2 vQ;
flat out vec3 vLight;  // toward the star, view space

void main() {
  vQ = position.xy * 1.16;
  vec4 c = viewMatrix * vec4(iCentre, 1.0);
  c.xy += vQ * iRadius;
  vLight = normalize(mat3(viewMatrix) * (uStar - iCentre));
  gl_Position = projectionMatrix * c;
}
```

```glsl
uniform float uQuota;     // 0.28 + 0.72 * sun left: the whole system dims with the window
uniform vec3 uPearl;
in vec2 vQ;               // 1.0 is the limb
flat in vec3 vLight;
out vec4 o;

void main() {
  float r = length(vQ);
  if (r > 1.16) discard;
  float aa = fwidth(r) * 1.1;
  float body = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  vec3 col = vec3(0.0);
  if (r < 1.0) {
    vec3 n = vec3(vQ, sqrt(1.0 - r * r));
    float ndl = dot(n, vLight);
    float rim = pow(1.0 - n.z, 9.0) * smoothstep(-0.34, 0.5, ndl);
    col = uPearl * (rim * 9.0 + pow(max(ndl, 0.0), 3.0) * 0.018) * uQuota;
  } else {
    float nl = dot(normalize(vQ), vLight.xy);
    col = uPearl * exp((1.0 - r) / 0.022) * smoothstep(-0.1, 0.72, nl) * 1.5 * uQuota;
  }
  o = vec4(col, body);    // premultiplied: the body occludes, the atmosphere adds
}
```

Cities.

```glsl
// One light per finished agent, one cluster per session. Night side only.
in vec3 aDir;             // unit vector from the world centre
in float aWorld;          // world index
in float aFail;           // 1 for an ember, 0 for a city light
uniform vec4 uWorld[32];  // xyz: centre, w: radius
uniform vec3 uStar;
uniform float uPx;
uniform vec3 uCity;
uniform vec3 uHalpha;
out vec3 vColor;

void main() {
  vec4 w = uWorld[int(aWorld)];
  vec3 view = mat3(viewMatrix) * aDir;
  float night = 1.0 - smoothstep(-0.12, 0.32, dot(aDir, normalize(uStar - w.xyz)));
  float limb = smoothstep(0.04, 0.3, view.z);
  bool hide = view.z < 0.04 || night * limb < 0.01;
  gl_Position = hide ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(w.xyz + aDir * w.w * 1.002, 1.0);
  gl_PointSize = uPx;
  vColor = mix(uCity, uHalpha, aFail) * night * limb * 3.0;
}
```

```glsl
in vec3 vColor;
out vec4 o;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  o = vec4(vColor * exp(-dot(d, d) * 14.0), 1.0);
}
```

Arc engine. A wake needs no history buffer, because it lies exactly on its orbit. There is no per-frame geometry.

```glsl
// Every curve is an arc of an ellipse: orbits, wakes, plumes, hoops, exposures, transfer arcs, streaks.
// position.x runs 0..1 along the arc, position.y is the side, -1..1.
in vec3 iCenter;
in vec3 iA;            // ellipse basis, scaled by radius
in vec3 iB;
in vec2 iSpan;         // start angle, sweep, radians
in vec4 iColor;        // linear rgb, HDR gain
in vec4 iStyle;        // x: width CSS px, y: taper 0..1, z: dash cycles along the arc, w: dash flow per second
in vec2 iLife;         // x: birth s, y: life s. Life 0 is a static arc. Otherwise a bright window runs along it once
in float iUnroll;      // 0 hoop, 1 flat row. Only the armillary sets it
in vec3 iRow;          // left end of the flat row, world space
uniform vec2 uRes;
uniform float uPxPerCss;
uniform float uNow;
out float vT;
out float vSide;
out vec4 vColor;
out vec3 vFx;          // x: dash cycles, y: dash flow, z: taper

vec3 orbit(float th) { return iCenter + iA * cos(th) + iB * sin(th); }

// Constant arc length: curvature falls to zero, the strip never stretches.
vec3 uncurl(float th, float t) {
  vec3 hoop = orbit(th);
  if (t <= 0.0) return hoop;
  float R = length(iA);
  float s = (th - iSpan.x) * R;                       // arc length from the pin
  float k = (1.0 - t) / R;
  vec2 q = k < 1e-5 ? vec2(s, 0.0) : vec2(sin(k * s) / k, (1.0 - cos(k * s)) / k);
  vec3 bent = iRow + vec3(q.x, 0.0, q.y);
  return mix(hoop, bent, smoothstep(0.0, 0.2, t));
}

void main() {
  float t = position.x;
  float g = 1.0;
  if (iLife.y > 0.0) {
    float s = clamp((uNow - iLife.x) / iLife.y, 0.0, 1.0);
    t = mix(max(0.0, s - 0.35), s, t);
    g = 1.0 - s * s;
  }
  float th = iSpan.x + iSpan.y * t;
  mat4 vp = projectionMatrix * viewMatrix;
  vec4 c0 = vp * vec4(uncurl(th, iUnroll), 1.0);
  vec4 c1 = vp * vec4(uncurl(th + 0.01, iUnroll), 1.0);
  vec2 dir = normalize((c1.xy / c1.w - c0.xy / c0.w) * uRes + vec2(1e-5, 0.0));
  float w = iStyle.x * uPxPerCss * mix(1.0, position.x, iStyle.y);
  c0.xy += vec2(-dir.y, dir.x) * position.y * w / uRes * 2.0 * c0.w;
  gl_Position = c0;
  vT = position.x;
  vSide = position.y;
  vColor = vec4(iColor.rgb, iColor.a * g);
  vFx = vec3(iStyle.z, iStyle.w, iStyle.y);
}
```

```glsl
uniform float uNow;
in float vT;
in float vSide;
in vec4 vColor;
in vec3 vFx;
out vec4 o;

void main() {
  float edge = 1.0 - smoothstep(0.35, 1.0, abs(vSide));              // analytic AA, no MSAA needed
  float dash = vFx.x > 0.0 ? step(0.5, fract(vT * vFx.x - uNow * vFx.y)) : 1.0;
  float fade = mix(1.0, vT * vT, vFx.z);
  o = vec4(vColor.rgb * vColor.a * edge * dash * fade, 1.0);
}
```

Hulls and all other screen facing marks.

```glsl
// One instanced quad for every screen facing mark: hulls, beads, broken rings, countdown arcs, slashes, debris, pods.
// position.xy is -1..1.
in vec3 iPos;            // world position
in float iHeading;       // screen radians, 0 points right
in float iSize;          // half extent of the quad, CSS px
in vec4 iColor;          // linear rgb, HDR gain
in vec4 iShape;          // x: kind, y: fill 0..1, z: progress 0..1, w: dash count
uniform vec2 uRes;
uniform float uPxPerCss;
out vec2 vP;
out vec4 vColor;
flat out vec4 vShape;

void main() {
  vec4 c = projectionMatrix * viewMatrix * vec4(iPos, 1.0);
  float ca = cos(iHeading);
  float sa = sin(iHeading);
  vec2 q = vec2(position.x * ca - position.y * sa, position.x * sa + position.y * ca);
  c.xy += q * iSize * uPxPerCss / uRes * 2.0 * c.w;
  gl_Position = c;
  vP = position.xy;
  vColor = iColor;
  vShape = iShape;
}
```

```glsl
const int KITE = 0, DART = 1, BEAD = 2, BROKEN = 3, HOLLOW = 4, COUNTDOWN = 5, SLASH = 6, SHARD = 7, POD = 8;
const float TAU = 6.2831853;
in vec2 vP;
in vec4 vColor;
flat in vec4 vShape;
out vec4 o;

float seg(vec2 p, vec2 a, vec2 b) {
  vec2 e = b - a;
  vec2 w = p - a;
  return length(w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0));
}

float quad4(vec2 p, vec2 v0, vec2 v1, vec2 v2, vec2 v3) {            // signed distance to a closed polygon
  vec2 v[4] = vec2[4](v0, v1, v2, v3);
  float d = 1e3;
  float s = 1.0;
  for (int i = 0, j = 3; i < 4; j = i, i++) {
    d = min(d, seg(p, v[i], v[j]));
    vec2 e = v[j] - v[i];
    vec2 w = p - v[i];
    bool c1 = p.y >= v[i].y;
    bool c2 = p.y < v[j].y;
    bool c3 = e.x * w.y > e.y * w.x;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * d;
}

void main() {
  int kind = int(vShape.x + 0.5);
  float stroke = 0.09;
  float d = 1.0;
  float gate = 1.0;
  if (kind == KITE) d = quad4(vP, vec2(1.0, 0.0), vec2(-0.62, 0.46), vec2(-0.24, 0.0), vec2(-0.62, -0.46));
  else if (kind == DART) d = quad4(vP, vec2(1.0, 0.0), vec2(-0.5, 0.26), vec2(-0.2, 0.0), vec2(-0.5, -0.26));
  else if (kind == BEAD) d = length(vP) - 0.72;
  else if (kind == POD) d = quad4(vP, vec2(0.7, 0.0), vec2(0.0, 0.42), vec2(-0.7, 0.0), vec2(0.0, -0.42));
  else if (kind == SHARD) d = quad4(vP, vec2(0.8, 0.1), vec2(-0.4, 0.5), vec2(-0.2, 0.0), vec2(-0.5, -0.4));
  else if (kind == SLASH) d = seg(vP, vec2(-0.8, -0.8), vec2(0.8, 0.8)) - 0.07;
  else {
    d = length(vP) - 0.9;
    float a = atan(vP.y, vP.x);
    if (kind == BROKEN) gate = step(fract(a / TAU * max(vShape.w, 1.0)), 0.62);
    if (kind == COUNTDOWN) gate = step(fract(a / TAU + 0.25), vShape.z) * step(fract(a / TAU * max(vShape.w, 1.0)), 0.6);
    stroke = 0.03;
  }
  float aa = fwidth(d);
  float fill = 1.0 - smoothstep(-aa, aa, d);
  float line = 1.0 - smoothstep(stroke - aa, stroke + aa, abs(d));
  o = vec4(vColor.rgb * vColor.a * mix(line, fill, vShape.y) * gate, 1.0);
}
```

Beams and meteors.

```glsl
// Straight marks in world space: open tool calls and meteors. position.x runs 0..1, position.y is the side.
in vec3 iFrom;
in vec3 iTo;
in vec4 iBeam;       // x: class, y: birth s, z: life s, 0 while the call is open, w: width CSS px
in vec4 iColor;      // linear rgb, HDR gain
uniform vec2 uRes;
uniform float uPxPerCss;
uniform float uNow;
out float vT;
out float vSide;
out vec4 vColor;
flat out float vClass;

void main() {
  float t = position.x;
  float g = 1.0;
  if (iBeam.z > 0.0) {                                  // a meteor: a window that runs once and dies
    float s = clamp((uNow - iBeam.y) / iBeam.z, 0.0, 1.0);
    t = mix(max(0.0, s - 0.3), s, t);
    g = 1.0 - s * s;
  }
  mat4 vp = projectionMatrix * viewMatrix;
  vec4 a = vp * vec4(iFrom, 1.0);
  vec4 b = vp * vec4(iTo, 1.0);
  vec4 c = mix(a, b, t);
  vec2 dir = normalize((b.xy / b.w - a.xy / a.w) * uRes + vec2(1e-5, 0.0));
  float w = iBeam.w * uPxPerCss * (int(iBeam.x + 0.5) == 0 ? mix(0.25, 1.0, position.x) : 1.0);
  c.xy += vec2(-dir.y, dir.x) * position.y * w / uRes * 2.0 * c.w;
  gl_Position = c;
  vT = position.x;
  vSide = position.y;
  vColor = vec4(iColor.rgb, iColor.a * g);
  vClass = iBeam.x;
}
```

```glsl
const int SCAN = 0, STRIKE = 1, DRILL = 2, OUTBOUND = 3, TIGHT = 4, METEOR = 5;
uniform float uNow;
in float vT;
in float vSide;
in vec4 vColor;
flat in float vClass;
out vec4 o;

void main() {
  int k = int(vClass + 0.5);
  float across = abs(vSide);
  float m = 1.0 - smoothstep(0.35, 1.0, across);
  if (k == SCAN) m = exp(-across * across * 3.0) * vT * 0.5;                  // wide, pale cone
  if (k == DRILL) m *= step(0.5, fract(vT * 7.0 - uNow * 6.0));               // dashes flow toward the surface
  if (k == OUTBOUND) m *= step(0.35, fract(vT * 4.0 - uNow * 3.0));           // dashes flow out of the world
  if (k == STRIKE || k == METEOR) m *= mix(0.4, 1.0, vT);                     // hot at the tip
  o = vec4(vColor.rgb * vColor.a * m, 1.0);
}
```

Motes.

```glsl
// Token motes. Craft zoom only. Ring buffer, written once at birth, then analytic.
in vec4 aPath;       // xy: start, zw: end, on the orbital plane of the selected craft
in vec3 aMeta;       // x: birth s, y: life s, z: lateral bow
uniform mat4 uPlane; // orbital plane to world
uniform float uNow;
uniform float uPx;
out float vA;

void main() {
  float t = clamp((uNow - aMeta.x) / aMeta.y, 0.0, 1.0);
  vec2 a = aPath.xy;
  vec2 b = aPath.zw;
  vec2 c = 0.5 * (a + b) + vec2(a.y - b.y, b.x - a.x) * aMeta.z;
  vec2 p = mix(mix(a, c, t), mix(c, b, t), t);
  gl_Position = projectionMatrix * viewMatrix * uPlane * vec4(p.x, 0.0, p.y, 1.0);
  gl_PointSize = uPx;
  vA = sin(t * 3.14159);
}
```

```glsl
uniform vec3 uOiii;
in float vA;
out vec4 o;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  o = vec4(uOiii * 2.0 * vA * exp(-dot(d, d) * 14.0), 1.0);
}
```

Finish.

```glsl
// Last effect in the pass, after bloom. postprocessing supplies aspect, and encodes sRGB after mainImage.
uniform vec3 uDisc;     // xy: centre uv, z: radius as a fraction of canvas height
uniform vec4 uFocus;    // xy: centre uv, z: inner radius, w: outer radius, fractions of canvas height
uniform float uDim;     // 1 normal, 0.45 locked
uniform float uDesat;   // 0 normal, 0.4 kernel link lost
uniform vec3 uVoid;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 k = vec2(aspect, 1.0);
  float past = smoothstep(uDisc.z * 0.985, uDisc.z, length((uv - uDisc.xy) * k));
  vec3 c = mix(uVoid * 0.3, inputColor.rgb, past);                  // the disc stays black after bloom
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 v = mix(c, vec3(luma), clamp(log2(1.0 + luma) / 6.0, 0.0, 1.0));   // highlights roll toward white, as film does
  v *= mix(1.0, uDim, smoothstep(uFocus.z, uFocus.w, length((uv - uFocus.xy) * k)));
  vec3 t = 1.0 - exp(-v * 1.05);
  outputColor = vec4(mix(t, vec3(dot(t, vec3(0.2126, 0.7152, 0.0722))), uDesat), inputColor.a);
}
```

### 7.7 Instancing plan

Fixed capacity, one shared geometry per kind, updates through `addUpdateRange`. `[V]`, the API exists in three 0.186.1.

| Buffer | Capacity | Draws | Update pattern | Past the cap |
|---|---:|---:|---|---|
| Sky points | 40,000 | 2 | Whole, on index growth, in idle time | Dust thins |
| Sky lines | 31 + 512 spokes, 128 segments | 1 | Range, on change | Oldest spokes leave with their day |
| Worlds and moons | 64 | 1 | Range, on layout | Beyond 32 worlds, outer worlds fold into a belt |
| Cities | 8,192, 4,096 at Penumbra | 1 | One range per landing | Oldest merge by cluster |
| Arcs | 2,048 | 3 LODs | `iSpan` range per moving craft | Long exposures drop first |
| Hulls | 1,024 | 1 | `iPos` range per moving craft | Shoals |
| Beams | 64 | 1 | One range per tool event | Newest win. Tape keeps all |
| Motes | 1,024, 512, 256 | 1 | One range per birth | Dropped. Numbers stay exact |
| Wells | 8 | uniform | Array write per frame | Rail lists all |
| Labels | 30 DOM nodes | | `transform` per moving anchor | Attention order wins |

A typical frame with 20 agents: about 28 draws and under 25,000 triangles, against the DS budget of 100 draws. `[V]` arithmetic

### 7.8 Post chain and stage

| Step | Setting | Note |
|---|---|---|
| Bloom | `mipmapBlur`, `luminanceThreshold` 1, `luminanceSmoothing` 0.2, `intensity` 0.5, `radius` 0.7, `levels` by tier | The wrapper defaults to `ADD`, which matches the stills `[V]`. The raw effect defaults to `SCREEN`, so keep the wrapper |
| Finish | `BlendFunction.SRC`, last in the pass | The stills' curve: `des = log2(1 + luma) / 6`, `v = mix(c, luma, des)`, `t = 1 - exp(-1.05 v)` `[V]`. sRGB encoding runs after `mainImage` `[V]` |
| Dither | `effectPass.dithering = true` | Runs after encoding, static. Prevents banding on near-black `[V]` for the API |

Resolution control is `dpr` and Bloom `levels` only. `resolutionScale` does nothing under `mipmapBlur`. `[V]`, source.

**Left out on purpose:** depth of field, SSAO, vignette, grain, chromatic aberration, lens flares, scanlines. None carries a signal.

```tsx
// The canvas, the sky pass, the cadence driver and the post chain.
import { useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, wrapEffect } from '@react-three/postprocessing';
import { BlendFunction, Effect } from 'postprocessing';
import * as THREE from 'three';
import finishFrag from './shaders/finish.frag?raw';
import { BATTERY_CAP_HZ, CADENCE_HZ, type Cadence, type Tier } from './tiers';

/** Stills' tone curve, disc occluder, lock dimmer, link-lost desaturation. One effect, last in the pass. */
export class FinishEffect extends Effect {
  constructor() {
    super('FinishEffect', finishFrag, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['uDisc', new THREE.Uniform(new THREE.Vector3(0.5, 0.5, 0.12))],
        ['uFocus', new THREE.Uniform(new THREE.Vector4(0.5, 0.5, 2, 3))],
        ['uDim', new THREE.Uniform(1)],
        ['uDesat', new THREE.Uniform(0)],
        ['uVoid', new THREE.Uniform(new THREE.Color('#060504'))],
      ]),
    });
  }
}
const Finish = wrapEffect(FinishEffect);

/** Redraws the sky only when the camera moved or the sky changed. Negative priority keeps automatic rendering on. */
function SkyPass({ scene, camera, target, dirty }: {
  scene: THREE.Scene; camera: THREE.Camera; target: THREE.WebGLRenderTarget; dirty: MutableRefObject<boolean>;
}) {
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    if (!dirty.current) return;
    dirty.current = false;
    gl.setRenderTarget(target);
    gl.clear();
    gl.render(scene, camera);
    gl.setRenderTarget(null);
  }, -1);
  return null;
}

/** One scheduler for the canvas. frameloop is demand, and this asks for frames at the rate the content needs. */
function CadenceDriver({ cadence, onBattery, capHz, onFrame }: {
  cadence: () => Cadence; onBattery: () => boolean; capHz: () => number; onFrame: (dtMs: number, hz: number, now: number) => void;
}) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      if (document.hidden) return;
      const hz = Math.min((onBattery() ? BATTERY_CAP_HZ : CADENCE_HZ)[cadence()], capHz());
      if (hz > 0 && now - last >= 1000 / hz - 1) {
        onFrame(now - last, hz, now);
        last = now;
        invalidate();
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [cadence, capHz, invalidate, onBattery, onFrame]);
  return null;
}

export function Stage({ tier, dpr, cadence, onBattery, capHz, onFrame, skyCamera, children }: {
  tier: Tier; dpr: number; cadence: () => Cadence; onBattery: () => boolean; capHz: () => number;
  onFrame: (dtMs: number, hz: number, now: number) => void; skyCamera: THREE.Camera; children: ReactNode;
}) {
  const skyScene = useMemo(() => new THREE.Scene(), []);
  const skyTarget = useMemo(() => new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false }), []);
  const skyDirty = useRef(true);
  return (
    <Canvas flat frameloop="demand" dpr={dpr} camera={{ fov: 20, near: 10, far: 20000 }}
            gl={{ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false }}>
      <CadenceDriver cadence={cadence} onBattery={onBattery} capHz={capHz} onFrame={onFrame} />
      <SkyPass scene={skyScene} camera={skyCamera} target={skyTarget} dirty={skyDirty} />
      {children}
      <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType}>
        <Bloom mipmapBlur levels={tier.bloomLevels} luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.6} radius={0.7} />
        <Finish />
      </EffectComposer>
    </Canvas>
  );
}
```

### 7.9 Level of detail

| Thing | System | World | Craft |
|---|---|---|---|
| World | Impostor, mass radius | Large impostor | Limb only |
| Craft | Sprite, 15 px times `craftK` | Sprite, 20 px | Mesh for the selected one, sprites for the rest |
| Plumes | All | All | Selected, plus dim neighbours |
| Orbits | Selected only | All, with altitude rings | Selected |
| Beams | `edit`, `launch`, `send` only | All families | All, selected craft |
| Hoops | Collapsed, beads visible | Open, labels on hover | Hidden |
| Tenders | Count on the parent past 4 | All | All of the selected craft |
| Pods, fuel arc | Hidden | Shown | Shown |
| Motes | None | None | Selected craft |
| Cities | Full | Full | Near hemisphere |
| Long exposure | Yes | Yes | No |
| Labels | Worlds, waiting, failed, selected | All craft in this world | Selected |
| Arc LOD | 24 or 48 | 96 | 96 |

### 7.10 Data flow

**Three clocks** (`DS 2.2`). Kernel events batch into a store outside React at most once per frame. `useFrame` reads it with `getState()`. React rows re-render at 4 Hz, never per event. Never `setState` inside `useFrame`.

**Snapshot on return.** After a hidden tab or a reconnect, resync from a snapshot, with no backlog replay. Keep event buffers bounded.

**Text is never in the stream.** Events carry structure only (`RF 9`) `[V]`. Text arrives only through an explicit fetch for one craft, on `W`, and nothing unsealed goes to logs. `title` never falls back to `lastPrompt` in default views, because it is sensitive text (`RF 3.1`) `[V]`.

**Veil** applies at the selector layer, so no component can leak a name. World names become star names hashed from `projectRoot` with a per-install salt. Titles, branches, paths and commands become structure, such as `Bash, 1 line, 31 chars`. Greek letters stay. A small `VEILED` tag shows in the masthead. Tape, toasts and the title all go through the same selectors.

---

## 8. UI components

All live in `src/hud`, all read the store through selectors with `useShallow`, and all are plain DOM. Only `LabelLayer` and `LeaderLine` depend on scene coordinates, and both degrade to nothing.

### 8.1 Shell

| Component | Props | States |
|---|---|---|
| `AppShell` | `hud: Hud` | `instrument` below 1024, `compact`, `regular`, `wide`, `short`, `cinema` |
| `Masthead` | none | normal, `veiled`, `kernel-lost` |
| `Wordmark` | `size` | static, `beads: number` during boot |
| `LampRow` | none | |
| `Lamp` | `name`, `count`, `onClick` | `dark`, `lit`, `test` at boot. On in 0 ms, off in `filament`. Lamps never blink. Click jumps to the rail section |
| `SunReadout` | `fiveHourLeft`, `sevenDayLeft`, `asOf` | `fresh`, `stale` after 10 min with a dashed underline, `unknown` |
| `RunCounts` | `run`, `idle` | |
| `LinkLamp` | `state`, `lastTickAt` | `ok`, `lag`, `no-signal` with a running counter |
| `AllStop` | `ownedCount`, `onStop` | `idle`, `holding` with a 1200 ms fill, `confirming` from pointer or assistive input, `done`, `disabled` when no owned craft |
| `BottomStrip` | none | two rows, one row when `short` |
| `Ephemeris` | none | Numbers update at 4 Hz with `servo` |
| `Tape` | `filter` | `all`, `writes-damage`, `needs`. `role="log"`. Coalesces with `×n` past 8 events a second |

**Lamps.** Dark means normal. One condition each, repeated in the rail, so a dark lamp row answers "does anything need me?" in one second.

| Lamp | Lit when | Style |
|---|---|---|
| `YOU` | At least one answerable decision | Solid `nad`, `void` text |
| `SOURCE` | At least one wait at source | Dashed `nad` outline |
| `FAULT` | Errored, crashed, abandoned, out of budget, not yet acknowledged | Solid `halpha`, `void` text |
| `RETRY` | Any craft retrying | `pearl` outline |
| `LOW` | Any craft at or above 80 % of its window | `pearl` outline |
| `LIMIT` | Plan limit reached, or admission frozen | Solid `halpha`, `void` text |
| `SENSOR` | Unknown records rising, a tail reset, or an index running | `bone` outline |

### 8.2 Left rail

| Component | Props | States |
|---|---|---|
| `Manifest` | `mode: 'craft' \| 'world'` | `auto` collapses healthy worlds by height, `virtual` past 40 rows |
| `WorldRow` | `world`, `counts`, `cost` | `expanded`, `collapsed`, `observed` tag `obs`, `selected` |
| `CraftRow` | `craft`, `selected` | From `visualState`. `attention` raises the row to `raised`. Hit area is the whole row |
| `StateMark` | `state`, `owned`, `size = 12` | One SVG per mark in section 6. Uses `currentColor` |
| `Designator` | `letter` | Greek in `designator` type. Flamsteed numbers past 24 |
| `WorkflowRow` | `workflow` | `running`, `closed`, `orphaned`. Shows counts, never a percent |
| `PadRow`, `DerelictRow` | `count` | Hidden at 0 |
| `Altimeter` | `craft[]`, `window` | World level. Log ruler with exact ticks |
| `Telemetry` | `craft` | Craft level. `owned`, `observed` |
| `Lineage` | `nodeId` | Tree. `linkedBy: 'inferred'` shows a dashed branch |
| `StandingGrants` | `grants` | Hidden when empty |

### 8.3 Right rail

| Component | Props | States |
|---|---|---|
| `Rail` | none | Fixed order from section 3.3. `NEEDS YOU` sticky |
| `DecisionRow` | `decision` | `new`, `waiting`, `danger`, `focused`, `answered-elsewhere`, `withdrawn`, `expired`, `cannot-answer` |
| `SourceRow` | `wait` | One state, no buttons. Names the owning window |
| `TroubleRow` | `node`, `tier` | `fault`, `retry`, `no-budget`, `parked`, `crashed`, `lost` |
| `LowRow` | `node` | Exact `812k of 1M used` |
| `LandedRow` | `world`, `lit`, `failed` | |
| `Channel` | `nodeId`, `width` | `structure`, `text` after `W`, `pinned`, `observed` per-response, `empty` |
| `ChannelRow` | `row` | `thinking`, `text`, `tool`, `tender`, `turn`, `error`. Sealed bars of true length |
| `FollowUp` | `craft` | `idle-queue`, `running-queue`, `sent`, `read-only` strip for observed, `disabled` when the kernel is lost |
| `Almanac` | `sentences` | Three sentences, `display` type, in the free rect at 0 craft |
| `AwayList` | `items` | `resume`, `salvage`, `review` |

### 8.4 Docket

| Component | Props | States |
|---|---|---|
| `Docket` | `decision`, `index`, `total` | `unfocused`, `arming` 350 ms, `armed`, `danger`, `wide`, `veiled`, `answered`. Holds a real focus trap while focused. `Esc` returns focus to where it was |
| `DocketBody` | `request` | `bash`, `write`, `edit`, `plan`, `question`, `mcp`, `other` |
| `ArmBar` | `armedAt` | Fills over 350 ms, then reads `armed` |
| `DecisionButtons` | `canAlways`, `danger`, `armed` | Disabled until armed. Each shows its key |
| `HoldButton` | `ms`, `onDone` | `idle`, `holding`, `done`. Used by Approve in danger, stop, All stop, trust. Pointer and keyboard alike |

### 8.5 Sheets and overlays

| Component | Props | States |
|---|---|---|
| `LaunchSheet` | `mode: 'craft' \| 'mission'` | `drafting`, `blocked` with a plain reason, `queued`, `launching` |
| `CommandLine` | `value`, `onParse` | Tokens underlined as parsed, unknown tokens in `slag` |
| `ParsedRows` | `parsed` | Each row editable |
| `Preflight` | `result` | `checking`, `ok`, `warn`, `blocked`. Shows `sources` and hooks. Loadout row only for trusted repos |
| `TrustHold` | `world` | Hold `Alt+T` 700 ms |
| `LedgerSheet` | none | `partial` while the usage index runs, with `ALMANAC 38 %` |
| `StatTile` | `label`, `value`, `note` | Value in `paper`, `est` in `slag` |
| `Meter` | `label`, `used`, `resets` | Fill `bone`, `halpha` past 80 %. Unfilled track `hairline`. Text carries the number |
| `RankedBars` | `rows` | Single hue `bone`, 12 px thick, 2 px gap, value at the tip, hover readout |
| `TableView` | `rows` | Every chart has one |
| `SkyStrip` | `days`, `selected` | Scrubber, `role="slider"`, arrow keys |
| `DayPanel` | `day` | Stats for the selected day |
| `FindPalette` | none | Fuzzy over worlds, craft, sessions, commands |
| `LawsDialog` | none | Modal, focus trapped |
| `SettingsSheet` | none | Boot full, short, off. Alert sound. Geiger. Notifications. Comfort rows. Quality auto or fixed. Scene on or off |
| `FirstFlight` | `step` | `notifications`, `sound`, `launch`, `done`, `skipped` |
| `Banner` | `kind` | `kernel-lost`, `scene-lost`, `limit`, `sensor`. `role="alert"` for the first two |

### 8.6 Scene adjuncts

| Component | Props | States |
|---|---|---|
| `LabelLayer` | none | 30 pooled nodes. One `useFrame` writes `transform`. Hidden on Plate only if the Plate draws its own |
| `LeaderLine` | `from`, `to` | One SVG path. `drawing` 180 ms, `shown`, `off` |
| `BootPlate` | `month` | Section 9.4 |
| `Plate` | none | SVG chart at 4 Hz. Same layout, same lens equation |
| `SceneMirror` | none | Visually hidden list of every craft, section 13 |
| `Announcer` | none | Polite and assertive live regions |
| `VeilTag`, `CinemaHud` | none | |

### 8.7 Store

Zustand 5, `subscribeWithSelector`, outside React. `import { create } from 'zustand'`.

| Slice | Holds |
|---|---|
| `fleet` | Worlds, sessions, agent nodes, workflows, keyed by id |
| `decisions` | Open requests by `requestId`, and waits at source |
| `plan` | Windows, `asOf`, status |
| `ledger` | Rollups from `usage.changed`, `history.digest` |
| `sky` | Digest rows, index progress |
| `view` | Level, selection, overlay, filter, veil, cinema, `Hud` |
| `scene` | Tier, cadence, context state. Written only by the scene |

---

## 9. Motion

### 9.1 Ownership

One library per property (`DS 2.6`). `useFrame` owns continuous values. GSAP owns camera and scripted beats. `motion/react` owns HUD enter and exit. CSS owns hover. With `frameloop="demand"`, every GSAP `onUpdate` calls `invalidate()`. Register the names below once with GSAP `CustomEase`, which ships in public `gsap` (`DS 3.2`) `[V]`, so canvas and DOM share them. Durations are starting values. `[U]`

### 9.2 Named easings

| Name | Curve | Duration | Used for |
|---|---:|---:|---|
| `relay` | none | 0 ms | Lamp on, state word flips |
| `filament` | `cubic-bezier(.1, .9, .2, 1)` | 240 ms | Lamp off, dim restores |
| `settle` | `cubic-bezier(.22, 1, .36, 1)` | 180 ms | HUD enter and move, view offset |
| `servo` | spring 170 / 26, no overshoot | about 500 ms | Numbers, meters, selection `[V]` settles in 506 ms |
| `coast` | linear | continuous | Owned orbit |
| `burn` | `cubic-bezier(.12, .8, .2, 1)` | gap to last flush, 600 to 2400 ms | Observed craft catching up |
| `halt` | `cubic-bezier(.2, 0, 0, 1)` | 120 ms | A craft stopping for a well |
| `wave` | linear radius, amplitude `1 - t * t` | 900 ms | Wavefront |
| `deepen` | `cubic-bezier(.45, 0, .55, 1)` | 1200 ms | A well forming |
| `lock` | `steps(3, end)` | 180 ms | Brackets closing |
| `fall` | `cubic-bezier(.55, 0, .9, .35)`, then `settle` | 900 ms, 260 ms on repeat | Camera into a well |
| `collapse` | `cubic-bezier(.7, 0, 1, .4)` | 180 ms | Ring into the hull |
| `snapback` | GSAP `elastic.out(1, 0.38)` | 700 ms | The sky rebounding |
| `dissolve` | linear | 600 ms | A cancelled approval |
| `tear` | spring 100 / 13.3 | 650 ms | Hoops opening. 6 % overshoot at 420 ms `[V]` |
| `ejection` | `cubic-bezier(.3, 0, .1, 1)` | real spawn time, about 1260 ms | Transfer arc |
| `slingshot` | `cubic-bezier(.7, 0, .12, 1)` | 1000 ms | Flights between worlds |
| `uncurl` | GSAP `expo.inOut` | 1100 ms | Unroll |
| `ignite` | `cubic-bezier(.16, 1, .3, 1)` | 180 ms | Drive lighting, a city light |
| `reentry` | `cubic-bezier(.6, .04, .98, .34)` | 1400 ms | De-orbit |
| `contact` | `cubic-bezier(.83, 0, .17, 1)` | 720 ms | The eclipse at boot |

**Three rules.** The camera never rolls. Bright flashes stay below three per second, so landings stagger. Cinema decays with repetition: a move repeated within 60 s plays at under a third of its length. Thirty approvals an hour never cost more than ten seconds of camera. `[V]`, arithmetic in the concept.

**Nothing blinks.** A lamp lights once and stays lit. Blinking is motion with no new information.

### 9.3 Transitions

| From | To | Move | Time |
|---|---|---|---|
| System | World | `slingshot` along a curve around bodies | 1000 ms |
| World | Craft | Chase drop behind the hull, limb rises | 800 ms |
| Craft or World | One level up | `Esc`: pull back along the same curve | 700 ms |
| World | World | Swing past the star, sliver sweeps the frame | 1100 ms |
| Any | Well | `fall`, optional, on `Enter` | 900 ms, 260 ms on repeat |
| Well | Previous | Rises after the answer, unless another well is open | 500 ms |
| Any | Launch | Scene stays, view offset `settle` | 180 ms |
| Any level | Sky | Light becomes ink: the Plate crossfades in, strip rises | 400 ms |
| World | Unroll | `uncurl`, camera tilts to top down | 1100 ms |
| Any | Cinema | Rails fade, canvas resizes at the end | 180 ms |

Rails and dockets never wait for the camera, and the camera never waits for them.

### 9.4 Boot: plate to life

The DOM is usable from the first frame, and the canvas loads lazily. Any key skips. An open decision skips at once. Frame one is the user's real month, which nobody can fake. Stars appear because the indexer found them, so the sequence reports real progress.

| Time | Visual | Really happening |
|---|---:|---|
| 0 ms | `BootPlate`: the month as ink on dim amber, worlds as ink rings, a pale sun disc. All lamps light for the lamp test. Rails paint | HUD painted. Plate drawn from the cached digest |
| 160 ms | First contact: a black disc touches the sun's edge and slides across with `contact`. Lamps release with `filament` | Kernel link open, snapshot arriving |
| 880 ms | Baily's beads: light breaks into points around the disc, **one bead per live session** | Live sessions known, from `sessions/` in under 1 ms (`RF 5.5`) `[V]` |
| 1100 ms | Diamond ring: one bead flares | First scene frame ready. If not, the plate holds here and the HUD works |
| 1200 ms | Totality: paper falls to `void`, ink turns to light, the same meridians now glow, the corona unfurls | Canvas crossfades in over 200 ms |
| 1400 ms | Worlds appear as silhouettes, limbs ignite, cities come on in a fast stagger | Main transcripts indexed, about 50 ms of work (`RF 5.4`) `[V]` |
| 1600 ms | Stars come out across the month, dusk in reverse | Worker indexing, about 4 s when cold, instant from cache `[V]` |
| 2000 ms | Sliver settles to the real window. Live craft are in place | Control returned |

The plate's paper is 4.1 % of white, so this is a dim page, not a flashbang. `[V]` arithmetic. It plays in full on the day's first open. After that a 400 ms crossfade. `boot: full, short, off` is a setting. Reduced motion cuts straight to the system.

**Kernel start** speaks the same language: `lost` craft appear frozen, the orphan sweep runs, and resume is offered only after it, because a resumed turn can re-run its last command (`AC 2.4`) `[V]`.

### 9.5 Hero moments

**The Bend.** Compare `naos-wave.png` and `naos-system.png`.

| Time | Scene | DOM and out of page |
|---|---|---|
| 0 ms | Craft `halt`, drive off | Rail row, `YOU` lamp `relay`, title, favicon, assertive announcement, notification if unfocused, `ping` if enabled. **All before any animation** |
| 0 to 900 ms | One wavefront crosses the free rect, sky only. Every meridian ripples, the crest catches light | |
| 0 to 1200 ms | `deepen`: ring closes, sky mirrored inside it | |
| After | `thetaE` grows with age. New wavefronts at 30 s, 2 min, 10 min. No blink, no pulse | Age ticks in `nad`. `ping` and notification repeat at 2 and 10 min |
| `Space` | Scene dims to 45 % except the ring, 180 ms. Brackets close with `lock`. Hairline draws from ring to docket | Docket opens with `settle`, focus enters, arm bar runs 350 ms |
| `Enter` instead | `fall` to the night side, optional | Same docket, same keys |
| Approve | Ring `collapse` into the hull. `snapback`: the whole sky rebounds in one elastic ripple, passing through flat. Drive `ignite`, craft moves on | `ok`. Next decision re-arms, or focus returns |
| Deny | Ring breaks outward in 240 ms, beam never fires, craft continues | `no` |
| Deny and stop | Ring cut, hull takes the interrupted slash | Focus to the follow-up box |
| Withdrawn | Ring `dissolve`, no rebound | Row reads `WITHDRAWN`, leaves |
| Expired | Ring hollow, fades | Row reads `EXPIRED` |
| Within 60 s of another | `deepen` in 300 ms, wave at half amplitude | Unchanged |

**The Salvo.** Compare `naos-salvo.png`. Opens at 3 launches under one parent within 1 s of `observedAt`, because journals have no timestamps (`RF 4.4`) `[V]`. Later launches join for 10 s. On launch gaps of p25 3 ms and p50 1.9 s, the 1 s rule catches 34 % of launches and 10 s catches 73 %. `[V]`, verdict. Launch time was taken from `.meta.json` creation, a proxy for `started`. `[U]` as an exact match.

| Time | Scene | DOM |
|---|---|---|
| 0 ms | Parent hull flares with `ignite`. Corona streamer toward that world jumps to full | Rows appear under the parent, `SALVO 5` tag. **At once** |
| 0 to 420 ms | One streak per agent, 48 ms apart, from the hull to its hoop or epicycle. 16 at most, then `+n` | `salvo` sound |
| 180 ms on | A new hoop opens with `tear`. Each arrival lands a spark and a bead | Tape: `SALVO wf_9c41 5 craft` |
| 420 ms on | Streamer decays over 1.2 s. **The sky stays rigid**, law 4 | |
| Each join | One more streak, for 10 s after the last launch | Count updates |
| Close | A spoke burns on today's meridian, for good | Spoke joins `history.digest` |

From an orchestrator the same event is the poster: the sungrazer fires transfer arcs across the whole system, one per world, in the real spawn time. Refused spawns arc back into the star.

**Other events.**

| Event | Sequence |
|---|---|
| Ejection | Filament lifts from the corona, `ejection` for the real spawn time, orbit insertion with a short burn |
| Landing | Retro tick, `reentry` streak, city light `ignite`, sky star at the now meridian |
| Meteor shower | A phase landing together, staggered 80 ms or more |
| Reboost | Drive flash, climb with `settle` |
| World wakes | Falls inward along its azimuth over 1.4 s, limb brightens |
| Unroll | Hoops peel at the pin and straighten into rows with `uncurl`. `Esc` is the exact reverse |
| Totality | Sliver thins to beads and goes, limbs fall to minimum, countdown on the disc |
| Diamond ring | One bead, full bloom for 300 ms, light returns to every world with `contact` |

Totality has a real trigger here: 109 rejected quota records, not 109 distinct events (`RF 7`) `[V]`. Behaviour at a live limit is unobserved. `[U]`

### 9.6 Sound

Synthesised in WebAudio, no sample files, no network. Nothing below 300 Hz, because thin laptop speakers would lose it. `[U]` Every sound is a signal, silence means nothing is happening, and sound is never the only channel for anything. While a well is open everything else ducks 6 dB.

| Name | Signal | Synthesis | Level | Switch |
|---|---|---|---:|---|
| `ping` | New answerable decision, repeats at 2 and 10 min | Partials 880 and 1320 Hz, 600 ms decay. Each repeat a fifth higher | -18 dB | Alert |
| `source` | Observed wait | One 660 Hz partial, 200 ms | -26 dB | Alert |
| `fault` | `FAULT` lamp on | Dry 80 ms buzz at 330 Hz | -24 dB | Alert |
| `tick` | `message.completed`, and `edit` tools an octave up | 2 ms noise click, high-passed at 2 kHz, level by log tokens, 30 a second at most | -36 dB | Geiger |
| `salvo` | Salvo opens | A 300 Hz thump, then one rising tick per agent, 12 ms apart | -22 dB | Geiger |
| `land` | Finish | Band-passed noise falling 3 to 1 kHz, 300 ms, staggered | -34 dB | Geiger |
| `ok` | Approved | Partials 1320 and 1980 Hz, 120 ms | -26 dB | Alert |
| `no` | Denied | 440 falling to 330 Hz, 120 ms | -26 dB | Alert |
| `dawn` | Window reset | Sines at 660, 990, 1320 Hz, 900 ms | -24 dB | Geiger |

The Geiger channel is the idea worth having: traffic becomes something you hear without looking, and silence starts to mean something. `AudioContext` starts on a user gesture. `[U]`

---

## 10. Signal mapping

From normalized event to visual and audio response. Types are `RF 9`, states `AC 5.1`, frames `AC 2`. Unknown record types and fields are counted, never fatal, and shown in `SENSOR`. A script checks that 148 names from those types all appear below. `[V]` That is a presence check: it proves each name has a row, not that the row is right.

**Lag classes.** `live`: Control plane frames (`AC 13`). `near`: pid file 22 to 162 ms, `api-request` 13 to 643 ms (`RF 0`, `RF 2.3`). `late`: transcript records, main up to 1.3 s, workflow agents up to 46 s (`RF 5.2`). `after`: known only once finished. All `[V]`. Tag `at` is used for position in time, `observedAt` for arrival, and `observedAt - at` drives `lag`.

### 10.1 Observed events

| Event | Lag | Visual | Audio |
|---|---|---|---|
| `session.discovered` | near | Observed: first light at its orbit. Owned: already flying | |
| `session.changed` | near | Label updates. A new `sessionId` on `/clear` keeps the hull and resets altitude. A new `cwd` changes a tag, the world stays | |
| `session.ended` | near | `clean`: re-entry, city light, sky star. `abandoned`: ember. `unknown`: as clean, hollow light. Reason `pid-recycled`: hull winks out, tag `pid reused` | `land`, or `fault` if abandoned |
| `activity.changed` | near | Section 10.2 | |
| `agent.started` | late | Tender launches or a bead joins its hoop. Counts toward a salvo, on `observedAt` | |
| `agent.ended` | late | Tender re-enters. Bead stops and lights an arc | `land` |
| `turn.started` | late | Uplink pulse on the hull by origin: `human` solid, `task_notification` dot, `peer` double, `sdk` small tick, `scheduled` hollow, `unknown` small tick. Open strings: `system` seen here `[V]` | |
| `turn.ended` | late | Drive cuts with a small puff. Tape tick with `stopReason` | |
| `request.started` | near | Drive lights. Comes from `api-request`, present since 2.1.300 (`RF 0`) `[V]`. A session on an older CLI, such as the PATH CLI 2.1.224, falls back to pid `busy` | |
| `message.completed` | late | Observed: `burn`, block ticks on the Tape. `model` updates the class | `tick` |
| `tool.started` | late | Beam on, by family and level | `tick` high for `edit` |
| `tool.finished` | late | Beam off. `isError`: tip flares, a spark. `decision: reject`: beam cut short, Tape tick | |
| `usage.changed` | late | Mass, numbers. `cost-state` swaps `est` for the settled number | |
| `workflow.changed` | late | Hoops and beads rebuild. Terminal status closes the armillary | |
| `compacted` | after | Reboost, tag `pre to post tokens`, `manual` or `auto` | |
| `api.retry` | late | Stutter, countdown arc, `attempt of maxRetries` | |
| `api.error` | late | Flameout, HTTP status on the tag, `FAULT` lamp | `fault` |
| `rate_limit.hit` | late | That craft is rate limited. A plan limit starts Totality, `LIMIT` lamp | `fault` |
| `tail.reset` | near | Tag `track reset`, `SENSOR` count | |

### 10.2 Activity, liveness, status

| Signal | Visual |
|---|---|
| Activity `starting` | Section 6.3 |
| `generating` | Section 6.1. `lastBlock` labels the Tape after the fact |
| `tool_running` | Section 6.1, one beam per open tool |
| `waiting` | Owned: the Bend. Observed: broken ring, debounced 400 ms, by `reason`: `permission prompt`, `input needed`, `sandbox request`, `worker request`, `dialog open`, or `unknown`, which shows `waiting` |
| `retrying` | Stutter with countdown |
| `compacting` | Owned only. No live signal exists for observed craft (`RF 3.5`) `[V]` |
| `idle` | Moored. With `backgroundShell`, a dim lance stays on |
| `interrupted` | Drive cuts, slash, Tape tick |
| `errored` | Flameout. Kind `rate_limit` shows `resetsAt` |
| `finished` | Re-entry, by `outcome` |
| Activity `unknown` | Outline hull, `slag`, `UNKNOWN` |
| Liveness `alive` | Beacon ticks on each 1 s probe, from `process.kill(pid, 0)` plus the pipe list, never `updatedAt` (`RF 0`) `[V]` |
| Liveness `dead` | Stale pid file: derelict. Never deleted by NAOS (`RF 2.4`) |
| Liveness `recycled` | After 2 ticks the hull winks out, tag `pid reused` |
| Liveness `foreign` | Off-world contact at the free rect edge |
| Liveness `unknown` | Beacon hollow |
| Pid `busy` | Backs `generating` or `tool_running`. Never trusted alone: it stayed `busy` for 30 minutes (`RF 2.3`) `[V]` |
| Pid `shell` | Moored with a dim lance |
| Pid `idle` | Moored, or flameout if the last record was an error |
| Pid `waiting` | As Activity `waiting` |
| Kind `interactive`, `bg`, `daemon`, `daemon-worker` | Tag at Craft level. `bg` adds a small B |
| Agent `running` | Bead or tender moving |
| Agent `completed` | Bead lit, city light |
| Agent `failed` | Red bead, ember |
| Agent `stopped` | Grey bead, no light |
| Agent `orphaned` | Derelict, `ORPHANED` |
| Agent `unknown` | Outline bead |
| Workflow `running` | Hoops open. Journal present, no state file, owner alive (`RF 0`) |
| Workflow `completed` | Hoops close, meteor shower, rings join the long exposure |
| Workflow `failed` | Hoops close in `halpha` |
| Workflow `killed` | Hoops close in `slag` |
| Workflow `orphaned` | Hoops left open and unlit, drifting. `RF 4.4` found one here `[V]` |
| `counts.retried` | Ghost bead with a second tick |
| `cached` | Shown only after the run ended |

### 10.3 Session fields

| Field | Visual |
|---|---|
| `contextTokens`, `contextWindow` | Altitude, Altimeter, `LOW` lamp at 80 %. No window known: hold mid orbit, tag `context unknown` |
| `queuedInputs` | Pods ahead of the hull, count on the row |
| `flushLagMs` | `lag` tag, `LAG MAX` in the bar |
| `cost` | Numbers, mass. `isEstimate` shows `est`, `isLowerBound` shows `+`. `partialOutputMessages` forces `+` (`RF 3.3`) |
| `model`, `requestedModel` | Class letter and tag |
| `effort`, `permissionMode` | Tag at Craft level |
| `gitBranch` | Tag. `HEAD` shows `detached` (`RF 3.3`) |
| `worktree` | Craft orbits a moon |
| `title`, `displayName`, `titleSource` | Row name. `lastPrompt` is never a fallback in default views |
| `agentCount`, `runningAgentCount` | Manifest counts |
| `lastRateLimit` | Tag at Craft level |
| `remoteControlled` | Antenna tick on the hull, tag `remote` |
| `acceptsPeerMessages` | Enables `send through broker`, a later phase (`RF 8`) |
| `entrypoint`, `version` | Tag at Craft level, open strings |
| `linkedBy` | `inferred` shows a dashed branch in Lineage |

### 10.4 Control plane

| State | Visual | Audio |
|---|---|---|
| `queued` | Sits on the Pad | |
| `spawning` | Ejection, transfer arc in flight | |
| `ready` | In orbit, no drive, no prompt yet | |
| `running` | Normal flight | |
| `awaiting_approval` | The Bend. A counter, not a flag, because requests can overlap across subagents (`AC 5.1`) `[V]` | `ping` |
| `idle` | Moored | |
| `parked` | Far holding orbit, hollow ring, `PARKED` | |
| `budget_exhausted` | Empty fuel arc, `NO BUDGET`, in `TROUBLE` | `fault` |
| `rate_limited` | Countdown from `resetsAt` | |
| `stopping` | Hull turned back, step label | |
| `exited` | Landed, resumable, city light with a small ring | `land` |
| `crashed` | Breakup, debris holds until acknowledged | `fault` |
| `lost` | Frozen, dashed outline | |
| `closed` | Row leaves, moon removed if it had one, light stays | |

| Frame | Visual |
|---|---|
| `text_delta` | `WRITE`, plume, Channel text if shown. `tps` from a 1 s sliding window, smoothed, because deltas burst (`AC 2.3`) `[V]` |
| `thinking_delta`, `system/thinking_tokens` | `THINK`, plume, token count. Without this a thinking agent looks stalled (`AC 2.3`) `[V]` |
| `signature_delta` | None |
| `message_delta` | Replaces the estimate with real `output_tokens` |
| `ttft_ms` | Tag at Craft level |
| `system/init` | Orbit insertion |
| `system/status` | Drive lights on `requesting` |
| `system/api_retry` | Stutter, never stalled |
| `system/task_started` | Tender launches, counts toward a salvo |
| `system/task_progress`, `system/task_updated` | Tender label, `last_tool_name` |
| `system/task_notification` | Tender lands |
| `system/permission_denied`, `permission_denials` | Tape tick, beam never fires |
| `result` | State from `terminal_reason`, never `subtype`. Ignore a result with `num_turns: 0` and no `user_message_uuid` (`AC 5.2`) `[V]` |
| `completed` | Moored |
| `aborted_streaming`, `aborted_tools` | Moored with an aborted tick |
| `max_turns` | Moored, row offers continue |
| `budget_exhausted` frame | Fuel out |
| `tool_deferred` | Parked |
| Unknown `terminal_reason` | Moored with an error badge (`AC 5.2`) |
| `total_cost_usd` | Numbers. Latest value, never summed (`AC 2.3`) |
| `modelUsage` | `contextWindow` for altitude scale |
| `subagent_stats` | Row counts, refused shown as fallback ticks |
| `command_lifecycle` | Pod `queued`, `started`, `completed`, `cancelled`. Useful, unstable |
| `rate_limit_event` | Sliver update, at each spawn |
| `PreToolUse` audit | Tape, including calls that never reach an approval |

### 10.5 Approvals and orchestration

| Signal | Visual | Audio |
|---|---|---|
| `approval.requested` | The Bend | `ping` |
| `approval.cancelled` | Ring dissolves, `WITHDRAWN` | |
| `approval.answer` | Collapse and rebound, or outward break | `ok`, `no` |
| Restart with pending approvals | Hollow ring, `EXPIRED`, fades | |
| `decisionReason`, `defaultToNo` | `halpha` ring, docket opens on Deny | |
| `permissionDecision`, `toolDenialKind` | Tape tick with `source` at Craft level | |
| `agent_spawn` | Ejection. Counts toward a salvo | `salvo` |
| `agent_spawn` refused | Fallback into the star, tag names the limit | |
| `agent_send` | Line to the target, uplink pulse of `peer` shape | |
| `agent_stop` | Retro burn | |
| `agent_wait` | Filament to the child, dim | |
| `agent_status`, `agent_list` | `mcp` beam to the star | |
| `salvo.opened`, `salvo.joined`, `salvo.closed` | Section 9.5 | `salvo` |

### 10.6 Fleet and kernel

| Signal | Lag | Visual | Audio |
|---|---|---|---|
| `five_hour.utilization` | minutes | Sliver thickness and colour, limb light, masthead with `AS OF`. Both scales normalised: 0 to 100 and 0 to 1 (`AC 6`) `[V]` | |
| `seven_day.utilization` | minutes | Masthead, Ledger | |
| `fetchedAtMs` | | `as of`. Rim arcs turn dashed after 10 min | |
| `allowed_warning` | live | Sliver turns `sliver-low`, note in the bar | |
| `rejected` | live | Totality, `LIMIT` lamp, admission frozen | `fault` |
| `resets_at` passes | | Diamond ring | `dawn` |
| `kernel.tick` | 1 Hz | Beacons. No tick for 2.5 s: `LINK` turns to `NO SIGNAL` | |
| `index.progress` | | Stars come out, `ALMANAC 38 %` in `SENSOR` | |
| Kernel link lost | | Section 12.3 | |
| `webglcontextlost` | | DOM banner, Plate, rebuild | |
| Transcript `ENOENT` by retention | | Star and city light go out | |
| Unknown records rising | | `SENSOR` lamp | |

**Deliberately no visual:** `api-request-blob`, `api-request-shape`, `atis-latch`, `mode`, `frame-link`, `file-history-snapshot`, `file-history-delta`, the artifact ledgers, and attachment subtypes outside `RF 3.2`. `[V]`

### 10.7 Every visual, back to its signal

If a visual is not here, it must not exist.

| Visual | Signal | | Visual | Signal |
|---|---|---|---|---|
| Disc | Kernel running | | Beam | One open tool call |
| Sliver, outer rim arc | Five hour window left | | Well, ring, lens, wavefront | A human can answer here, age is strength |
| Inner rim arc | Seven day window left | | Hollow ring | Parked or expired |
| Corona brightness | Fleet token rate | | Broken ring | A human must answer elsewhere |
| Corona streamers | Token load per world | | Streak | A launch |
| Corona flow | Fleet output tokens | | Burned spoke | One fan-out, for good |
| World size | Mass: 30 day spend, or bytes | | Transfer arc | A spawn in flight, or a draft |
| World position | Slot and recency | | Mote | Live tokens, selected craft |
| World limb light | Five hour window left | | Meteor | A finish |
| Moon | Worktree | | Pad | Admission queue |
| City light | One finished agent | | Debris | A crash not yet acknowledged |
| Ember | One failed or abandoned agent | | Derelict | Owner gone |
| Hull | One live session or agent | | Meridian | One day |
| Hull fill | Owned or observed | | Now meridian | Now |
| Altitude | Context used | | Horizon | Retention limit |
| Motion along the orbit | Tokens flowing | | Sky star | One transcript |
| Plume | Live rate, or a call in flight | | Dust | 64 KiB of transcript |
| Beacon | Liveness probe | | Long exposure arc | One craft of the last 24 hours |
| Pods | Queued prompts | | Filament, tether | Lineage, workflow owner |
| Hoop, bead, lit arc | Phase, agent, finished | | Bloom | No signal: it is how emission displays |

Static and owing no signal: the hairlines, the static dither, tilt under your own drag.

---

## 11. Performance

**Nothing here is measured on a GPU.** Every frame number is a target. `[U]` The MP/s figures are arithmetic on the operator judge's pass model, so they compare directly with the 606 and 70 in the verdict. `[V]` as arithmetic.

### 11.1 Cadence

The canvas renders only as fast as what is moving needs. `frameloop="demand"`, one scheduler, section 7.8.

| Cadence | Hz | When | On battery |
|---|---:|---|---:|
| `rest` | 0 | No live craft and nothing animating. Moored craft add two frames per `kernel.tick`, beacon on and beacon off | 0 |
| `drift` | 15 | Only observed craft live, no burn in flight | 10 |
| `cruise` | 30 | Any owned craft producing tokens, or any burn | 20 |
| `event` | 60 | Flight, Bend forming, wavefront, rebound, salvo, boot, landing. Holds 400 ms after the last | 30 |

Corona stops with `uTokenClock` at rest. Hidden tab: 0, resync from a snapshot on return, while title and notifications keep working. Link lost: 0.

### 11.2 Budget

| Viewport | Tier | Canvas | `drift` | `cruise` | `event` | Render targets |
|---|---|---|---:|---:|---:|---:|
| 1280 x 800 at 1.5 | Umbra | 1.21 MP | 74 | 148 | 287 MP/s | 34 MiB |
| | Corona | 0.88 MP | 53 | 104 | 204 | 25 MiB |
| | Penumbra | 0.59 MP | 36 | 70 | 138 | 17 MiB |
| 1920 x 1080 at 1 | Umbra | 1.29 MP | 79 | 157 | 305 | 36 MiB |
| 2560 x 1440 at 1 | Umbra | 2.47 MP | 151 | 302 | 585 | 69 MiB |
| | Corona | 1.79 MP | 109 | 211 | 416 | 50 MiB |
| | Penumbra | 1.21 MP | 74 | 143 | 282 | 34 MiB |

All `[V]`, arithmetic. References on the same model: the concept held 606 MP/s at 60 Hz whenever anything was active. CONN holds 70 sustained and 301 in transitions. On the attached panel NAOS is in CONN's class at native resolution, because the inset canvas is 1.21 MP where full bleed would be 2.30.

| Metric | Budget |
|---|---|
| Frame at `event` | 16.7 ms: GPU 8, main thread 4, compositor 1, reserve 3.7 `[U]` |
| Frame at `cruise` | 33.3 ms |
| Draw calls | About 28, ceiling 100 |
| Triangles | Under 25,000 at 20 agents |
| Sky redraw | 36,346 points, only when the camera moves |
| Live labels | 30 |
| Canvases, WebGL contexts | 1 |
| JS bundle | 1,700 KB, about 497 KB gzip with Drei (`DS 4.3`) `[V]`. Smaller here, not measured |
| Fonts | 128 KB `[V]` |
| First paint | Under 200 ms, HUD only. Canvas lazy loaded (`RF 5.5`) |
| Idle GPU | 0 at rest. Two small redraws per `kernel.tick` with moored craft |

### 11.3 Quality tiers

"Totality" is an event here, so the top tier is named Umbra.

| | Umbra | Corona | Penumbra | Plate |
|---|---|---|---|---|
| When | Default where the canvas is 1.3 MP or less | Default above that | Stepped down, or on battery | No WebGL2, software renderer, context lost twice in 10 min, or chosen |
| `dpr` | `devicePixelRatio` | 0.85 times it | 0.7 times it | none |
| Ceiling | 3 MP | 2 MP | 1.2 MP | |
| Bloom `levels` | 6 | 5 | 4 | none |
| Corona | full, 30 Hz | half, 15 Hz | half, 15 Hz | static SVG |
| Sky target | 1 | 0.75 | 0.5 | SVG |
| Motes | 1,024 | 512 | 256 | none |
| Cities | 8,192 | 8,192 | 4,096 | counts |

Tiers are multipliers, because a numeric `dpr` is absolute in R3F 9.8.2. `[V]` A `dpr` of 1 on this panel would upscale 1.5x. `uPxPerCss` keeps every line at its CSS width at any tier. Whether hairlines survive upscaling is `[U]`.

### 11.4 Automatic switching

`PerformanceMonitor` only calls back (`DS 2.8`) `[V]`, and rAF intervals cannot fall below vsync, so headroom cannot be read from them. Stepping up is therefore a probe.

| Rule | Value |
|---|---|
| Window | 30 frames, or one second at 60 Hz. Never mixes two cadences. Ignores 3 frames after any rest |
| Step down | p95 above 1.2 times budget in two windows in a row. At most one change per 10 s |
| Below Penumbra | Halve the cadence ceiling, 60 to 30 to 15 |
| Plate | At Penumbra and 15 Hz, p95 above 100 ms |
| Step up | 60 s on time at 30 Hz or more, 60 s since the last change. A step down within 30 s is a failed probe. Three failures end probing for the session |
| 15 Hz | Proves nothing, so never triggers a step up |
| Battery | `navigator.getBattery()`, if present: cap at Corona and use the battery column in 11.1 |
| Memory | Remember the tier per machine in `localStorage`, inside try/catch |

Simulated on six machine profiles. `[V]` A fast machine climbs Penumbra to Umbra at 61 s and 122 s. A very slow one falls to the Plate at 81 s, after stepping through every tier and cap. A healthy `drift`-only session never changes.

```ts
// Quality tiers, render cadence, and the automatic switch between tiers.
import type { Rect } from './layout';

export interface Tier {
  name: 'Umbra' | 'Corona' | 'Penumbra';
  /** Multiplier of devicePixelRatio, never an absolute dpr. */
  scale: number;
  /** Ceiling on the drawing buffer, megapixels. */
  maxMP: number;
  bloomLevels: number;
  coronaHz: number;
  skyScale: number;
  motes: number;
  cities: number;
}

export const TIERS: readonly Tier[] = [
  { name: 'Umbra', scale: 1, maxMP: 3, bloomLevels: 6, coronaHz: 30, skyScale: 1, motes: 1024, cities: 8192 },
  { name: 'Corona', scale: 0.85, maxMP: 2, bloomLevels: 5, coronaHz: 15, skyScale: 0.75, motes: 512, cities: 8192 },
  { name: 'Penumbra', scale: 0.7, maxMP: 1.2, bloomLevels: 4, coronaHz: 15, skyScale: 0.5, motes: 256, cities: 4096 },
];

/** R3F treats a numeric dpr as absolute, so derive it from the display. */
export const renderDpr = (t: Tier, free: Rect, devicePixelRatio: number): number =>
  Math.min(devicePixelRatio * t.scale, Math.sqrt((t.maxMP * 1e6) / (free.w * free.h)));

export type Cadence = 'rest' | 'drift' | 'cruise' | 'event';
export const CADENCE_HZ: Record<Cadence, number> = { rest: 0, drift: 15, cruise: 30, event: 60 };
export const BATTERY_CAP_HZ: Record<Cadence, number> = { rest: 0, drift: 10, cruise: 20, event: 30 };

/**
 * Picks the tier from measured frame intervals. Knows nothing about React or three.
 * Feed it the rAF delta of each frame the cadence driver asked for. It ignores the first 3 frames after any rest.
 * A vsync locked interval cannot fall below budget, so headroom cannot be read from it. Stepping up is a probe:
 * after 60 s on time it tries one tier higher, and a step down within 30 s counts as a failed probe. Three end the probing.
 */
export class TierMonitor {
  private samples: number[] = [];
  private lastChangeAt = -Infinity;
  private lastUpAt = -Infinity;
  private onTimeSince = -Infinity;
  private overBudget = 0;
  private skip = 3;
  private failedUps = 0;
  private hz = 0;
  private plated = false;
  private readonly onChange: (index: number) => void;
  private readonly onPlate: () => void;
  /** Ceiling the cadence driver obeys. Halves before the Plate is considered. */
  capHz = 60;
  index: number;

  constructor(start: number, onChange: (index: number) => void, onPlate: () => void) {
    this.index = start;
    this.onChange = onChange;
    this.onPlate = onPlate;
  }

  /** Call when the cadence falls to rest or the tab hides. */
  rest(): void { this.skip = 3; this.samples.length = 0; this.onTimeSince = -Infinity; }

  frame(dtMs: number, hz: number, now: number): void {
    if (hz <= 0 || this.plated) return;
    if (hz !== this.hz) { this.hz = hz; this.samples.length = 0; }    // never mix two cadences in one window
    if (this.skip > 0) { this.skip--; return; }
    this.samples.push(dtMs);
    if (this.samples.length < Math.max(30, hz)) return;               // 1 s at 30 and 60 Hz, 2 s at 15 Hz
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    this.samples.length = 0;
    const budget = 1000 / hz;
    if (p95 > budget * 1.2) {
      this.onTimeSince = -Infinity;
      if (++this.overBudget >= 2 && now - this.lastChangeAt >= 10_000) {
        this.overBudget = 0;
        this.lastChangeAt = now;
        if (this.index < TIERS.length - 1) {
          if (now - this.lastUpAt < 30_000) this.failedUps++;
          this.onChange(++this.index);
        } else if (this.capHz > 15) this.capHz /= 2;
        else if (p95 > 100) { this.plated = true; this.onPlate(); }
      }
      return;
    }
    this.overBudget = 0;
    if (hz < 30 || p95 > budget * 1.05) return;                       // 15 Hz proves nothing about a higher tier
    if (this.onTimeSince === -Infinity) this.onTimeSince = now;
    if (this.index > 0 && this.failedUps < 3 && now - this.onTimeSince >= 60_000 && now - this.lastChangeAt >= 60_000) {
      this.lastChangeAt = this.lastUpAt = now;
      this.onTimeSince = -Infinity;
      this.onChange(--this.index);
    }
  }
}
```

### 11.5 Measure first

Slice 0, before anything else. All scenes at 1280 x 800, device pixel ratio 1.5, the attached display, unless stated. Pass conditions are starting values. `[U]`

| Scene | Content | Pass | If it fails |
|---|---|---|---|
| `S0` | 0 craft, sky, corona frozen | Zero frames at rest | Fix the scheduler |
| `S20` | 20 craft, 5 worlds, 1 well, `cruise` | p95 under 33.3 ms at Umbra | Corona becomes the default |
| `S20e` | Same, flight, wavefront, rebound at `event` | p95 under 16.7 ms at Corona | `event` caps at 30 Hz |
| `S60` | 60 craft, 8 wells, 16 streak salvo | p95 under 33.3 ms at Corona | Penumbra becomes the default |
| `S120` | 120 craft, shoals | p95 under 33.3 ms at Penumbra | Lower caps |
| `W20` | `S20` at 2560 x 1440 | p95 under 33.3 ms at Corona | Only if a monitor is attached |
| `LOOK` | A/B of `FinishEffect` and AgX on the Arc, and 4 against 6 bloom levels | Sodium ring and black disc survive at Penumbra | If the look dies at 4 levels, stop and rethink. This is the cheapest moment to learn it |
| `LOSS` | `WEBGL_lose_context`, twice | Plate in under 1 s, DOM untouched, restore rebuilds | Fix before Layer 3 |

**Result, 2026-10-31, headless Edge on the Arc:** all pass, so **Umbra stays the default** at 1.21 MP. Numbers and caveats in `docs/bench/README.md`.

Read `gl.info.render`, frame intervals and `EXT_disjoint_timer_query_webgl2` if exposed. `[U]` whether it is.

### 11.6 Reduced motion

`prefers-reduced-motion` through `MotionConfig reducedMotion="user"` and `gsap.matchMedia()`. The information stays, the travel goes. Do not use `gsap.config({ nullTargetWarn: false })`, which the skills wrongly present as a motion switch. `[V]`

| Normal | Reduced |
|---|---|
| Boot | Cut to the system in 150 ms |
| Flights, dive | Cut with a 120 ms fade |
| Orbiting | Craft sit still, state by mark and label. Plumes hold their length |
| Plume dashes, pulses | Static |
| Well forming | Full strength at once, the sky is still bent |
| Wavefront | None. Lamp, row and notification carry the arrival |
| Rebound | Ring removed, sky returns in one 150 ms fade |
| Salvo | Hoop and beads appear, static spoke, no streaks |
| Landing | City light fades in |
| Unroll | 120 ms crossfade |
| Corona flow | Frozen |
| Tilt | Off |
| Lamps | Unchanged |

### 11.7 No WebGL

The canvas is never the only route to an action (`DS 2.1`). All ten jobs in section 3.5 are DOM.

The **Plate** replaces the canvas: a chart of the same system from the same `layout.ts`. Stars and dust are drawn once in Canvas 2D, the rest is SVG: disc with sliver gauge, worlds as circles, craft as marks on rings, 31 meridians as paths recomputed at 4 Hz with the same lens equation. So **law 4 survives without a GPU: the lines still bend.** `[U]` as a build. The wavefront does not exist on the Plate. Below 1024 px wide, or by choice, there is no scene at all.

**Detect at start:** no `webgl2` context, or `WEBGL_debug_renderer_info` reports SwiftShader or llvmpipe.

**Context loss.** R3F has no handler (`DS 2.8`) `[V]`. Listen on `gl.domElement`. On `webglcontextlost`: `preventDefault`, show the DOM banner, swap to the Plate. On restore: rebuild targets and re-upload attributes from their JS copies. Twice in 10 minutes: stay on the Plate until reload.

---

## 12. Empty, loading, error, scale

### 12.1 Empty

| State | Screen |
|---|---|
| **First run** | Globe with bare meridians, disc, sliver. `FirstFlight` in the free rect. Three steps: allow notifications, allow the alert sound, launch a test craft. `No history yet.` Nothing is faked |
| **First Flight** | One Haiku craft in a scratch folder, $0.02 cap, no settings, strict MCP. It is asked to write one file, so it raises one real approval, and the Bend fires on a real signal. A minimal agent cost $0.0003 (`AC 2.9`) `[V]`. The flow itself is `[U]` |
| **0 craft, with history** | The Almanac, section 12.4 |
| **World with no craft** | Limb, cities, long exposure, dossier, `L launch into this world` |
| **Empty search** | `Nothing here matches.` |
| **Observed only, no control plane** | Everything except the Bend works. Salvo is the hero |

### 12.2 Loading

| Stage | Time | Screen |
|---|---|---|
| Paint | Under 200 ms | HUD, Plate from cached digest if any |
| Live sessions | Under 1 ms of work `[V]` | Manifest rows, beads at boot |
| Main index | About 50 ms `[V]` | World rows with titles |
| Agent index | About 4 s when cold `[V]` | Stars fill in, `ALMANAC 12 %` in `SENSOR` |
| Usage index | About 42 s when cold `[V]`, low priority, cached by `(path, size, mtimeMs)` | Masses crossfade from bytes to spend over 1.2 s. Ledger shows `partial`. Nothing blocks |
| Canvas chunk | Lazy | Plate stays until the first scene frame |
| Channel history | On demand | Rows with `loading` at the end. Skeleton bars of `hairline`, no shimmer |

### 12.3 Errors and disconnection

| Condition | Screen | Controls |
|---|---|---|
| **Kernel link lost** | Beacons stop, scene freezes, 40 % desaturated. Masthead counts `NO SIGNAL 0:14`. Banner: `Kernel not responding` | Everything disabled, with the reason. Decisions read `cannot be answered now`. Retry at 1, 2, 4, 8 s, then every 10 s |
| Kernel not running at open | Plate from cache, caption `Kernel not running`, command `naos up` | Copy button |
| **Link back** | Snapshot, gap marked in the Tape | Re-enabled. Craft alive before show `LOST` until reconciled (`AC 5.3`) |
| Kernel restarted | `lost` craft frozen, approvals `EXPIRED`, sweep runs, then resume is offered | Resume only after the sweep |
| WebGL lost | Banner `Scene lost, recovering`, Plate | All work |
| Stale plan data | Dashed underline after 10 min, `as of 14 min` | |
| Admission closed | Launch states why in plain words, and can queue on request | |
| Spawn failed | Fallback arc, reason in the row. A missing `cwd` is checked before spawn, because its real error misleads (`AC 7`) `[V]` | |
| Second tab answered | `ANSWERED ELSEWHERE` | |
| Format changed | `SENSOR` lamp, unknown types counted | |
| Transcript gone | Star and light go out. `ENOENT` is normal (`RF 5.5`) | |
| Text fetch failed | Row keeps its sealed bar, `text unavailable` | |

### 12.4 The Almanac

Compare `docs/design/naos-idle.png`. Three sentences in `display` type at the foot of the free rect, built from counts with no model call. `Last night 16 craft landed on harbor.` `You held the fleet for 41 minutes today.` `88 % of the sun is showing.` World labels that collide with it hide. The right rail becomes `WHILE YOU WERE AWAY`: resume, salvage, review. Blocked time is exact for live sessions and marked `~` for history.

Motion at rest is the beacons, and at 0 craft nothing moves. The screen is a photograph of the last month, it costs nothing, and it is usually what you will see. Whether it holds up on the hundredth morning is `[U]`.

### 12.5 Scale

| Fleet | Scene | HUD | Cadence |
|---|---|---|---|
| **0** | Eclipse at rest, sliver wide, corona frozen, long exposures, cities | Almanac, away list, `L` | `rest` |
| **1** | One craft in full detail, its world drawn inward | One row, Channel open with no zoom | `drift` or `cruise` |
| **5** | All craft labelled by letter | Manifest rows fit, all with state words | `drift` or `cruise` |
| **20** | Labels only for waiting, failed, selected. Armillaries hold workflows as one object. Corona shows the split | Fits at 800 high with no scroll `[V]`, composite. Rails ordered by attention | `cruise` |
| **59** | The real peak here: 59 transcripts in one minute `[V]`. Most are workflow beads | Manifest per world, workflows as one row | `cruise` |
| **100+** | Vessels past 24 per world merge into a **shoal**: a density band on the altitude ring. Tenders become a count. Finished beads become a lit arc. Beams sample to 64 | Manifest virtualised, counts per world, `F` to find. Tape coalesces. Grouped by world when 8 or more wait | `cruise`, tier may step |

Decisions never aggregate. At any scale the path to a decision stays the same length, because authority does not scale.

| Thing | Cap | Past the cap |
|---|---:|---|
| Wells that bend | 8 | Newest, then oldest 7. The rail lists all |
| Labels | 30 | Attention order wins |
| Hulls and beads | 1,024 | Shoals |
| Beams | 64 | Newest win |
| Streaks per salvo | 16 | `+n` |
| Worlds with a slot | 32 | Outer worlds fold into a belt |

Real limits frame this: 16 concurrent agents and 1,000 per workflow run (`RF 4.4`) `[V]`, and starting limits of 6 running and 16 alive owned agents (`AC 12.3`), which are `[U]` there. So 100+ means many observed runs or a long queue.

---

## 13. Accessibility

Target WCAG 2.2 AA for the DOM. The scene is decorative to assistive technology, because it carries nothing the DOM lacks.

**Contrast.** All text tokens pass 4.5:1 on all three surfaces: worst is `slag` on `raised`, 5.27. `[V]` Rails sit on opaque `void`, so these are the real ratios, with no scrim to worst-case. Meaningful boundaries use `rule`, 3.75 or better. `hairline` is decorative only. Dark lamp legends are inactive by design, and their state is repeated in the rail. Hover and focus lift them to `bone`.

**Colour alone.** Every state has a mark, a word and a motion. `nad`, `halpha` and `oiii` separate under protan, deutan and tritan simulation. `[V]` Text on the `FAULT` lamp is `void`, 6.40.

**Keyboard.** Every job works from the keyboard, section 3.4.

| Topic | Rule |
|---|---|
| Tab | Never hijacked. Order: skip link, masthead, Manifest, Scene mirror, right rail, bottom strip |
| Skip link | First focusable: `Skip to decisions` |
| Lists | Manifest is `role="tree"` with roving tabindex: arrows move, `Enter` opens. Rail sections are lists of buttons |
| Hold actions | Every hold has a non-hold route: stop and All stop open a confirm dialog from a pointer click or a screen reader activation |
| Focus ring | `--focus`, 2 px `paper` plus a 1 px `void` offset, visible on every surface. `:focus-visible` only |
| Focus never moves by itself | A new decision does not take focus. `Space`, `Ctrl+.` or a click does |
| Docket | Focus trapped while focused. `Esc` returns to the previous element and decides nothing |
| Dialogs | Focus trap, `Esc`, focus return |
| Single keys | WCAG 2.1.4: a setting turns off all global single-letter keys, leaving `Ctrl+.` and native controls |
| Timing | Decisions have no timeout. The 350 ms arm delay is a safety measure, and a setting extends it to 1 s |

**Screen reader.**

| Element | Treatment |
|---|---|
| Canvas | `aria-hidden="true"` |
| `SceneMirror` | Visually hidden list of every craft, updated at 1 Hz: `kestrel beta, needs approval, 41 seconds`. Keeps a live count |
| Assertive region | Only new answerable decisions: `kestrel beta needs approval, Bash` |
| Polite region | Finished, failed, salvo, limit. Throttled to one per 4 s, coalesced: `3 agents finished` |
| Tape | `role="log"`, not live by default, so it stays quiet |
| Lamps | Buttons with a name and count: `Faults, 1` |
| Meters | `role="meter"` with `aria-valuetext`: `five hour window, 58 percent left` |
| `SkyStrip` | `role="slider"`, `aria-valuetext` with the date |
| Docket | `role="region"`, labelled by world and tool. Buttons announce their key through `aria-keyshortcuts`. The arm state is announced once |
| Marks | `aria-hidden`. The state word is the accessible text |
| Greek letters | `aria-label` spells the name: `beta` |

**Other preferences.**

| Preference | Response |
|---|---|
| `prefers-reduced-motion` | Section 11.6 |
| `forced-colors: active` | Marks use `currentColor`, lamps get system borders, the scene yields to the Plate in system colours |
| Browser zoom to 200 % | Viewport falls below 1024, Instrument mode. Nothing is lost |
| Comfort setting | Rows 24 px, body 14 px |

**Known gap.** Rows of 20 px sit below the 24 px target size of WCAG 2.5.8. Accepted for density at 20 craft. The Comfort setting and full keyboard operation are the alternatives.

---

## 14. Build order

The rule, from CONN: the operations path comes first and spectacle comes last, and nothing depends on spectacle. Each step ships alone. Efforts are one strong builder. `[U]`

Agents here may not launch GUI programs, so **Slice 0 needs the user once**: the page posts its numbers to the kernel, which writes `docs/bench/<date>.json`, so opening it is the whole task.

Build against a **fixture kernel** first: a small Node server that replays a scripted event stream over the same WebSocket: 20 agents on 5 worlds, with salvo, decision, retry, crash and landing scripted by time, placeholder names only. Every step below can then be built and tested with no live agents.

| Step | Contents | Ships as | Done when | Days |
|---|---|---|---|---:|
| **Slice 0: Proof** | `S0`, `S20`, `LOOK`, `LOSS` scenes on one page: lens, corona, disc, bloom, finish, synthetic sky | A bench page | Numbers recorded, default tier chosen, tone curve chosen | 2 |
| **Slice 1: The Instrument** | **The slice that must work first.** Kernel Observer plane to WebSocket to store. Masthead, lamps, Manifest, rail, Tape, Channel in structure mode, Find, Laws, keyboard, `J` `K`, attention order, screen reader, Plate, Veil, title badge, notification, Instrument mode | A complete read-only operator tool on real sessions, no WebGL | All observed sessions appear within 1 s. 20 fixture agents fit at 1280 x 800. Keyboard only works. Veil hides every name | 8 |
| **Slice 2: The Hand** | Control plane in the UI. Launch, Docket with arming, follow-up, stop, All stop, Standing grants, Ledger, First Flight, mission | Full operator product, still no WebGL | One real approval answered by key. Double tap cannot approve an unread call. Typing elsewhere cannot reach a card. Stop leaves no process | 7 |
| **Layer 3: The Eclipse** | Stage, cadence, tiers, context guard, Almanac Sky, disc, corona, rim arcs, worlds, cities, labels, System camera, Almanac, Sky view | The poster. Rails beside a living sky | `S0` and `LOOK` pass in the real app. Plate swap is seamless | 5 |
| **Layer 4: The Fleet** | Arc engine, hulls, plumes, wakes, beams, state language, World and Craft levels, flights, input always wins | All agents visible and moving | `S20` passes. Every row of section 6 is visible on fixtures. Any key ends any flight | 6 |
| **Layer 5: The Salvo** | Armillary, salvo rule, streaks, corona flare, burned spokes, sungrazer, transfer arcs | Observer hero | Fires on real fan-outs with no control plane | 3 |
| **Layer 6: The Bend** | Lens wells, wavefront, lock, leader line, rebound, dive | Control hero | `S20e` passes. Bent sky appears only for owned, answerable decisions | 4 |
| **Layer 7: The Rest of the Sky** | Boot plate to life, landings, meteor showers, reboost, Totality, Diamond ring, unroll, Day Reel, Cinema | Every clip-worthy moment | Boot under 2.4 s and skippable. Reduced motion table holds | 5 |
| **Layer 8: Sound** | All nine sounds, Geiger, ducking | Optional | Audible on the attached speakers `[U]` | 1 |

Total about 41 days. Veil ships in Slice 1, before the first shared clip, because the product's value is a clip people share and world names would leak private project names.

---

## Appendix A. What this asks of the kernel

`RF 9` and `AC 9.1` carry almost everything. These are the additions. All hold structure only, no message text.

| Addition | Why |
|---|---|
| `toolFamily` on `tool.started`, `tool.finished` | Beam shape, label. Open set, `other` is the fallback |
| `node.rate { tps, source }` at 4 Hz | Plume, corona, `WRITE 388/s` |
| `plan.changed { fiveHourLeft, sevenDayLeft, asOf, resetsAt, status }` | Sliver, masthead. Normalise both utilization scales |
| `kernel.tick` at 1 Hz | Beacons, dead man's switch |
| `salvo.opened`, `salvo.joined`, `salvo.closed` | Section 9.5. Times on `observedAt`, persisted for spokes |
| `history.digest { nodeId, projectRoot, kind, startedAt, endedAt, model, bytes, usd, outcome }` | Sky, cities, mass, Almanac. `usd` is null until the usage index ends |
| `index.progress { stage: 'stat' \| 'head' \| 'usage', done, total }` | Boot, `SENSOR`. Full parse in a low priority worker, cached by `(path, size, mtimeMs)`, skipping `api-request` lines by prefix |
| Engram rows, 12 bytes per tool call: time, node, class, flags, duration | Day Reel, Ledger. 61,824 rows take 725 KiB `[V]`, Golgi |
| `blockSizes` on `message.completed` | Sealed bars of true length. Not in `RF 9` today `[V]` |
| `contextWindow` for observed craft | Altitude. From `modelUsage` in spike frames, `cache/model-catalog` otherwise. 1,000,000 for every current model listed except haiku-4-5 `[V]`, verdict. Whether every session gets it is `[U]` |
| Waited-time accounting | `BLOCKED ON YOU`. Exact live, estimate `~` for history |
| `POST /preflight` | `resolveSettings({ cwd })`, cwd check, git check, admission state |
| `lastLoadout` per repo | Spawn-derived skills, MCP, context, trusted repos only |
| Text fetch per craft | `W`. Never part of the stream |
| `standing.changed` | Standing grants |
| `layout.json` | Slots, nudges per class, salt for Veil, under the NAOS data folder, never under `~/.claude` |
| `ui.presence { visible, focused }` from clients | Decides whether to raise a notification |
| `notify()` | Windows toast from the kernel. PowerShell with `Windows.UI.Notifications` is the first candidate, with `activationType="protocol"` opening `/open?docket=<requestId>`, which opens the app window on `/#docket=<requestId>`. `[U]` entirely |
| `POST /bench` | Writes Slice 0 numbers to `docs/bench/` |
| Fixture mode | `naos fixture <script>`, same WebSocket |

Rename the managed title prefix from `agentos:` to `naos:` in the dedupe contract (`AC 13`).

## Appendix B. Dependencies

Installed `--ignore-scripts` in a scratch project: 74 packages, one copy of `three`, no Drei, `stats-gl`, `detect-gpu` or troika. `[V]` All code in this document typechecks against it under TypeScript 6.0.3. `[V]` A production build and `npm audit` on this exact set have not run, though they did on the larger DS set. `[U]`

```text
ui/src/
  core/          laws.ts, layout.ts, tiers.ts, state.ts. Pure, unit tested in Node from the sample tables above
  store/         slices, selectors, the Veil, the WebSocket client
  hud/           the components of section 8
  scene/         Stage, passes, instanced layers, flight camera, labels
  scene/shaders/ the 22 files of section 7.6, imported with ?raw
  plate/         Plate and BootPlate, shared by boot, Sky and the no-WebGL path
  audio/         the sounds of section 9.6
```

```json
{
  "dependencies": {
    "@fontsource-variable/martian-mono": "5.3.0",
    "@fontsource/b612": "5.3.0",
    "@fontsource/cormorant": "5.3.0",
    "@fontsource/eb-garamond": "5.3.0",
    "@gsap/react": "2.1.2",
    "@react-three/fiber": "9.8.2",
    "@react-three/postprocessing": "3.2.2",
    "gsap": "3.15.0",
    "motion": "14.6.0",
    "postprocessing": "6.39.5",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "three": "0.186.1",
    "zustand": "5.0.16"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.3.3",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@types/three": "0.186.0",
    "@vitejs/plugin-react": "6.1.2",
    "tailwindcss": "4.3.3",
    "typescript": "6.0.3",
    "vite": "8.3.5"
  }
}
```

**Changes from `DS 4.1`.** Drei is gone: nothing here needs it, so none of its CDN defaults can fire, and the `stats-gl` override goes with it. If Drei ever returns, restore that override. Inter, Space Grotesk and JetBrains Mono are gone. Keep the pins: `three` stops at 0.186.1 because `postprocessing` caps at `< 0.187.0`. Fiber caps React at `< 19.4`. Vite config as in `DS 4.4`, unchanged. GSAP is not open source, so read its licence before any redistribution. `[U]`

`three` deprecates `Clock`. R3F still creates one, so expect a console warning, and use `delta` with your own accumulator (`DS 2.8`).

## Appendix C. Verification log

Run 2026-10-31 unless noted. Nothing was written outside the scratchpad and `docs/`. No transcript was opened, no credential or key file was read, and no GUI program was started. Scripts and outputs: `scratchpad/design/`.

| Check | Result | Status |
|---|---|---|
| Composite renders | `plate2.mjs` and `hud.mjs`: real fonts, final layout rules. No overflow at 1280 x 800, 1920 x 1080, 2560 x 1440, apart from one 2 px test limit at W | `[V]`, CPU only |
| Display, keyboard, battery | 1920 x 1200, 30 x 19 cm, 144 DPI, German layout 00000407, battery present, read from WMI and the registry | `[V]` |
| Fonts | cmap read from woff2 files with a small reader, sizes and families from the packages | `[V]` |
| `postprocessing` 6.39.5 | `Effect` defaults to `NORMAL`, `BloomEffect` to `SCREEN`, wrapper to `ADD` (`0`), `ENCODE_OUTPUT` and dithering run after `mainImage`, `levels` default 8 | `[V]`, read |
| `three` 0.186.1 | `GLSL3` drops the `pc_fragColor` define | `[V]`, read |
| `ResolvedSettings` | `effective`, `provenance`, `sources` only | `[V]`, read in `sdk.d.ts` |
| Dependency set | Resolves, 74 packages, one `three` | `[V]` |
| GLSL | 22 of 22 pass parser and glslang. A type error and a syntax error both fail | `[V]`, no GPU |
| TypeScript | `tsc --strict`, `noUncheckedIndexedAccess`, exit 0. Injected errors fail | `[V]`, types only |
| `visualState` | 20 cases, including observed craft never reporting thinking, and no alarm at 119 s | `[V]` |
| `placeWorlds` | 3,840 layouts, minimum gap 3.7 px. Found and fixed an overlap of 23 px | `[V]` |
| `TierMonitor` | Six machine profiles. Found and fixed a repeating Plate callback and an impossible step up | `[V]` |
| Palette | Validator and WCAG, section 5.1 | `[V]` |
| Wireframes | 9 views on a checked grid, all 160 x 50 | `[V]` |
| Mapping coverage | Script: every type, state, status and frame name in `RF 9`, `AC 5.1`, `AC 2` appears in section 10 | `[V]` |
| Anything on a GPU, in a browser, in motion, or with a person | Not done | `[U]` |

## Appendix D. Open questions

| # | Question | Who settles it |
|---|---|---|
| 1 | Does the Arc iGPU hold these budgets, and does the look survive it? | Slice 0, one page view by the user |
| 2 | Does an operator notice the wavefront in peripheral vision? | Real use. Rail, lamp and notification carry the alert either way |
| 3 | Does the Windows toast route work from the kernel, and can a click open the docket? | Slice 1 spike |
| 4 | Does every session really get a 1M context window? | Read `contextWindow` per session in Slice 1 |
| 5 | What happens at a real plan limit? No spike reached one (`AC 14`) | First real limit. Totality stays dark until then |
| 6 | Settled: app window, the user's choice. `--app` gives about 720 px of height against about 665. A Start menu entry opens it, see `docs/ARCHITECTURE.md`, App lifecycle | Done |
| 7 | Is `Ctrl+.` free in the user's browser? | Slice 1, with a settings fallback |
| 8 | Public release: trademark search, npm scope, GSAP licence, API keys instead of a Max login (`AC 1`) | Only if it is ever distributed |
| 9 | Does the idle screen hold up on the hundredth morning? | Time |
