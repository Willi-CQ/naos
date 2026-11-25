# Golgi

UI concept for the Agent OS. Angle: a living organism.
Written 2026-10-31. One of three independent concepts.

Golgi shows every agent on this machine as one culture of living tissue under a microscope. Cells charge, fire, bud and die. Finished work sinks into the tissue and stays there as anatomy, so the app is alive even when nothing is running. The operator sits at the centre of the organism, labelled with one small word: *you*.

**How claims are marked**

| Tag | Meaning |
|---|---|
| **[V]** | VERIFIED here. I ran it or read it in this session |
| **[R]** | VERIFIED in a research report that I read here. `runtime` is `docs/research/runtime-formats.md`, `control` is `agent-control.md`, `skills` is `design-skills.md` |
| **[U]** | UNVERIFIED. Design judgement, an estimate, or something nothing has run |

Design decisions are proposals, so they carry no tag unless they state a fact. **No frame of this design has been rendered on a GPU.** Every performance number is [U].

**Concept stills.** To judge composition without a browser, I wrote a CPU compositor that follows the planned layer order, fed with real anonymised history masses. The live scene in them is illustrative. They show composition and palette, not WebGL output, and they prove nothing about speed.

- The Reach, 20 agents across 5 projects: `scratchpad/organism/still-reach.png`
- Asleep, replaying history: `scratchpad/organism/still-sleep.png`
- Fixed tissue, the history view: `scratchpad/organism/still-fixed.png`

---

## 0. What the data changed

I measured how this fleet really fires before designing anything. Two read-only passes covered 2,102 transcripts, 2.07 GB and 268,244 records, and produced aggregates only. Method and limits are in Appendix C.

| Measured [V] | What it changed |
|---|---|
| Shell tools are 53.7 % of 61,824 tool calls, reads 32.5 %, writes 10.2 %. Budding is 0.28 %. 2.03 % of tool results are errors | **Loudness is the inverse of base rate.** The common signal must be the quiet one |
| Median 7 tool calls per active minute, p99 130, peak 17 in one second. Median gap between fleet tool calls is 958 ms | The screen is mostly quiet, so sparse signals must look good and linger. A 512-slot spike pool has 18.8x headroom over the real peak |
| A model call charges for a median 3.5 s, p90 19.8 s, p99 about 70 s | The natural rhythm is **slow charge, sudden fire**. That is an action potential, and it is also what the data can honestly show |
| 21 compactions, median 630,824 down to 14,553 tokens, a 97.7 % drop | Compaction is the most dramatic change a cell's body goes through |
| The top 2 of 11 stores hold 97.2 % of tool calls. Stores range from 30,985 calls to 0 | Project mass must be logarithmic, and asymmetry is honest |
| Human answers to questions took a median 167 s, p90 1,276 s (n = 11). Of 35,579 permission decisions, 92.5 % came from config and only 49 were one-off human answers. Another 2,589 carry `user_permanent`, and I did not establish how many of those were a live choice | On these sessions the approval moment is rare, so it can be grand. It must stay calm while it waits for minutes. Managed agents with stricter rules will ask more often [U], so repeats compress |
| Peak reality: 59 transcripts active in one minute, 32 overlapping agent lifetimes, 3 stores active in one minute | 59 is a real scale case. 100+ and 5 busy projects have not happened here yet |

From the research, three facts decide the whole design:

1. Assistant blocks reach disk only when a response ends, so thinking and writing cannot be shown live from disk. [R runtime §0]
2. Workflow agent records can arrive 46 s late, so no stall alarm under 120 s. [R runtime §0]
3. A read-only observer cannot approve, message or stop a session it did not start. Messaging needs an OS-owned broker session, and approval has no route at all. [R runtime §8]

A nervous system turns the first fact from a limitation into the look. A neuron charges silently and then fires all at once. Golgi does not pretend to stream tokens it cannot see.

---

## 1. Name, pitch, hero moment

### Name

**Golgi**. CLI: `golgi`. Say GOL-jee.

Camillo Golgi published a silver stain in 1873 that turns a small fraction of neurons black, about 1 to 5 %, which let anatomists follow single cells end to end. [V, web, Appendix E] The organelle with the same name packages cargo and sends it where it must go. So the name covers both planes: the stain that makes the nervous system visible, and the dispatcher inside the cell.

Checks: `golgi` is not on PATH here. [V] The name holds none of the banned words. [V] A web search found no AI agent product with this name, which is weak evidence. [V] The npm name `golgi` is taken by an unrelated web component framework at 1.6.1. [V] That does not matter for a private local binary, but a published package would need a scope.

### Pitch

> Golgi is a living nervous system on a microscope slide: every agent on your machine is a cell you can watch charge, fire, bud and die, and the only synapse it cannot close by itself ends in you.

### Hero moment: the Reach

Agents can spawn agents, and Claude can prompt Claude, but no agent may approve for another. "A parent cannot approve for a child." [R control §12.4] So the one thing the organism cannot do is inside its own anatomy. When it needs permission it has to reach outside itself, to the only other neuron there is.

| Time | Signal | What you see |
|---|---|---|
| 0.00 s | `approval.requested` | The cell stops charging. It swells 12 %. Its nucleus floods amber. The blocked spike sits frozen at the root of its neurite |
| 0.10 s | same | A tendril of pale tissue leaves that exact cell. If the request carries `subagentId`, it leaves the bud, not the parent. It runs up the project's tract toward the centre, with bulges travelling along it |
| 1.10 s | same | The tip reaches the empty centre, flares, and **flattens against the inside of the glass**. Tissue is pushed aside around it. It reads as a fingertip pressed against your monitor from inside. The heartbeat stops for 1.2 s, as if the organism holds its breath |
| 1.50 s | same | The approval card resolves on the flesh. It is the only pale surface on the screen. The roster pins the row and the screen reader gets one assertive announcement |
| 1.85 s | armed | Keys go live. Enter never approves |
| on answer | `approval.answer` | **Approve:** transmitter crosses, and a calcium wave runs back down the tendril into the cell and out through the whole tissue. The frozen spike continues |

The aim is three seconds, no explanation, and a stranger asking "what the hell is that". [U] The operator sees the most important event in the product, in the centre of the screen, tied to the exact cell that asked. Beauty carries the information.

The full sequence plays only if no approval arrived in the last 60 s. Otherwise it compresses to 450 ms, and under reduced motion it is instant. The median human answer took 167 s [V], so after contact the patch rests. It does not pulse for attention. Its rim slowly flushes redder with age, because there is no timeout and the UI must show age. [R control §9.1]

---

## 2. The metaphor

### The point of view

Most agent dashboards make you a pilot. Golgi makes you a scientist at a bench. The fleet is a specimen and the app is the instrument, which is why it cannot become a spaceship.

| Instrument part | In Golgi | Input |
|---|---|---|
| Round field of view | The only place the organism exists. Everything else is plain DOM on the dark stage around it | |
| Objective lens | 4x organism, 20x project, 100x cell | `1` `2` `3`, wheel |
| Focus knob | **Depth is time.** Near is now, deeper is older. You do not fly through it, you focus through it | `[` `]`, Shift+wheel, arc on the rim |
| Filter cube | Channels hide or show classes of signal, such as "only what changes the world" | Click, or `C` then `1` to `5` |
| Patch pipette | Write access. Selecting a cell patches it. Follow-ups are injected through the pipette | `Enter`, `/` |

There is no orbit camera, because a microscope has none. That keeps spatial memory stable and removes a whole class of confusion.

### The seven laws

These are testable rules, and any screen that breaks one is a bug.

1. **Stillness is information.** If nothing happened, nothing moves. A still cell really is idle.
2. **Loudness is the inverse of base rate.** Shell calls are quiet because they are constant. A write leaves a mark. A bud is an event. The Reach stops everything else.
3. **Dead things never look alive.** History is stain, replay has its own colour and label. An operator can never mistake the past for the present.
4. **Nothing moves once placed.** Layout is deterministic and stored. Your project stays at two o'clock forever.
5. **Never fake live.** Observed cells charge and fire per API response. Only managed cells show token flow, because only they have it.
6. **The body is the data.** Every fibre is a real transcript. Anything you can see can be clicked and leads to a real record.
7. **Plain words on every control and state.** Biology is for the eye. Labels stay `running`, `needs approval`, `error`. This document uses the biology, the UI does not.

### Entity map

| Entity | In the organism | What you see | Real source |
|---|---|---|---|
| **Project** | Ganglion | A cluster of cells in a fine glial capsule, at a fixed place, with dense history fibres around it. Size is log of lifetime tool calls | `projectRoot`, grouped across slugs [R runtime §3.3] |
| **Session** | Neuron | A cell with a blue nucleus. Soma shape shows the model, soma size shows context fill | `ObservedSession` [R runtime §9] |
| **Subagent** | Bud | A small cell that swells out of its parent, keeps a thin neck, and is absorbed when it ends. The neck is dashed when the link was only inferred | `parentNodeId`, `linkedBy` [R runtime §9] |
| **Workflow** | Stalk | A segmented stalk growing out of its parent, like a stacked polyp | `ObservedWorkflow` [R runtime §4.4] |
| **Phase** | Segment | One segment per distinct `started.phase`, in order of first appearance. Agents bud from their segment. Finished agents leave a ring on it | `phases[]`, journal [R runtime §4.4] |
| **Tool call** | Action potential | A spike on the neurite of its class. Its direction says whether the cell takes in or acts on the world | `tool.started`, `tool.finished` [R runtime §9] |
| **Approval request** | The Reach | A tendril that presses against the glass in front of you | `approval.requested` [R control §9.1] |
| **Token stream** | Charge, or flow | Observed: citron fills the cell while a request is in flight, then it fires. Managed: the cytoplasm visibly flows at the live rate | `api-request`, `stream_event` [R runtime §0, control §2.3] |
| **Cost** | Granules | Grains stored in the cytoplasm, read like an abacus: small $1, large $10, dark $100. Budget is a separate **yolk** that drains | `CostEstimate`, `maxBudgetUsd` [R runtime §3.4, control §6] |
| **Error** | Damage | A failed tool sends a magenta spike back the way it came. An API error burns a lesion. Retries make the cell tremble | `isError`, `api.error`, `api.retry` [R runtime §9] |
| **Idle** | Quiescence | The cell is completely still, nucleus lit. Only the shared heartbeat touches it | `activity: idle` [R runtime §3.5] |
| **Finished** | Apoptosis | Clean end: the cell condenses and sinks into deeper focus, where it stays as anatomy. Abandoned: it ruptures | `session.ended` [R runtime §9] |

### The rest of the body

| Thing | In the organism | What you see |
|---|---|---|
| The operator | *you* | One small italic word at the exact centre, in an empty void. Tracts converge on it. Human prompts travel out from it, approvals travel in to it |
| The kernel | Heartbeat | A faint ring leaves the centre once per second. It is the 1 s liveness loop, so if it stops, the kernel stopped [R runtime §5.5] |
| Plan window | Culture medium | The fluid colour follows the five-hour window, like phenol red: wine while fresh, then orange, then sulfur yellow when spent [V, web, Appendix E] |
| Context | Turgor | The soma inflates with context. Near the limit the rim gets thin and bright |
| Compaction | Shedding | The cell collapses to a fraction of its size and sheds a cloud of vesicles |
| Queued input | Docked vesicles | Dots lined up at the membrane, one per queued send |
| Worktree | Capsule | A second membrane around the cell, because it is isolated |
| Model | Cell type | See below |
| Managed or not | Labelled or wild | Managed cells carry a bright ring on the nucleus: you can act on them. **Wild** cells, `origin: observer`, have none and offer no controls |
| History | Tracts and sediment | One fibre per retained transcript, running from *you* to its project, then branching. Out-of-focus blue nuclei are real past agents |
| Claude prompts Claude | Division and crawl | `agent_spawn` splits a cell. The daughter crawls on a growth cone to its target project and plugs in. A new tract stays behind |
| Resume | Revive | The pipette touches a sunken cell and it refills. The kernel refuses if that session is alive elsewhere [R runtime §8] |
| Fork | Clone | A new cell buds from a sunken one, because `forkSession` gives a new id [R control §2.5] |
| Standing permission | Standing synapse | "Always this session" leaves a thin permanent line from the cell to *you*, so delegated authority stays visible |
| Retention | Resorption | When a transcript ages out, its fibre fades. Unused anatomy really does shrink [R runtime §1] |

### Signal classes

Neurons have polarity, so every cell has one. Its local "up" points at *you*. Dendrites face you and take things in. The axon points away and acts on the world. Shell neurites come out of the sides.

| Class | Tools | Share [V] | Anatomy | Direction | Colour | Loudness |
|---|---|---:|---|---|---|---|
| Effector | Bash, PowerShell, Monitor, TaskStop, TaskOutput | 53.70 % | Side neurite ending in a bouton | Out | `calcium` | Base level |
| Sensory | Read, Grep, Glob, WebFetch, WebSearch, ToolSearch, Skill, ListAgents | 32.54 % | Dendrites | **In** | `dapi` | Quietest |
| Motor | Edit, Write, NotebookEdit | 10.22 % | Axon | Out | `mcherry` | Loud, and leaves one ring on the axon |
| Secretion | StructuredOutput, SubagentHandback | 3.01 % | Vesicle along the stalk | Back to parent | `saline` | Small |
| Budding | Agent, Task, Workflow, `agent_spawn` | 0.28 % | New body | | All | An event |
| Gap junction | SendMessage, SendToProject, `agent_send` | 0.10 % | Arc between two cells | Cell to cell | `formalin` | Medium |
| Symbiont | `mcp__*` | 0.03 % | Small body on the membrane | Out and back | `saline` | Small |
| Human | AskUserQuestion, ExitPlanMode | 0.02 % | The Reach | To you | `reach` | Everything stops |
| Other | Anything else, 63 calls here | 0.10 % | Nucleus flicker | | `saline` | Faint |

Tool names are an open set, so an unknown name falls into Other, never into an error.

Neurite length grows with how much that cell uses that class, so **a cell's shape is a record of what it did**. A cell that mostly greps grows long dendrites. A cell that edits grows a long axon with many rings. You can read an agent's character at 20x without opening it.

### Cell types

| Model family | Share of messages [V] | Cell type | Soma | Roster glyph |
|---|---:|---|---|---|
| sonnet | 43.0 % | Stellate | Five uneven lobes, never a regular star | `*` |
| opus | 36.9 % | Pyramidal | Triangular, apical dendrite toward you | `A` |
| haiku | 19.1 % | Granule | Small and round | `o` |
| fable | 0.7 % | Purkinje | Large flask | `Y` |
| Unknown | | Plain | Oval | `.` |

Match by family name only. The real glyphs are small SVG silhouettes, not letters and not emoji.

---

## 3. Wireframes

All wireframes target 2560 x 1440. The field is 1372 px across. The side columns are 560 px wide. Sample names and numbers are placeholders. Biological words inside the field, such as `axon` or `yolk`, are notes for this document and do not appear in the UI. The side columns show real UI text.

### 3.1 Overview, objective 4x

The default view. Twenty agents across five projects, read in one sweep.

```text
golgi                                                                                                Plan window
KERNEL OK 20 AWAKE 1 NEEDS YOU                                                                       FIVE-HOUR 62 %  RESETS 1H 12M
                                                          . . . . . . . .                   [3]      SEVEN-DAY 31 %  AS OF 3 MIN
Needs you                                           . . .          project-c. .
A agent-10 needs appr. ||.|.|                   . .                 .    .      . .                  Needs you
                                              . .                   (*)(*)    . . . .                BASH agent-10 project-b  0:41
project-a        8  ~$5.3                   .                     .  .(A)             .              Nothing else is waiting
A agent-01 generating |.|| ||             .                        .    .               .
* agent-02 tool       .|| |.|           .                               .                 .          Activity
o agent-03 idle       ...  ..         .      [2]              .         .          .  .     .        MODEL CALLS IN FLIGHT       9
  wf build, phase 2/3 5 agents      .                             . .   .  .                  .      TOOLS / MIN                38
project-b        5  ~$18.5          .     .                         .   .                     .      CONTEXT, LARGEST         71 %
A agent-09 generating .| ||.      .                                     .                       .    SPENT, LIST PRICE     ~$41.20
* agent-11 generating ||.|.|      .                                    .                .       .
o agent-12 tool       | |.||                                           .                             Channels
  bud agent-13 generating .|    .     project-d                        .                          |  [x] READS, INBOUND
project-c        3  ~$28.4      |                       .             .          .      .         |  [x] SHELL, OUTBOUND
* agent-14 ERROR      |.  .    ||     .        .    .                 .              project-a    || [x] WRITES, LEAVE A MARK
* agent-15 generating ||.|||   |    (*)  (o) . . . . .               .                             | [x] DAMAGE
A agent-16 idle       ...  .   |  .                    . . .         .            . .(A) (*)-o-o   | [x] NEEDS YOU
project-d        2  ~$11.9     |              .              . you  . .   .           (o)   o-o    |
* agent-17 generating |. ||.   |                            .           . . . . . . .       o      |
o agent-18 tool       .||.|    |   .     .        .         .                            . .       |
project-e        2  ~$21.8     ||             [1]          .      .     .   ..                    ||
A agent-19 tool       | ||.|    |                          .             .          .             |
* agent-20 generating |.||.     |                          .               .  .      .            '
                                                          .      .   .   (A) (*).              .
shape = model   ticks = 5 min     '               .       .            . .    .                 '
                                  '                       .   . .  .       project-e            '
                                    '                     .                   .               '
                                    '                     .    .                              '
                                      '                   .  .                 .            '
                                        '          (A)(*)o.                               '
                                          '        . (A)(o)     .                       '
                                            '        .    .                           '
                                              ' '  project-b..    .               ' '
                                                ' '                             ' '
                                                    ' ' '                 ' ' '                      / MISSION  1 2 3 OBJECTIVE
                                                          ' ' ' ' ' ' ' '                            [ ] FOCUS IN TIME  TAB NEXT
```

- **Left, the roster.** It is also the raster: each row carries its last 5 minutes of spikes, the classic neuroscience plot. It is plain DOM plus one Canvas 2D strip, works with no WebGL, and is the real overview for an operator. `needs approval` pins to the top.
- **[1] Sediment.** Blurred blue nuclei and dim fibres are real past agents, out of focus.
- **[2] Tract.** The nerve from *you* to a project. Its width follows how many human turns went there.
- **[3] Rim.** Outer arc is the five-hour window, inner arc the seven-day window. No gauge tile is needed.
- Ticks in the raster use the record time, not arrival time, so a late workflow flush lands behind the now line and you can see the lag.

### 3.2 Zoom into a project, objective 20x

Neurites, buds, yolk, docked vesicles, capsules and the workflow stalk appear at this level.

```text
golgi / project-b  20x                                                                               project-b
KERNEL OK 5 HERE 15 ELSEWHERE                                                                        ROOT     C:/dev/project-b
                                                          . . . . . . . .                            BRANCH   main
Needs you                                           . . .                 . . .                      WORKTREE agent/k2f9
A agent-10 needs appr. ||.|.|                   . .                             . .                           agent/p7q1
                                              . .                                 . .
project-b                                   .agent-09  worktree          agent-11     .              Agents
A agent-09 generating .| ||.              .  .---------------.            /~~~\  bud    .            MANAGED 3   WILD 2
* agent-11 generating ||.|.|            .    :   /~~~~~\     :            | ( |--( )  agent-13       RUNNING 3   WAITING 1
o agent-12 tool       | |.||          .      :  /  ( )  \ ---:--> writes  \___/ neck        .
  bud agent-13 generating .|        .        :  \   o:: /    :  .      .     ooo  queued inputs      Activity
                                    .        :   \_____/ ==--: yolk                           .      MODEL CALLS IN FLIGHT       3
Elsewhere                         .          :  <-- reads    :    .                             .    TOOLS / MIN                12
project-a   8 agents ~$5.3        .          '---------------' .                                .    SPENT, LIST PRICE      ~$18.5
project-c   3 agents ~$28.4                                 .   .
project-d   2 agents ~$11.9     .     .  .   .                    .               .               |  Recent errors
project-e   2 agents ~$21.8     |             .                                                .. |  agent-12  Bash error    2 min
                               ||    .                  .                              .    .     ||
Backlog                        |                     agent-10  NEEDS APPROVAL                      | Selected
1 parked, needs an answer      |                   .   /!!!!!\ .         .              .          | agent-09  managed  opus
2 queued for admission         |                    .  |  !  |=====> to you              .         | CONTEXT 44 %   LEFT $0.61
                               |                       \_____/   .                      .          | ENTER patch  S stop  / inject
Ended here                     |                             ..          .                         |
12 ended, last 7 days          ||                                         wf build                ||
3 can be revived                |                                  .      ==|===|===|==>  stalk   |
                                |               .      .    ...          . ph1 ph2 ph3  .      .  '
                                         agent-12  wild, read only          o   o   o
                                  '        . . . . .   .                    o       o   granules'
                                  '       .  ( x )  .  lesion                                   '
                                    '      ' ' ' ' '         .                 . .            '
                                    '                                                         '
                                      '                                                     '
                                        '                                                 '
                                          '                                             '
                                     focus deeper for older tissue                    '
                                              ' '                                 ' '
                                                ' '                             ' '
                                                    ' ' '                 ' ' '
                                                          ' ' ' ' ' ' ' '                            2 FAR  3 CLOSER  ESC BACK
```

- The right column becomes the project dossier. Every line is an existing field.
- Wild `agent-12` has no nucleus ring and no action buttons. The dots only mark it in this ASCII drawing.
- Backlog shows work that is not visible as a cell yet: parked and queued.

### 3.3 Zoom into one agent, objective 100x, with live stream

A glass pipette enters and patches the cell. The cell fills the field.

```text
golgi / project-b / agent-09                                                                         Recording  structure only
100x  selected, managed                                                                              T shows text for this agent
                                                          . . . . . . . .
Agent                                               . . .                 . . .pipette         \\    14:02:07 request    opus
STATE    tool running 0:06                      . .                             . .        \\\\  \\  14:02:11 response   412 out
MODEL    opus 5.5, medium                 ~   . .                                 . .   \\\   \\\             thinking + tool
MODE     default                            .                                        \.\  \\\\       14:02:11 Read       0.2 s ok
ORIGIN   managed by golgi                 .   ~                                   \\\  \.\           14:02:11 request    opus
WORKTREE agent/k2f9                    reads, inbound                         \\\\ \\\\   .          14:02:19 response   88 out
FLUSH    live frames                  .           ~       .~~~~~~~~~~~~~~.  \\  \\\         .        14:02:19 Edit       0.9 s ok
                                    .                   .'                '.  \\              .               one ring on the axon
Usage                               .                ~ /                    \                 .      14:02:20 request    opus
CONTEXT  [#####-----] 44 %        .                   |~    .-------.   ::   |                  .    14:02:26 response   140 out
BUDGET   [###-------] $0.61       .   ~ ~             |    /         \  ::.  |                  .    14:02:26 Bash       running
SPENT    ~$1.39 list price                ~ ~ ~ ~ ~ ~ |   |  nucleus  |      |  axon: writes                  held 0:06
TURNS    7 of 40                .                     |    \   (o)   /   .   |====================|
QUEUED   1 follow-up            |                     |     '-------'        |  | | | one ring    |  Live, managed cell
                               ||                      \   granules: spend  /   per edit          || 45 tok/s   ttft 1.4 s
Lineage                        |                       ~'.                .'                       |
you                            |                   ~ ~    '~~~~~~~~~~~~~~'                         | - - - - - - - - - - - - - - -
`- agent-02  orchestrator      |                 ~               #        ---                      | > follow-up
   `- agent-09  this cell      |             ~ ~                 #      o o o- docked              |
      `- bud agent-21          |           ~                    ##            ---                  | ENTER queue after this turn
                               ||        ~                      #                -                || CTRL ENTER interrupt, send
Tool mix                        |      ~                        #                 --              |
shell  ########  31             |                              #                (yolk) budget     '  I interrupt  S stop  F fork
reads  #####     19                                            #                                     B add budget  M model
writes ##         6               '            shell, held     #                                '    ESC back to 20x
                                  '                           #                                 '
                                    '                         #                               '
                                    '                      (####)                             '
                                      '                                                     '
                                     trace, last 2 min                                    '
                                            /|        /|     /|____    waiting          '
                                      _____/ |___ ___/ |____/      |___/####          '
                                     request  response  tool  needs you           ' '
                                                ' '                             ' '
                                                    ' ' '                 ' ' '
                                                          ' ' ' ' ' ' ' '
```

- **Recording** is structure only by default. `T` reveals text for this one cell, as an explicit call. [R runtime §9] Thinking text never appears, because it is not available: blocks carry an empty string with a signature. [R control §2.3]
- **Managed cell:** frames arrive live, so the stream is per token and `tok/s` is a live estimate, smoothed over at least 1 s. [R control §2.3]
- **Wild cell:** the stream is per response. The header says `per response, may lag`, the follow-up box is replaced by `read only, this session belongs to another window`, and `S` is absent.
- **Membrane trace:** a strip chart of this cell's real events. Request ramps up, response fires, tool holds a plateau, needs-you clamps flat.

### 3.4 The approval flow

```text
  A  0.00 s  signal stops                     B  0.10 to 1.10 s  reach                    C  1.10 to 1.50 s  contact

              . . . . . . . .                             . . . . . . . .                             . . . . . . . .
          . .                 . .                     . .                 . .                     . .                 . .
      . .                         . .             . .                         . .             . .     .~~~~~~~~~~~~.      . .
    . .                             . .         . .                             . .         . .      /  pressed on  \       . .
   |.                                 .|       |.                                 .|       |.        |   the inside |         .|
  ||                                   ||     ||                                   ||     ||         \   of glass   /          ||
  |                 you                 |     |                 you                 |     |           '~~~~~~~~~~~~'            |
  ||                                   ||     ||             ===                   ||     ||          ==                       ||
   |'                                 '|       |'      ======                     '|       |'     ====                        '|
    ' ' (!) cell clamps,            ' '         ' ' (!)  tendril runs           ' '         ' '(!)                          ' '
      ' '   swells, amber         ' '             ' '    up the tract         ' '             ' '                         ' '
          ' '                 ' '                     ' '                 ' '                     ' '                 ' '
              ' ' ' ' ' ' ' '                             ' ' ' ' ' ' ' '                             ' ' ' ' ' ' ' '

                 . - ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ - .
            . '      flesh surface, the only pale thing on the screen                    ' .
         .'                                                                                  '.
        /     AGENT-10   PROJECT-B   OPUS   0:41                                               \
       |                                                                                        |
       |      wants to run a shell command                                                      |
       |      +----------------------------------------------------------------------+          |
       |      | command       npm run migrate -- --target staging                    |          |
       |      | description   Apply pending schema migrations                        |          |
       |      | blocked path  ./db/migrations                                        |          |
       |      +----------------------------------------------------------------------+          |
       |                                                                                        |
       |      [ A approve ]   [ S this session ]   [ D deny ]   [ X deny, stop turn ]           |
       |                                                                                        |
       |      E edit input first          R redirect with a new prompt                          |
        \                                                                                      /
         '.   armed after 350 ms. Enter never approves.                                      .'
            ' .                                                                          . '
                 ' - ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ - '
                                       ||
                                       ||  tendril. Age flushes the rim.
```

| Key | Decision | SDK return [R control §9.2] | What the tissue does |
|---|---|---|---|
| `A` | Approve | `allow`, `updatedInput: input` | Transmitter crosses, wave runs home and out through the tissue. Frozen spike continues |
| `E` | Edit and approve | `updatedInput` changed | As approve, plus a small scar on the tendril. The model is not told, so the audit log says so |
| `S` | Always this session | `updatedPermissions`, `destination: 'session'` | The tendril thins into a **standing synapse** that stays until the session ends. Later matching calls light it silently |
| `D` | Deny | `deny`, `message` | The tendril withers. A magenta nick stays on the blocked neurite. The default text is "Not approved for this call.", because policy-sounding denials made the model refuse later work |
| `X` | Deny and stop turn | `deny`, `interrupt: true` | The tendril is cut. The message is lost by design, so the injection box opens for guidance |
| `R` | Redirect | Send with `priority: 'now'` | The patch turns into the pipette and your text goes in. The approval is cancelled |

Rules from the research, all enforced in the card:

- `approval.cancelled` peels the patch away with the word `withdrawn`. Without this the UI would show a dead approval forever. [R control §9.1]
- Requests are keyed by `requestId`. A second answer returns false, so two open tabs are safe and show `answered elsewhere`. [R control §9.1]
- `decisionReason: "Path is outside allowed working directories"` opens on Deny. `defaultToNo` opens on Deny. `suppressAlwaysAllowRule` hides `S`. [R control §9.2]
- `mcpServer.name` is escaped unless `source` is `sdk`. [R control §9.2]
- `localSettings` suggestions are never passed through by default. [R control §9.2]
- `AskUserQuestion` shows a form on the patch. `ExitPlanMode` shows the plan and the patch grows to 60 % of the field. [R control §9.3]
- After a kernel restart, open requests turn grey and say `expired`. [R control §5.3]

Safety details:

- Keys arm after 350 ms, and only when the patch has focus, so typing elsewhere can never approve. `Ctrl+.` focuses it.
- Enter never approves. `Esc` returns focus and decides nothing.
- Further waiting cells hold their tendrils at the edge of the patch, up to 4, then `+N`.
- While you look at history, the Reach still tears through the stain. An approval is never hidden by a view state.

**The wild reach.** A wild session cannot be answered from here. Nothing can answer a foreign session's prompt, and a peer message "can't approve anything". [R runtime §8] So when its pid file says `waiting`, a pale dashed tendril rises and stops short of the glass. There is no patch and no buttons, only a row in `Needs you`: `answer in its own window (claude-vscode, name)`. It starts at the main cell, because the pid file does not say which subagent asked. [R runtime §3.5] That honesty matters more than the effect.

### 3.5 The mission command

`/` opens it from anywhere. The pipette enters the field and its tip follows the chosen project.

```text
golgi  4x
KERNEL OK 3 AWAKE                                                                                    +- Mission ------------------+
                                                          . . . . . . . .                            | Describe the work          |
project-b        3  ~$4.1                           . . .                 . . .                      |                            |
A agent-01 generating ||.|.                     . .                             . .                  |                            |
* agent-02 tool       .| |.                   . .                                 . .                +----------------------------+
o agent-03 idle       ...                   .                                         .              PROJECT  project-b  known repo
                                          .                                             .            PROFILE  Build, trusted repo
Others                                  .    .                                            .          MODEL    opus 5.5
project-a  project-c                  . project-c      .                                    .\\\     EFFORT   medium
project-d  project-e                .                 .                                    \ \.      BUDGET   $2.00
                                    .                                 pipette, tip follows\ \\.      TURNS    40
Target                            .           .   .    .              the selected project\\    .    WORKTREE [x] agent/k2f9
Up and down picks a project.      . .        .  . .                                   \\\\      .    MODE     default  plan  auto
The tip follows. Nothing is                    .  . .                               \\\\\            PARENT   none, root of a tree
injected until you confirm.     .  .                  .                            \ \            |
                                |            . .        .                       \\\\\             |  Preflight, no model call
                               ||                                               \ \       .       || LOADS    user project local
                               |                         ..                  \\\\\            .    | HOOKS    PostToolUse
                               |                           .                \ \                    |          SessionStart
                               |                             . you        \\\\\    project-a .     | CONTEXT  about 23k at start
                               |                                    . . .\.\. . .                  | ADMIT    3/6 running 3/16 alive
                               |                               .      \\\\\   .   . .              | WINDOW   62 %, stops at 80 %
                               ||                             .       \ \           ... .     .   ||
                                |                             .    \\\\\           .    .         |  Unknown repo: its hooks would
                                |                            .    \ \                     ..   .. '  run at spawn, so this profile
                                                             .  \\\\\                                switches to no project config.
                                  '              .          .  \ \         .              .   . '
                                  '                         .\\\\ .                             '    ENTER inject   ESC cancel
                                    '             .         . \                               '
                                    '                .    \.\\  .                    .        '
                                      '        .           (A)(*)                           '
                                        '              (+)..     .         .              '
                                          '             .                               '
                                            '  .---- project-b ----.                  '
                                              '' target, drop here '              ' '
                                                ' '                             ' '
                                                    ' ' '         ..      ' ' '
                                                          ' ' ' ' ' ' ' '
```

- Fields map to `agent_spawn` and base options. [R control §8, §12.2]
- **Profile** picks from the researched use cases: build in a trusted repo, unknown repo, read-only analyst, unattended long job, plan first, orchestrator, scratch. [R control §8]
- **Preflight** comes from `resolveSettings({ cwd })`, which spawns nothing and calls no model. [R control §2.9]
- **The trust warning is real.** With `project` in `settingSources`, a repo's `SessionStart` hook runs at spawn and its `.mcp.json` server starts, before any prompt and outside `canUseTool`. [R control §2.9]
- **Admission** shows the starting limits: 6 running, 16 alive, stop at 80 % of the window. These numbers are research judgement. [U] Over a limit the mission waits as a vesicle in the pipette, state `queued`.
- **Model** previews the cell type. **Budget** previews the yolk.
- The child's budget is `min(requested, parent remaining)`. [R control §6, design, U]
- CLI twin: `golgi spawn "..." --project x --profile plan --budget 2`.

### 3.6 Keys

| Key | Action | Key | Action |
|---|---|---|---|
| `/` | Mission | `Tab` | Next cell that needs attention |
| `1` `2` `3` | Objective 4x, 20x, 100x | `j` `k` | Move in roster |
| `[` `]` | Focus in time | `Enter` | Zoom in, patch |
| `0` | Back to now | `Esc` | Zoom out, close |
| `C` `1`-`5` | Toggle a channel | `T` | Show text for this cell |
| `Ctrl+.` | Focus the approval | `P` | Anonymous mode |
| `M` | Sound | `Shift+S` | Stop all managed agents in view, after a confirm |

**Anonymous mode** swaps every title for a Latin-style name hashed from the session id, for screenshots and streams. Real names return when it ends.

---

## 4. Visual language

### 4.1 Palette

The world is wet, warm and dark. There is no blue-purple gradient anywhere. Three of the colours come from real fluorescence microscopy: blue nuclei, green-yellow calcium, red marker. Hex values are canonical.

| Token | Hex | Role | On `stage` [V] | On `medium.acid` [V] |
|---|---|---|---:|---:|
| `stage` | `#0F0507` | Everything outside the field | | |
| `raised` | `#211215` | Panels, hover | | |
| `hairline` | `#4B373A` | Decorative rules only | 1.82 | 1.42 |
| `medium.fresh` | `#2A0611` | Culture fluid, window under 50 % | | |
| `medium.spent` | `#2A1206` | Culture fluid at 80 % | | |
| `medium.acid` | `#2C2206` | Culture fluid at 100 % | | |
| `phenol.0` / `.1` / `.2` | `#E0405F` `#E8843A` `#E8D24A` | Rim arc at the same three stops | 4.85 / 7.46 / 13.16 | 3.79 / 5.82 / 10.27 |
| `formalin` | `#E6EBE3` | Primary text, membrane light. Slightly green, so it is not a warm cream | 16.61 | 12.97 |
| `saline` | `#B9C0B6` | Secondary text | 10.79 | 8.43 |
| `silt` | `#949B91` | Tertiary text | 7.04 | 5.50 |
| `dapi` | `#9CC1F8` | Nuclei, identity, reads | 10.91 | 8.51 |
| `calcium` | `#E8FE52` | Activity: charge and shell spikes | 17.92 | 13.99 |
| `mcherry` | `#FD4620` | Writes: things that change the world | 5.81 | 4.54 |
| `cy5` | `#E04FC4` | Damage only | 5.82 | 4.55 |
| `reach` | `#F6B239` | Needs you, and nothing else | 10.86 | 8.48 |
| `foxfire` | `#70FFE4` | Replay only, never live | 16.37 | 12.79 |
| `flesh` | `#F9D7CF` | Contact patch surface | | |
| `flesh.ink` | `#2A1015` | Text on flesh, 13.22 on `flesh`, 6.98 on a flushed rim | | |
| `flesh.vein` | `#C86268` | Capillaries, decorative | | |
| `paper` | `#C29741` | Fixed tissue plate | | |
| `paper.wash` | `#D8BA79` | Plate highlight | | |
| `paper.ink` | `#180B03` | Silver stain and text, 7.17 on `paper`, 10.31 on `paper.wash` | | |
| `paper.carmine` | `#6A0D2C` | Damage in fixed tissue, 4.57 on `paper` | | |

Rules:

- `reach`, `cy5` and `foxfire` are exclusive to one meaning each. My first still used amber on the quota arc and it read as "needs you", so the arc now uses the phenol ramp.
- Every semantic colour passes 4.5:1 on every stage tone, including the spent medium. [V]
- `hairline` is below 3:1, so it never carries meaning. [V]

**Colour vision.** I searched for the semantic set that maximises the worst-case OKLab distance across normal, protan, deutan and tritan vision. The first hand-picked palette had a worst pair of 5.7. This one has a worst pair of 11.0, tritan `mcherry`/`cy5`. [V, arithmetic with the Machado 2009 matrices, entered from memory.] Colour is never alone anyway: each class also differs in direction, location and shape.

**Brand distance.** `mcherry` is the nearest token to a known brand colour, at an OKLab distance of 9.6 from terracotta `#D97757` and 11.0 from `#C15F3C`. It is far more saturated, and it marks writes, never identity. `formalin` is near-white, not a warm cream accent. [V for the arithmetic, U for the brand hexes, which are from memory.] The field has no regular radial burst: tracts curve, sectors are unequal, and stellate cells are never symmetric.

### 4.2 Type

The research proposed Space Grotesk, Inter and JetBrains Mono. The brief bans the first two, so this set replaces all three. All three are OFL-1.1. [V]

| Role | Family, exact CSS name | Package | Size, Latin woff2 [V] | Use |
|---|---|---|---:|---|
| Voice | `'IM Fell English'`, normal and italic | `@fontsource/im-fell-english@5.3.0` | 59.9 KB, 57.8 KB | Wordmark, section heads, captions, plate labels, *you*. At least 18 px |
| Reading | `'Atkinson Hyperlegible Next Variable'`, wght 200 to 800 | `@fontsource-variable/atkinson-hyperlegible-next@5.3.0` | 34.0 KB, italic 37.6 KB | Names, sentences, approval text. Designed for legibility, which suits a clinical tool |
| Instrument | `'Martian Mono Variable'`, wght 100 to 800, wdth 75 to 112.5 | `@fontsource-variable/martian-mono@5.3.0` | 38.5 KB with wdth | Telemetry, states, keys, commands. `font-stretch: 75%` in dense rows. Uppercase, at least 11 px |

IM Fell is a digitised 17th-century type with real ink wobble, and it looks like an anatomy plate. It is the single most unexpected thing in a developer tool, so it is used sparingly. Fell has only weight 400, and that is enough.

All labels are DOM. No 3D text means none of the troika problems. [R skills §2.5]

### 4.3 Materials and shaders

| Material | Idea |
|---|---|
| Medium | Flat phenol tint, modulated by a small tileable noise texture and darkened toward the rim. Never animated |
| Anatomy | Baked into textures, monochrome, tinted in the composite: near pale bone, mid rose, far deep red |
| Membrane | Screen-space metaballs. Cells fuse, stretch and pinch for free. A soft rim, never a vector outline. Fake refraction bends what lies behind |
| Nucleus | Soft disc in `dapi`, slightly grainy. Managed cells add a thin bright ring |
| Neurite | GPU Bezier ribbon with a soft core. Fresh links, flush lag under 2 s, show myelin beads through `sin(along * n)` |
| Spike | Short HDR comet, above 1.0 so that only spikes bloom |
| Contact patch | Flesh with fine friction ridges, capillaries at the edge, a dark wet margin, tissue displaced around it |
| Stain | Paper tint, ink from the same anatomy textures. No bloom, no glow, nothing moves |

### 4.4 Post-processing

Only bloom, with `luminanceThreshold: 1`, `mipmapBlur`, `intensity: 0.7`. Because the threshold is 1, the tissue should stay dark and only HDR spikes should glow. [R skills §2.4 for the defaults, U for the result] Everything else lives inside one composite pass.

Deliberately absent: depth of field as a pass (focus is baked), SSAO, scanlines, animated grain, lens flares, a chromatic aberration pass. Grain that moves would break law 1.

### 4.5 Motion language

GSAP `CustomEase` ships in public `gsap`. [R skills §3.2] Named tokens live in one module and are shared by GSAP, CSS and GLSL.

| Name | Curve | Duration | Used for |
|---|---|---|---|
| `charge` | `1 - exp(-t / 6 s)`, never reaches 1 | Length of the real call | Citron fill. A median call reaches 44 %, a p90 call 96 % [V, arithmetic]. A long call never falsely looks finished |
| `spike` | Rise in 30 ms, exponential decay | About 220 ms | Discharge, nucleus flash |
| `calcium` | Rise 140 ms, decay tau 1.3 s | About 4 s to fade | Afterglow behind signals. Sparse firing stays readable, because you can see where something just fired |
| `axoplasm` | Linear | Reads 900 px/s, shell 1,400 px/s, writes 600 px/s at 4x | Spike travel. Speed marks class, not duration |
| `turgor` | Critically damped spring, tension 170, friction 26 [R skills §2.12] | About 600 ms | Every size change |
| `pinch` | `expo.in` | 900 ms | A bud's neck thinning, then a snap |
| `crawl` | Linear with stick-slip pauses | 120 px/s at 4x | Growth cone between projects |
| `reach` | `power2.inOut`, plus a travelling sine | 1,000 ms | Tendril |
| `press` | `cubic-bezier(.2, 1.4, .3, 1)` | 320 ms | Flattening on glass. The only overshoot in the product |
| `wither` | `power3.in` | 480 ms | Deny, withdrawn |
| `apoptosis` | `power3.in`, then `sine.inOut` | 1,400 ms, then 2,400 ms | Condense, then sink |
| `heartbeat` | `sine.out` | Ring takes 700 ms, one per real tick | Liveness ring, lifts anatomy 6 % at most |
| `objective` | `power3.inOut` | 520 ms | Zoom between lenses |
| `focus` | `power2.out` | 400 ms | Focus change |
| `meniscus` | `cubic-bezier(.22, 1, .36, 1)` | 220 ms | HUD enter and exit, no overshoot |

Ownership follows the research: `useFrame` for per-frame values, GSAP for scripted beats, `motion/react` for HUD, CSS for hover. [R skills §2.6]

### 4.6 HUD style

The HUD looks like engraving on an instrument. Text sits directly on the stage, with hairline rules and no boxes. There are no rounded corners, no glass, no blur and no cards. Near-opaque DOM also avoids the `backdrop-filter` cost over a live canvas. [R skills §2.7]

The HUD never overlaps the field, except for labels and the contact patch.

---

## 5. Hero techniques

Everything sits on the tested stack: three 0.186.1, R3F 9.8.2, postprocessing 6.39.5. [R skills §4]

**Verification of this section.** The R3F skeleton for the render graph passes strict `tsc` 6.0.3 against that exact set. All 7 shader files pass a GLSL parser, syntax only. [V] Nothing ran on a GPU. [U] The effort numbers are for one experienced developer. [U]

### Render graph

```text
OFFSCREEN, useFrame priority -1, which keeps automatic rendering on       [R skills 2.6]
  field     343 x 343  RGBA16F   instanced gaussians    r membrane  g capsule  b heat  a charge
  afterglow 343 x 343  RGBA16F   ping-pong              previous frame decays, spikes add
CACHED, re-baked only when history changes
  anatomy   2048 near, 1024 mid, 1024 far  RG8 + mips   r fibres  g nuclei
MAIN SCENE, EffectComposer at priority 1, HalfFloatType, multisampling 0
  ribbons   neurites, stalks, tracts                    instanced quad strips
  spikes    fire and forget                             instanced quads
EFFECTS, EffectComposer mergeMode="none", so each is its own pass
  Membrane  medium + anatomy at focus LOD + refraction + rim + charge + afterglow
  Contact   always mounted, early-out unless an approval is open
  Bloom     threshold 1
```

`mergeMode="none"` is required. `Contact` samples `inputBuffer` at displaced coordinates, so it declares `EffectAttribute.CONVOLUTION`. In the default `auto` mode the wrapper would merge it with `Membrane` into one `EffectPass`, and `inputBuffer` would then hold the image from before `Membrane` ran. [V, read in `@react-three/postprocessing` and `postprocessing` source, not run]

| Canvas setting | Value | Why |
|---|---|---|
| `dpr` | 1, at most 1.25 | iGPU [R skills §2.4] |
| `flat`, `antialias: false`, `stencil: false` | | The composer owns the frame [R skills §2.4] |
| `frameloop` | `demand`, driven by one scheduler | 60 Hz awake, 30 Hz asleep, 0 hidden |
| Canvas count | 1 | The raster is Canvas 2D, so no second WebGL context [R skills §2.1] |

Use `RawShaderMaterial` with `glslVersion: GLSL3`, and write `texelFetch` for curves. Render targets are 16F, not 32F, since blending on 32F needs an extra extension. [U from memory of the WebGL rules, check on the Arc.] Picking is a spatial hash over known positions, not a raycast, because layout is deterministic.

### T1. The membrane field

**The key trick.** Cells are not meshes. Each is a few gaussians added into a quarter-resolution float buffer, and one composite pass thresholds the result. Everything organic comes free: blobs fuse, necks stretch and pinch, lesions are negative blobs, and the capsule is a lower threshold on another channel.

Instancing: one `InstancedBufferGeometry` quad, capacity 2,048. Attributes `aBlob` (x, y, radius, born) and `aChannels`. Growth is computed in the vertex shader from `born`, so a new cell costs one attribute write. Soma shapes are 1 to 6 lobes from a table per cell type.

```glsl
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec4 f = texture(tField, uv);
  vec2 g = vec2(density(uv + vec2(uTexel.x, 0.0)) - density(uv - vec2(uTexel.x, 0.0)),
                density(uv + vec2(0.0, uTexel.y)) - density(uv - vec2(0.0, uTexel.y)));
  float inside = smoothstep(0.45, 0.55, f.r);
  vec2 lens = g * 0.06 * inside;                                 // wet refraction of what lies behind
  vec3 back = uMedium + textureLod(tAnatomy, uv + lens, uFocusLod).rgb + inputColor.rgb;
  float rim = exp(-pow((f.r - 0.5) / 0.05, 2.0));
  vec3 color = mix(back, uCytoplasm, inside * 0.72) + rim * uMembrane * 0.34;
  color += inside * f.a * f.a * uCalcium * 1.25;                 // charge fills the cell from the inside
  color += f.b * uReach * 0.36;                                  // heat around a cell that needs you
  outputColor = vec4(color + texture(tGlow, uv).rgb, 1.0);
}
```

Use four explicit taps for the gradient, since `dFdx` is blocky across 2 x 2 quads. [U] **Effort: 5 days.**

### T2. Neurites as GPU Bezier ribbons

Drei `Line` builds one object per line, which is ruled out. [R skills §2.3] Instead, one quad strip is instanced, and control points live in a `DataTexture`.

- Curves: RGBA32F, 4 texels per row, 4,096 rows, 256 KiB. [V, arithmetic]
- Live ribbons: 512 instances at 24 segments, about 24,600 triangles. [V, arithmetic]
- Growth is `tip = (now - born) * rate` in the vertex shader. No JS runs per frame.
- Width follows use, which is the Hebbian part: well-used pathways thicken.

**Effort: 4 days.**

### T3. Action potentials, fire and forget

JS writes one record per event, and the GPU owns all motion. That makes the per-frame JS cost of signals zero, however many there are.

```ts
const fire = (curve: number, now: number, seconds: number, dir: 1 | -1, amp: number, rgb: readonly [number, number, number]) => {
  const i = head
  head = (head + 1) % SPIKES
  row.setX(i, curve)
  spike.setXYZW(i, now, seconds, dir, amp)
  color.setXYZ(i, rgb[0], rgb[1], rgb[2])
  row.addUpdateRange(i, 1)
  spike.addUpdateRange(i * 4, 4)
  color.addUpdateRange(i * 3, 3)
  row.needsUpdate = spike.needsUpdate = color.needsUpdate = true
}
```

```glsl
void main() {
  float s = (uTime - aSpike.x) / aSpike.y;
  if (s < 0.0 || s > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // clipped: slot is idle
  float t = aSpike.z > 0.0 ? s : 1.0 - s;
  int row = int(aRow);
  vec4 a = texelFetch(uCurves, ivec2(0, row), 0);
  vec4 b = texelFetch(uCurves, ivec2(1, row), 0);
  vec4 c = texelFetch(uCurves, ivec2(2, row), 0);
  vec4 d = texelFetch(uCurves, ivec2(3, row), 0);
  vec2 q = normalize(tangent(a.xy, b.xy, c.xy, d.xy, t) + 1e-5) * aSpike.z;
  vec2 n = vec2(-q.y, q.x);
  vec2 p = bez(a.xy, b.xy, c.xy, d.xy, t) + q * position.x * uSize.x + n * position.y * uSize.y;
  vQ = position;
  vColor = aColor * aSpike.w * (1.0 - s * s);
  gl_Position = vec4((uView * vec3(p, 1.0)).xy, 0.0, 1.0);
}
```

Capacity 512, against a real peak of about 27 live spikes. [V, arithmetic] Replay and tract traffic share the pool.

**Burst unpack.** One flush can hold several tool calls with their results. [R runtime §5.2] The kernel feed plays such a flush in order, keeping real relative gaps, capped at 1.5 s in total. The HUD still shows real timestamps.

**Effort: 3 days.**

### T4. Calcium afterglow

A quarter-resolution ping-pong buffer. Each frame it keeps `mix(c, blur4(c), 0.22) * exp(-dt / 1.3)`, then new spikes are added. Signals leave a fading trace that spreads a little. At 7 tool calls a minute this is what makes the organism feel alive, because you can see where something fired seconds ago. **Effort: 1 day.**

### T5. Anatomy, and focus through time

This is what makes the empty state rich at almost zero cost.

- **Baked.** One fibre per retained transcript, 2,102 here. [V] Each leaves *you*, runs in its project's tract, then branches. The bake is seeded by session id, so it is stable.
- **Depth.** Near is the last 24 h, mid 1 to 7 days, far older. Blur is hardware mips, read with `textureLod`, so focus costs one LOD change.
- **Cost.** Almost nothing per frame: one texture read per layer. All three layers take 16.0 MiB as RG8 with mips. [V, arithmetic]
- **Re-bake** only when something sinks or retention removes a transcript, in a worker with an `OffscreenCanvas` 2D, then one texture upload. [U]

**Effort: 4 days.**

### T6. Budding and crawling

- **Bud.** The daughter blob starts inside the parent and moves out with `pinch`. The metaball threshold forms the neck by itself, which thins and snaps. No mesh surgery is needed. I saw this neck appear in the CPU still from nothing but two gaussians and a small one between them. [V]
- **Stalk.** A ribbon plus a blob per segment. Agents bud in alternating whorls, up to 16 live per run. [R runtime §4.4] Finished agents become rings drawn in the ribbon shader from a count.
- **Crawl.** `agent_spawn` to another project: a ribbon grows behind a small blob. Three to five very short ribbons at the tip flick out and retract as filopodia.
- Parent links that are `inferred` use a dashed ribbon.

**Effort: 3 days.**

### T7. The Reach

- Tendril: a chain of up to 40 field blobs along the tract curve, with radius growing toward the tip and flaring at the end. It is real tissue in the same field, so it fuses with the cell.
- Contact patch: a separate effect that stays mounted, because compiling a shader at the moment of an approval would stall the frame. With nothing open it exits early. [U for the stall]
- The card is DOM on top, with a real focus trap and a real `aria-live`.
- The heartbeat stops for 1.2 s through a body clock. Spike clocks are not touched, so other agents' signals stay truthful.

```glsl
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uRadius <= 0.0) { outputColor = inputColor; return; }      // nothing is open
  vec2 p = uv - uCenter;
  float a = atan(p.y, p.x);
  float wob = 1.0 + 0.040 * sin(3.0 * a + 0.6) + 0.028 * sin(5.0 * a + 2.1);
  float d = length(p) / (uRadius * wob);
  vec2 bent = uCenter + p * (1.0 - 0.20 * pow(clamp(1.46 - d, 0.0, 1.0), 2.0) * step(1.0, d));
  vec3 behind = texture(inputBuffer, bent).rgb;                  // tissue is pushed aside at the point of contact
  behind *= 1.0 - 0.72 * exp(-pow((d - 1.035) / 0.05, 2.0));     // dark wet margin
  float warp = texture(tNoise, uv * 2.3).r * 40.0;
  float ridge = sin((d * 230.0 + warp) * 0.58);                  // friction ridges
  float edge = pow(clamp((d - 0.60) / 0.40, 0.0, 1.0), 1.8);
  float flush = clamp(uAge / 600.0, 0.0, 1.0);
  vec3 skin = mix(uFlesh, uVein, edge * (0.62 + 0.2 * flush));
  skin *= 1.0 - (0.022 + 0.13 * edge) * (0.5 + 0.5 * ridge);
  outputColor = vec4(mix(behind, skin, smoothstep(1.0, 0.99, d)), 1.0);
}
```

The patch radius is 246 px, 0.359 of the field radius, or 0.383 at its widest lobe. Capsules stay outside 0.375 with real masses, so the patch hides no cell and at most grazes a capsule edge. [V, geometry] **Effort: 4 days.**

### T8. Medium and medium change

One uniform lerped through three stops, and a CSS variable for the stage. It moves over 20 s, so you sense it rather than watch it. When `resets_at` passes, fresh medium sweeps across the dish in 3 s. Lab people will smile, and everyone else learns that their window just reset. **Effort: 1 day.**

### T9. Fixed tissue

One uniform moves the composite from fluorescence to stain. Paper tint replaces the medium, and the same anatomy textures become ink. The CPU stain still came straight from the fibre data with no art pass, and it looks like a plate from an old anatomy atlas. [V for what the still shows] The same layout drives the no-WebGL fallback. **Effort: 2 days.**

### T10. Dream

A worker builds an **engram**: one 12-byte row per tool call with time, node, class, flags and duration, and no text. 61,824 rows take 725 KiB. [V, arithmetic] A single-threaded full parse of 2.07 GB took 32 s here, so it runs once at low priority and then only touches changed files. [V for the 32 s]

The scheduler picks the last active day, drops gaps over 5 minutes, and scales it to 210 s. A median day of 1,765 calls fires 8.4 spikes a second, the busiest day 34 a second. [V, arithmetic] Order is kept and duration is not, which matches how biological replay is described. [V, web, Appendix E] I did not find a verified speed factor, so the UI just shows its own ratio. **Effort: 3 days, plus kernel work.**

### T11. Layout

A pure module with no WebGL, shared by the renderer and the fallback.

- **Ganglia:** an R2 low-discrepancy sequence with dart throwing, mapped into an annulus from 0.47 to 0.86 of the field radius. Every prefix is well spread, so adding a project moves nobody. It holds 36 ganglia at a gap of 0.20. [V]
- **Capsule radius:** `0.045 + 0.028 * log10(1 + tools)`, capped by half the distance to the nearest ganglion. Without the cap, two capsules overlapped by 0.027 with real masses. With it, clearance is 20.5 px. [V]
- **Cells:** phyllotaxis at the golden angle, always the lowest free slot. Spacing stays 46.4 px at c = 30 px with a 13 px soma, from 2 to 100 cells, so cells never touch. [V]
- Slots are written to `layout.json` and never recomputed.
- Project labels go on the outward side of the capsule, with collision checks. In the CPU still, naive placement put two labels over cells.

**Effort: 2 days.**

### T12. Roster raster

DOM rows plus one Canvas 2D strip per group. Each tick shifts the image by 1 px and draws only new ticks, so cost does not grow with history. 300 s across 226 px is 1.3 s per pixel. Rows are virtualised beyond 40. **Effort: 3 days.**

### Effort total

| Block | Days [U] |
|---|---:|
| T1 to T5, core image | 17 |
| T6, T7, hero behaviour | 7 |
| T8 to T12, medium, stain, dream, layout, roster | 11 |
| Quality tiers, fallback, boot, sound | 7 |
| **Total for one developer** | **42** |

---

## 6. Real-time mapping

Every row is an existing signal from the research. Four small kernel additions are listed in Appendix A.

Latency caveats that apply throughout: main session records reach disk within 1.3 s, workflow agents up to 46 s. [R runtime §5.2] Control-plane frames are live. The kernel feed outranks the transcript for managed agents. [R control §13]

### 6.1 Observer events

| Event | Visual response | HUD echo |
|---|---|---|
| `session.discovered` | A soma condenses in the lowest free slot, `turgor`. Cells already alive at boot just appear | Roster row added |
| `session.changed` | No motion of its own. The field that changed drives its own row in 6.3 | Row text updates |
| `session.changed`, new `sessionId`, same `pid` | `/clear` or `/resume` mutates the id while the process stays. [R runtime §2.1] The cell stays in place, the old conversation leaves a fibre, and the soma resizes to the new context with `turgor` | Title changes |
| `session.ended`, `clean` | `apoptosis`: condense, sink to near depth, stays as a fibre | `finished`, row leaves after 10 s |
| `session.ended`, `abandoned` | Rupture: membrane tears and fragments scatter. A mark stays in the sediment | `abandoned` |
| `session.ended`, `unknown` | As clean, with a hollow nucleus | `finished?` |
| `session.ended`, reason `pid-recycled` | As its outcome | Tag `pid reused` |
| `agent.started` | Bud or stalk bud, `pinch`. Stalk for a new workflow | Row indented under parent |
| `agent.ended`, `completed` | Bud is absorbed up its neck. One ring stays | Row collapses |
| `agent.ended`, `failed` | Bud ruptures. One `cy5` ring stays | `failed` |
| `agent.ended`, `stopped` | Neck is tied off clean | `stopped` |
| `agent.ended`, `orphaned` | Stalk greys and keeps its place, no heartbeat | `orphaned`, in `Needs you` as info |
| `agent.ended`, `unknown` | As completed, hollow ring | `ended?` |
| `turn.started`, `human` | White drop travels out of *you* down the tract into the cell | Raster mark |
| `turn.started`, `task_notification` | Drop arrives back along a stalk from a bud | Raster mark |
| `turn.started`, `peer` | Drop arrives across a gap arc | Raster mark |
| `turn.started`, `sdk` | Thin drop down the tract | Raster mark |
| `turn.started`, `scheduled` | Drop enters from the rim | Raster mark |
| `turn.started`, `unknown` or `system` | Membrane flash with no direction | Raster mark |
| `turn.ended` | One settle ring leaves the nucleus and charge drains. The cell goes still | State changes |
| `request.started` | `charge` begins | `generating`, model name |
| `message.completed` | Discharge `spike`, scaled by log of output tokens. Block mix shows after the fact: `thinking` flashes the nucleus, `text` the membrane, `tool_use` releases spikes | Recording row, block types |
| `tool.started` | Spike on the neurite of its class, in its direction | Raster tick, recording row |
| `tool.finished`, ok | If it was held, the bouton releases | Row gets its duration |
| `tool.finished`, `isError` | Spike runs **backward** to the soma in `cy5` | Row marked, count up |
| `tool.finished`, `decision: reject` | Spike dies at the root with a magenta nick | `denied` |
| `usage.changed` | Soma size follows context. New granules appear. Yolk drains | Numbers update |
| `workflow.changed` | Segments, buds and rings update. Terminal status: stalk stiffens and sinks | Phase count `2/3` |
| `compacted` | Soma collapses in 800 ms and sheds a vesicle cloud that sinks. Shown after the fact for wild cells | `compacted 630k to 15k` |
| `api.retry` | Tremor, amplitude from `attempt / maxRetries`. A thin ring drains over `retryInMs`. Not magenta: nothing has failed | `retrying 2/10, 8 s` |
| `api.error` | Lesion: dark pit with a `cy5` rim | `error`, status |
| `rate_limit.hit` | Hypoxia: cell pales, rim dims, countdown ring to `resetsAt` | `rate limited, resets 1h 12m` |
| `tail.reset` | Membrane flickers once | Splice mark in the raster |

### 6.2 Activity states

`activity.changed` carries these. Each state of `Activity` is one body state, resolved in the research's priority order. [R runtime §3.5]

| State | Body | Label |
|---|---|---|
| `starting` | Soma forming, nucleus dim | `starting` |
| `generating` | `charge` fill. `lastBlock` appears later in the recording, never live | `generating` |
| `tool_running` | Held bouton on each open tool, with the glow growing slowly | `tool`, name, age |
| `waiting`, `permission prompt` | Managed: the Reach. Wild: the wild reach | `needs approval` |
| `waiting`, `input needed` | Same, form on the patch if managed | `needs input` |
| `waiting`, `sandbox request` | Wild reach, labelled | `sandbox request` |
| `waiting`, `worker request` | Wild reach, labelled | `worker request` |
| `waiting`, `dialog open` | Wild reach, labelled | `dialog open` |
| `waiting`, `unknown` | Wild reach, labelled | `waiting` |
| `retrying` | Tremor and ring | `retrying` |
| `compacting` | Soma shrinks while shedding. Managed cells only, because disk has no live signal [R runtime §3.5] | `compacting` |
| `idle` | Still, nucleus lit | `idle` |
| `idle`, `backgroundShell` | Still, one bouton stays lit | `idle, shell running` |
| `interrupted` | The active neurite is cut and the stump retracts in 300 ms | `interrupted` |
| `errored`, `rate_limit` | Hypoxia | `rate limited` |
| `errored`, `api` or `unknown` | Lesion | `error` |
| `finished`, `clean`, `abandoned` or `unknown` | See `session.ended` | |
| `unknown` | Hollow nucleus, no motion | `unknown` |

A `busy` agent with no record for 120 s gets a quiet tag, `quiet 2m`, in `silt`. It never gets an alarm colour. Real shell calls pass 124 s at p99, so 120 s of silence is normal. [V]

### 6.3 Fields

`None` in the Visual column means the body does not change, so the HUD column is that signal's visual. Addresses and joins are listed so that nothing is left out, but they are not signals.

| Field | Visual | HUD |
|---|---|---|
| `liveness: alive` | Takes part in the heartbeat | |
| `liveness: dead` | Ends as above | |
| `liveness: recycled` | After 2 ticks, ends as above | `pid reused` |
| `liveness: foreign` | Sits in a dim annex at the rim, no heartbeat | `other host` |
| `liveness: unknown` | Hollow ring around the nucleus | `liveness unknown` |
| `origin` | Managed cells get the nucleus ring, wild cells do not | `managed` or `wild`, and controls appear or vanish |
| `kind`, `entrypoint`, `version` | None on the body, because they do not change behaviour | Chips at 100x. `bg` maps to `background` |
| `remoteControlled` | Small mark on the membrane | `remote` |
| `acceptsPeerMessages` | None | Enables `send through broker`, later |
| `queuedInputs` | Docked vesicles, one each | `queued 2` |
| `model`, `requestedModel` | Soma shape | Model name |
| `effort` | Nucleus size, three steps | Text |
| `permissionMode` | Ring style on the capsule at 20x and closer. `plan` dotted, `auto` none | Chip |
| `contextTokens / contextWindow` | Soma size. Near full the rim thins and brightens | Bar at 100x |
| `usage`, `usageTree` | Granules | Numbers |
| `cost.usd` | Granules, abacus: small $1, large $10, dark $100. Fits the real range up to $800 a session tree [V] | `~$1.39` |
| `cost.isEstimate` | None | `~` prefix, `list price` label |
| `cost.isLowerBound` | None | `>=` prefix |
| `cost.unpricedModels` | None | Footnote mark |
| `worktree`, `worktreePath`, `worktreeBranch` | Second membrane | Branch name |
| `gitBranch` | None | Text, `HEAD` shows as `detached` |
| `flushLagMs` | Myelin beads when under 2 s, plain neurite otherwise | Row age |
| `linkedBy` | Dashed neck when `inferred` | Tooltip |
| `spawnDepth` | Position in the lineage | Lineage tree |
| `agentType` | None | Text |
| `background` | None | Chip |
| `description` | None. It is private model text [R runtime §9] | Only on `T` |
| `title`, `displayName` | None | Row name. `lastPrompt` is never used as a fallback here, because it is sensitive text [R runtime §3.1] |
| `workflow.attempt`, `counts.retried` | Second bud on the same spot with a scar | `retry 1` |
| `transcriptBytes`, `lastRecordAt` | Fibre weight in the anatomy | Row age |
| `partialOutputMessages` | None | Sets `isLowerBound` |
| `lastRateLimit` | Hypoxia, if current | Text |
| `WorkflowStatus` `running`, `completed`, `failed`, `killed`, `orphaned` | Growing, sinks, sinks with `cy5` ring, tied off, grey and detached | Text |
| `counts`, `durationMs`, `totalTokens`, `totalToolCalls`, `statusSource` | Rings on segments show the counts | Stalk dossier at 20x |
| `phases`, `phase`, `index`, `agentNodeIds`, `running`, `completed`, `failed` of a phase | Segment order, and which agent sits on which segment | Phase count |
| `name` of a workflow, `label` | None | Text at 20x |
| `projectRoot` | Chooses the ganglion | Project name |
| `startCwd`, `currentCwd`, `cwd` | None | Path at 100x |
| `titleSource` | None | Picks the title, skipping `lastPrompt` |
| `pidStatus` | Input to `Activity`, never drawn alone | |
| `startedAt`, `endedAt`, `lastWriteAt` | Finished cells: depth in the anatomy | Age text |
| `agentCount`, `runningAgentCount` | Buds and stalks already show them | Group header in the roster |
| `toolCalls` | Neurite length | Tool mix at 100x |
| `errors` | Small lesion marks, up to 5, then a count | Count at 100x |
| `childNodeIds`, `parentToolUseId` | One neck per bud | Lineage tree |
| `estimateUsd`, `costStateUsd` | Granules use `usd`, the higher of the two [R runtime §3.4] | `~` drops once a non-zero `cost-state` exists |
| `input`, `output`, `cacheRead`, `cacheWrite5m`, `cacheWrite1h`, `messages`, `webSearchRequests` | Granules, through cost | Breakdown at 100x |
| `sessionId`, `agentId`, `nodeId`, `rootNodeId`, `key`, `runId`, `taskId`, `workflowRunIds`, `slugs`, `transcriptPath`, `metaPath`, `journalPath`, `statePath`, `scriptPath`, `transcriptDir`, `parentNodeId` | None. They are addresses and joins, not signals | Copyable at 100x |

### 6.4 Control plane

Managed agents have far richer signals, and that visible difference is honest.

| Signal | Visual | HUD |
|---|---|---|
| `queued` | Vesicle held in the pipette at the rim | Backlog |
| `spawning` | Droplet lands, soma condenses over about 1.26 s [R control §2.1] | `spawning` |
| `ready` | Formed, nucleus lit, not charging | `ready` |
| `running` | Per activity | |
| `awaiting_approval` | The Reach. A counter, not a flag, because requests can overlap across subagents [R control §5.1] | `needs approval` |
| `idle` | Still | `idle` |
| `parked` | Shrinks into a dark spore with one amber dot, because it still needs an answer | `parked` |
| `budget_exhausted` | Yolk empty, membrane wrinkles, cell dims | `budget out`, `B` adds budget |
| `rate_limited` | Hypoxia with countdown | `rate limited` |
| `stopping` | Ligature tightens over the real stop, 2.0 to 2.25 s [R control §2.4] | `stopping` |
| `exited` | Sinks to near depth with a small pilot nucleus, because it can be revived | `exited`, `Revive` |
| `crashed` | Rupture, pilot nucleus stays | `crashed`, `Revive` |
| `lost` | Dashed membrane, frozen | `lost, kernel restarted` |
| `closed` | Fully absorbed, capsule dissolves | Row leaves |
| `approval.requested` | The Reach | Pinned row |
| `approval.cancelled` | Patch peels off | `withdrawn` |
| `approval.answer` | See 3.4 | Audit row |
| `stream_event`, `text_delta` | Cytoplasm flow: tiled noise scrolls inside the soma at a speed from live tokens per second | `45 tok/s`, text if shown |
| `thinking_delta`, `system/thinking_tokens` | Shimmer inside the nucleus. Without this a thinking agent looks stalled [R control §2.3] | Token count only |
| `signature_delta` | None, it carries no meaning for an operator | |
| `content_block_start`, `content_block_stop` | Grouping only | Recording rows |
| `message_start`, `message_delta`, `message_stop` | Final usage replaces the estimate | `tok/s` settles |
| `ttft_ms` | None | Trace label |
| `system/status`, `requesting` | Same as `request.started` | |
| `system/api_retry` | Same as `api.retry` | |
| `system/task_started` | Bud | Row |
| `system/task_progress`, `system/task_updated` | Bud's last tool as a spike | Chip |
| `system/task_notification` | Bud ends, secretion vesicle travels home | Row collapses |
| `command_lifecycle`, `queued`, `started`, `completed`, `cancelled` | Vesicle docks, fuses, is gone, or pops | Count |
| `rate_limit_event`, `allowed` | Medium and arcs update | Numbers |
| `rate_limit_event`, `allowed_warning` | Arc brightens once | Banner, admission closes at the limit |
| `rate_limit_event`, `rejected` | Medium jumps to `acid`, managed cells go hypoxic | Banner with `resetsAt` |
| `terminal_reason: completed` | Goes still | `idle` |
| `terminal_reason: aborted_streaming`, `aborted_tools` | Goes still, nick on the neurite | `idle`, turn marked aborted |
| `terminal_reason: max_turns` | Goes still | `idle`, `continue` offered |
| `terminal_reason: budget_exhausted` | Starves | `budget out` |
| `terminal_reason: tool_deferred` | Spore | `parked` |
| Any other `terminal_reason` | Goes still, small lesion | `idle` with an error badge [R control §5.2] |
| `permission_denials[]`, `subagent_stats` | A refused child shows as one failed bud bump on the membrane | Recording rows |
| `PreToolUse` audit row | Sees auto-approved calls too. Same spike as any tool | Recording row |
| `agent_spawn` | Division and crawl | New row |
| `agent_send` | Gap arc, then `turn.started` as `peer` | Recording row |
| `agent_stop` | Ligature | `stopping` |
| `agent_wait`, `agent_status`, `agent_list` | Spike on the budding neurite. `agent_wait` holds it | Recording row |
| Stop path `forced` | Ligature snaps, a small rupture | `forced stop` |

### 6.5 Machine-wide

| Signal | Visual | HUD |
|---|---|---|
| `five_hour.utilization` | Medium tint and outer arc | `62 %` |
| `seven_day.utilization` | Inner arc | `31 %` |
| `resets_at` passes | Medium change sweep | `resets` label restarts |
| `fetchedAtMs` older than 10 min | Arcs turn dashed | `as of 14 min` |
| `extra_usage`, `spend`, `limits[]` | None | Text under Plan window, only when active |
| Liveness loop tick, 1 Hz | Heartbeat ring | |
| Kernel link lost | Asystole, 10.2 | `kernel lost`, actions disabled |
| `webglcontextlost` | Stain plate | Banner, recovery |
| Transcript gone, `ENOENT` at reconcile | Its fibre fades over 2 s | |
| Admission open or closed | Pipette tip clear or fogged | `admission closed` |

### 6.6 Every visual, back to its signal

This is the inverse table. If a visual is not here, it must not exist.

| Visual | Driven only by |
|---|---|
| Medium tint | `five_hour.utilization` |
| Rim arcs | `five_hour`, `seven_day`, `fetchedAtMs` |
| Medium change sweep | `resets_at` passing |
| Heartbeat ring | Kernel liveness tick |
| *you* | Fixed anchor, does not move |
| Tract width | Human turns per project |
| Fibres, depth nuclei | Retained transcripts and their age |
| Depth parallax, 4 px at most | Your own pointer. Off under reduced motion |
| Ganglion size | Log of lifetime tool calls, live cell count |
| Soma shape | Model family |
| Soma size, rim tension | Context fill |
| Nucleus size, ring | `effort`, `origin` |
| Charge fill | `request.started` to `message.completed` |
| Cytoplasm flow | `text_delta` rate, managed only |
| Nucleus shimmer | Thinking frames, managed only |
| Discharge flash | `message.completed` |
| Spikes | `tool.started`, by class |
| Afterglow | Past spikes |
| Backward spike | `tool.finished` with `isError` |
| Held bouton | Open tool, `tool_running` |
| Neurite length | Tool count per class for this cell |
| Rings on the axon | Successful writes |
| Myelin beads | `flushLagMs` |
| Docked vesicles | `queuedInputs`, `command_lifecycle` |
| Granules | `cost.usd` |
| Yolk | `maxBudgetUsd` minus spend |
| Capsule ring style | `permissionMode` |
| Second membrane | Worktree fields |
| Neck, dashed neck | `parentNodeId`, `linkedBy` |
| Stalk, segments, rings | Journal and workflow state |
| Tremor, retry ring | `api.retry`, `retryInMs` |
| Lesion | `api.error`, other terminal failures |
| Hypoxia | `rate_limit.hit`, `rejected` |
| Spore | `parked` |
| Ligature | `stopping`, `agent_stop` |
| Tendril, patch, wave | `approval.*` |
| Wild reach | Pid `waiting` on a wild session |
| Standing synapse | `updatedPermissions` granted in this session |
| Rim flush on the patch | Age of the request |
| Shedding | `compacted`, `compacting` |
| Settle ring | `turn.ended` |
| White drop, gap arc | `turn.started` by origin |
| Bud, crawl | `agent.started`, `task_started`, `agent_spawn` |
| Sinking | `session.ended`, `exited`, `closed` |
| Foxfire replay | Engram rows, while asleep |
| Wake wave | First awake event after sleep |
| Stain plate | Focus away from now, boot, no WebGL |
| Pipette | Your selection, mission form |
| Flicker | `tail.reset` |
| Secretion vesicle | StructuredOutput, SubagentHandback, `task_notification` |
| Symbiont body | `mcp__*` tool calls |
| Nucleus flicker | Tools of class Other |
| Nick on a neurite | `decision: reject`, aborted turns |
| Severed neurite | `interrupted` |
| Rupture | `abandoned`, `crashed`, failed bud, forced stop |
| Pilot nucleus | `exited`, `crashed`, because they can be revived |
| Hollow nucleus or ring | Unknown state, unknown liveness |
| Failed bud bump | `subagent_stats` refusals |
| Dim annex at the rim | `liveness: foreign` |
| Remote mark | `remoteControlled` |
| Dashed membrane | `lost` |
| Wrinkled membrane | `budget_exhausted` |
| Arc brightening | `allowed_warning` |
| Pipette fog | Admission closed |
| Asystole | Kernel link lost |

---

## 7. Scale behaviour

| Awake | What the screen does |
|---|---|
| **0** | Asleep. The body is all there, because it is the history. Replay runs in `foxfire`, under a label |
| **1** | Wake wave, then one bright cell in a dark body. The right column shows its recording without zooming |
| **5** | The default. Every cell is labelled and neurites are visible at 4x |
| **20** | Labels only on attention, hover and selection. The roster carries the overview |
| **100+** | Population mode. Workflows become colonies, the raster becomes a density map |

### 0 agents, usually the case

The rest state is the most important screen, because it is what you see most days.

- **It is rich.** The CPU still shows it: tracts converging on *you*, out-of-focus nuclei, all real.
- **It moves honestly.** Heartbeat, plus replay of your last active day. Each flash is a real tool call from history. The label reads `REPLAY  29 OCT  14:10  1:140` in `foxfire`. A colour never used for live means it cannot be confused with live. The replay stops the instant anything wakes.
- **It is useful.** The right column becomes `While you were away`: sessions ended, abandoned, orphaned workflows, and spend. Below it, `Revive` lists exited sessions, so yesterday's work is one key away.
- **Asleep** means nothing in `starting`, `generating`, `tool_running`, `waiting`, `retrying` or `compacting` for 30 s. Idle sessions left open in an editor do not count as awake, and they sit still among the replay.
- **A machine with no history** shows an empty dish, the word *you*, the heartbeat and the mission prompt. It says `no history yet` and does not fake anything.

Biology gives this a straight reading: replay happens during rest and keeps sequence order, not duration. [V, web, Appendix E]

### 1 agent

The first awake event sends a calcium wave out from that cell across all tissue in 1.2 s, and the replay stops. The camera does not move, because the operator did not ask it to. The right column switches to the recording of that one cell, so one agent needs no zoom.

### 5 agents

Everything is on: names on cells, neurites at 4x, tract traffic visible.

### 20 agents across 5 projects

The brief's stress case. This is how it stays free of confusion:

- **One place for each thing.** Project by position, state by roster row, urgency in the centre.
- **Labels budget.** At most 30 live labels. [R skills §2.11] Project names always show. Cell names show on `needs approval`, `error`, hover and selection.
- **The roster is the instrument.** 20 rows and 5 headers need about 720 px of the 1440 px height. [V, arithmetic]
- **`Tab`** walks only cells that need attention.
- **Channels** cut noise. Turning off reads and shell leaves only writes and damage: "what is changing the world right now?"
- **Real load is modest.** At p99 the fleet fires about 2 tool calls a second. [V]

### 100+ agents

Nothing like this has happened here. The real peak is 59 transcripts in one minute. [V] A single workflow can reach 1,000 agents, with 16 running at once. [R runtime §4.4]

| Beyond | Change |
|---|---|
| 32 live cells in view | Neurites at 4x collapse into one short stub per class |
| 64 live cells | Workflow agents become single-blob granules with no neurites |
| Any finished workflow agent | Collapses to a ring on its segment, so 1,000 finished agents are one count |
| 100 awake | Raster switches to one row per project or phase, drawn as a density heatmap. Spikes on a stalk merge into phase-level population bursts |
| 256 events in one frame | The rest merge into aggregate pulses |

Approvals never aggregate. Each stays individual, because authority does not scale. Admission limits make 100 managed agents unlikely, so this is mostly wild sessions and workflow agents.

---

## 8. Performance plan

Target: 60 fps at 2560 x 1440 on Intel Arc iGPU, 2 GB shared, all day, without loud fans.

**Nothing here is measured on a GPU.** The research reached the same point, and the first build step is a real browser check. [R skills §6]

### Why it can work

1. **The round field is the plan.** The field covers 1,478,421 px of 3,686,400, or 40.1 % of the screen. [V, arithmetic] The design choice that gives the concept its identity also removes 60 % of the shaded pixels.
2. **Signals are sparse.** Peak 17 a second, about 27 live spikes. [V]
3. **History is baked.** 2,102 fibres cost one texture read. [V for the count, U for the speed]
4. **Unlit.** No lights, no shadows, no mesh complexity. [R skills §2.4]
5. **Quarter-resolution fields.** The most organic effect runs on 117,649 pixels. [V, arithmetic]
6. **No per-frame JS for motion.** Growth, spikes and buds run in vertex shaders.

### Frame budget at 1440p

| Pass | Resolution | Estimate [U] |
|---|---|---:|
| JS, store, uploads | | 2.0 ms |
| Field blobs | 343 px | 0.4 ms |
| Afterglow | 343 px | 0.3 ms |
| Ribbons and spikes, additive | 1372 px circle | 1.5 ms |
| Composite | 1372 px circle | 2.5 ms |
| Contact, idle early-out | 1372 px circle | 0.1 ms |
| Bloom | 686 px and down | 2.0 ms |
| Browser composition | | 1.0 ms |
| **Total** | | **9.8 ms, about 7 ms spare** |

### Capacities and memory

| Item | Capacity | Memory [V, arithmetic] |
|---|---|---:|
| Field blobs | 2,048 | Instance data small |
| Curves | 4,096 rows | 256 KiB |
| Live ribbons | 512 | About 24,600 triangles |
| Spikes | 512 | 16 KiB |
| Field buffer | 343 px RGBA16F | 919 KiB |
| Afterglow pair | 343 px RGBA16F | 1,838 KiB |
| Anatomy, 3 layers RG8 with mips | | 16.0 MiB |
| Engram | 61,824 rows | 725 KiB in the kernel |

Draw calls stay near 20, against the skill's 100. [U] Live labels stay at 30 or fewer, in one overlay updated only when the camera moves. Drei `Html` is not used, because it adds a `useFrame` per label. [R skills §2.5]

### Quality tiers

Named after real microscopy methods. Tiers change in the order the research advises: lower resolution before lowering effects. [R skills §2.4]

| Tier | Trigger | Field scale | Bloom | Refraction | Afterglow | Ribbon segments |
|---|---|---:|---|---|---|---:|
| **Q3 Confocal** | Default | 1.0 | Half res | On | On | 24 |
| **Q2 Widefield** | Mean frame over 14 ms for 2 s | 0.8 | Quarter res | On | On | 16 |
| **Q1 Phase contrast** | Mean frame over 20 ms for 2 s | 0.66 | Off | Off | On | 8 |
| **Q0 Fixed** | No WebGL, or context lost twice | Plate | | | | |

`PerformanceMonitor` must be wired to real state, because alone it changes nothing. [R skills §2.8] Thresholds are starting values. [U]

### Power, all day

| State | Frame rate |
|---|---|
| Awake | 60 |
| Asleep | 30. Replay is slow enough, and fans stay quiet |
| Tab hidden | 0, then resync from a snapshot, never a backlog [R skills §2.2] |
| Kernel lost | 0 |

The skeleton's scheduler compiled against `frameloop="demand"`. [V] GSAP tweens must call `invalidate()` in `onUpdate`. [R skills §2.6]

### Reduced motion

`prefers-reduced-motion` keeps all information and removes travel.

| Normal | Reduced |
|---|---|
| Spikes travel | Terminal dot fades in and out at the end of the neurite |
| Reach grows | Patch fades in within 120 ms, with a static line from the cell |
| Heartbeat | Off. A small `kernel ok` remains |
| Replay | Off, anatomy is static |
| Wake wave, medium sweep | Off |
| Objective, focus | Cuts |
| Tremor | Static `retrying` ring |
| Parallax | Off |

HUD uses `MotionConfig reducedMotion="user"`, GSAP uses `gsap.matchMedia()`. [R skills §2.9]

### No-WebGL fallback

The fallback is the Golgi stain: same layout module, drawn once into SVG and Canvas 2D on `paper`.

- Roster, raster, approvals, mission, stop and recording are DOM, so **nothing is lost**.
- The approval is the same DOM card, in the same place, on a plain flesh disc.
- Live state shows as ink marks: filled nucleus for running, ring for idle, `paper.carmine` for damage, and a drawn line from the waiting cell to *you*.
- The same plate appears during context loss. [R skills §2.8] R3F does not handle `webglcontextlost`, so the kernel state stays in the store, and on restore all targets and textures are rebuilt.

### Measurement plan

Before anything else is built, a thin slice: T1, T2, T3 with synthetic data, in a browser on this machine.

| Scene | Content | Pass condition [U] |
|---|---|---|
| S0 | Asleep, 2,102 fibres, replay at 34 a second | p95 under 33 ms at 30 Hz |
| S20 | 20 cells, 5 ganglia, 3 spikes a second | p95 under 16.7 ms at Q3 |
| S60 | 60 cells, 8 spikes a second | p95 under 16.7 ms at Q2 |
| S100z | 100x on one cell, field blobs filling the view | p95 under 16.7 ms |

If S20 fails at Q3, Q2 becomes the default. If S20 fails at Q1, refraction and the field approach need rework before going further.

---

## 9. Sound, off by default

Electrophysiologists often listen to neurons through an audio monitor. [U, from memory] So Golgi's sound is a spike monitor, not a soundtrack. It is off by default, started with `M`, synthesised with Web Audio, and uses no sample files.

| Event | Sound |
|---|---|
| Shell spike | Very soft low click, panned by position |
| Read spike | Fainter high tick |
| Write | Short wooden knock |
| Tool error | Short detuned click, doubled |
| API error | Dull thud |
| Bud | Rising wet pop |
| Finished | One low exhale |
| The Reach | A low 55 Hz tone with slow beating, fading to silence after 10 s, because it must not nag |
| Approve | Soft resolving fifth |
| Deny | Falling note |
| Replay | Silence, because the past makes no sound |

Volume follows law 2: frequent events are almost inaudible. At p99 activity it should sound like quiet rain. Sound never carries anything that is not also visible.

---

## 10. Boot sequence and transitions

### 10.1 Boot

Startup data is ready in about 50 ms [R runtime §5.5], so boot is pure theatre and must never block anything. The HUD is interactive from first paint, and any key skips.

**First launch of the day, 2.4 s:**

| Time | Real step | On screen |
|---|---|---|
| 0 ms | Page loads, cached snapshot | Dark stage. Wordmark in Fell |
| Under 50 ms | Sessions, pipes, shallow walk, main index | Round **amber plate** fades up. Your real anatomy appears as black ink, like a page from an anatomy atlas. Caption: *Fig. 1. State of the culture, 31 October* |
| 600 ms | Live socket connects | One drop of reagent lands at the centre |
| 600 to 1,400 ms | First heartbeat tick | The drop spreads. Where it passes, paper turns to wet wine medium and **ink turns to living fluorescence** |
| 1,400 to 2,000 ms | Channels come up | Nuclei light first, then any awake cell starts charging |
| 2,000 to 2,400 ms | Window values | Arcs sweep to their value and *you* fades in |

An old anatomical drawing wakes up, built from your own history, and it is the second "what the hell" moment. The Golgi plate has its own story: the stain that first made a nervous system visible.

**Other launches:** a plain 600 ms crossfade. If an approval is open, boot is skipped at once.

**Kernel down:** the plate stays, with the caption `Kernel not running` and the command `golgi up`.

### 10.2 Transitions

| Transition | What happens | Duration |
|---|---|---|
| Objective change | Zoom about the selected point. Detail layers fade in by LOD | `objective`, 520 ms |
| Focus change | Layers blur through each other by LOD | `focus`, 400 ms |
| Now to history | The stain spreads from the rim: wet becomes paper, light becomes ink. Live cells vanish, and a small `live: 3 awake` stays on the rim | 600 ms |
| History to now | Reverse. `0` from anywhere | 400 ms |
| Sleep to wake | Calcium wave from the waking cell, 1.2 s across the field. Foxfire stops at once | 1,200 ms |
| Wake to sleep | After 30 s, replay fades up over 3 s | 3,000 ms |
| Select a cell | Pipette enters, touches, seals with a small ring | 400 ms |
| Spawn | Pipette, droplet, condensing soma, first charge | About 1.3 s, real spawn time |
| Stop | Ligature over the real stop duration | 2.0 to 2.25 s |
| Compaction | Collapse and shedding | 800 ms |
| Medium change | Fresh medium sweeps from one side | 3,000 ms |
| Kernel lost | **Asystole.** The heartbeat stops, everything freezes, colour drains 40 %. `kernel lost`. Controls disable, and open approvals read `cannot be answered now` | 800 ms |
| Kernel back | One strong heartbeat. Resync from a snapshot. Cells that were alive show `lost` until reconciled [R control §5.3] | 600 ms |
| Context lost | Crossfade to the stain plate, banner, then restore | 300 ms |

---

## Appendix A. What the kernel must add

All four are structure only and hold no message text.

| Addition | Why |
|---|---|
| `liveness.tick`, 1 Hz | Drives the heartbeat from the real loop |
| `usage.window`, at most every 30 s | Medium and arcs, from `cachedUsageUtilization` [R runtime §7] |
| `layout.json` | Stored ganglion seeds and slots |
| Engram index | Fixed-width rows of past tool calls, for replay and raster history |

## Appendix B. Risks

| Risk | Answer |
|---|---|
| Additive overdraw is too slow on the Arc | The measurement slice runs first, with tiers ready |
| Bio-jargon confuses | Law 7: labels are plain. Only this document uses the biology |
| Flesh gets tiring every day | Only the patch is flesh, and it is transient. A setting swaps it for a plain pale disc |
| Clusters of round dots disturb some people | Cells are convex and luminous. Dark pits exist only as rare lesions. [U] |
| Replay gets mistaken for live | Unique colour, permanent label, stops instantly, `0 awake` in the header |
| Permanent motion distracts | The heartbeat lifts anatomy by 6 % at most. Reduced motion removes it |
| A fingertip inside the monitor feels too strong | Test it with real use. The full sequence is rare, and compressed repeats are short |
| `golgi` npm name is taken | Irrelevant for a local binary. Use a scope if published |
| Formats change between CLI versions | Unknown types are ignored and counted. [R runtime §0] Open-string handling for tool names, origins and reasons |

## Appendix C. Verification log

All runs were on 2026-10-31. Nothing was written under `~/.claude`, and no credential or key file was opened. Scripts and raw outputs are in `scratchpad/organism`.

| Check | Result | Tool |
|---|---|---|
| Firing census, pass 1 | 2,102 transcripts, 2.07 GB, 268,244 records, 0 bad lines, 32 s | `firing-census.mjs` |
| Firing census, pass 2 | Charge ramp, context, cost, firing rate, model mix | `firing-census2.mjs` |
| Census privacy | Output is counts and fixed names. MCP tools collapse to `mcp`. Project stores are `S1` to `S11` by rank | Read the output |
| Fonts | Three packages exist at 5.3.0, OFL-1.1. Family names and sizes read from tarballs | `npm pack`, no scripts run |
| Names | `golgi`, `glia`, `zooid` and others checked. `zooid` is an AI agent chat app, so it was rejected | `npm view`, one web search |
| Contrast and colour vision | Table in 4.1 | `palette-final.mjs` |
| Layout | Capacity, clearance, phyllotaxis spacing, with real masses | `layout_check.py` |
| R3F skeleton | Exit 0, strict, `noUncheckedIndexedAccess`, TypeScript 6.0.3, section 4 dependency set | `r3f-check/src/sketch.tsx` |
| GLSL | 7 of 7 files parse, syntax only, `@shaderfrog/glsl-parser` 7.0.1. `inputBuffer` comes from `postprocessing` at runtime | `glsl-check/parse.mjs` |
| Three APIs | `addUpdateRange`, `clearUpdateRanges`, half-float extensions and the `mainImage` contract exist in the installed source | Read source |
| Effect passes | `auto` merges a convolution effect with a plain one, `none` keeps them apart. This caught a real bug in my first render graph | Read source |
| Stills | Three scenes rendered and inspected. They exposed real faults that changed this design | `render_still.py` |
| Mapping coverage | 240 names in 22 groups, parsed from the research types and tables, 0 missing from section 6. This is a presence check. It proves each name has a row, not that the visual is right. The first run found 42 gaps, which were then filled | `coverage.py` |

**Census limits.** Timestamps are record times, so per-class latency and charge ramps are approximate. The census includes this workflow's own agents. Cost figures are list-price estimates with the research formula, and older agent transcripts undercount. The charge ramp pairs `api-request` with the next new assistant message. The `n = 11` human latency is a small sample.

**Not verified.** Frame rate, shader output, bloom, refraction, `OffscreenCanvas` baking, any GPU behaviour, any live event path, the kernel additions, and how the Reach feels in daily use.

## Appendix D. Additions to the research

Values the reports do not list, found by the census. All parsers must treat these as open strings. [V]

| Field | Report lists | Also seen here |
|---|---|---|
| `turnOrigin` | `human`, `task_notification`, `peer`, `sdk`, `scheduled` | `system`, 3 records |
| `permissionDecision.source` | `config`, `user_permanent`, `user_temporary` | `user_reject`, `user_abort`, `hook` |
| `toolDenialKind` | `user-rejected`, `automode-blocked`, `permission-rule` | `interrupted`, 2 records |
| Tool names | Default list in `control` §8 | `StructuredOutput` 1,820, `SubagentHandback` 43, `ArtifactData` 14, `SendUserFile` 5 |

`design-skills.md` §2.10 proposes a dark control room with cyan state colours and Inter. This concept replaces that direction, because the brief rules out those fonts and asks for something that belongs to this product alone. Its engineering guidance is kept.

## Appendix E. Sources

Web facts are flavour and metaphor, not product behaviour.

- [Golgi's method, Wikipedia](https://www.wikipedia.org/wiki/Golgi_stain): date, chemistry, selective staining
- [The Golgi Stain, circa 1873, The Scientist](https://www.the-scientist.com/the-golgi-stain-circa-1873-43991)
- [Camillo Golgi, Linda Hall Library](https://lindahall.org/about/news/scientist-of-the-day/camillo-golgi)
- [Phenol red, Wikipedia](https://en.wikipedia.org/wiki/Phenol_red): colour against pH
- [The essential guide to phenol red in cell culture media, Thermo Fisher](https://www.thermofisher.com/blog/life-in-the-lab/the-essential-guide-to-phenol-red-in-cell-culture-media/): orange then yellow as medium acidifies
- [Nadasdy et al., J. Neurosci. 1999](https://www.jneurosci.org/content/jneuro/19/21/9497.full.pdf): sequences replayed at a faster timescale during sleep
- Hippocampal replay reviews on PMC, [one](https://pmc.ncbi.nlm.nih.gov/articles/PMC6605500) and [two](https://pmc.ncbi.nlm.nih.gov/articles/PMC5783826): time-compressed reactivation, also while resting awake. I used search summaries of these and did not read them in full

A yellow background in historical Golgi preparations and a specific replay speed factor were not confirmed by these sources. Neither is claimed here. The amber plate is an aesthetic choice.
