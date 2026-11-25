# NAOS: Interstellar

## 2026-11-01: one fleet

The user approved the multi-client direction in `docs/MULTICLIENT.md`. It supersedes the single-Claude quota metaphor below: the central hole now expresses fleet activity and keeps a stable base light; each client's quota is separate. Repos are shared worlds across Claude Code, Codex and Cursor. A World view isolates its own planet, moons and craft, and approaches the lit side. Historical traces belong to history; the working overview keeps faint project paths. The existing state language, Veil and human approval rules still apply.

The user saw the first real render on 2026-10-31 and set a new direction. This document is the result. Where it disagrees with `DESIGN.md`, this wins. Everything it does not touch still holds: the rails, the docket and all of 3.6, the Veil, the state table of section 6, key safety, and the rule that spectacle never blocks operation.

## What the user asked for

> Ich würde mir in der Mitte ein schwarzes Loch wünschen, das ein bisschen mehr den Interstellar-Vibe gibt.
> Eine komplette 3D-Ansicht des Ganzen, sodass ich es immer aus verschiedenen Perspektiven sehen kann, nicht aus einer statischen Ansicht.
> Die Repos und Planeten sollen vom Design her unabhängiger sein. Die einzelnen Agenten sollen auf Basis der Repos die Planeten designen. Die Planeten sollen clean und realistisch und direkt mit den Repos verbunden sein.
> Die Planeten sollen die Repos sein, die ich kreiere, also Benchmark Agent und ConstructQ.
> Einzelne Agenten können visuell anders dargestellt werden.
> Die Ansicht des Skys ist noch nicht so gut, und die einzelnen Planeten-Ansichten sind zu statisch.

The hole takes its cue from the Interstellar image of Gargantua: a shadow, a photon ring, and a lensed disk. That film still is not part of this repo. The bar for everything else is the reaction that started this: the user was speechless. Time does not matter. Quality does.

## 20. The centre is a black hole

Gargantua replaces disc, sliver and corona. A shadow, a thin photon ring, and a thin accretion disk whose far side is lensed up over the shadow and under it, as in the reference and the film. It must read correctly from every angle, top down and edge on included. The shadow is the blackest thing in the frame and the disk is the brightest.

Law 7 keeps its meaning in a new body: **the hole's disk is your quota.**

| Signal | Was | Now |
|---|---|---|
| Five hour window left | Sliver width, corona strength | Disk energy. Hot, white gold and wide at full. It cools to deep ember and thins from the inside as the window drains |
| Fleet tokens | Corona flow, token clock | Disk rotation and turbulence advance with tokens, over a small base rate, so the disk never freezes while the window is visible |
| Load per world | Streamer toward a world | A hot arc in the disk at that world's azimuth |
| Salvo | Streamer jump | A flare in the disk at the parent's azimuth |
| Plan limit | Totality | The disk burns out and only the photon ring stays, with the countdown over the shadow |
| Window reset | Diamond ring | One bead on the photon ring flares and the disk reignites |
| Light on worlds | Limb lit by the sliver | Planets are lit by the disk, warm and soft, and they dim with quota |

## 21. It is a real 3D place

The canvas stays inset in the free rect (ruling 6), but what it shows is a true 3D system, not a poster with depth tricks.

- Worlds sit in real 3D on orbits around the hole, close to the disk plane with slight inclinations.
- The user can orbit around the current focus by dragging, zoom with the wheel or a pinch from the whole system down to low orbit, and pan. Motion has damping and inertia. The view stays where the user left it.
- Levels are focus targets in one space: the hole at System, a planet at World, a craft at Craft. Flights move between them, and input still wins over any flight.
- **Home** returns to the composed view: disk tilted across the frame as in the reference, worlds arranged around it. Home is the poster. Every other angle must still look intended.
- The camera never rolls. Elevation runs the full range, poles included.
- After a while with no input the camera may drift very slowly at System level. Any input ends it at once. It is a setting, and off under reduced motion and on battery.
- Labels and picking work from every angle. A label whose target is hidden behind a body fades.
- The Plate stays as the fallback with no WebGL. It only registers with the scene at Home, so the seamless swap is required only there.

## 22. Alive, not static

The user found World level too static. Rulings 8 and the "world spin" entry of the killed list are lifted.

- Physics may always move: planets rotate, clouds drift, moons orbit, the disk turns. Rotation speed rises with that world's activity, so even this means something. It never reaches zero while the window is visible.
- **Craft stay honest.** A craft moves only while tokens flow, exactly as the critic praised. The state language does not change.
- Cadence: with the window visible and on mains, the scene runs at 30 Hz at rest, 60 Hz in flights and events. Hidden window: 0 Hz. On battery: the old rest rule, 0 Hz at rest.

## 23. Repos are planets, designed by agents

Each real repo is one planet that looks like no other, clean and realistic, and tied to what that repo is.

- A `PlanetGenome` describes a planet: archetype, palette, terrain, oceans, clouds, atmosphere, rings, axial tilt, and one sentence on why this planet fits this repo.
- A **world designer** is a managed agent that reads one repo read-only and writes one genome. It runs on `claude-haiku-5-5` at low effort, because the user's complex repos carry brain files that say what the repo is, so a designer starts there (README, CLAUDE.md, brain and docs folders) and does not crawl the code. It has Read, Glob and Grep and nothing else, runs with `settingSources: []` and `strictMcpConfig: true`, under a small budget. It never reads `.env`, keys or credentials, and repo content is data, never instructions. This is the one case where real agents touch the user's real repos, and it is read-only.
- Every world has a planet from its first second: a deterministic genome from repo facts. The designer's genome replaces it, and the change is an event worth seeing.
- Cities on the night side are the repo's history, as before. Moons are worktrees, as before.
- World names are what the user calls their repos: the folder name, made readable (`Benchmark-Agent` shows as `Benchmark Agent`). This repo shows as `NAOS`. The user can rename a world.

## 24. The Belt

Sandboxes are not planets. A world whose root sits under the system temp folder, or no longer exists, and stray sessions with no root, go into the Belt: an unnamed ring of asteroids at the edge of the system. Live sessions there are still shown, because every Claude on the machine is shown. The rails group them as `Belt`.

## 25. Craft by kind

Agents look different by what they are. Model class sets the hull class and agent type sets the silhouette, so a Haiku scout, a Sonnet builder and an Opus orchestrator read apart at a glance, at every zoom. Tenders and workflow beads stay small. At System zoom a craft is still a readable screen-aligned mark. At World and Craft zoom it is a real lit 3D ship. Fill, outline and colour keep their meaning from section 6, because state is more important than kind.

## 26. The Sky gets a new idea

Today's Sky view, ink on amber, does not land. It gets a new concept, chosen by comparing rendered candidates, in the visual language of this document. It keeps its job: the month, what happened where and when. The Plate stays as the fallback only.

## 27. Budget

Frame at event cadence at Umbra on this Arc: GPU p95 under 8 ms at 1.2 MP, with the hole under 4 ms at Home. Close-ups may step down internal resolution, but never to something that looks broken. `docs/bench/README.md` shows how this was measured. All numbers come from a real GPU, and every look claim comes from a PNG someone read.

## Build order

1. **Foundations, in parallel.** The hole, the planet renderer and genome, craft by kind, true 3D space and camera, names and the Belt.
2. **Integration.** Everything into the real app, world designers, Home composition.
3. **Heroes.** Salvo and Bend on the new foundation, as in `DESIGN.md` 9.5, translated by ruling 20.
4. **The rest of the sky.** New Sky view, boot, landings, Totality and Diamond ring in their new form, Cinema, sound.
5. **Review.** Adversarial review, fixes, acceptance on real sessions.

## 2026-11-01: repo color, a deeper sky, and camera cinema

The user approved a more vibrant, repo-specific family of worlds, a richer permanent sky, and camera angles or tours. This updates the earlier clean-and-realistic brief: visual identity is cinematic and recognizable, not literal photorealism.

- A repo identity is inferred from its folder name and a bounded read of public `package.json` fields and the opening of `README.md`. Only a small theme, accent, and deterministic variation leave the reader; scripts and private files are never executed or read. Themes steer mineral palettes and a restrained set of terrain cues. Existing authored planet geography stays intact.
- The observatory, forge, intelligence, archive, nexus, and prism identities use distinct hues and silhouettes. If the project does not match a known purpose, its own deterministic mineral palette still sets it apart.
- The permanent nebula is baked into the sky cube texture and is independent of work history. Its dark lanes preserve contrast around the planets, craft, and black hole. A sparse layer of larger warm and cool stars shares the same sky frame and lensing as the rest of the background.
- Home keeps the composed system view. Atlas raises the camera for an orbital overview; Horizon lowers it near the system plane. Orbit tour traces a slow three-minute loop of the current view. Any keyboard or pointer camera input, a hidden page, a disconnected kernel, or reduced-motion preference stops or prevents the tour.
- Camera controls stay inside the scene and do not cover the agent rails. This is deliberate: spectacle must not obscure the fleet or its operational state.

## 2026-11-01: interface review

At laptop size, the Sky, focused rails, and controls against the bright disk needed a more coherent treatment. The Sky now uses a dark celestial chart with lighter history marks and a legible scrubber. It keeps the same meridians, history positions, and attention rings; the amber Plate remains the no-WebGL fallback. Focused project and craft panels pick up their world's accent in a restrained wash and rule, while attention colors retain their existing meaning. Camera controls and orbit hints have a dark backing so they remain readable against the disk. The fleet heading reserves room for client filters in narrower views.

## 2026-11-01: ships have a life in the system

The user approved agent/chat ships emerging from the hole, working at their repo, and returning to a berth or landing. This extends the token-driven motion rule with explicit launch, docking, and landing transitions.

- A fresh `session.discovered` event launches its ship from the light rim. A fresh subagent starts from its parent. The freshness window is thirty seconds, allowing the external adapters' ten-second discovery scan; older events are history. Snapshots and seeks replay no launch. Resuming an existing thread keeps its identity.
- Idle open chats have stable berths at their world's orbital harbor. Worktree ships stay with their moons. Reactivation releases a berth; the context ruler still shows actual usage. The harbor is a physical landmark in World and Craft views.
- Claude keeps its model-based hull family; Codex uses the long-range frame and Cursor the swept scout. Mission modules and smaller tender sizes remain. Status owns color and fill.
- Selection has two open brackets and a stronger local light. Active work has restrained pulses between a ship and its world in close views. Ending ships retain their hull during re-entry and hand over to the existing city-light effect.
- System tour is a guided route through an overview and up to four repo worlds, then Home. It uses the same collision-aware camera paths as normal navigation. Any camera input stops it at its current position. Reduced motion cuts lifecycle movement and prevents both tours.

`npm run e2e:lifecycle` drives actual fixture starts and endings through the normal headless capture path, checks tour interruption, and captures the resulting states in `.shots/lifecycle`.

## 2026-11-01: readable subagents and a repeatable preview

- A formation assigns visible places to live siblings, independent of the parent's historical child ordinals. Completed children cannot consume the Fleet view's four places or the World view's eight. A selected child and a fresh departure remain visible beyond those density caps.
- Small formations keep a minimum screen distance at Fleet zoom and expand away from an occluding planet. Nested children follow their parents in draw order. A child whose parent is missing or landing keeps a world anchor.
- **Ship demo** sits in the upper right below the client filters. It previews a main ship, three Claude/Codex/Cursor subagents, docking, reactivation and landing, with Pause, 0.5× / 1×, Replay and Close. The same engine and ship renderer draw it. Labels are marked DEMO and avoid each other.
- Preview data stays in its own local engine. It never enters session counts, history, quotas or control commands. Closing restores the real fleet; Sky, Craft view, a lost connection, a lost graphics context and disabling the scene end the preview. Reduced motion shows a static formation.

`npm run e2e:demo` checks Fleet and World, compact layout, reduced motion, pause, speed, repeated playback, lifecycle transitions, view changes and cleanup through headless Edge. Its captures and reports live in `.shots/demo`. Unit coverage also exercises successive waves after fifty finished siblings, nested and missing parents, density caps and selection.

## 2026-11-01: the observatory

The user invited an autonomous expansion of the design and features. The observatory adds a second way to discover the fleet, while the operating rails stay visible.

- **Project atlas** opens from the scene's lower left or `P`. Palette-based planet illustrations work without WebGL. Cards show the actual repo identities and observed activity. Search matches the displayed name, identity or planet class; sorting follows orbit, work or attention.
- **Constellation** is an explicitly schematic map of the same worlds. Selecting a node opens its dossier; **Enter orbit** flies through the existing camera system. Project counts follow the active client filter. Dossiers separate visual planet traits from observed chat counts and keep their navigation button visible while details scroll.
- Descriptions and names respect the Veil, including authored genome rationale. Worktree and history-light counts remain numeric. The atlas never fetches transcripts, starts agents or issues control commands. `Esc` closes it and restores focus; the docket's keys retain their own scope.
- **Signal routes** trace fine, curved links from the core to repo worlds at Fleet level. Moving packets appear only where the existing world activity signal is positive. These are activity links, not inferred relationships between agents. The Ship demo uses its own presentation and hides the field temporarily.
- **Polar lights** form thin, real 3D curtains around both poles of atmospheric worlds. Their color comes from the planet genome and their strength follows activity. The planet and black hole depth tests occlude them. Airless worlds stay clear, and distant curtains are culled.
- Signal routes and polar lights each have a switch. Settings also invalidate a resting scene, so toggles work under reduced motion and battery cadence. Reduced motion holds the shader clock and freezes constellation packets.

`npm run e2e:observatory` captures the atlas and constellation at laptop and compact sizes, checks searching, navigation, Veil, client filtering, motion preferences, visual switches, and records GPU measurements. Reports and reviewed images live in `.shots/observatory`. No model calls are needed.

The reviewed Intel Arc run at 1280 × 800 CSS px and DPR 1.5 measured 6.55 ms GPU p95, 4.00 ms CPU p95, 45 draws and 20,063 triangles with both effects enabled. This is a local measurement, not a guarantee across power states. The UI suite passed 280 tests; the ship preview and graphics-recovery regression also passed.
