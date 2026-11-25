# hud: the seams

Slice 1, The Instrument, lives here. The Hand adds `docket/`, `launch/`, `ledger/` and `sheets/` next to it without editing the shell. WebGL mounts into one slot. This file is what they plug into.

## Reading state

No component reads `FleetState`. `store/model.ts` builds one `Model` at most four times a second, and that is the only place real names can become strings. The Veil acts there, so a component cannot leak what it never held.

```ts
import { useModel, useView, useShell, useNaos } from '../store/store.ts';

const decisions = useModel((m) => m.decisions);  // shallow compared, re-renders at 4 Hz at most
const veil = useView((v) => v.settings.veil);    // view state, immediate
const free = useShell((s) => s.free);            // layout of the current class
```

- `model.decisions` holds open requests oldest first, plus settled ones for 6 s with `note` set to `ANSWERED ELSEWHERE`, `WITHDRAWN` or `EXPIRED`. A lost link sets `note` to `cannot be answered now`. Each row has `requestId`, `nodeId`, `agentId`, `who`, `tool`, `age`, `preview`, `danger`.
- `model.crafts[nodeId]` is the whole craft: `state` (from `core/state.ts`), `word`, `metric`, `tier`, `mark`, `tone`, `owned`, `agentId`, `standing`.
- `model.walk` is the J and K order. Tier 1 is decisions: use it for the docket's own `J` `K` only through `model.decisions`.
- The raw request a docket needs is the one exception. Read it from `useNaos.getState().fleet.approvals[requestId]`, and pass it through `veiledApproval()` from `store/model.ts` unless `V` is held. That function is the one deliberate door.
- The Scene reads `useNaos.getState().fleet` and `.rates` every frame, never `model`.

## Commands

`store/commands.ts`: `await command('approval.answer', { requestId, decision, clientId })` returns `CommandResult`, it never throws. `useNaos.getState().link.clientId` is the id for `approval.answer` and `craft.watchText`. `fault.ack` has no UI yet, because DESIGN gives it no key: the Hand decides where it goes, and `TroubleRow` in `Rail.tsx` is the obvious place.

## Overlays

`store/registry.ts`. Register once at start, from `main.tsx` or a module it imports.

```ts
registerOverlay({ id: 'docket', layer: 'docket', modal: false, Component: Docket });
registerOverlay({ id: 'launch', layer: 'sheet', modal: true, Component: LaunchSheet });
registerOverlay({ id: 'ledger', layer: 'sheet', modal: true, Component: LedgerSheet });
```

- `Component` gets `{ arg }`, whatever `openOverlay(id, arg)` passed. Launch gets `'craft'` or `'mission'`.
- Layers are the z of DESIGN 5.5: `sheet` 40, `docket` 50, `palette` 60, `dialog` 80. Position with the classes `.layer-sheet`, `.layer-docket`, `.layer-palette`, `.layer-dialog`, which already use `--top`, `--bot`, `--sheet`, `--docket`.
- `openOverlay` remembers the focused element and `closeOverlay` returns to it. `useDialogFocus(ref)` from `hud/focus.ts` is the trap. `data-autofocus` picks the first stop.
- `Esc` closes the top overlay through `escape()` in the store. It decides nothing.
- An unregistered id says so through the polite region and does nothing. That is why `L`, `C` and the 5H readout already have a binding: they start working when you register.

## Keys

`hud/keymap.ts` holds the table of section 3.4 and one listener. Add or replace rows with `registerKeys()`. The same `id` replaces, later rows win.

```ts
registerKeys([
  { id: 'docket.approve', scope: 'docket', match: letter('a'), run: approve },
  { id: 'docket.deny', scope: 'docket', match: letter('d'), run: deny },
]);
setKeyScope('docket');  // when the docket takes focus, 'global' when it leaves
```

- Scope `docket` fires only under `setKeyScope('docket')`, and in that scope nothing global fires except rows with `always: true`. So a double tap outside the docket can never reach a card.
- `inText: true` lets a row fire in a text field. Only `attend.anywhere` (Ctrl+.) and `escape` do.
- `always: true` lets it fire above a modal overlay and with single keys off.
- `letter('a')` and `letter('s', true)` for Shift are exported from `keymap.ts`. Match stop keys on `e.code === 'Period'`.
- `attend.space` and `attend.anywhere` call `attend()`, which calls `runAction('attend', requestId)` first. Register that action to open the docket: `registerAction('attend', (id) => { ...; return true; })`. While nothing is registered, `attend()` selects the craft.
- Rows already there for you to replace by id: `stop.hold` (`.`, 600 ms), `allstop.hold` (`Shift+.`, 1200 ms). The default rows only say the control plane is not here yet. Holds need keydown and keyup, so replace them rather than wrap them.
- `I`, `B`, `O`, `U` call `runAction('focusFollowUp' | 'addBudget' | 'fork' | 'resume')`. Register those.

## Slots

- `registerSlot('followUp', FollowUp)` fills the foot of the wide Channel on an owned craft. Observed craft keep the `READ ONLY` strip.
- `registerSlot('allStop', AllStop)` replaces the masthead button. Until then it is a labelled button that does nothing, because a stop control that stops nothing should say so.

## Settings the Hand reads

`useView((v) => v.settings)`: `longArm` extends the arm delay to 1 s, `singleKeys`, `alert`, `mute`, `notifications`. Change with `setSetting(key, value)`. It persists, and `notifications` reaches the kernel through `ui.presence`.

## The scene

`SceneSlot` in `AppShell.tsx` renders `<div id="scene-slot">` over the Plate in the free rect and lazy loads `scene/Live.tsx` into it after the first paint. `hud/sceneGate.ts` decides whether that happens at all, and it must never import three. `settings.scene` off, no WebGL2, a software renderer or `scene.retired` keep the slot empty, and then the browser never fetches the chunk.

- `scene/controller.ts` is the one object outside React. `sync` runs at 4 Hz and on model, view and shell changes, `beforeFrame` on every rendered frame. It writes `scene.mounted`, `scene.tier`, `scene.cadence`, `scene.context` and `scene.retired` through `setScene`, and that slice is the scene's alone.
- Worlds, labels and wells come from `chartOf()` in `plate/chart.ts`, the chart the Plate draws, so the two cannot disagree. Stars and spokes come from `store/sky.ts`, for the same reason.
- `epoch` in the store bumps on every snapshot. The controller cuts to it instead of tweening, because a seek, a reconnect or a reload is not motion.
- At `rest` nothing renders and no rAF is pending. Anything that changes the picture at rest calls `redraw()`, and anything that moves goes through `pulse()` or a cadence fact, never a chain of redraws.
- The docket dims through `uDim` and `state.focus`, not through CSS on the slot: an opacity on the slot shows the Plate through the sky. The `.plate` and `.labels` rules in `docket/hand.css` are what is left of that.

The Plate does not go away with a scene on top. It costs one static canvas and a 4 Hz SVG, and it is the Sky (`view.sky`). The slot fades over it in 400 ms for the Sky and for `settings.scene`, and cuts at once on a lost context, because that canvas has no picture left to fade.

**The fleet.** `scene/fleet.ts` is the engine, `scene/rig.ts` the camera, `scene/roster.ts` what the engine is told. `setRoster` runs at 4 Hz and may allocate. `draw` runs on every rendered frame, writes every list from scratch and allocates no object, array or closure, so a state is only a row of the table in `core/look.ts`, never a slot to keep in step. The bench writes a roster by hand and draws through the same engine, which is how `S60` and `S120` test the real thing.

- Pure maths is in `core`: `look.ts` section 6, `crowd.ts` lanes and shoals, `flight.ts` poses and paths, `flash.ts` the flash gate, `ease.ts` the names of 9.2. `scene/motion.ts` registers those with GSAP once and writes them as `--name` custom properties, so CSS can use the same curves.
- Transients come only from `onFleetEvents` in the store, never from a snapshot, so a seek shows the right state and replays nothing.
- The kernel's clock drives the fleet, so a paused fixture stops every craft and a shot repeats. The camera runs on wall time, or a pause would freeze it mid flight.
- An owned craft flies at `orbitRate`, so its angle is integrated. `setAngleSource` hands that angle to the chart, which keeps the Plate under the hull.
- Labels are placed on the current camera at 4 Hz, then ride their anchor every frame. A row holds where its anchor stood. Text comes from `model` only. `core/labels.ts` stays pure, and `levelTag` in the controller is what World and Craft level print.
- Any keydown lands a flight in a capture listener, before the keymap, so the key then applies from the end state. A press on the canvas does the same.

**Seams for Layer 5.** Hoops and beads are drawn, still and closed-form: `tear`, the close, the unroll, the sungrazer and refused arcs are not. `FleetEngine.streak` is one streak with the 48 ms stagger, so a salvo only has to call it per agent and cap at 16. The corona flare is not there.

**Seams for Layer 6.** `state.wells` still takes static strength from the chart and now rides the hull through `wellIds`. Forming, wavefront, rebound, `setViewOffset` and the lock are untouched. `state.waves` is empty. The rig has no dive pose yet: add it next to `chasePose`, and `go` takes the rest. The 8-well bench scenes still shred the sky, and the white wedges there are burned spokes magnified by a lens, not craft.

**Seams for Layer 7.** `land` already does the streak, the flare and the held light until the digest brings the city. A 5 s sky rebuild is still what delays the star. Meteor showers can book through `FlashGate`.

The Plate does not go away with a scene on top. It costs one static canvas and a 4 Hz SVG, and it is the Sky (`view.sky`). The slot fades over it in 400 ms for the Sky and for `settings.scene`, and cuts at once on a lost context, because that canvas has no picture left to fade.

**Seams for Layer 4.** `buffers.arcs24`, `buffers.hulls` and `buffers.beams` are mounted and empty, and `arcs48` and `arcs96` hold only long exposures and rim arcs, so plumes and hoops need their own ranges there. Craft positions are `onOrbit()` in `core/orbit.ts`: the screen projection of the same plane a hull will fly in, which the Plate already uses. Moored craft add two frames per `kernel.tick` in 11.1, and that belongs with the beacons. `state.wells` is fed at static strength from the chart: forming, wavefront and rebound are Layer 6, which also owns `setViewOffset` and the lock.

## Not here on purpose

- Stars in the Plate are drawn from `history.get`, once per size. Boot and cached digest are Layer 7.
- `Announcer`, `SceneMirror`, the title and the favicon run off `model`, so anything the Hand adds to `decisions` reaches them.
