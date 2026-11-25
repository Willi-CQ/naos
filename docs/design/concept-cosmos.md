# NAOS: the Living Cosmos concept

One of three independent UI concepts for the Agent OS. Angle: a living cosmos. Written 2026-10-31.

**How claims are marked.**

| Tag | Meaning |
|---|---|
| `[V]` | VERIFIED: I ran it, or read it in source, a report or a registry, in this session |
| `[U]` | UNVERIFIED: judgement, an estimate, or anything that needs a real GPU or a real person |

Design decisions are proposals, not claims, so they carry no tag unless they assert something testable. Nothing here ran in a browser or on the GPU, because GUI programs are off limits. Every statement about frame rate or live feel is `[U]`.

**Sources.** `RF` is `docs/research/runtime-formats.md`, `AC` is `docs/research/agent-control.md`, `DS` is `docs/research/design-skills.md`. A section number follows, such as `RF 3.5`.

**Look at these first.** A CPU port of the shaders in section 5 rendered three stills at 1920 x 1080. No GPU was involved. The sky in all three is this machine's real history, from file sizes and modification times only. No transcript was opened. Worlds and fleet are synthetic. `[V]`

| Still | Shows | Path |
|---|---|---|
| Hero | The Bend, seen from the night side | `scratchpad/cosmos/out/plate-dive.png` |
| Active | 20 agents on 5 worlds, two wells open | `scratchpad/cosmos/out/plate-active.png` |
| Idle | 0 agents, history only | `scratchpad/cosmos/out/plate-idle.png` |

---

## 1. Name, pitch and hero moment

### Name

**NAOS.** Command: `naos`.

- It reads **Native Agent OS**, the phrase in the brief. `[V]`
- Naos is also a real star, zeta Puppis. The name comes from a Greek word for ship, and the star sits in the old constellation of the ship Argo. It is a blue supergiant of about 40,000 K. `[V]`, web sources, secondary
- In Greek architecture a naos is a temple's inner chamber, the room that holds what matters. One source ties the star's word to this sense too. `[V]`, web source, secondary
- Four letters, no shift key, the same on QWERTY and QWERTZ. `[V]`
- It contains neither Claude nor Anthropic. `[V]`

**Collisions.** The unscoped npm name `naos` is taken by a one-maintainer Puppeteer monitoring CLI, last modified 2022-05-10. `[V]` That matters only if this is ever published, and then a scoped name solves it. A web search for NAOS with AI agents found NabaOS, AgentOS and AIOS, and no product called NAOS. `[V]` The closest name on GitHub is `getnao/nao`, an agentic BI tool, one letter away. `[V]` A trademark search was not done. `[U]`

**Wordmark.** `N A O S` in wide-tracked Cormorant Light, with the O drawn as a hairline ring and one bright bead at one o'clock: the diamond ring of an eclipse. The app icon is that O alone. It deliberately has no rays, because a radial starburst in warm orange is Anthropic's visual territory. The palette keeps away from it as well, see section 4.

### Pitch

> NAOS turns every agent on your machine into a craft in a living solar system, where spend is mass, altitude is remaining context, motion is tokens, and the only thing in the universe that can bend light is an agent that needs you.

### The single hero moment: the Bend

The sky in NAOS is rigid. Thirty day lines and every session you ran in the last month hang behind the system and never move.

Then an agent needs a human.

1. Its craft stops dead and its drive goes out.
2. Over 1.2 seconds the sky starts to bend around it. The day lines bow away from the hull, stars slide, and an Einstein ring closes around the craft. The sky behind the craft appears mirrored inside the ring.
3. No modal opens, no toast slides in, nothing blinks. A row appears in the rail at the same instant, so the fact is never hidden. You notice the bend from the far side of the system, in peripheral vision, because it is the only distortion that ever happens here.
4. The longer it waits, the deeper the well. The protocol has no timeout: "permission prompts have no park deadline" (`AC 2.2`). `[V]` Age is the only urgency that exists, so the sky shows age.
5. You press a key. The camera falls to the night side of the world and looks past the hull toward the eclipse. You answer with one more key.
6. The ring collapses into the hull, the whole sky rebounds in one elastic ripple, the drive relights, and the craft moves on.

This is the moment that belongs to this product alone, because the flashy effect is the signal. In the real universe mass bends light. Here mass bends nothing, and need does. An operator running 20 agents should never have to scan for what needs them, because the sky is already pointing at it. `[U]`

**The second moment: Claude prompts Claude.** When an orchestrator calls `agent_spawn`, a filament lifts off the corona and a new craft flies a transfer arc to its world, in the real time the spawn takes. Several at once make a salvo. This is the brief's new level, made visible.

**What a stranger sees in three seconds.** A black disc with a pearl corona, hairline crescents of black worlds covered in gold city lights, and a sky bent around a burning ring. That the stills earn "what the hell is that" is my judgement, not a test. `[U]`

### The seven laws

Everything in the scene obeys seven rules. They fit on the `?` overlay and take a few minutes to learn. `[U]`

| # | Law | Meaning |
|---|---|---|
| 1 | **Mass is spend** | A world's size is its spend in the retained 30 days |
| 2 | **Altitude is context** | A craft in low orbit is close to a full context window |
| 3 | **Motion is tokens** | Orbit progress and corona flow are odometers. Nothing moves unless tokens moved it |
| 4 | **Only need bends space** | Nothing else in this universe distorts the sky, not stars, not planets, not errors |
| 5 | **Light is late** | Observed craft are shown with their real signal delay, and say so |
| 6 | **Work leaves light** | Every finished agent becomes a city light (where) and a sky star (when) |
| 7 | **The sun is your quota** | The sliver of sun showing past the disc is what is left of the five hour window |

### Reading a craft without colour

State is carried by motion and shape first, so colour is redundant by construction.

| What you see | What it means |
|---|---|
| Moving, drive lit | The model is producing tokens |
| Still, drive lit | A model call is in flight on an observed craft, tokens have not reached disk yet |
| Still, beam on | A tool is running |
| Still, ring around it | It needs you |
| Still, dark, beacon ticking | Idle |
| Tumbling | A failure, or a retry with a countdown |
| Falling | Finished |

---

## 2. The metaphor

The whole product is an eclipse. The kernel is a small dark disc standing in front of a star. The star is the raw power of the model. The light that still gets past the disc lights everything else, and you run the fleet by that light.

Three observations from the research drove this, and each became part of the metaphor instead of a caveat:

- **Live per response, not per token.** Assistant blocks reach disk only when a response ends, and workflow agent records can be 46 s old (`RF 0`). `[V]` A dashboard has to hide this. A cosmos has a name for it: light delay, law 5.
- **The plan window is the real limit, not dollars** (`AC 6`). `[V]` So the most important limit is the sun itself, law 7.
- **Transcripts expire after 30 days** (`RF 1`). `[V]` So the observable universe has an edge.

**Owned and observed.** Everything below comes in two kinds. **Owned** craft belong to the control plane: NAOS spawned them through the SDK, and you can steer them. **Observed** craft are sessions NAOS only reads: you can watch them and nothing more (`RF 8`). `[V]` The word `foreign` is kept for its exact report meaning, `liveness: foreign`, a process on another host.

| | Owned | Observed |
|---|---|---|
| Hull | Filled | Outline |
| Motion | Continuous, per delta | A burn when a response lands, then still |
| Token wind | A steady stream | Bursts |
| Well | Closed ring, answerable here | Broken ring, answerable only in its own window |
| Delay tag | Hidden, it is near zero | `lag 11.6 s` at world and craft zoom |
| Arrival | Launched from the star | First light at its orbit, because nobody here launched it |

### 2.1 Entity map

| Entity | Object | Rule | Signal |
|---|---|---|---|
| **Project** | **World**: a black sphere with a hairline lit limb | Size from `spend30d`, log scale, because two stores hold 95 % of the bytes here `[V]`. Golden-angle slot assigned at first sight and never reassigned, so a world stays where you remember it. Distance from the star grows with days since activity. Worlds do not orbit: spatial memory beats realism. Spin speed follows token traffic | `projectRoot` (`RF 3.3`), `cost` |
| **Session** | **Vessel**: a kite hull in its world's orbital plane | Each world has one orbital plane, so altitude reads as plain radial distance. Altitude from `contextTokens / contextWindow`. Orbit progress from output tokens | `ObservedSession` (`RF 9`) |
| **Subagent** | **Tender**: a small dart on an epicycle around its parent | Depth is an epicycle on an epicycle. Nested agents are unverified (`RF 4.2`), so depth 2 uses `parentAgentId` first | `parentNodeId`, `spawnDepth`, `agentType` |
| **Workflow** | **Armillary**: tilted hoops around the world, tethered to the owning vessel | Built from `journal.jsonl`. The tether shows who launched it. When the state file appears, the hoops close and join the long exposure rings | `ObservedWorkflow` (`RF 4.4`) |
| **Workflow phase** | **Plane**: one hoop per distinct `started.phase`, in order of first appearance | A hoop exists only once an agent has started in it. There is no percent bar, because no total exists until the run ends (`RF 4.4`) `[V]` | `started.phase`, `ObservedWorkflowPhase` |
| **Workflow agent** | **Bead** on its hoop | A running bead moves. A finished bead stops and lights an arc of the hoop. A retry (same `key`, new `agentId`) leaves a hollow ghost and launches a new bead with a second tick. A cached result appears already lit | journal `started`, `result`, `failed`, `workflowProgress[].cached` |
| **Tool call** | **Beam** from hull to surface | Shape by class, table in 2.2. On for as long as the call is open | `tool.started`, `tool.finished` |
| **Approval request** | **Well**, and the event is **the Bend** | Lensing strength from age. Up to 8 wells bend at once. Details in 2.3 | `approval.requested`, pid `waiting` |
| **Token stream** | **Motes**, **drive plume**, **corona streamers** | One mote per 10 tokens flows from the star to the craft. The plume length is the live rate. The corona is a polar chart of where tokens are going right now | `text_delta`, `thinking_tokens`, `message.completed` |
| **Cost** | **Mass**, **trail**, **fuel** | Spend condenses into world size. Trail length is spend per minute. Fuel is budget left on owned craft. Every printed number is labelled `est`, and a lower bound gets a `+` | `CostEstimate` (`RF 9`), `maxBudgetUsd` |
| **Error** | Tiered, table in 2.4 | | `isError`, `api.error`, `crashed` |
| **Idle** | **Moored**: engine off, beacon ticking on the 1 s liveness probe | The blink is the real probe, so a moored craft proves it is alive | pid `idle`, `process.kill(pid, 0)` |
| **Finished** | **Re-entry**, then a **city light** and a **sky star** | A streak across the limb, one light on the surface, one star at the now meridian. A workflow that finishes together is a meteor shower | `session.ended`, `agent.ended` |

### 2.2 Beam classes

Tool names come from `AC 8`. `[V]` Unknown tools fall to `ping`, because parsers must ignore what they do not know (`RF` header).

| Class | Tools | Shape |
|---|---|---|
| `scan` | Read, Glob, Grep | Wide pale cone sweeping the surface |
| `strike` | Edit, Write, NotebookEdit | Thin hot lance, leaves a 10 s ember at the hashed folder |
| `drill` | Bash, PowerShell | Dashed lance |
| `outbound` | WebFetch, WebSearch | Lance pointing off the world into the sky |
| `relay` | any `mcp__*` tool | Arc to a tick on the limb, or to the star for `mcp__os__*` |
| `launch` | Agent, Task, Workflow | No beam: it launches a tender or an armillary |
| `tight beam` | SendMessage | Line from craft to craft |
| `ping` | everything else | 120 ms tick at the hull |

For observed craft, one flush can hold several tool calls together with their results (`RF 5.2`). `[V]` Those beams replay as a fast stagger, 120 ms apart, at most 8 per flush, then a `+n` tag. They are labelled as replay at craft zoom, never presented as live.

### 2.3 Wells in detail

- **Strength.** `thetaE(age) = 56 * (1 + 0.4 * log2(1 + age / 30))` px at 1080p, capped at 200, scaled by height. At 1440p that gives 75 px at 0 s, 148 px at 134 s, 206 px at 10 min, capped at 267 px. `[V]`, arithmetic
- **Reach.** Deflection falls as `thetaE^2 / r`. A well 134 s old moves the sky 24 px at 900 px away and 12 px at 1800 px, so it is visible across a 1440p screen. `[V]`, arithmetic. The bend is plain in the Active still at this strength, but whether a working operator reads it as "the sky is pointing at something" is `[U]`.
- **Owned.** Immediate on `canUseTool`. Closed ring, keys work.
- **Observed.** From pid `status: waiting`, debounced 400 ms. An SDK session was seen in `waiting` for 175 ms (`RF 2.3`) `[V]`, and that must not warp the sky. Broken ring, 60 % strength, no keys, because nothing outside a session can answer its prompt (`RF 8`). `[V]` The docket says which window owns it.
- **Attribution.** An observed well sits on the vessel, not a tender: the pid file does not say which subagent asked (`RF 3.5`). `[V]`
- **Danger.** `decisionReason: "Path is outside allowed working directories"` turns the ring H-alpha and opens the docket on deny (`AC 9.2`). `defaultToNo` opens on deny too. `suppressAlwaysAllowRule` hides the always options.
- **Serial calls.** Approvals inside one agent are serial (`AC 2.2`). `[V]` After an answer the ring reforms at once for the next call and the docket says `call 2 of 2`.
- **Over the cap.** With more than 8 wells, the 8 oldest bend. The rail still lists all of them.

### 2.4 Failure tiers

| Severity | Signal | Object | What the operator does |
|---|---|---|---|
| Spark | `tool.finished` with `isError` | Beam tip flares H-alpha, one tick on the tape | Nothing, the model handles it |
| Stutter | `api.retry`, `retrying` | Drive flickers, hull tilts, a countdown arc shows `retryInMs` | Nothing, it recovers. Never called stalled |
| Long silence | `generating` with no flush for over 120 s | Dim hazard tick, label `no signal 2 min` | Look. No alarm under 120 s (`RF 0`) `[V]` |
| Flameout | `errored`, `api.error` | Drive dead, slow tumble, H-alpha hull | Read the error, resend |
| Fuel out | `budget_exhausted` | Dark coast, empty fuel arc | Resume with more budget |
| Breakup | `crashed` | Hull breaks into debris that stays on the orbit until acknowledged | Sweep, then resume |
| Derelict | `orphaned`, dead pid with stale file | Unlit hull, drifting off its orbit | Salvage: resume, or dismiss |
| Signal lost | `lost` after a kernel restart | Hull shown as static, pending approvals expire | Reconcile, then resume |
| Hard landing | `session.ended` with `abandoned`, `agent.ended` with `failed` | Red ember crater, not a city light | Open it from the world |

### 2.5 The rest of the system

| Entity | Object | Rule | Signal |
|---|---|---|---|
| Kernel | **The Disc** | Always there while the daemon runs. If the link drops, sweeps stop and the HUD says `no signal` | WebSocket link |
| Orchestrator | **The Eclipse**, with a **Sungrazer** in its corona | The orchestrator is the star of the system. An orchestrator profile agent has no world of its own, so it flies a tight orbit inside the corona and spawns from there | profile with `mcp__os__*` (`AC 8`) |
| Claude prompts Claude | **Ejection** | `agent_spawn` lifts a filament from the corona. The craft flies a transfer arc to its world. Flight time is the real cold start, about 1.26 s (`AC 2.1`) `[V]` | `agent_spawn`, `query()`, `system/init` |
| Refused spawn | **Fallback**: the ejection arcs back into the star | The tag names the limit | `refused: depth limit`, `subagent_stats.refused` |
| Plan window | **The Sliver** | Eclipse magnitude follows the window. The whole system dims with it | `cachedUsageUtilization`, `rate_limit_event` |
| Limit reached | **Totality** | Sliver gone, limbs at minimum, countdown on the disc | `rejected`, `rate_limit.hit`, `resetsAt` |
| Window reset | **Diamond ring** | One bead flares on the limb, and light returns to every world | `resets_at` passes |
| Worktree | **Moon** of its world | An isolated checkout is a separate body. Worktree craft orbit the moon, not the planet | `worktree`, `worktreePath`, `worktreeBranch` |
| Admission queue | **The Pad**: a holding ring close to the star | Craft waiting for a slot sit here, unlaunched | `queued` (`AC 5.1`) |
| Queued prompts | **Pods** ahead of the hull | One pod per pending prompt | `queuedInputs` (`RF 3.6`) |
| Compaction | **Reboost** | Altitude jumps from low to high with a short flash. Observed craft show it after the fact, as the report demands | `compacted`, `preTokens`, `postTokens` |
| Lineage | **Filament** | Shown only for the selected craft, so it never clutters | `parentNodeId`, `parentAgentId` |
| History | **The Almanac Sky** | Section 5, H6 | transcript stats |
| Retention | **The Horizon** | The 30 day meridian is the edge of the observable universe. Stars thin toward it and go out when the file is deleted | `cleanupPeriodDays` (`RF 1`) |
| Delay | **Light lag** | Tag at zoom, plus a ghost at the last confirmed position | `flushLagMs` (`RF 9`) |
| Other host | **Off-world contact** at the system edge | No liveness check possible (`RF 2.4`) | `liveness: foreign` |
| No project | **Rogue body** at the edge | A session outside any repo and without a root | `projectRoot: null` |

---

## 3. Wireframes

All five are 116 columns. They were built on a character canvas, and the meridians in the sketches are displaced with the same lens equation the shader uses. World names, costs and message text are placeholders, not user data.

### 3.1 Overview: 20 agents across 5 worlds

```text
+------------------------------------------------------------------------------------------------------------------+
| N A O S   Fri 30 Oct  14:06:31          SUN LEFT  5h 58 %   7d 82 %   as of 14:02   lag max 11.6 s     ? laws    |
+------------------------------------------------------------------------------------------------------------------+
| MANIFEST                  m| :     :      :     :     : 3 harbor  $640   :     :    | NEEDS YOU                 2|
| 1 kestrel  ****^  !   $4.20| :     :      :     :     :     :     .:.....:..   :    | > 02:14  kestrel β         |
| 2 tundra   ******     $1.10|       :      :     :     :     :  ...:....... ... :    |   Bash, approval           |
| 3 harbor   ===== 11   $5.30|      :       :     :     :     : .oo...ooooo...oo.:    |   a approve  d deny        |
| 4 mosaic   **!        $0.70|      :       :     :     :     :ooo::         ..oo:o   |   ret  open docket         |
| 5 lumen    *^ (obs)   $0.10| 5 lumen  $3  :     :     :     : . ##         .. .:o   |                            |
|                            |     :  *******:     :    : [D] :ooo##         :: o:o   |   00:41  lumen γ  observed |
| HELD AT THE PAD           0|  ..:##*       *[C]  :    :     : .oo###ooooo###oo. :   |   permission prompt        |
| DERELICT                  1|  .. ##*:  x   *     :    :     :  ...:####### ...  :   |   answer in its own window |
|   tundra run, owner gone   |  ..:##*      **      .   |   . :     :......:..    :   |                            |
|                            |     :  ******   \     \  |  /     /  :      :      :   | TROUBLE                   1|
| FLEET                      |     :        .    \    \ | /    /   :       :       :  |   mosaic δ  retry 3 of 10  |
| alive 21     running 14    |      :         `.   `.  \|/  .`=====>>      :       :  |   next try in 8 s          |
| needs you 2  failed 1      |      :      :     #########  :     :         :       : |                            |
|                            |      :      :   ###       ###:    :    *******:*       | LOW ORBIT                 1|
| keys                       |      :<=====  :::           ###  :   **:       ***     |   tundra α  9 % context    |
| spc  attend oldest         |      :     :  ::  THE DISC   ##  :  *:           **    |                            |
| 1-9  go to world           |      :     :  ..   kernel    ## :  *:  :          **   | LANDED, LAST HOUR        12|
| tab  next craft            |      :     :  ..     [A]     :: [B]*      <β>    : :   |   harbor  11 lit, 1 failed |
| L    launch                |   [G]:     :  ...           :::    *:  :        : **   |   kestrel  1 lit           |
| T    sky, 30 days          |      :     :    ...       ...   :   *:           **    |                            |
| /    find                  | :    :     :     :......... :   ===> [F]   :   ***     |                            |
|                            | :     :    :     :     :    :     :    *******:*     : |                            |
|                            | :     :        .`   .`  /|\  `.   `.        :        : |                            |
|                            | :     :      .    /    / | \    \  :        :       :  |                            |
|                            | :   ::###       /     /  |  \     \ :   #######     :  |                            |
|                            | :   .. ##   :     :    :      :     :.###.....:::. :   |                            |
|                            | :   ...::   :     :   #####   :  ...:##         ..γ:.. |                            |
|                            | :     :     :     : ##     ## :  α>  ##         .. : . |                            |
|                            | :4 mosaic  $11    : ::     :: :  ....##         ..:... |                            |
|                            | :     :     :     : ..     .. :     .::::.........:[E] |                            |
|                            | :     :     :     :   .....   :      :  .......   :    |                            |
|                            | :     :     : 2 tundra  $51    :   1 kestrel  $412:    |                            |
+------------------------------------------------------------------------------------------------------------------+
| EPHEMERIS   1,840 tok/s est   $3.20/h est   today $11.40 est   window resets 17:40   owned 4 of 6 running        |
| sky  |....|....|.::.|.||.|....|..:.|.||:|....|.::.|....|..|  30 days, one tick per day, height is work done      |
+------------------------------------------------------------------------------------------------------------------+
```

- **[A] The Eclipse.** Black disc, sliver of sun at one o'clock, corona streamers (`===>`) reaching toward the worlds that are drawing tokens now.
- **[B] Closed well.** Owned craft `β` needs approval. The meridians bow around it. It can be answered here.
- **[C] Broken well.** Observed craft, 60 % strength, read only.
- **[D] Armillary.** A running workflow on `harbor`: hoops are phases, beads are agents.
- **[E] Long exposure.** Faint arcs left by craft of the last 24 hours.
- **[F] Token wind.** Motes on a bowed path from star to world.
- **[G] A meridian.** One per day, on a stereographic sky. The bottom strip is the same 30 days as a flat index, with `T` to scrub.

The Manifest is one row per world, with a tick per craft: `*` running, `^` needs you, `!` failed, `=` armillary beads. `m` expands it to one row per craft. It is real DOM and works with no canvas at all.

**Why 20 agents across 5 worlds stay readable.** Three channels at falling speed answer three questions. The sky answers "does anything need me?" before you look at it. The rails answer "which one, and what is wrong?", ordered by attention. The Manifest answers "what is everything doing?", always one key away. At overview only world names, waiting craft and failed craft carry labels, and a whole workflow is one object.

### 3.2 Zoom into a project

```text
+------------------------------------------------------------------------------------------------------------------+
| N A O S  >  kestrel                       SUN LEFT  5h 58 %                       esc  back to system            |
+------------------------------------------------------------------------------------------------------------------+
| ALTIMETER             | :      :       :       :      :      :      :      :      | kestrel                    1 |
| context left          | :      :      :        :       :     :      :      :      | C:/dev/kestrel  git  main    |
|                       | :      :      :         :      :     :      moon agent/q7 |                              |
|                       | :     :      :********* :      :      :     : ...:....... | MASS     $412 est, 30 days   |
| 100 |                 | :     :     :*        **[N]    :      :    .:..##     ....| TODAY    $11.40 est          |
|     |                 | :     :    **   :    :  **     :      :    .:  ##     ..  | LIGHTS   492, 18 failed      |
|  90 |                 | :     :    :     <δ>     *: o o:o     :    .:..##     ....| MOONS    1 worktree          |
|     |                 | :     :    **   :    :o o*     :  o o :     : ...####:.[L]|                              |
|  80 | α ------        | :     :     :*      ....###########...:     :      :      | CRAFT    5, 2 tenders        |
|     |                 |tether- - -   :......####           #:::.....:      :      |                              |
|  70 |                 | :      :  ....:  ####.................::::  :..... :      | ARMILLARY  repo-audit  live  |
|     |                 | :      :..   .:.##.......................::.:.   ..:      | plane 1  survey    6  ===== !|
|  60 | β ----- [H]     | :    ..:  ... .##.       .  .. .         ...: ...  :..α>  | plane 2  verify    6  =>>>>> |
|     |                 | :   .  :..ε...##        .. ...  . .        ........: ...  | plane 3  report    3  >>>    |
|  50 |                 | :  .   :. .. ##          ....   ..          .. .. .:   .  | retried 1   open 8           |
|     |                 | : .   ..:..  ##               . ....        ..  .. :.   . | no total until the run ends  |
|  40 | γ --            |  :.   . :.   ##        [I] lights      *    ..   . :.   . |                              |
|     |                 |  :.   ..:..  ##                         \   [K] .. :.   . | tokens 412k   tools 318      |
|  30 |                 |  t .   .: .. ##                          \  .. ..  :   .  | est $2.10, lower bound       |
|     |                 |  :  β>  :. ...##                          |........: ...  |                              |
|  20 |                 |  :   .. : ... .##.                       ...: ...  :..    | tab  next craft              |
|     |                 |  :     t:.   ..:::..........................γ.   ..:      | ret  open channel            |
|  10 | ε -  low orbit  |  [J]    : .... : ::::.....................  :..... :      | L    launch into this world  |
|     |                 |  :      :     .:....:::.           .........:      :      |                              |
|   0 | == atmosphere   |  :      :      :    ..:..............:.     :      :      |                              |
|                       |  :      :      :     o:o     :      o:      :      :      |                              |
|                       |  :      :      :   [M] plane 2  o o  :      :      :      |                              |
|                       |  :      :      :      :      :      :       :      :      |                              |
|                       |  :      :      :      :      :      :       :      :      |                              |
|                       |  :      :      :      :      :      :      :       :      |                              |
+------------------------------------------------------------------------------------------------------------------+
| tape  09:12 lit  09:14 lit  09:15 Edit  09:15 reboost  09:16 lit  09:17 well opened  09:18 failed  09:19 lit     |
+------------------------------------------------------------------------------------------------------------------+
```

- **[H] Altimeter.** The same altitude as the scene, as a ruler, so context pressure is exact.
- **[I] City lights.** One per finished agent, clustered by hashed folder.
- **[J] Tenders** on epicycles around `β`.
- **[K] Beam** from `γ` to the surface.
- **[L] Moon.** A worktree, with its own craft `ζ`.
- **[M] Armillary** hoops opened up. Beads get labels on hover.
- **[N] Well.** Still bending the sky at this zoom.

The right rail gives the phases as counts, never a percentage, and says why. `tab` walks craft in order of attention.

### 3.3 Zoom into one agent, live stream

```text
+------------------------------------------------------------------------------------------------------------------+
| N A O S  >  kestrel  >  β             owned   live link             P  veil text          esc  back to world     |
+------------------------------------------------------------------------------------------------------------------+
| β  fix-flaky-queue        |  :     :     :     :     :    | CHANNEL                               text shown     |
| sonnet-5-5   class G      |  :     :     :     :     :    |                                                      |
| effort low   mode default |  :     :     :     :     :    | 14:05:58  turn 7      from you                       |
| branch agent/q7   moon    |  :     :     :     :     :    | 14:06:01  thinking    ~410 tokens, text hidden       |
|                           |  :     :     :     :     :    | 14:06:04  text        The flaky test waits on a      |
| ORBIT   62 % context left |    [O]  ______     :     :    |                       timer that the fake clock      |
|         74k of 200k       |        /      \>>> plume :    |                       never advances, so the         |
| DRIVE   388 tok/s est     |        \______/    :     :    |                       retry path races the           |
| FUEL    $0.42 of $2.00    |        filled hull: owned:    |                       assertion.                     |
|         soft cap          |  :     :     :     :     :    | 14:06:06  Read        src/queue/timer.ts   0.2 s     |
| TURN    7                 |  : Bash lance [P]  :     :    | 14:06:07  Grep        useFakeTimers        0.1 s     |
| TOOLS   31, 1 failed      |  :     :  |  :     :     :    | 14:06:09  Edit        src/queue/timer.ts   +4 -2     |
| QUEUED  0                 |  :     :  |  :     :     :    |                       approved, this session         |
| LAG     0, live link      |  :     :  |  :     :     :    | 14:06:11  Bash        npm test -- queue    12.4 s    |
|                           |  :     :  |  :     :     :    |                       running  ......                |
| LINEAGE                   |  :     :  *  :     :     :    | 14:06:12  tender t2   Explore started                |
| kernel > sungrazer > β    |  :     :     :     :     :    |                                                      |
|   tender t1  Explore      |  :     :     :     :     :    |                       generating_                    |
|   tender t2  running      |  :     :#############    :    |                                                      |
|                           |  :  ####     :     : ####:    | tape  |tt|xxx|T|T|E|B========|  blocks of turn 7     |
| observed craft show here: |  . . city lights below . .##  |       t thinking  x text  T tool  B running now      |
| READ ONLY   lag 11.6 s    |##   ..   .  ...    .   . :  ##|                                                      |
| no send, no stop          |   ...     ..    ..  .  ..:    |                                                      |
|                           |  :     :     :     :     :    |                                                      |
|                           |  eclipse past the limb   :    |                                                      |
|                           |  sky stays behind hull   :    |                                                      |
|                           |  :     :     :     :     :    |                                                      |
|                           |  :     :     :     :     :    |                                                      |
|                           |  :     :     :     :     :    |                                                      |
+------------------------------------------------------------------------------------------------------------------+
| > follow-up, queued until the turn ends_                                                                         |
| ret  queue     ctrl+ret  now, interrupts the turn     . hold  stop     f  fork     m  moon     b  budget         |
| stop runs: interrupt, end of input, then taskkill /T /F as a last resort. the hull shows each step.              |
+------------------------------------------------------------------------------------------------------------------+
```

- **[O] Hull.** Filled, so owned. The camera chases it above the limb with the sky always in frame.
- **[P] Beam.** The current tool, in its class shape.

The channel is structure by default, and text only on purpose. Opening it is the explicit on-demand fetch the reports require, and `P` veils text for screen sharing (`RF 9`). `[V]` Thinking shows an estimated token count and no text, because thinking is hidden (`AC 2.3`). `[V]` For an observed craft the same panel shows per-response records, `generating` while a call is in flight, block types after the fact, and a `READ ONLY` strip with no input.

### 3.4 Approval flow

```text
+------------------------------------------------------------------------------------------------------------------+
| A. THE BEND, seen from anywhere. No modal opens and the camera does not move.                                    |
+------------------------------------------------------------------------------------------------------------------+
|  :    :    :    :    :     :     :     :    :    :   :    :   | RAIL  NEEDS YOU                     1            |
|  :    :    :    :    :     :     :     :    :    :    :   :   | > 00:03  kestrel β   Bash, approval              |
|  :    :    :   :    :      :      :    :    :    :    :   :   |                                                  |
|  :    :   :    :    :     :****    :  meridians bow at:    :  | assertive live region announces:                 |
|  :    :   :    :   :   *:**   ****  : every distance  :    :  | "kestrel beta needs approval, Bash"              |
|  :    :   :    :   : ***        :***:   :    :   :    :    :  |                                                  |
|  :   :    :   :      *       :    :* :  :    :   :    :    :  | the row exists at t = 0, before the              |
|  :   :    :   :   :  :  :  <β>     *     :   :        :    :  | well has finished forming                        |
|  :   :    :   :      *       :    :* :  :    :   :    :    :  |                                                  |
|  :    :   :    :   : ***        :***: craft stops dead:    :  | spc  open docket here, no flight                 |
|  :    :   :    :   :   *:**   ****  : drive off  :    :    :  | ret  dive to the craft                           |
|  :    :   :    :    :     :****    :    :   :    :    :    :  |                                                  |
|  :    :    :   :    :      :      :    :    :    :    :   :   | age grows the well: 0 s, 30 s, 2 min, 10 min     |
|  :    :    :    :    :     :     :     :    :    :    :   :   |                                                  |
+------------------------------------------------------------------------------------------------------------------+
| B. DOCKET, glance mode. Rendered by tool. The canvas keeps running, focus is trapped in the docket.              |
+------------------------------------------------------------------------------------------------------------------+
|  kestrel  β  fix-flaky-queue          owned          waiting 00:14            request 97cc...7a                  |
|  in tender t2  Explore                                                       call 2 of 2, serial                 |
|                                                                                                                  |
|  Bash                                                                                                            |
|      npm install --save-dev vitest@4                                                                             |
|                                                                                                                  |
|      Install the test runner upgrade                                                                             |
|      blocked path  C:/dev/kestrel/.claude/worktrees/q7/package.json                                              |
|                                                                                                                  |
|  [a] approve    [e] edit, then approve    [s] always, this session    [d] deny    [x] deny, stop turn            |
|  [r] redirect: send a new instruction now, cancels this request       [shift+s] always in this project           |
|                                                                                                                  |
|  deny text reaches the model verbatim: "Not approved for this call."                                             |
|  edit is not told to the model: it goes to the audit log                                                         |
|                                                                                                                  |
+------------------------------------------------------------------------------------------------------------------+
| C. DIVE. The camera falls to the night side, low, and looks past the craft toward the eclipse.                   |
+------------------------------------------------------------------------------------------------------------------+
|    :   :   :   :   :      :      :    :   :  :   :   :   :  :     | DOCKET (same component, same keys)           |
|    :   :  :   :   :  *****:*****  :   :   :   :  :   :   :   :    | Bash   npm install --save-dev vitest@4       |
|   sky is lensed  :***     :    ****:   :  :   :   :  :   :   :    |                                              |
|   never frame a :**       :       **:   :  :  :   :  :   :   :    | [a] approve   [d] deny   [e] edit ...        |
|   well against :**        :        **:  :  :  :   :  :   :   :    |                                              |
|   its own world**  :      :      :  **  :  :  #########  :   :    | ANSWER                                       |
|    :     :  :  :      :  <β>  :      *: :  :###       ###:   :    | approve    ring collapses in 180 ms, sky     |
|    :  :  :  :  **  :      :      :  **  : :::           ###  :    |            rebounds, drive relights          |
|    :  :  :   : :**        :        **:  : ::             ##  :    | deny       ring breaks outward, beam never   |
|    :  :   :  :  :**       :       **:   : ..    disc     ##  :    |            fires, craft continues            |
|    :   :  :   :  :***     :    ****:   :  ..             ::  :    | cancelled  signal aborted: ring dissolves,   |
|    :   :  :   :   :  *****:*****  :   :   ...           :::  :    |            no rebound, row says cancelled    |
|    :   :   :   :   :      :      :    :   : ...       ...:  :     | expired    kernel restarted: hollow, fades   |
|     :  :   :   :    :     :     :    :   :   :.........  :  :     | observed   no keys: open ring, read only     |
|     :########################################### :   :  :   :     |                                              |
+------------------------------------------------------------------------------------------------------------------+
| Speed rule: first dive of a session 900 ms. Another approval within 60 s: 260 ms. Any key ends a flight at once  |
| and applies. Thirty approvals an hour never cost more than ten seconds of camera.                                |
|                                                                                                                  |
+------------------------------------------------------------------------------------------------------------------+
```

The docket renders by tool as `AC 9.3` specifies: `command` and `blockedPath` for Bash and PowerShell, a diff for Edit, `plan` as Markdown for ExitPlanMode, a form from `questions[]` for AskUserQuestion, server and source for MCP. `mcpServer.name` is escaped unless `source` is `sdk`.

Key to return value, from `AC 9.2`:

| Key | Action | Result |
|---|---|---|
| `a` | Approve | `{ behavior: 'allow', updatedInput: input }` |
| `e` | Edit, then approve | `updatedInput` changed. The model is not told, so it goes to the audit log |
| `s` | Always, this session | `updatedPermissions` with `destination: 'session'` |
| `shift+s` | Always in this project | Explicit only, because it writes `.claude/settings.local.json` |
| `d` | Deny | `{ behavior: 'deny', message }`. The default text names this one call, never a rule |
| `x` | Deny, stop the turn | `interrupt: true`. The message is lost, so guidance goes in the next prompt |
| `r` | Redirect | A send with `priority: 'now'` |

### 3.5 Mission command

```text
+------------------------------------------------------------------------------------------------------------------+
| N A O S  >  LAUNCH                        camera pulls back to the eclipse                        esc  cancel    |
+------------------------------------------------------------------------------------------------------------------+
|  :      :      :      :      :      :      :      :     [Q] transfer arcs: one per craft, drawn while you type   |
|  :      :      :      :      :      :      :      :      :      :      harbor :      :      :      :      :      |
|  :      :      :      :      :      :      :      :      :      : #::..:      :      :      :      :      :      |
|  :      :      :      : #########   :      :   ................ : ## ..:      :      :      :      :      :      |
|  :      :      :      ###       ### :   .......   :      :     ...##...:      :      :      :      :      :      |
|  :      :      :    :::           ###..........   :      :      :      ....   :      :      :      :      :      |
|  :      :      :    ::             ##      :  ..............    :      :   ....      : ###::::     :      :      |
|  :      :      :    ..    disc     ##      :      :      : ........................  ###     ...   :      :      |
|  :      :      :    ..             ::      :      :      :      :      :      ......##         ..  :      :      |
|  :      :      :    ...           :::      :      :      :      :      :      :     ##         ..  :      :      |
|  :      :      :      ...       ... :      :      :      :      :      :      :     ##         ..  :      :      |
|  :      :      :      : .........   :      :      :      :      :      :      :      ###     ...   :      :      |
|  :      :      :      :      :      : held at the pad if admission says no    :      : ::::...     :      :      |
|  :      :      :      :      :      :      :      :      :      :      :      :      :  kestrel    :      :      |
+------------------------------------------------------------------------------------------------------------------+
| > @kestrel #build $2 x2 moon  fix the flaky queue test and add a regression test_                                |
|                                                                                                                  |
| WORLD     kestrel   C:/dev/kestrel   git repo   trusted, loads user, project, local settings                     |
| PROFILE   build     hybrid worktree, permission mode default, approvals on Bash and PowerShell                   |
| MODEL     sonnet-5-5   effort low      change: tab                                                               |
| BUDGET    $2.00 each, soft cap, can overshoot by one API call     tree limit $4.00                               |
| MOON      new worktree per craft, branch agent/<id>. Shell writes are not confined, so Bash stays on approval    |
|                                                                                                                  |
| WILL LOAD   CLAUDE.md, 46 skills, 14 MCP servers, hooks PostToolUse, SessionStart, about 23k context             |
| ADMISSION   running 4 of 6    alive 9 of 16    five hour window 42 % used, launch freezes at 80 %                |
|                                                                                                                  |
| unknown world, not trusted: no settings, strict MCP, no project hooks. Press t to trust: hooks and MCP servers   |
| then run at spawn, before any prompt, and outside approvals.                                                     |
|                                                                                                                  |
| ctrl+ret  launch 2      shift+ret  plan first      alt+ret  read-only analyst                                    |
|                                                                                                                  |
| same thing from a terminal:                                                                                      |
|   naos launch --world kestrel --profile build --budget 2 --moon -n 2 "fix the flaky queue test"                  |
| same thing from an agent, through MCP:   agent_spawn { project, profile, budget_usd, worktree, prompt }          |
+------------------------------------------------------------------------------------------------------------------+
```

- **[Q] Transfer arcs.** They draw while you type `@kestrel`, one per craft, so the sky answers the command before you commit.

The command line is the whole form. `@` world, `#` profile, `$` budget, `x2` count, `moon` worktree, then the prompt. Everything below it shows what was parsed, and can be edited with `tab`. Profiles are the rows of `AC 8`.

The panel exists to make three findings visible at the moment they matter:

- `settingSources` is a trust decision: a repo's hooks and `.mcp.json` run at spawn, before any prompt and outside `canUseTool` (`AC 2.9`). `[V]`
- The budget is a soft cap that overshoots by one API call (`AC 2.10`). `[V]`
- A worktree does not confine what shell commands write (`AC 7`, item 15). `[V]`

`WILL LOAD` comes from `resolveSettings({ cwd })`, which needs no spawn (`AC 2.9`). `[V]` The numbers in the wireframe are the spike's own measurements.

### 3.6 Operator keys

| Key | Action |
|---|---|
| `spc` | Attend the oldest well, docket in place |
| `ret` | Dive to the selected craft, or open its channel |
| `esc` | Up one level: craft, world, system |
| `1` to `9` | Fly to a world |
| `tab`, `shift+tab` | Next or previous craft, attention order |
| `L` | Launch |
| `/` | Find a world, craft or session |
| `T` | Sky: scrub 30 days |
| `m` | Expand the Manifest |
| `.` hold 600 ms | Stop the selected craft |
| `P` | Veil all transcript text |
| `?` | The seven laws |

Attention order is wells by age, then failures, then low orbit, then budget, then the rest. No animation ever blocks a key: input during a flight ends the flight at once and applies.

---

## 4. Visual language

### 4.1 Point of view: the eclipse-lit universe

Nothing reflects here. Everything visible is emitting, and everything emitting means something. Worlds are black silhouettes with a razor limb, like the Earth at night from orbit. The picture has the high contrast of eclipse photography and the false colour of narrowband astronomy, on a warm black that is neither navy nor violet.

The HUD is annotation on a photographic plate: no cards, no glass, no rounded corners, no blur. Hairline rules, leader lines, ticks, and text on the black.

### 4.2 Palette

Every state colour is a real emission line, and there are only three: O III, Na D and H-alpha. Hues were computed from the wavelengths through the CIE 1931 functions. `[V]` Lightness was then tuned for contrast and colour-blind separation with the hue held fixed. `[V]`

**State.** Contrast is WCAG against `void`.

| Token | Hex | Origin | Role | Contrast |
|---|---|---|---|---|
| `oiii` | `#21E3BE` | O III, 500.7 nm, hue 174.6 | The model is working: drive, motes, streamers | 12.41 |
| `pearl` | `#EAF0F2` | Continuum, no line | A tool is running: beams. Corona at rest, world limbs | 17.69 |
| `nad` | `#FD9D4E` | Na D, 589.3 nm, hue 57.4 | Needs a human: rings, the `NEEDS YOU` header. Used for nothing else | 9.80 |
| `halpha` | `#FC5466` | H-alpha, 656.3 nm, hue 18.3 | Failure | 6.40 |
| `lamp` | `#B47800` | Gold, hue 74 | Finished: HUD marks, lit arcs | 5.46 |
| `ash` | `#665F57` | Neutral | Idle, moored. Marks on `void` and `scrim` only | 3.24 |

**Surfaces and text.** Contrast is on `void`, then `scrim`, then `raised`.

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `void` | `#060504` | Canvas clear, page background | |
| `scrim` | `#0E0B09` | Near-opaque backing where the rail crosses bright sky | |
| `raised` | `#1A1512` | Focused row, docket field | |
| `hairline` | `#4A3F33` | Decorative rules only | 1.99, 1.91, 1.77 |
| `rule` | `#7C7062` | Boundaries that carry meaning | 4.22, 4.06, 3.75 |
| `paper` | `#F4ECDF` | Primary text | 17.37, 16.73, 15.44 |
| `bone` | `#BFB3A1` | Secondary text | 9.87, 9.51, 8.77 |
| `slag` | `#94897A` | Tertiary text | 5.93, 5.72, 5.27 |

All text tokens pass 4.5:1 on all three surfaces. `[V]` Per the dataviz method, values and labels stay in text tokens, and a coloured mark beside them carries the state.

**Scene emission.** Never used as text.

| Token | Hex | Role |
|---|---|---|
| `city` | `#FFC77A` | City lights, long exposure arcs, about 3,300 K |
| `meridian` | `#8C7A66` | Day lines, at very low gain |
| `now` | `#FFE7D0` | The now meridian, 5,000 K |
| `sliver-full` | `#9FB8FF` | Sliver with the window fresh, 40,000 K, the colour of Naos itself |
| `sliver-low` | `#FFB96E` | Sliver near the limit, 3,000 K. The sun cools as it runs out |

**Stellar class of a model.** Colour of a sky star, by input price: expensive and short-lived runs hot, cheap and small runs cool, as stars do. Read from the same table as the cost estimate, not hard-coded (`RF 3.4`).

| Class | Input price per MTok | Models today | Hex | Blackbody |
|---|---|---|---|---|
| O | 8 and up | fable | `#A2BBFF` | 30,000 K |
| A | 3 to under 8 | opus | `#CDD9FF` | 10,000 K |
| G | 1 to under 3 | sonnet | `#FFF2EB` | 5,800 K |
| M | under 1 | haiku | `#FFB96E` | 3,000 K |

**Validator result.** The dataviz validator ran on the six state colours, all pairs, on `void`. `[V]`

| Check | Result | Note |
|---|---|---|
| CVD separation | PASS, worst 8.1 (deutan), tritan 12.4 | Target is 8 |
| Normal-vision floor | PASS, worst 16.3 | Floor is 15 |
| Contrast | PASS, all at least 3:1 | |
| Lightness band | FAIL, reported as such | A chart-fill rule. These are emissive marks on black, so it does not apply |
| Chroma floor | FAIL on `pearl` and `ash`, reported as such | Those two are neutral on purpose |

The first draft failed for real: a pale cream for finished work collapsed into `oiii` under protanopia (3.8) and sat too close to `pearl` (10.0). That is why `lamp` is a darker gold. `[V]` A fourth line, H-beta for tools, was dropped too: against O III it scores 9.8 on the normal-vision floor of 15, and 2.5 under tritanopia. `[V]` So tool beams became neutral and tell themselves apart by shape.

**Brand distance.** `nad` is a pure sodium orange, used only for attention, on a palette that is black, pearl and teal. There is no terracotta, no warm off-white page, no starburst. `[U]` as a legal judgement.

### 4.3 Type

Four packages, all OFL-1.1 on npm, 5.3.0. `[V]` 128 KB of `woff2` for the set below. `[V]`

| Role | Family | Import | Use |
|---|---|---|---|
| Names | Cormorant Light | `@fontsource/cormorant/latin-300.css`, `latin-300-italic.css` | Wordmark, world names in italic, Almanac sentences. 28 px and up only: its hairlines echo the world limbs and vanish below that size |
| Designators | EB Garamond Medium Italic, Greek | `@fontsource/eb-garamond/greek-500-italic.css` | The Bayer letter of a craft |
| HUD | B612 | `@fontsource/b612/latin-400.css`, `latin-700.css` | All interface text, 12, 13 and 14 px |
| Numbers | B612 Mono | `@fontsource/b612-mono/latin-400.css`, `latin-700.css` | Telemetry, code, the channel. Monospaced, so digits do not jitter |

**Why B612.** Airbus, ENAC and the University of Toulouse specified it for cockpit screens, Intactile Design drew it, and it is named after the asteroid in Saint-Exupery's novel. `[V]`, web sources. A typeface built to be read in a cockpit, named after an asteroid: no other font belongs here more. Its legibility on this HUD is `[U]`.

**Bayer designators.** Live craft in a world get Greek letters in launch order, as stars in a constellation do. `β` is shorter than any label, stays readable in a 12 px row, and gives the operator a word for each craft. Past 24 in a world they take Flamsteed numbers, which is how astronomers solved the same problem.

**Glyph limits.** The Latin files of B612, B612 Mono and Cormorant have no `Δ`, `≥`, `≤`, `→`, `≈` or Greek letters. `[V]`, read from the `cmap` tables. So the HUD writes `lag`, `+` and `>`, and every Greek letter comes from EB Garamond. These do exist: `·`, `−`, `×`, `…`, `•`. `[V]`

**Replaces.** The DS 2.10 stack of Space Grotesk, Inter and JetBrains Mono is out, as the brief bans the first two. Everything is DOM, so the troika font problem in `DS 2.5` does not arise.

### 4.4 Materials

All unlit, no lights in the scene, no shadows, no environment maps.

| Material | Used for | Idea | HDR peak |
|---|---|---|---|
| `Void lens` | Sky behind everything | Fullscreen triangle sampling the sky layer through the lens equation | 3.5 at the ring |
| `Corona` | Star | Polar function, data-driven streamers, two noise taps | 2.5 |
| `Sliver` | Sun past the disc | Analytic crescent of two circles, `fwidth` antialiased | 16 |
| `Limb` | World, moon | Billboard impostor, analytic sphere, premultiplied | 9 |
| `City` | Finished agents | Point sprites on a unit sphere, night side only | 3 |
| `Arc` | Orbits, trails, hoops, exposure | Instanced screen-space ribbon | 2 |
| `Hull` | Craft, beads, tenders | Instanced quad, shape from an SDF | 4 |
| `Beam` | Tool calls, meteors | Instanced quad with a class pattern | 4 |
| `Wind` | Motes | Point sprites on an analytic curve | 2 |

### 4.5 Post-processing

In order:

1. Sky layer into a half-float target, only when something changed.
2. Scene, with the lens composite as its background.
3. Bloom, threshold 1.0, so only real emission blooms. Five levels on this machine.
4. Disc occluder, so the kernel disc stays black after bloom. The first still had a grey veil there until this step existed. `[V]`
5. AgX tone mapping, one effect in the same pass.

**Left out on purpose:** depth of field, SSAO, vignette, grain, chromatic aberration, lens flares. None of them carries a signal, so none is allowed. Bloom is how emission displays, and it adds no value of its own. MSAA is off because every hairline is antialiased analytically.

The lens is not a composer effect. A `mainUv` effect would warp the craft sitting in the middle of the well, and `postprocessing` throws if `mainUv` is combined with a convolution effect in one pass. `[V]`, source. Lensing only the sky layer keeps the hull crisp in the centre of the ring, as the Hero still shows. `[V]`

### 4.6 Motion language

Ownership follows `DS 2.6`: `useFrame` for continuous values, GSAP for camera and scripted beats, `motion/react` for HUD, CSS for hover.

| Name | Curve | Duration | Used for |
|---|---|---|---|
| `coast` | `linear` | continuous | Orbit progress on owned craft |
| `burn` | `cubic-bezier(0.12, 0.8, 0.2, 1)` | gap to last flush, 600 to 2400 ms | Observed craft catching up after a flush |
| `halt` | `cubic-bezier(0.2, 0, 0, 1)` | 120 ms | A craft stopping for a well |
| `deepen` | `cubic-bezier(0.45, 0, 0.55, 1)` | 1200 ms | A well forming |
| `fall` | `cubic-bezier(0.55, 0, 0.9, 0.35)`, then `settle` | 900 ms, 260 ms on repeat | Camera into a well |
| `collapse` | `cubic-bezier(0.7, 0, 1, 0.4)` | 180 ms | Ring into the hull on approve |
| `snapback` | GSAP `elastic.out(1, 0.38)` | 700 ms | The sky rebounding |
| `slingshot` | `cubic-bezier(0.7, 0, 0.12, 1)` | 1000 ms | Flights between worlds |
| `ejection` | `cubic-bezier(0.3, 0, 0.1, 1)` | real spawn time, about 1260 ms | Transfer arc of a launch |
| `reentry` | `cubic-bezier(0.6, 0.04, 0.98, 0.34)` | 1400 ms | De-orbit |
| `ignite` | `cubic-bezier(0.16, 1, 0.3, 1)` | 180 ms | Drive lighting, a city light turning on |
| `settle` | `cubic-bezier(0.22, 1, 0.36, 1)` | 180 ms | HUD enter and move |
| `dissolve` | `linear` | 600 ms | A cancelled approval |
| `contact` | `cubic-bezier(0.83, 0, 0.17, 1)` | 720 ms | The eclipse at boot |

Register them once with GSAP `CustomEase` so canvas and DOM share names. `CustomEase` ships in public `gsap` (`DS 3.2`). `[V]` Durations are starting values. `[U]`

**Three rules.** The camera never rolls. Bright flashes stay below three per second, so meteor showers stagger. Cinema decays with repetition: a move repeated within 60 s plays at under a third of its length.

---

## 5. Hero techniques

Stack and pins are `DS 4.1`, and nothing here adds a runtime dependency beyond the fonts. Efforts are one strong engineer or agent working alone. `[U]`

**How this code was checked.** All GLSL below parses with `@shaderfrog/glsl-parser` 7.0.1, and a negative control with two broken shaders fails. `[V]` That is syntax and scope only, so no GPU driver has compiled it. `[U]` `stage.tsx` passes `tsc --strict` against the DS set under TypeScript 6.0.3, and a negative control fails on exactly its two injected errors. `[V]` The CPU port uses the same formulas with procedural noise instead of a noise texture, so the look of the GLSL is inferred, not seen. `[U]`

### Render graph

```text
useFrame(-1)  sky layer into half-float target    only if camera moved or sky changed
scene         lens composite (background, renderOrder -1000, no depth)
              worlds and moons, billboards at the centre plane, depth on
              arcs, cities, hulls, beams, motes, depth test, no depth write, additive
composer      bloom (mipmap, threshold 1) + disc occluder + tone mapping
DOM           rails, labels, docket, above the canvas
```

### H1. The Bend

**Effort: 3 days.**

The whole trick is that the lens touches only the sky. The sky renders into its own target, then a fullscreen triangle draws it through the point-lens equation as the scene background. Worlds and craft draw on top, so the hull stays sharp in the middle of the ring.

```glsl
uniform sampler2D uSky;      // the sky layer, half-float
uniform sampler2D uNoise;    // 256 x 256 tiling noise, built at boot
uniform vec4 uWell[8];       // xy: centre in px, z: thetaE in px, w: 1 owned, 0 observed
uniform int uWellCount;
uniform vec2 uRes;
uniform vec3 uVoid;
uniform vec3 uSodium;
varying vec2 vUv;

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
    s -= d * te * te / r2;                                  // point lens, wells add
    shadow *= smoothstep(0.34 * te, 0.62 * te, r);          // dark inner disc
    float k = (r - te) / (0.3 * te);
    gain *= 1.0 + 2.6 * exp(-k * k);                        // caustic brightening
    float a = atan(d.y, d.x);
    float m = texture2D(uNoise, vec2(cos(a), sin(a)) * 0.17 + float(i) * 0.31).r;
    float arc = pow(clamp((m - 0.3) / 0.42, 0.0, 1.0), 1.5);
    float e = (r - te) / ((0.85 + 3.4 * arc) * sqrt(te / 104.0));
    float gate = mix(step(fract((a + 3.14159) / 0.5), 0.6), 1.0, uWell[i].w); // observed ring is broken
    ring += uSodium * mix(0.75, 2.5, uWell[i].w) * (0.14 + 1.3 * arc) * exp(-e * e) * gate;
  }
  vec3 sky = texture2D(uSky, s / uRes).rgb;
  gl_FragColor = vec4(uVoid + sky * shadow * gain + ring, 1.0);
}
```

- **R3F.** `SkyPass` in `stage.tsx` fills the target at negative `useFrame` priority, which keeps automatic rendering on (`DS 2.6`). `[V]` A mesh with `frustumCulled={false}`, `depthTest={false}` and `renderOrder={-1000}` draws the composite.
- **Uniforms.** Each frame, project every waiting craft to pixels and write `uWell`. That is one uniform array, with no per-well object.
- **Rebound.** On approve, drive a `thetaE` multiplier through `snapback`. It passes through zero, overshoots slightly negative, and the sky ripples back.
- **Off screen.** A well outside the frame still bends the frame edge toward itself, because `1/r` reaches far. A chevron in the HUD names it.
- **Camera rule.** Found by rendering: a well framed against its own black planet has nothing to bend and looks like a flat orange circle. `[V]` The dive camera therefore sits low on the night side and looks past the hull along the limb, so sky is always behind the ring.

### H2. The Eclipse

**Effort: 3 days.**

```glsl
uniform sampler2D uNoise;
uniform vec2 uStream[16];    // x: screen azimuth of a world, y: its token load 0..1
uniform int uStreamCount;
uniform float uTokenClock;   // advances with fleet output tokens, never with wall time
uniform float uSunLeft;      // five hour window left, 0..1
uniform vec3 uPearl;
uniform vec3 uOiii;
uniform vec3 uSliver;      // cools from sliver-full to sliver-low as the window burns
varying vec2 vP;             // position in star radii

float tap(float a, float r, float f) {
  return texture2D(uNoise, vec2(cos(a), sin(a)) * f + vec2(0.0, r * 0.06 - uTokenClock)).r;
}

void main() {
  float r = length(vP);
  float a = atan(vP.y, vP.x);
  float s = 0.0;
  for (int i = 0; i < uStreamCount; i++) {
    float d = atan(sin(a - uStream[i].x), cos(a - uStream[i].x));
    float sig = 0.1 + 0.05 * uStream[i].y;
    s += uStream[i].y * exp(-(d * d) / (sig * sig));        // the corona is a polar chart of token load
  }
  s = min(s, 1.25);
  float c = min(s, 1.0);
  float n = pow(clamp((tap(a, r, 0.41) - 0.24) / 0.5, 0.0, 1.0), 2.2);
  float h = pow(clamp((tap(a, r, 2.6) - 0.2) / 0.6, 0.0, 1.0), 1.6);
  float fade = 1.0 - smoothstep(3.6 + 2.6 * c, 5.2 + 3.6 * c, r);
  float I = pow(max(r, 1.0), -(3.9 - 1.9 * c)) * (0.1 + 1.45 * n * (0.45 + 1.1 * h)) * (0.62 + 1.5 * s) * fade * 1.05;
  vec3 col = mix(uPearl, uOiii, clamp(0.62 * s, 0.0, 1.0)) * I;

  // The sun behind the kernel disc: same radius, displaced toward one o'clock by what is left of the window.
  vec2 sp = vP - vec2(0.469, 0.883) * (0.012 + 0.11 * uSunLeft);
  float aa = fwidth(r) * 1.2;
  float past = smoothstep(1.0 - aa, 1.0 + aa, r);
  float sun = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, length(sp));
  float e = (r - 1.0) / 0.008;
  col += uSliver * sun * past * 16.0 + uPearl * exp(-e * e) * 0.5;
  gl_FragColor = vec4(col * past, 1.0);
}
```

- **The corona is a chart.** Each loaded world pulls one streamer toward its screen azimuth, so the star's shape shows where tokens are going. The Active still shows three of them. `[V]`
- **The sliver is a gauge.** Two equal circles, one displaced. Displacement sets how much sun shows, with its thickest point at one o'clock. It reads as a crescent only with the limb term kept small, which took two renders. `[V]`
- **`uTokenClock`.** Advances with fleet output tokens. At 0 agents the corona is frozen, like a photograph, and costs nothing to animate.
- **Split for cost.** The streamers cover nearly the whole frame at overview: a quad of up to 17 star radii. Render them into a half-resolution target at 30 Hz. Keep the disc and sliver at full resolution in a small quad of 1.3 radii. Split the shader at its comment.
- **Noise.** One 256 x 256 tiling texture built at boot in a `DataTexture`. Nothing is loaded from a CDN (`DS 2.8`).

### H3. Night worlds and city lights

**Effort: 2.5 days.**

```glsl
uniform vec3 uLight;         // toward the star, view space
uniform float uQuota;        // 0.28 + 0.72 * sun left: the whole system dims with the window
uniform vec3 uPearl;
varying vec2 vQ;             // billboard position, 1.0 is the limb

void main() {
  float r = length(vQ);
  if (r > 1.16) discard;
  float aa = fwidth(r) * 1.1;
  float body = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  vec3 col = vec3(0.0);
  if (r < 1.0) {
    vec3 n = vec3(vQ, sqrt(1.0 - r * r));
    float ndl = dot(n, uLight);
    float rim = pow(1.0 - n.z, 9.0) * smoothstep(-0.34, 0.5, ndl);
    col = uPearl * (rim * 9.0 + pow(max(ndl, 0.0), 3.0) * 0.018) * uQuota;
  } else {
    float nl = dot(normalize(vQ), uLight.xy);
    col = uPearl * exp((1.0 - r) / 0.022) * smoothstep(-0.1, 0.72, nl) * 1.5 * uQuota;
  }
  gl_FragColor = vec4(col, body);   // premultiplied: body occludes, atmosphere adds
}
```

- **Impostors.** A billboard at the sphere's centre plane, one instanced quad per world or moon. The limb stays perfect at any zoom with no MSAA, and a world costs 2 triangles.
- **Depth without `gl_FragDepth`.** The billboard writes depth at the centre plane. Nothing orbits inside a sphere, so anything in front of the plane passes and anything behind it is hidden. That keeps early-z. The CPU port sorts exactly this way. `[V]`
- **Cities.** One `THREE.Points`, capacity 8,192, for all worlds. Attributes: unit vector, world index, outcome, age. The vertex shader rotates by world spin, drops the far side, and fades on the day side.
- **Placement.** `siteHash` of the top folder picks a cluster, the subfolder picks a sub-cluster, and the file jitters. The same folder always lights the same region, so a project grows a recognisable geography. Raw paths stay in the kernel, Appendix A.
- **Real counts.** Stores here hold from 1 to 1,418 transcript files. `[V]` The Idle still uses those counts: big worlds look populated and small ones show a few lights, with cluster layout synthetic. `[V]`

### H4. The Arc Engine

**Effort: 2 days.**

Orbits, trails, phase hoops and long exposures are all one primitive: an arc of a circle. So they are all one draw call. Trails need no history buffer, because a trail lies exactly on its orbit: it is the arc behind the craft. There is no per-frame geometry at all.

```glsl
// position.x: t along the arc, 0..1. position.y: side, -1..1.
attribute vec3 iCenter;      // orbit centre
attribute vec3 iA;           // orbit basis, scaled by radius
attribute vec3 iB;
attribute vec2 iSpan;        // start angle, sweep
attribute vec4 iColor;       // rgb, gain
uniform vec2 uRes;
uniform float uWidthPx;
varying float vT;
varying float vSide;
varying vec4 vColor;

vec3 orbit(float th) { return iCenter + iA * cos(th) + iB * sin(th); }

void main() {
  float th = iSpan.x + iSpan.y * position.x;
  mat4 vp = projectionMatrix * viewMatrix;
  vec4 c0 = vp * vec4(orbit(th), 1.0);
  vec4 c1 = vp * vec4(orbit(th + 0.01), 1.0);
  vec2 dir = normalize((c1.xy / c1.w - c0.xy / c0.w) * uRes);
  c0.xy += vec2(-dir.y, dir.x) * position.y * uWidthPx / uRes * 2.0 * c0.w;
  gl_Position = c0;
  vT = position.x;
  vSide = position.y;
  vColor = iColor;
}
```

```glsl
varying float vT;
varying float vSide;
varying vec4 vColor;

void main() {
  float edge = 1.0 - smoothstep(0.35, 1.0, abs(vSide));     // analytic AA, no MSAA needed
  gl_FragColor = vec4(vColor.rgb * vColor.a * edge * vT * vT, 1.0);
}
```

- **Instancing.** `InstancedBufferGeometry`, fixed capacity 2,048, three LODs of 24, 48 and 96 segments. Update ranges with `addUpdateRange` (`DS 2.3`). `[V]`
- **Why one plane per world.** The first still gave each orbit its own inclination, and the result was unreadable scribble. Giving each world one plane turned the arcs into rings, and made altitude readable as a radius. `[V]`

### H5. Fleet sprites and the odometer

**Effort: 2 days.**

One instanced quad, capacity 1,024, for craft, tenders and beads. The fragment shader draws the shape from an SDF: kite, dart, bead, filled or outlined. Orbit progress is the only per-frame upload.

```text
theta = theta0 + 2 * PI * outputTokens / 8000     owned: damped toward target each frame
                                                  observed: burn toward target on flush
```

8,000 tokens per revolution gives 20 s per orbit at the measured 396 tokens per second, and 160 s at 50. `[V]`, arithmetic

At craft zoom a real hull replaces the sprite: about 300 triangles, one mesh, always the selected craft.

### H6. The Almanac Sky

**Effort: 2 days.**

The sky is a calendar, and it is the answer to "particle wallpaper". There is not one decorative star in it.

- **One meridian per day.** 6 degrees apart, so 30 days fill half the sphere, from the now meridian to the Horizon. The other half of the sky is empty: that is the future.
- **One star per transcript.** Longitude is time, latitude is a lane per project with spread, brightness is size, colour is stellar class.
- **One dust mote per 64 KiB of transcript.** No parsing needed, `stat` gives it. Density is real work done.

**Real result on this machine.** 2,177 `.jsonl` files, 2.09 GB, 34,244 dust motes at 64 KiB, in 22 folders of which 11 hold transcripts. Daily volume runs from 1 to 467 files. `[V]` So the sky comes out as bright vertical lines on burst days and dark gaps between. A month of work reads as an emission spectrum, which fits the palette better than any Milky Way I could have faked. `[V]`, seen in the stills

```glsl
attribute vec3 aDir;         // unit vector on the celestial sphere
attribute vec3 aColor;       // colour times flux
attribute float aSize;       // point size in px
uniform mat3 uBasis;         // world to sky camera, z along the view axis
uniform float uTanHalfV;     // tan(psiV / 2), 0.6 at psiV = 62 degrees
uniform float uAspect;
varying vec3 vColor;

void main() {
  vec3 v = uBasis * aDir;
  float psi = acos(clamp(v.z, -1.0, 1.0));
  float rho = tan(0.5 * psi) / uTanHalfV;                   // stereographic: circles stay circles
  vec2 ndc = normalize(v.xy + vec2(1e-6)) * rho;
  gl_Position = vec4(ndc.x / uAspect, ndc.y, 0.0, 1.0);
  gl_PointSize = aSize;
  vColor = aColor;
}
```

- **A wider sky than scene.** The sky layer has its own stereographic projection, about 180 degrees across, so the month fits at overview while the scene camera stays at 30 degrees. It is at infinity, so no parallax gives this away. `[U]` in motion.
- **Meridians are not decoration.** Scattered stars do not show curvature well. Straight lines do. Without meridians, the Bend would be invisible wherever history is sparse. `[V]`, from the stills
- **Cost.** 36,346 points, two draws, only when the camera moves. Static otherwise.
- **The sky fills like dusk.** At boot stars appear as the indexer reports them, so it doubles as the only progress bar. Main transcripts arrive first, 40 to 50 ms, the rest over about 4 s in a worker, cached after that (`RF 5.4`). `[V]`

### H7. Token wind, beams, meteors

**Effort: 2 days.**

```glsl
attribute vec4 aPath;        // xy: start, zw: end, on the ecliptic plane
attribute vec3 aMeta;        // x: birth, y: life in seconds, z: lateral bow
uniform float uNow;
uniform float uPx;
varying float vA;

void main() {
  float t = clamp((uNow - aMeta.x) / aMeta.y, 0.0, 1.0);    // no CPU update after birth
  vec2 a = aPath.xy;
  vec2 b = aPath.zw;
  vec2 c = 0.5 * (a + b) + vec2(a.y - b.y, b.x - a.x) * aMeta.z;
  vec2 p = mix(mix(a, c, t), mix(c, b, t), t);
  gl_Position = projectionMatrix * viewMatrix * vec4(p.x, 0.0, p.y, 1.0);
  gl_PointSize = uPx;
  vA = sin(t * 3.14159);
}
```

- **Motes.** Ring buffer of 2,048 or 4,096, written once at birth with `addUpdateRange`, then fully analytic. 1,840 tokens per second means 368 live motes. `[V]`, arithmetic
- **Beams and meteors.** One instanced quad, capacity 64. Start, end, class, phase. A meteor is a beam with a short life.

### H8. Stage and flight camera

**Effort: 2 days.**

```tsx
// Printed in section 5 of the concept. Compiled with tsc --strict against the design-skills section 4 set.
import { useMemo, useRef, type MutableRefObject, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, ToneMapping, wrapEffect } from '@react-three/postprocessing';
import { Effect, ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';

/** Runs after bloom in the same EffectPass, so the kernel disc stays black. */
class DiscOccluderEffect extends Effect {
  constructor() {
    super('DiscOccluderEffect', /* glsl */ `
      uniform vec3 uDisc;   // xy: centre in uv, z: radius in uv height
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec2 d = (uv - uDisc.xy) * vec2(aspect, 1.0);
        outputColor = vec4(inputColor.rgb * smoothstep(uDisc.z * 0.985, uDisc.z, length(d)), inputColor.a);
      }`, { uniforms: new Map<string, THREE.Uniform>([['uDisc', new THREE.Uniform(new THREE.Vector3())]]) });
  }
}
const DiscOccluder = wrapEffect(DiscOccluderEffect);

/** Redraws the sky layer only when the camera moved or the sky changed. Negative priority keeps auto-render. */
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

export interface Tier { dpr: number; bloomLevels: number; skyScale: number; motes: number }
export const TIERS: Record<'totality' | 'corona' | 'penumbra', Tier> = {
  totality: { dpr: 1, bloomLevels: 6, skyScale: 0.5, motes: 4096 },
  corona: { dpr: 0.85, bloomLevels: 5, skyScale: 0.33, motes: 2048 },
  penumbra: { dpr: 0.7, bloomLevels: 4, skyScale: 0.25, motes: 512 },
};

export function Stage({ tier, active, rootRef, children }: {
  tier: Tier; active: boolean; rootRef: RefObject<HTMLDivElement>; children: React.ReactNode;
}) {
  const skyScene = useMemo(() => new THREE.Scene(), []);
  const skyCamera = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), []);
  const skyTarget = useMemo(() => new THREE.WebGLRenderTarget(1280, 720, { type: THREE.HalfFloatType, depthBuffer: false }), []);
  const skyDirty = useRef(true);
  return (
    <Canvas flat dpr={tier.dpr} frameloop={active ? 'always' : 'demand'} eventSource={rootRef as RefObject<HTMLElement>} eventPrefix="client"
            gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}>
      <SkyPass scene={skyScene} camera={skyCamera} target={skyTarget} dirty={skyDirty} />
      {children}
      <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType}>
        <Bloom mipmapBlur levels={tier.bloomLevels} luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.6} radius={0.7} />
        <DiscOccluder />
        <ToneMapping mode={ToneMappingMode.AGX} />
      </EffectComposer>
    </Canvas>
  );
}
```

- **Flight.** Camera on a Catmull-Rom path, with GSAP driving one parameter and `useFrame` reading it. `invalidate()` in `onUpdate` for demand mode (`DS 2.6`). Free orbit and wheel zoom use `CameraControls`, with no roll.
- **Paths curve.** Flights swing around bodies, as a gravity assist would, and never pass through a world.
- **Dive framing.** Computed from the craft: night side, low, past the hull toward the star. The Hero still uses this formula. `[V]`

### H9. Label layer

**Effort: 1 day.**

One `useFrame` projects up to 30 anchors and writes `transform` on 30 pooled DOM nodes. It avoids one `Html` per label and its per-instance `useFrame` (`DS 2.5`). `[V]` World names always show. Craft labels show when selected, waiting or failed. Leader lines are one SVG path.

### Total

About 21.5 days for the canvas, plus about 10 for the HUD, docket and fallback. `[U]`

---

## 6. Real-time mapping

**Lag classes.**

| Class | Meaning | Measured |
|---|---|---|
| `live` | Control plane frames | Frames arrive as they happen (`AC 13`) `[V]` |
| `near` | Pid file, `api-request` | 22 to 162 ms pid, 13 to 643 ms request (`RF 0`, `RF 2.3`) `[V]` |
| `late` | Transcript records | Main up to 1.3 s, workflow agent up to 46 s (`RF 5.2`) `[V]` |
| `after` | Only known once finished | Compaction, block type (`RF 3.5`) `[V]` |

### 6.1 Signal to visual

**Session and agent events** (`ObservedEvent`, `RF 9`)

| Signal | Lag | Visual response |
|---|---|---|
| `session.discovered` | near | Observed: first light at its orbit. Owned: already flying, so nothing new |
| `session.changed` | near | Label updates. `sessionId` changing on `/clear` keeps the hull and resets altitude. `cwd` changes the tag only, the world stays |
| `session.ended` | near | `clean`: re-entry, city light, sky star. `abandoned`: hard landing, ember. `pid-recycled`: hull winks out, tag `recycled` |
| `activity.changed` | near | Table below |
| `agent.started` | late | Tender launches from the parent, or a bead joins its hoop |
| `agent.ended` | late | Re-entry for a tender. A bead stops and lights an arc |
| `turn.started` | late | Uplink pulse on the hull, by origin: `human` solid, `task_notification` dot, `peer` double, `sdk` small tick, `scheduled` hollow, `unknown` small tick |
| `turn.ended` | late | Drive cuts with a small puff. A tick on the tape with `stopReason` |
| `request.started` | near | Drive lights |
| `message.completed` | late | Observed: burn, mote burst, block ticks on the tape. `model` updates class and tag |
| `tool.started` | late | Beam on, by class |
| `tool.finished` | late | Beam off. `isError`: tip flares. `decision: reject`: beam cut short, tick on the tape |
| `usage.changed` | late | Mass, trail, odometer target, HUD. `cost-state` swaps `est` for the settled number |
| `workflow.changed` | late | Hoops and beads rebuild. Terminal status closes the armillary |
| `compacted` | after | Reboost: altitude jumps, ring flash, tag `pre to post tokens`, `manual` or `auto` |
| `api.retry` | late | Stutter, countdown arc from `retryInMs`, `attempt of maxRetries` |
| `api.error` | late | Flameout, HTTP status on the tag |
| `rate_limit.hit` | late | That craft flames out. A plan limit starts Totality |
| `tail.reset` | near | Brief static on the tag, `track reset`, cursor restarts |
| Journal `launched`, `started`, `result`, `failed` | late | Arrive through `workflow.changed`: first hoop, new bead, lit arc, red bead |

**Activity states** (`Activity`, `RF 9`)

| State | Visual |
|---|---|
| `starting` | Hull present, no drive |
| `generating` | Drive lit. Owned also moves. `lastBlock` labels the tape after the fact |
| `tool_running` | Still, beam on. Several tools give several beams |
| `waiting` | Well, by `reason` |
| `retrying` | Stutter with countdown |
| `compacting` | Owned only: hull glows, altitude climbing. No live signal exists for observed craft (`RF 3.5`) `[V]` |
| `idle` | Moored. With `backgroundShell`, a dim drill beam stays on |
| `interrupted` | Drive cuts hard, tick on the tape |
| `errored` | Flameout. `rate_limit` kind shows `resetsAt` |
| `finished` | Re-entry, by `outcome` |
| `unknown` | Outline hull, grey, label `unknown` |

**Liveness, status and kind** (`RF 2`, `RF 9`)

| Signal | Visual |
|---|---|
| `alive` | Beacon ticks on each 1 s probe |
| `dead` | Stale pid file: derelict. Never deleted by NAOS (`RF 2.4`) |
| `recycled` | After 2 ticks: hull winks out, tag `recycled` |
| `foreign` | Off-world contact at the system edge |
| Liveness `unknown` | Beacon hollow |
| `busy` | Backs `generating` or `tool_running`. Never trusted alone, because it stayed `busy` for 30 minutes (`RF 2.3`) `[V]` |
| `shell` | Moored with a dim drill beam |
| Pid `idle` | Moored, or flameout if the last record was an error |
| `permission prompt` | Well, label `permission prompt` |
| `input needed` | Well, label `input needed` |
| `sandbox request` | Well, label `sandbox request` |
| `worker request` | Well, label `worker request` |
| `dialog open` | Well, label `dialog open` |
| `kind`: `interactive`, `bg`, `daemon`, `daemon-worker` | Tag at craft zoom. `bg` gets a small B on the hull |
| `entrypoint` | Tag at craft zoom, an open string |
| `remoteControlled` | Antenna tick on the hull, tag `remote` |
| `version` | Tag at craft zoom |

**Agent and workflow status** (`RF 9`)

| Signal | Visual |
|---|---|
| `running` | Bead or tender moving |
| `completed` | Bead lit, city light |
| `failed` | Red bead, ember |
| `stopped` | Grey bead, no light |
| `orphaned` | Derelict. Owner dead, journal open (`RF 4.4`) |
| Agent `unknown` | Outline bead |
| Workflow `running` | Hoops open, beads moving |
| Workflow `completed` | Hoops close, meteor shower, rings join the long exposure |
| Workflow `failed` | Hoops close in H-alpha |
| Workflow `killed` | Hoops close grey |
| Workflow `orphaned` | Hoops left open and unlit, drifting |
| `counts.retried` | Ghost bead with a second tick |

**Session fields**

| Signal | Visual |
|---|---|
| `contextTokens`, `contextWindow` | Altitude, Altimeter |
| `queuedInputs` | Pods ahead of the hull |
| `flushLagMs` | Lag tag, ghost, `lag max` in the header |
| `cost` | Mass, trail, HUD. `isEstimate` shows `est`, `isLowerBound` shows `+` |
| `usage.partialOutputMessages` | Forces `+` on the estimate (`RF 3.3`) |
| `model`, `requestedModel` | Class letter, tag |
| `effort`, `permissionMode` | Tag at craft zoom |
| `gitBranch` | Tag. `HEAD` shows `detached` (`RF 3.3`) |
| `worktree` | Craft orbits a moon |
| `title`, `displayName` | Label. `titleSource` decides the fallback |
| `agentCount`, `runningAgentCount` | World row, ticks |
| `lastRateLimit` | Tag at craft zoom |
| `acceptsPeerMessages` | Broker action enabled, later phase (`RF 8`) |

**Control plane states** (`AC 5.1`)

| State | Visual |
|---|---|
| `queued` | Sits on the Pad |
| `spawning` | Ejection, transfer arc in flight |
| `ready` | In orbit, no drive, no prompt yet |
| `running` | Normal flight |
| `awaiting_approval` | Well. A counter, so overlapping requests stack |
| `idle` | Moored |
| `parked` | Tool deferred: craft on a far holding orbit, tag `deferred` |
| `budget_exhausted` | Fuel out |
| `rate_limited` | Cold coast, countdown from `resetsAt` |
| `stopping` | Retro burn. The hull shows each stop step |
| `exited` | Landed, resumable. City light with a small ring |
| `crashed` | Breakup, debris |
| `lost` | Static hull |
| `closed` | Moon removed if it had one, light stays |

**Control plane frames** (`AC 2`)

| Signal | Lag | Visual |
|---|---|---|
| `text_delta` | live | Mote stream, plume, channel text |
| `system/thinking_tokens` | live | Mote stream, plume, `thinking` row. Without it the agent looks stalled (`AC 2.3`) |
| `message_delta` | live | Replaces the estimate with real `output_tokens` |
| `system/init` | live | Orbit insertion |
| `ttft_ms` | live | Tag at craft zoom |
| `total_cost_usd` | live | Fuel arc, trail, HUD. Read the latest, never sum (`AC 2.3`) |
| `modelUsage` `contextWindow` | live | Altitude scale |
| `system/permission_denied`, `permission_denials` | live | Tape tick, beam never fires |
| `command_lifecycle` | live | Pod queued, started, completed or cancelled |
| `system/task_started` | live | Tender launches |
| `system/task_progress`, `system/task_updated` | live | Tender label, `last_tool_name` |
| `system/task_notification` | live | Tender lands |
| `system/api_retry` | live | Stutter, not stalled |
| `rate_limit_event` | live | Sliver update, at each spawn |
| `subagent_stats` | live | World row, refused counts as fallback ticks |
| `terminal_reason: completed` | live | Moored |
| `aborted_streaming`, `aborted_tools` | live | Moored with an aborted tick |
| `max_turns` | live | Moored, HUD offers continue |
| `budget_exhausted` frame | live | Fuel out |
| `tool_deferred` | live | Holding orbit |
| Unknown `terminal_reason` | live | Moored with an error badge (`AC 5.2`) |

**Approvals and orchestration** (`AC 9`, `AC 12`)

| Signal | Visual |
|---|---|
| `approval.requested` | The Bend |
| `approval.cancelled` | Ring dissolves, no rebound |
| `approval.answer` | Collapse and rebound, or outward break |
| Restart with pending approvals | Hollow ring, `expired`, fades |
| `decisionReason`, `defaultToNo` | H-alpha ring, docket opens on deny |
| `agent_spawn` | Ejection from the corona |
| `agent_spawn` refused | Fallback into the star |
| `agent_send` | Uplink pulse, `peer` shape |
| `agent_stop` | Retro burn |
| `agent_wait` | Filament to the child lit dim |
| `agent_status`, `agent_list` | `relay` beam to the star, like any MCP call |
| `permissionDecision` | Tape tick, `accept` or `reject`, with `source` at craft zoom |
| `toolDenialKind` | Tape tick, label names the kind |

**Fleet and kernel**

| Signal | Lag | Visual |
|---|---|---|
| `five_hour.utilization` | up to minutes | Sliver thickness and colour, limb light, header number with `as of` |
| `seven_day.utilization` | up to minutes | Header number |
| `fetchedAtMs` | | `as of` time on the gauge |
| `status: allowed_warning` | live | Sliver turns `sliver-low`, ephemeris note |
| `status: rejected` | live | Totality, countdown |
| `resets_at` passes | | Diamond ring |
| Liveness loop, 1 s | | Beacon tick on every craft |
| Shallow walk, 5 s | | Sweep: one thin ring leaves the star |
| Index progress | | Stars come out |
| Kernel link lost | | Sweeps stop, disc hatched, `no signal` |
| WebGL context lost | | DOM banner, Plate fallback |
| Transcript `ENOENT` by retention | | Star and city light go out |

**Deliberately no visual.** Records the reports mark as skip or ignore are not signals about the fleet: `api-request-blob`, `api-request-shape`, `atis-latch`, `mode`, `frame-link`, `file-history-snapshot`, `file-history-delta`, the artifact ledgers, and every attachment subtype outside `RF 3.2` (`RF 3.1`). `[V]` Unknown types are counted, never fatal, and shown only in a debug view.

### 6.2 Visual to signal

Nothing appears on screen that is not in this list.

| Visual | Signal |
|---|---|
| Disc | Kernel running |
| Sliver | Five hour window left |
| Corona brightness | Fleet token rate |
| Corona streamers | Token load per world |
| Corona flow | Fleet output tokens, an odometer |
| Sweep ring | Shallow walk, 5 s |
| World size | 30 day spend |
| World position | First seen order, days since activity |
| World spin | World output tokens |
| World limb light | Five hour window left |
| Moon | Worktree |
| City light | One finished agent |
| Ember | One failed or abandoned agent |
| Hull | One live session or agent |
| Hull fill | Owned or observed |
| Hull shape | Vessel, tender, bead |
| Altitude | Context left |
| Orbit progress | Output tokens |
| Drive plume | Live token rate, or call in flight |
| Trail | Spend per minute |
| Long exposure arc | One craft of the last 24 hours |
| Beacon | Liveness probe |
| Pods | Queued prompts |
| Hoop | One workflow phase |
| Bead | One workflow agent |
| Lit arc | Finished beads |
| Ghost bead | A retried attempt |
| Tether | Workflow owner |
| Filament | Lineage, selected craft only |
| Beam | One open tool call |
| Well, ring, lens | A human is needed, age is strength |
| Mote | 10 tokens |
| Meteor | A finish |
| Transfer arc | A spawn in flight |
| Pad | Admission queue |
| Debris | A crash not yet acknowledged |
| Derelict | Owner gone |
| Meridian | One day |
| Now meridian | Now |
| Horizon | Retention limit |
| Sky star | One transcript |
| Dust | 64 KiB of transcript |
| Bloom | No signal: it is how emission displays |

---

## 7. Scale behaviour

| Fleet | Scene | HUD | Camera | Render loop |
|---|---|---|---|---|
| **0** | Eclipse at rest, sliver wide, corona frozen. Worlds wear long exposure rings from the last 24 hours. Cities glow. Sweep every 5 s | The **Almanac**: sentences set in Cormorant, built from counts. Salvage and resume rows. `L` to launch | Still, a small pointer parallax | `demand`. Almost no GPU work |
| **1** | One craft, full detail, its world drawn inward | One row, channel offered on `ret` | Eases to frame star and world | `always` while it flies |
| **5** | All craft labelled by letter. Orbits visible on selection | Manifest rows per craft fit without scrolling | System view | `always` |
| **20** | Labels only for selected, waiting, failed. Armillaries collapse workflows into one object. Corona shows the split | Manifest per world, rails ordered by attention | System view | `always`, tier may step down |
| **100+** | Vessels past 24 per world merge into a **shoal**: one density band on the altitude ring. Beams sample to 64, motes to the cap, meteors stagger | Manifest virtualised, counts per world, `/` to find | System view, shoals expand on zoom | `always`, adaptive |

### 0 agents: the usual case

**It does not feel dead, because it is made of what happened.** The Idle still has zero craft and is still a full picture: the month as a spectrum, long exposure rings, cities. The sky there is real, and the rings are synthetic. `[V]` Whether it holds up on the hundredth morning is `[U]`.

- **Almanac sentences.** Computed from data, no model call. For example: "Last night 16 craft landed on harbor. One derelict drifts near tundra. 88 % of the sun is showing."
- **Actions.** Resume exited sessions, salvage orphaned runs (`RF 4.4` found one here `[V]`), launch.
- **Day Reel, optional.** After 20 s untouched at 0 agents, the last 24 hours replay in 40 s: launches and landings only, from indexed times, always labelled `REPLAY 09:14`, stopped by any input, off on battery. It uses real data and declares itself, so it stays inside the no-decoration rule.
- **Motion at rest** is only the sweep and the beacons, and both are true.

### Hard limits and aggregation

| Thing | Cap | Past the cap |
|---|---|---|
| Wells that bend | 8 | Oldest 8 bend, rail lists all |
| Live labels | 30 | Attention order wins (`DS 2.5`, a judgement `[U]`) |
| Arcs | 2,048 | Long exposures drop first |
| Hulls, beads | 1,024 | Shoals |
| Beams | 64 | Newest win, the tape keeps all |
| Motes | 2,048 or 4,096 | Dropped, HUD numbers stay exact |
| City lights | 8,192 | Oldest merge by cluster |
| Worlds | 32 with a slot | Outer worlds fold into a belt |

Real limits frame this: 16 concurrent agents and 1,000 per workflow run (`RF 4.4`) `[V]`, and starting limits of 6 running and 16 alive for owned agents (`AC 12.3`, those numbers are `[U]` in the report). So 100+ means many observed runs, or a long queue.

---

## 8. Performance plan

**Target:** 60 fps at 2560 x 1440 on the Intel Arc iGPU of the Core Ultra 7 155H, 2 GB shared. None of this has been measured. `[U]` The design leans on unlit shaders, instancing, a static sky and analytic antialiasing, so the risk is concentrated in one place: bloom.

### 8.1 A correction to DS

`DS 2.4` says to lower `resolutionScale` before lowering effects, and that the prop exists on `EffectComposer`. It does exist, but in `@react-three/postprocessing` 3.2.2 it only feeds `DepthDownsamplingPass` under `enableNormalPass`, and SSAO through context. `[V]`, source. It does not lower render resolution, and this pipeline uses neither. Under `mipmapBlur`, `BloomEffect`'s own `resolutionScale` is deprecated. `[V]`, source

**The real controls** are `dpr` on the Canvas, through `setDpr`, and `levels` on `Bloom`. `[V]`, source. Each level halves resolution (`MipmapBlurPass.setSize`). `[V]`

### 8.2 Budget

Computed for a typical frame with 20 agents. `[V]`, arithmetic. Timings are estimates. `[U]`

| Tier | Render size | Draws | Triangles | Points | Render targets |
|---|---|---|---|---|---|
| Totality | 2560 x 1440, 3.69 MP | 27 | 12,176 | 12,288 | 147 MB |
| Corona | 2176 x 1224, 2.66 MP | 25 | 12,176 | 10,240 | 104 MB |
| Penumbra | 1792 x 1008, 1.81 MP | 23 | 12,096 | 4,608 | 69 MB |

All under the DS budget of 100 draws, and far under 2 GB. Add 36,346 sky points on frames where the camera moves.

Estimated frame on Arc, tier Corona: `[U]`

| Stage | Estimate |
|---|---|
| Sky layer | 0 ms static, about 2 ms in flight |
| Lens composite | 0.6 ms, 1.2 ms with 8 wells |
| Corona at half resolution, 30 Hz | 0.5 ms average |
| Worlds, disc, sliver | 0.3 ms |
| Cities, hulls, beams, motes | 0.4 ms |
| Arcs | 0.5 ms |
| Bloom and post, 5 levels | 3.5 ms |
| **GPU total** | **about 6 to 7 ms** |
| Main thread, batching and labels | about 4 ms |

### 8.3 Quality tiers

| | Totality | Corona | Penumbra | Plate |
|---|---|---|---|---|
| When | Discrete GPU | Default on this Arc | Below 60 fps, on battery | No WebGL, context lost |
| `dpr` at 1440p | 1 | 0.85 | 0.7 | none |
| Bloom `levels` | 6 | 5 | 4 | none |
| Sky layer scale | 0.5 | 0.33 | 0.25 | SVG |
| Corona | half, 30 Hz | half, 30 Hz | third, 15 Hz | static SVG |
| Motes | 4,096 | 2,048 | 512 | none |
| City lights | 8,192 | 8,192 | 4,096 | counts |

The upscale from `dpr` below 1 is plain browser scaling, and hairlines will soften. Every line is drawn in screen pixels and widens by `1 / dpr` to compensate. The visible result is `[U]`.

**Stepping.** `PerformanceMonitor` only calls back (`DS 2.8`) `[V]`, so wire it: `onDecline` steps down one tier at once, `onIncline` steps up after 30 s stable. Remember the tier per machine in `localStorage`, inside try/catch.

### 8.4 Idle and data path

- **Idle costs almost nothing.** At 0 agents, `frameloop="demand"`, with `invalidate()` only on the sweep, a beacon tick, or input. The corona is frozen by `uTokenClock`, so a daily tool does not spin the fan. `[U]`
- **Three clocks** (`DS 2.2`). Daemon events batch into the store at most once per frame. `useFrame` reads with `getState()`. React re-renders rows at 4 Hz, not per event.
- **Hidden tab.** Stop rendering. On return, resync from a snapshot, no backlog replay.
- **Context loss.** R3F has no handler (`DS 2.8`) `[V]`. Listen on `gl.domElement`, show a DOM banner, fall back to Plate, rebuild targets on restore.
- **Offline.** No CDN at runtime: no Drei presets, no remote decoders (`DS 2.8`). The noise texture is generated.

### 8.5 First measurement

Before any other build work, port H1, H2 and bloom into one page and run it on this machine at 1440p. Read `gl.info.render`, frame time, and `EXT_disjoint_timer_query_webgl2` if it is exposed. `[U]` whether it is. If bloom misses budget, drop to 4 levels first, then Penumbra. If the look dies at 4 levels, the concept has a real problem, and that is the cheapest moment to find out.

### 8.6 Reduced motion

`prefers-reduced-motion`, through `MotionConfig reducedMotion="user"` and `gsap.matchMedia()` (`DS 2.9`). The information stays, the movement goes.

| Normal | Reduced |
|---|---|
| Boot eclipse | Cut to the system in 150 ms |
| Camera flights | Cut with a 120 ms fade |
| Orbiting | Craft sit at fixed positions, state by glyph and label |
| Well forming | Appears at full strength, static. The sky is still bent |
| Rebound | Ring removed, sky returns in one 150 ms fade |
| Meteors | City light fades in |
| Corona flow | Frozen |
| Day Reel | Off |

The rail and the assertive live region do not change. Never colour alone: every state has shape, motion or both, plus text (`DS 2.9`).

### 8.7 No WebGL: the Plate

The canvas is never the only route to an action (`DS 2.1`). The Manifest, rails, docket, launch and stop are DOM and work with no canvas at all.

The Plate is an SVG chart of the same system: disc with sliver gauge, worlds as circles, craft as glyphs on rings. Its 31 meridians are SVG paths recomputed at 4 Hz with the same lens equation, so **law 4 survives without a GPU: the lines still bend.** `[U]` as a build, the formula is the one in H1.

A focusable DOM list mirrors the scene for keyboard and screen reader use, with `aria-live="polite"` throttled, and assertive only for wells (`DS 2.9`).

---

## 9. Sound, optional and off by default

Silence is the default, and an eclipse is silent. With sound on, it follows the same rule as the picture: every sound is a signal, and nothing plays when nothing is happening.

All synthesised in WebAudio, with no sample files and no network. `AudioContext` starts on a user gesture. Master at about -24 LUFS. `[U]`

| Sound | Signal | Synthesis |
|---|---|---|
| Low drone | Fleet token rate. Silent at 0 | Two detuned sines near 55 Hz, gain from rate |
| Soft crackle | Tool calls | Filtered noise grains, one per `tool.started`, very quiet |
| Bowl tone | A well opens | One sine with a slow beat and long decay. Repeats at 30 s, 2 min, 10 min, a fifth higher each time |
| Sub swell | Dive into a well | Sine sweep down to 40 Hz |
| Struck glass | Approved | Two short partials |
| Low thud | Denied | Short sine drop |
| Air streak | Finish | Band-passed noise with a falling centre, staggered in a shower |
| Crack and hiss | Breakup | Noise burst, one per crash, rate limited |
| Bright chord | Diamond ring | Stacked sines, once per window |

Rules: a well is the only sound that repeats. Everything else stays under it, ducked by 6 dB while one is open. Sound is never the only channel for anything.

---

## 10. Boot and transitions

### Boot: an eclipse happens

The UI opens bright and goes dark, because that is what an eclipse does. The DOM HUD paints first and is usable from the first frame, and the canvas is lazy loaded (`DS 4.4`). Any key skips to the end. Stars appear because the indexer found them, so the sequence reports real progress.

| Time | Visual | What is really happening |
|---|---|---|
| 0.00 s | Screen warm `paper`, a flat bright sun. Wordmark in black | HUD painted |
| 0.16 s | First contact: the disc touches the sun's edge and slides across | Kernel link open, snapshot arriving |
| 0.88 s | Baily's beads: light breaks into points around the disc, one bead per live session | Live sessions known, from `sessions/` in under 1 ms (`RF 5.5`) `[V]` |
| 1.10 s | Diamond ring: one bead flares | First scene frame ready |
| 1.20 s | Totality: sky falls to `void`, corona unfurls, meridians draw outward from the disc | Sky layer rendered |
| 1.40 s | Worlds appear as silhouettes, limbs ignite, cities come on in a fast stagger | Main transcripts indexed, about 50 ms of work (`RF 5.4`) `[V]` |
| 1.60 s | Stars come out across the month, dusk in reverse | Worker indexing, up to about 4 s when cold, instant from cache `[V]` for the timing |
| 2.00 s | Sliver settles to the real window. Rails finish. Live craft are in place | Control returned |

The boot is one brightness transition, not a strobe, so it stays under three flashes per second. A white screen in a dark room is unkind, so it plays in full only on the day's first open, is 400 ms after that, and `boot: full, short, off` is a setting. Reduced motion always cuts straight to the system.

**Kernel start** uses the same language: `lost` craft appear as static, orphan sweeps run, and resume is offered only after the sweep, because a resumed turn can re-run its last command (`AC 2.4`). `[V]`

### Transitions

| From | To | Move | Time |
|---|---|---|---|
| System | World | `slingshot` along a curve, around bodies, world grows into frame | 1000 ms |
| World | Craft | Chase drop to behind the hull, limb rises | 800 ms |
| Craft | World | `esc`: pull back along the same curve | 700 ms |
| World | System | `esc`: pull back along the same curve | 700 ms |
| World | World | Swing past the star, sliver sweeps the frame | 1100 ms |
| Any | Well | `fall`, night side, low | 900 ms, 260 ms on repeat |
| Well | Previous | Rises back after the answer, unless another well is open | 500 ms |
| Any | Launch | Pull back to frame the star and all worlds | 700 ms |
| System | Sky mode | Scene dims to 20 %, sky takes focus, the bottom strip becomes a scrubber | 400 ms |

Rails and dockets use `settle` at 180 ms. They never wait for the camera, and the camera never waits for them.

**Scene events, not transitions:**

| Event | Sequence |
|---|---|
| **Launch** | Filament lifts from the corona, ejection, transfer arc with `ejection` for the real spawn time, orbit insertion with a short burn |
| **Reboost** | Drive flash, climb with `settle` from low to high orbit |
| **Landing** | Retro tick, `reentry` streak, `ignite` city light, new sky star at the now meridian |
| **Meteor shower** | A whole phase landing together, staggered 80 ms or more |
| **Totality** | Sliver thins to beads, then gone, limbs fall to minimum, countdown on the disc |
| **Diamond ring** | One bead, full bloom for 300 ms, light returns to every world with `contact` |

---

## Appendix A. What this asks of the kernel

The normalized types in `RF 9` carry almost everything. These are the additions.

| Addition | Why | Privacy |
|---|---|---|
| `toolClass` and `siteHash` on `tool.started` | Beam class, city placement | `siteHash` is a hash of the folder. The raw path stays in the kernel, and `tool.started` keeps carrying no text |
| `node.rate` at 4 Hz | Plume, corona, motes | Numbers only |
| `plan.changed { fiveHour, sevenDay, asOf, resetsAt, status }` | Sliver. Normalise both scales: 0 to 100 and 0 to 1 (`AC 6`) `[V]` | Numbers only |
| `kernel.tick` and `kernel.sweep` | Beacons, sweep ring | None |
| `history.digest` per transcript | Sky, cities, Almanac: `{nodeId, projectRoot, kind, startedAt, endedAt, model, bytes, usd, outcome, siteHash}` | No message text. Built by the indexing worker, cached by `(path, size, mtimeMs)` |
| `index.progress` | Stars coming out at boot | None |
| `contextWindow` for observed craft | Altitude. `max_input_tokens` from `cache/model-catalog` (`RF 7`) | None |

Rename the managed title prefix from `agentos:` to `naos:` in the dedupe contract (`AC 13`).

## Appendix B. Changes to the DS recommendation

| DS | This concept |
|---|---|
| Fonts in 4.1: Inter, Space Grotesk, JetBrains Mono | Remove. Add `@fontsource/cormorant`, `@fontsource/eb-garamond`, `@fontsource/b612`, `@fontsource/b612-mono`, all 5.3.0 |
| Tokens in 2.10 | Replace with section 4.2 |
| "Lower `resolutionScale`" in 2.4 | Use `dpr` and `levels`, section 8.1 |
| Signature moments in 2.10 | Replaced by section 10 |

Everything else in `DS 4` stands: exact versions, `three` 0.186.1, the `stats-gl` override, the Vite config.

## Appendix C. Risks

| Risk | Mitigation | Status |
|---|---|---|
| The Bend is missed | The rail row and the assertive live region exist from t = 0. The lens is the fast channel, never the only one | `[U]` |
| Bloom misses budget on Arc | Measure first, section 8.5 | `[U]` |
| The look does not survive AgX and a real GPU | The stills used a simple filmic curve, not AgX | `[U]` |
| Altitude is unknown for some craft | No `contextWindow`: hold mid orbit, tag `context unknown`. Never guess | `[U]` |
| Hairlines soften below `dpr` 1 | Screen-space widths, section 8.3 | `[U]` |
| Too many concepts to learn | Seven laws. The operator needs only the table of craft states | `[U]` |
| Long waits make the sky unusable | `thetaE` is capped. Wells older than 1 hour stop growing | `[V]`, arithmetic |
| Sky sparse on a new machine | Meridians show the Bend without any history | `[V]`, from the stills |
| On-disk formats change | All visuals bind to the normalized events, not to records (`RF` header) | `[V]` |

## Appendix D. Evidence and limits

Scripts and raw outputs are in `scratchpad/cosmos/`.

| Check | Result | Status |
|---|---|---|
| Three stills from a CPU port of the shaders | `out/plate-*.png`, `tools/plate.mjs`. Used to find six real defects | `[V]` |
| History survey | `tools/sky-survey.mjs`. `lstat` only, no file opened, no names printed | `[V]` |
| Palette | Dataviz validator, all pairs, section 4.2 | `[V]` |
| Text contrast | WCAG and APCA on three surfaces | `[V]` |
| Hues from wavelengths | CIE fit of Wyman, Sloan and Shirley, `tools/spectral.mjs` | `[V]` |
| Fonts | Packages downloaded to scratch, `cmap` read, import paths listed. Font code never run | `[V]` |
| GLSL | 7 of 7 parse, negative control fails | `[V]`, syntax only |
| `stage.tsx` | `tsc --strict`, negative control fails | `[V]`, types only |
| Lens, budgets, odometer | `tools/budget.mjs` | `[V]`, arithmetic |
| Wireframes | Width and border checked by script | `[V]` |
| Mapping coverage | Every event type, state and status in `RF 9` and `AC 5.1` checked by script against section 6 | `[V]` |
| Anything on a GPU, in a browser, in motion, or with a person | Not done | `[U]` |

**Scope notes.** The survey found 22 project folders against the 15 in the brief, 11 of them holding transcripts. The difference is presumably the spike workspaces. `[U]` Nothing was written outside the scratchpad except this file, nothing under `~/.claude` was touched, and no transcript was opened.
