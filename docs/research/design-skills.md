# Design skills research for the Agent OS UI

Source: `github.com/freshtechbro/claudedesignskills`, commit `1da73fe` (2025-11-19), the only commit in the clone.
Audit date: 2026-10-30. Machine: Windows 11, Node 24.14.1, npm 11, Intel Arc iGPU with 2 GB shared memory.

Every claim carries a tag:

- **[V]** VERIFIED: I ran it, or read the code or registry metadata, in this session.
- **[U]** UNVERIFIED: skill text or engineering judgement that I did not test here.

Nothing ran in a browser, because the rules forbid launching GUI programs. Every statement about frame rate, visual result or live behaviour is therefore [U], unless it comes from reading library source.

## Bottom line

1. **Security:** the 11 screened skills are clean. No prompt injection, hooks, network calls, shell execution or obfuscation. [V]
2. **Use the skills as knowledge, not as code.** Their concepts hold up. Their code is a mix of still-valid, deprecated and broken, and the starters target React 18 and R3F 8. [V]
3. **`three@latest` does not work with this stack today.** `postprocessing@6.39.5` caps three at `< 0.187.0`, and 0.187.0 was published today. Pin `three@0.186.1`. [V]
4. **The exact set in section 4 passes** a strict peer resolve, a strict typecheck, a production build and `npm audit`. The peer conflict that rules out `three@0.187.0` was reproduced as a negative control. [V]
5. **Four traps the skills do not mention:** a second three copy through `stats-gl`, a Vite 8 crash on the starter's `manualChunks`, CDN calls hidden in Drei and troika defaults, and troika rejecting woff2 fonts while `@fontsource-variable` ships only woff2. All four have tested or source-confirmed answers below. [V]
6. **Copy six skills, and only `SKILL.md` plus `references/`** (section 5). Nothing has been copied yet.

## 1. Security screen

### 1.1 Method

All scanning ran from `scratchpad/tools`, outside the clone, with `python -I`. Nothing from the repo was imported or executed. [V]

- **Text scan:** 245 files and 116,248 lines, covering `.claude/skills/<name>/` and `plugins/individual/<name>/` for all 11 skills. [V]
- **Positive control:** fixtures with known-bad content triggered all 16 pattern categories and the Unicode check. Without this, a clean result would mean nothing. [V]
- **Python:** 18 of 19 scripts parsed with `ast` (imports, calls, file modes). `react-three-fiber/scripts/component_generator.py` has a syntax error at line 149 and was scanned by regex instead. `web3d-integration-patterns` has no scripts. [V]
- **Plugins:** all 21 commands and 11 agents reviewed as distinct lines after normalisation, and the keys and path values of all 11 manifests parsed. [V]
- Coverage of everything else is in 1.4.

### 1.2 Results

| Check | Result | Evidence |
|---|---|---|
| Instruction override, role hijack, fake system tags, concealment, directives aimed at the assistant | 0 hits | [V] scan |
| Zero-width, bidi, tag and soft-hyphen characters | 0 hits | [V] scan |
| Homoglyphs | Only Greek ζ, used as the damping ratio in the physics docs | [V] scan |
| HTML comments in Markdown | 58 in the skill folders (116 counting plugin copies), all inside code fences, longest 48 characters, all ordinary code comments | [V] every one read |
| Shell execution (`subprocess`, `os.system`, `eval`, `exec`, `child_process`) | 0 hits | [V] scan and AST |
| Network in Python (`urllib`, `requests`, `socket`, `http`) | 0 hits, stdlib imports only | [V] AST |
| Network CLI (`curl`, `wget`, `Invoke-WebRequest`) | 0 hits | [V] scan |
| Network in JS (`fetch`, `XMLHttpRequest`, `WebSocket`) | 1 hit, see F1 | [V] scan |
| Obfuscation (base64, hex blobs, `marshal`, `pickle`) | 0 hits | [V] scan |
| Secret paths (`.ssh`, `.aws`, `.npmrc`, credentials, API keys) | 0 hits | [V] scan |
| Hooks and config (`PreToolUse`, `"hooks"`, `mcpServers`, `settings.json`, `allowed-tools`) | 0 hits | [V] scan |
| Destructive operations (`rm -rf`, `shutil.rmtree`, `os.remove`) | 0 hits | [V] scan |
| SKILL.md frontmatter | Only `name` and `description` on all 22 skills; `skill-creator` adds `license` | [V] parsed |
| `plugin.json` | Same 11 keys on all 11 skills, no `hooks`, no `mcpServers` | [V] parsed |
| `marketplace.json` | 27 plugins, all local `./plugins/...` sources | [V] parsed |
| Copy drift | `.claude/skills`, `plugins/individual/*/skills` and `.factory/skills` are SHA-256 identical for all 11 | [V] hashed |
| Zip bundles | 22 zips, 198 of 198 members identical to the tree after line-ending normalisation. The raw mismatch was CRLF from the Windows checkout | [V] compared in memory |
| Git hooks | Only `*.sample` files | [V] listed |

### 1.3 Flagged files

None of these is malicious. They are listed so a reviewer can check the call.

| ID | File | Finding | Verdict |
|---|---|---|---|
| F1 | `modern-web-design/references/performance_checklist.md:787` | `fetch('/analytics', ...)` | Benign doc sample with a relative URL [V] |
| F2 | `threejs-webgl/assets/starter_scene/index.html:77-78`; `gsap-scrolltrigger/assets/easings/easing_visualizer.html:7`; `gsap-scrolltrigger/assets/starter_scroll/index.html:249-251`; `lightweight-3d-effects/assets/starter_lightweight/index.html:75-84`; `pixijs-2d/assets/starter_pixijs/index.html:40` | Remote scripts without SRI, several on floating versions (`gsap@3`, `vanta@latest`, `zdog@1`, `pixijs.download/release`) | Passive until opened, but a supply-chain risk if pasted. Not copied under section 5 [V] |
| F3 | `gsap-scrolltrigger/references/easing_guide.md:570`; `lightweight-3d-effects/references/vantajs_effects.md:32,529` | The same floating CDN pattern in reference docs | Docs only. Never paste into the UI [V] |
| F4 | All 19 script commands under `plugins/individual/*/commands/` | They describe running a script, but contain no executable body, frontmatter or tool grants. The two `web3d` commands name no script | Harmless and not useful [V] |
| F5 | All `scripts/*.py` in the 11 skills | Stdlib only. They write only through `open(..., 'w')`, `write_text` or `makedirs`, and many block on `input()` | No exec or network, but unsuitable for headless use. Output-path handling not reviewed by eye [V] |
| F6 | `skill-creator/scripts/__pycache__/quick_validate.cpython-313.pyc` | Committed compiled binary | Strings match its source sibling. Outside the 11, never copy [V] |
| F7 | `barba-js/scripts/project_setup.py:718` | `subprocess.run(['npm', 'install'], cwd=project_path, check=True)` | On-topic with fixed arguments, but it would run install scripts. Outside the 11, not recommended [V] |

Root files `CLAUDE.md`, `README.md` and `MARKETPLACE.md` had 0 grep hits for injection phrases, and none of them are copied. [V]

### 1.4 Coverage limits

A pattern scan cannot judge intent in prose, so the eye review matters. This is the honest coverage of the 11 required skills:

- **Read in full:** every `SKILL.md`, plus all `references/` of `modern-web-design`, `react-three-fiber`, `threejs-webgl`, `gsap-scrolltrigger`, `motion-framer`, `lightweight-3d-effects`, `animated-component-libraries`, `react-spring-physics` and `animejs`. Of `pixijs-2d/references/`, only `performance_guide.md`. Also `assets/examples/README.md` of `react-three-fiber`, `motion-framer` and `gsap-scrolltrigger`. [V]
- **Tool-scanned only, not read by eye:** [V]
  - `pixijs-2d/references/api_reference.md`, `filters_effects.md`, `assets/examples/README.md` and `assets/starter_pixijs/*`
  - `lightweight-3d-effects/assets/examples/README.md` and `assets/starter_lightweight/*`
  - `gsap-scrolltrigger/assets/starter_scroll/*` and `assets/easings/*`
  - small starter sources in `motion-framer` and `react-three-fiber`, and `assets/README.md` of `react-spring-physics` and `animejs`
  - all Python sources, which got AST and regex only
- **Consequence:** the copy rule in section 5 excludes `scripts/` and `assets/`, so everything that gets copied was read by eye, and none of it is executable.
- **The other 12 skills** were skimmed for relevance and pattern-scanned, as instructed. The only hit was F7. [V]

## 2. Distilled guidance for a real-time 3D operations UI

Tags: [V] where I confirmed behaviour in library source or a build. [U] for skill advice or judgement that was not measured.

### 2.1 Architecture

- **One canvas, full-bleed, behind a DOM HUD.** This is the skill's "Layered Separation" and "Unified React" patterns combined. [U]
- **Share pointer events through a root element:** `eventSource={rootRef}` with `eventPrefix="client"`. This keeps HUD panels from swallowing canvas events. Compiles against R3F 9.8.2. [V]
- **Keep the HUD container `pointer-events: none`** and turn it back on per panel. [U]
- **Do not stack a second WebGL context.** The Pixi overlay pattern means two renderers on one 2 GB iGPU. [U]
- **The ops view must work without WebGL.** Agent list, approvals and stop controls are DOM. The canvas is a view of state, never the only route to an action. [U]

### 2.2 Data flow: three clocks, no React in the hot path

- Keep three rates apart: **data** (bursty daemon events), **simulation** (per-frame interpolation) and **render** (the rAF loop). [U]
- Apply daemon events to a store outside React at most once per frame, in batches. [U]
- Read that store in `useFrame` with `getState()`. Subscribe with `subscribeWithSelector` only to raise a dirty flag. Pattern compiles against zustand 5.0.16. [V]
- Never call `setState` in `useFrame`. Mutate refs. [U, skill]
- Selectors that return new objects need `useShallow` in zustand 5, from `zustand/react/shallow`. Import compiles. [V] The infinite-loop failure without it is [U].
- After a hidden tab, resync from a snapshot instead of replaying a backlog. Keep event buffers bounded. [U]
- For idle periods use `frameloop="demand"` and switch with `setFrameloop`, which exists on the R3F store. [V] In demand mode, anything that moves must call `invalidate()`, GSAP tweens included. [U]

```tsx
// Condensed from the smoke app, which compiles against the section 4 set under strict TS [V].
// slotFor and statusColor are placeholders here. Not run in a browser [U].
const CAPACITY = 2048
const dummy = new THREE.Object3D()
const color = new THREE.Color()

function AgentField() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const dirty = useRef(true)

  useLayoutEffect(() => {
    ref.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    return useStore.subscribe((s) => s.agents, () => { dirty.current = true })
  }, [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh || !dirty.current) return
    dirty.current = false
    let i = 0
    for (const agent of Object.values(useStore.getState().agents)) {
      if (i >= CAPACITY) break
      dummy.position.copy(slotFor(agent)); dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, color.set(statusColor(agent)))
      i++
    }
    mesh.count = i
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  })

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, CAPACITY]}>
      <icosahedronGeometry args={[0.3, 1]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}
```

### 2.3 Instancing and geometry

- Use `InstancedMesh` for agents and share geometry and materials. Skill threshold: more than 50 identical objects. [U, skill]
- Pass `undefined`, not `null`, in `args`. The skill's `null` fails under TS. [V]
- Allocate a fixed capacity and move `mesh.count` instead of recreating. [U]
- `InstancedMesh.computeBoundingSphere()` exists. Use it after updates, or set `frustumCulled={false}`. [V for the method, U for the culling outcome]
- `BufferAttribute.addUpdateRange()` exists for partial uploads. [V]
- Pointer picking on an instance returns `e.instanceId`. Typecheck confirms the field. [V]
- Keep node positions deterministic, for example a stable hash of the agent id, so nodes never jump. Run any force layout in a worker at low rate. [U]
- Avoid one `<Line>` per edge. Drei `Line` builds a `Line2` object per instance. [V] Prefer one preallocated segments buffer with a draw range. [U]

### 2.4 Look and post-processing on an iGPU

- **Go unlit.** The skill ranks `MeshBasicMaterial` fastest and `MeshPhysicalMaterial` slowest. An emissive scene with no lights and no shadows gives the "glowing" look at the lowest cost. [U]
- **Set `multisampling={0}`.** The wrapper defaults to 4. [V] Use `antialias: false` on the Canvas too, because the composer owns the frame. [U]
- **Bloom selectively.** `BloomEffect` defaults are `luminanceThreshold = 1`, `mipmapBlur = true`, `intensity = 1`. [V] The skill example sets the threshold to 0 (`assets/examples/README.md:453`), which would bloom the whole frame. [U]
- **HDR glow is possible.** The composer defaults to `HalfFloatType`. [V] Colours above 1.0 with `toneMapped={false}` should exceed the threshold while the background stays dark. [U]
- **Lower `resolutionScale` before lowering effects.** The prop exists on `EffectComposer`. [V]
- **Drop `DepthOfField`.** It appears in the skill's example, and it is the wrong cost for a status view. [U]
- **Avoid `<ContactShadows>`,** or set `frames={1}`. Its default is `frames = Infinity`, so it re-renders every frame, and the skill examples omit the prop. [V]
- **Cap DPR at 1.5** with a monitor loop, as in 2.8. Skill checklist says 2. This is an iGPU adjustment. [U]

### 2.5 Text and labels

- **Default to DOM labels in the HUD.** `Html` runs a `useFrame` per instance, and `occlude` adds a raycast per element per frame. [V] Budget roughly 30 live labels, for example hovered, selected and pinned. [U]
- **Avoid `<Text>` without a local font.** troika's unicode fallback points at `cdn.jsdelivr.net`. [V] Whether a specific string triggers the fetch is [U].
- **troika throws `woff2 fonts not supported`.** [V] `@fontsource-variable/*` ship only woff2. [V] For 3D text, use the static `.woff` from `@fontsource/jetbrains-mono@5.3.0`, for example `files/jetbrains-mono-latin-500-normal.woff`. [V for the file]
- **In-scene numbers:** an atlas or a shader is cheaper than one text object per node. [U]

### 2.6 Animation ownership

The skill's key rule is one library per property. [U, skill] Applied here:

| Concern | Owner | Why |
|---|---|---|
| Continuous per-frame values | `useFrame`, or damping helpers such as `maath` | No allocation, no timeline [U] |
| Camera moves, boot sequence, scripted beats | GSAP timelines through `useGSAP` | Best sequencing, and `contextSafe` covers event handlers [V for the API] |
| HUD enter, exit, layout | `motion/react` | `AnimatePresence`, `layout`, `MotionConfig` [V for the API] |
| Hover and press micro-states | CSS, or `motion` | Compositor-friendly [U] |

- GSAP has its own ticker. With `frameloop="demand"`, tween `onUpdate` must call `invalidate()`. Compiles. [V] Motion in the canvas stops otherwise. [U]
- GSAP can be driven manually with `gsap.ticker.remove(gsap.updateRoot)` and `gsap.updateRoot(t)`. [V, in its types] This also freezes DOM tweens whenever R3F is idle, so prefer `invalidate()`. [U]
- `useFrame(cb, n)` with `n > 0` **turns off R3F's automatic render**. Source comment: "it takes rendering into its own hands". [V] `EffectComposer` already uses priority 1. [V] To order work without that side effect, use a negative priority: only positive values raise the manual-render flag. [V]
- Pass `invalidate` as `useThree((s) => s.invalidate)` to avoid a broad re-render subscription. [U, skill]
- `motion/three` exports only `threeEffect`, which binds motion values to objects imperatively. There is no `motion.mesh`. [V] Do not plan around it. [U]

### 2.7 HUD and DOM performance

- Animate `transform` and `opacity` only. [U, skill]
- **Be sparing with `backdrop-filter` over a live canvas.** The skill warns about cost and suggests 2-3 glass elements per viewport. [U] Over an always-moving WebGL layer on an iGPU, prefer near-opaque panels and keep real blur for one or two surfaces. [U]
- Set `will-change` only during an animation. The GSAP skill's permanent `will-change` contradicts the design skill. [V that they conflict]
- `layout` is expensive. Prefer `layout="position"`. [U, skill]
- Virtualise long lists and add `contain: layout style paint` to panels. [U]
- Use `tabular-nums` for telemetry so digits do not jitter. [U]
- Do not use the skill's `clamp()` fluid type on dense panels. Fixed steps suit an ops view; keep fluid type for the hero title. [U]

### 2.8 Adaptive quality and resilience

`<PerformanceMonitor>` only computes a factor and calls your callbacks. [V] `<AdaptiveDpr>` only follows `performance.current`, and within Drei's `core` folder `regress` appears only in four controls. [V] So the skill's snippet (`SKILL.md:804-819`) with `console.log` callbacks changes nothing under load. Wire it up as the skill's own example does:

```tsx
const [dpr, setDpr] = useState(1.25)
<Canvas dpr={dpr} flat frameloop="demand" eventSource={rootRef} eventPrefix="client"
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}>
  <PerformanceMonitor onIncline={() => setDpr(1.5)} onDecline={() => setDpr(1)} />
```

- **Handle WebGL context loss yourself.** R3F has no `webglcontextlost` handling (0 files match in `dist`). three has its own (3 matches in `WebGLRenderer.js`). [V] Listen on `gl.domElement`, show a DOM banner, and recover. `react-three-fiber`, `threejs-webgl`, `web3d-integration-patterns` and `modern-web-design` never mention this. [V] It matters for a dashboard that stays open all day. [U]
- **Watch for leaks** with `gl.info.memory` in a dev overlay. Objects passed through `<primitive>` are yours to dispose. [U, skill]
- **`THREE.Clock` is deprecated,** and R3F 9.8.2 still creates one (`clock: new THREE.Clock()`). [V] Expect a console warning. [U] Use `delta` and your own accumulator instead of `state.clock`. [U]
- **Stay offline-capable.** The tool is local, and these Drei defaults reach third-party hosts: [V]

| Drei feature | Host |
|---|---|
| `Environment preset=...` (`useEnvironment.js`) | `raw.githack.com` |
| `useGLTF` / `Gltf` Draco decoders | `www.gstatic.com` |
| `Ktx2`, `MatcapTexture`, `NormalTexture` | `cdn.jsdelivr.net` and githack |
| `Cloud` default texture | `rawcdn.githack.com` |
| `detect-gpu`, a Drei dependency, for its benchmark data | `unpkg.com` |

`react-three-fiber`, `threejs-webgl` and `web3d-integration-patterns` never mention these hosts or offline use. [V] Avoid presets. Build light with `<Lightformer>` or skip environment maps, and host any decoder locally. [U]

### 2.9 Accessibility

- Respect `prefers-reduced-motion` with `MotionConfig reducedMotion="user"` for the HUD. [V for the API] Use `gsap.matchMedia()` for GSAP. [V for the API]
- Do not copy the skills' `gsap.config({ nullTargetWarn: false })` under a reduced-motion check. `nullTargetWarn` is a warning flag in GSAP's config type, not a motion switch. [V for the type, U on runtime effect]
- Never signal state by colour alone. Pair colour with shape or motion and a text label. [U, skill]
- Mirror the scene in a focusable DOM list so keyboard and screen-reader users can select agents. [U]
- Use `aria-live="polite"`, throttled, for state changes, and an assertive region only for approvals. [U]
- Modals need a focus trap, Escape handling and focus return. [U, skill]
- Never trust contrast comments in the skills. See 3.3. Compute them.

### 2.10 Design direction

The brief asks for flashy, cool and insane. The skills' relevant trends are dark-first, neon gradients, high-contrast duotone, kinetic type and depth layering. [U, skill] The proposal is a **dark control room**: a deep void, additive glowing agents clustered by project, and crisp telemetry in the HUD. [U]

**Tokens.** All values are in sRGB gamut, so DOM and WebGL can use the same colours. Contrast is computed with the WCAG formula. [V]

| Token | OKLCH | Hex | On void | On panel | On raised |
|---|---|---|---|---|---|
| `bg.void` | `14.5% 0.018 265` | `#070a12` | - | - | - |
| `bg.panel` | `19.5% 0.022 265` | `#10151f` | - | - | - |
| `bg.raised` | `24.5% 0.026 265` | `#1a202d` | - | - | - |
| `line` | `36% 0.03 265` | `#353d4d` | 1.82 | 1.68 | 1.49 |
| `text.hi` | `96.5% 0.008 265` | `#f1f3f9` | 17.89 | 16.53 | 14.68 |
| `text.mid` | `80% 0.02 265` | `#b7becb` | 10.59 | 9.79 | 8.69 |
| `text.lo` | `68% 0.025 265` | `#9198a8` | 6.87 | 6.35 | 5.63 |
| `accent.cyan` / `state.run` | `82% 0.14 210` | `#13dcf6` | 11.87 | 10.97 | 9.73 |
| `accent.violet` | `74% 0.14 295` | `#b298f9` | 8.22 | 7.60 | 6.74 |
| `state.wait` | `83% 0.15 85` | `#f4bf3f` | 11.62 | 10.74 | 9.53 |
| `state.ok` | `82% 0.17 155` | `#52e492` | 12.10 | 11.19 | 9.93 |
| `state.err` | `72% 0.17 18` | `#fd717c` | 7.39 | 6.83 | 6.06 |
| `state.idle` | `66% 0.03 265` | `#8992a5` | 6.36 | 5.88 | 5.22 |

`line` is decorative only. It sits below the 3:1 needed for meaningful UI boundaries, so use `text.lo` for those. [V for the ratio]

**State encoding** (proposal, [U]):

| State | Colour | Shape or motion | Label |
|---|---|---|---|
| Running | `state.run` | Slow pulse, flow along edges | `running` |
| Waiting for approval | `state.wait` | Stronger pulse, ring, HUD card with focus | `needs approval` |
| Done | `state.ok` | Ring collapses, node dims | `done` |
| Error | `state.err` | Sharp one-shot flicker, then steady | `error` |
| Idle or queued | `state.idle` | Static | `idle` |

**Type:** Space Grotesk for display, Inter for UI, JetBrains Mono for telemetry. Family names are `'Space Grotesk Variable'`, `'Inter Variable'` and `'JetBrains Mono Variable'`. [V] Latin subsets are 22 KB, 48 KB and 40 KB. [V]

**Motion tokens.** The skill offers 150, 250 and 400 ms with `cubic-bezier(0.34, 1.56, 0.64, 1)` for spring-like overshoot. For GSAP, `power2.out` is the default and `power3.out` is for larger moves. Use overshoot sparingly. [U, skill]

**Signature moments,** each short and skippable under reduced motion ([U]):

1. Boot: grid ignites, title resolves with `ScrambleTextPlugin`. The plugin ships in public `gsap`. [V]
2. Spawn: a node bursts out of its project core, and the edge draws in.
3. Approval: amber pulse, slight camera nudge, HUD card slides in and takes focus.
4. Focus: GSAP camera fly-to, HUD morphs through `layoutId`.
5. Completion: ring collapses and telemetry settles.

### 2.11 Budgets

No GPU measurement exists yet, so all of these are targets. [U]

| Metric | Target | Source |
|---|---|---|
| Frame time, active | 16.7 ms, fall back to 33 ms | Skill desktop target; 33 ms is my iGPU fallback |
| Draw calls | Below 100 | Skill desktop target |
| Visible triangles | Well below the skill's 1M | iGPU adjustment |
| DPR | 1.0 to 1.5 | iGPU adjustment |
| Post passes | Bloom, plus optional vignette | Judgement |
| Live `Html` labels | Around 30 | Judgement |
| Canvas count | 1 | Judgement |

Measured bundle for the smoke app, section 4 set: 1,700 KB of JS, about 497 KB gzip. Details are in 4.3. [V]

### 2.12 What these skills teach that a default developer would miss

1. Positive `useFrame` priority disables automatic rendering. [V]
2. Keep expensive scene parts mounted with `visible` rather than conditional mounting. [U, skill]
3. `AnimatePresence` needs a direct child with a stable `key`, and `mode="popLayout"` handles list exits. [U, skill]
4. `layout="position"` is cheaper than `layout`. [U, skill]
5. Put one ScrollTrigger on a timeline, not on tweens inside it. [U, skill]
6. Choose the cheapest material that keeps the look, and share geometry and materials. [U, skill]
7. Reuse one `Object3D` or `Matrix4` as a scratch object in loops. [U, skill]
8. A spring is critically damped at `friction = 2 * sqrt(tension * mass)`. The default `170/26` is almost exactly that (26.08), so it settles with practically no overshoot. Arithmetic confirmed. [V]
9. Pick easing by exit and entrance: `.out` for both, `none` for scrubbed values. [U, skill]
10. `filterArea`, `BitmapText` and pooling are the Pixi fixes, if a 2D layer is ever needed. [U, skill]

The biggest gaps are what the skills **omit**: context loss, CDN defaults, the woff2 limit, and `frames` on `ContactShadows`. [V]

## 3. Staleness audit

### 3.1 Registry facts

All values come from `npm view <pkg> version peerDependencies --json` on 2026-10-30. [V] Dates are publish dates where I fetched them. An `m` suffix marks the packument's `time.modified`, which is only an upper bound for that version.

| Package | Skills assumed | Current | Date | Peers read from npm |
|---|---|---|---|---|
| `react`, `react-dom` | ^18.3.1 | 19.3.1 | 2026-10-14 | `react-dom`: `react ^19.3.1` |
| `three` | ^0.172.0, CDN 0.160, r134 | 0.187.0 | 2026-10-30 | none |
| `@types/three` | ^0.172.0 | 0.187.0 | 2026-10-30 | none |
| `@react-three/fiber` | ^8.18.8 | 9.8.2 | 2026-10-14 | `react >=19 <19.4`, `react-dom >=19 <19.4`, `three >=0.156` |
| `@react-three/drei` | ^9.123.0 | 10.7.9 | 2026-09-25 | `react ^19`, `three >=0.159`, `@react-three/fiber ^9.0.0`, optional `react-dom ^19` |
| `@react-three/postprocessing` | unversioned | 3.2.2 | 2026-10-21 | `react ^19.0.0`, `three >= 0.156.0`, `postprocessing ^6.36.0`, `@react-three/fiber >=9.7.0` |
| `postprocessing` | unversioned | 6.39.5 | 2026-09-09 | **`three >= 0.168.0 < 0.187.0`** |
| `gsap` | "Club" plugins era | 3.15.0 | 2026-04-13 | none |
| `@gsap/react` | unversioned | 2.1.2 | 2025-01-15 | `gsap ^3.12.5`, `react >=17` |
| `motion` | "v11+" | 14.9.0 | 2026-10-30 | optional `react`, `react-dom` `^18 \|\| ^19`, optional `remix ^3.1.0` |
| `framer-motion` | ^11.15.0 | 14.9.0 | m 2026-10-30 | same as `motion` |
| `framer-motion-3d` | used in examples | 12.4.13 | 2025-03-11 | **`@react-three/fiber 8.2.2`**, npm marks it "no longer supported" |
| `zustand` | default import era | 5.0.16 | 2026-10-22 | optional `react >=18`, `immer >=9.0.6`, `@types/react >=18`, `use-sync-external-store >=1.2.0` |
| `vite` | ^6.0.11 | 8.3.5 | 2026-10-21 | optional only |
| `@vitejs/plugin-react` | ^4.3.4 | 6.1.2 | 2026-10-05 | `vite ^8.0.0`, others optional |
| `typescript` | unversioned | 7.0.2 | 2026-07-08 | none |
| `typescript-eslint` | not used | 8.72.1 | not fetched | **`typescript >=4.8.4 <6.1.0`**, `eslint ^8.57 \|\| ^9 \|\| ^10` |
| `tailwindcss` | config-file era | 4.3.3 | 2026-07-16 | none |
| `@tailwindcss/vite` | not mentioned | 4.3.3 | 2026-07-16 | `vite ^5.2.0 \|\| ^6 \|\| ^7 \|\| ^8` |
| `@types/react`, `@types/react-dom` | ^18.3 | 19.3.0 | 2026-09-09 | `@types/react-dom`: `@types/react ^19.3.0` |
| `@fontsource-variable/*` | not used | 5.3.0 | 2026-07-19 | none |
| `@fontsource/*` | not used | 5.3.0 | m 2026-07-19 | none |
| `pixi.js` | v8 partly | 8.22.0 | m 2026-10-27 | none |
| `@pixi/react` | not mentioned | 8.0.5 | m 2025-12-01 | `pixi.js ^8.2.6`, `react >=19.0.0` |
| `animejs` | "v3+" | 4.5.0 | m 2026-08-17 | optional `three`, `@types/three >=0.150.0` |
| `@react-spring/web` | unversioned | 10.1.2 | m 2026-10-01 | `react`, `react-dom` `^16.8 \|\| ^17 \|\| ^18 \|\| ^19` |
| `@react-spring/three` | unversioned | 10.1.2 | m 2026-10-01 | as above, `three >=0.126`, `@react-three/fiber >=6.0` |
| `popmotion` | unversioned | 11.0.5 | m 2022-08-15 | none |
| `vanta` | 0.5.24 | 0.5.24 | m 2022-09-16 | none, needs `THREE` passed in or global |
| `zdog` | 1.1.3 | 1.1.3 | m 2022-05-25 | none |
| `vanilla-tilt` | 1.8.1 | 1.8.1 | m 2023-08-15 | none |
| `leva` | ^0.9.35 | 0.10.1 | m 2025-10-31 | `react`, `react-dom` `^18 \|\| ^19`; pulls `zustand ^3.6.9` |
| `r3f-perf` | not mentioned | 7.2.3 | m 2024-11-08 | `@react-three/fiber >=8.0`, `react >=18`, `three >=0.133`; pulls `zustand ~4.5.2` |
| `maath` | not mentioned | 0.10.8 | m 2026-08-17 | `three >=0.134.0`, `@types/three >=0.134.0` |
| `three-stdlib` | not mentioned | 2.36.1 | m 2025-11-10 | `three >=0.128.0` |
| `troika-three-text` | via Drei | 0.52.5 | m 2026-07-24 | `three >=0.125.0` |

### 3.2 APIs that no longer apply

Each row was confirmed by the compiler, the bundler or installed source.

| Skill location | Stale pattern | Reality | Evidence |
|---|---|---|---|
| `web3d-integration-patterns/SKILL.md:536,609`; `react-three-fiber/SKILL.md:695` | `import create from 'zustand'` | Use `import { create } from 'zustand'` | [V] TS1192 |
| `web3d-integration-patterns/SKILL.md:268,508`; `react-three-fiber/SKILL.md:676` | `motion` from `framer-motion-3d` | Package is unsupported and locked to R3F 8.2.2. No `motion.mesh` successor exists | [V] npm, `motion/three` types |
| `motion-framer` throughout | `from "framer-motion"` | Use `motion/react`. The old name resolves only because it is hoisted | [V] exports, tsc |
| `react-three-fiber/SKILL.md:166,207,311`; `references/api_reference.md:361` | `three/examples/jsm/loaders/GLTFLoader` | Fails under `moduleResolution: bundler`. Use `three/addons/loaders/GLTFLoader.js` | [V] TS2307, addon path passes |
| `react-three-fiber/references/api_reference.md:323,431` | `GLTFLoader` from `three` | Not exported by three core | [V] TS2305 |
| `react-three-fiber/SKILL.md:426,764`; `assets/examples/README.md:338` | `args={[null, null, count]}` | Use `undefined` | [V] TS2322 |
| R3F examples with `useRef()` | No argument | `@types/react` 19 needs one | [V] TS2554 |
| `react-three-fiber/assets/starter_r3f/vite.config.js:12-18` | `manualChunks` as an object | **Vite 8 build crashes:** `TypeError: manualChunks is not a function` | [V] build |
| Same | `manualChunks` as a function | Builds, but three was silently merged into the `r3f` chunk | [V] build |
| `react-three-fiber/assets/starter_r3f/package.json` | React 18, R3F 8, Drei 9, Vite 6 | Every core dependency is at least one major behind | [V] read |
| `threejs-webgl/SKILL.md:250`; `references/api_reference.md:48,412`; `assets/starter_scene/main.js:21` | `THREE.PCFSoftShadowMap` | Removed at runtime, falls back to `PCFShadowMap` with a warning | [V] `WebGLShadowMap.js:99-101` |
| `threejs-webgl/SKILL.md:419`; `references/api_reference.md:358` | `new THREE.Clock()` | Deprecated since r183, use `THREE.Timer` | [V] `Clock.js` |
| `react-three-fiber/references/api_reference.md` | `state.mouse` | Deprecated, use `pointer`. The skill says so too | [V] `store.d.ts:93` |
| `gsap-scrolltrigger/SKILL.md:520`; `references/api_reference.md:312`; `references/common_patterns.md:931` | `ScrollTrigger.matchMedia()` | Deprecated since 3.11, use `gsap.matchMedia()` | [V] `scroll-trigger.d.ts:271` |
| `gsap-scrolltrigger/references/common_patterns.md:500,515`; `easing_guide.md:536`; `assets/examples/README.md:112` | "Club GreenSock plugin" | SplitText, ScrambleText, CustomEase, MorphSVG, DrawSVG, Flip, Inertia and ScrollSmoother all ship in public `gsap@3.15.0` | [V] file listing |
| `motion-framer/SKILL.md:135,335,342` | `staggerChildren` | Deprecated: "Use `delayChildren: stagger(interval)`" | [V] motion-dom `d.ts` |
| `animejs/SKILL.md:37` and all references | `anime({ targets })`, `anime.timeline`, `anime.stagger`, `anime.path`, `anime.setDashoffset` | v4 has named exports only, no default export. The whole skill targets v3 | [V] `dist/modules/index.d.ts` |
| `react-spring-physics/SKILL.md:293-306`; `references/popmotion_api.md` | `inertia(...).start(fn)`, `physics`, `.pipe()`, `.filter()` | v11 `inertia` returns `{ stop }` with no `.start`. No release since 2022 | [V] `inertia.d.ts` |
| `pixijs-2d/SKILL.md:762`; `references/performance_guide.md` | `cacheAsBitmap` | Deprecated since 8.0, use `cacheAsTexture` | [V] mixin `d.ts` |
| `pixijs-2d/SKILL.md:299` | `beginHole()`, `endHole()` | Not in `Graphics.d.ts`. `.cut()` is | [V] `d.ts` |
| `pixijs-2d/references/performance_guide.md:220,250` | `cullable` on `Application` | Not in `Application.d.ts`. Culling is `CullerPlugin` | [V] `d.ts` |
| `pixijs-2d/references/performance_guide.md:410,413` | `texture.baseTexture`, `SCALE_MODES` | `SCALE_MODES` aliases `DEPRECATED_SCALE_MODES`; `SCALE_MODE` is now a string type | [V] `const.d.ts` |
| `pixijs-2d/references/performance_guide.md:33,82` | `renderer.stats` | No `stats` member in `AbstractRenderer.d.ts` or `types.d.ts` | [V] grep; other files not checked |
| `lightweight-3d-effects/SKILL.md:312` | `three@0.134.0` from a CDN for Vanta | A second, ancient three alongside r186. No Vanta release since 2022 | [V] metadata; runtime [U] |

These still hold, because the smoke app uses them and it compiles: `useGSAP`, `ThreeElements['mesh']`, `AnimatePresence`, `LazyMotion` with `domAnimation`, `MotionConfig`, `useReducedMotion`, `useAnimate`, `useMotionValue`, `stagger`, `LayoutGroup`, `Html`, `Instances`, `Bvh`, `PerformanceMonitor`, `AdaptiveDpr`, `AdaptiveEvents`, `CameraControls`, `OrbitControls`, `Billboard`, `Text`. [V] `useAnimation` remains an alias of `useAnimationControls`. [V] Pixi's `generateFilteredTexture` exists. [V]

Not checked: `web-vitals` calls in `performance_checklist.md`, and FID as a current metric. They are irrelevant for a local tool. [U]

### 3.3 Errors that are not about age

| Location | Problem | Evidence |
|---|---|---|
| `react-three-fiber/scripts/component_generator.py:149` | Python syntax error, so the script and its command cannot run | [V] `ast.parse` |
| `modern-web-design/SKILL.md:610`; `references/accessibility_guide.md:480` | `gsap.config({ nullTargetWarn: false })` is presented as the reduced-motion response | [V] read |
| `modern-web-design/references/accessibility_guide.md:76-89` | Wrong contrast comments. `oklch(20% 0 0)` is `#161616` at 18.10:1, not `#1a1a1a` at 11.6:1. `oklch(40% 0 0)` is `#484848` at 9.21:1, not `#666666` at 7.3:1, and `#666666` is really 5.74:1. `oklch(50% .15 140)` is 5.66:1, not 7.2:1, so that "AAA" accent fails AAA | [V] computed |
| `modern-web-design/SKILL.md:347` | Refers to a `model-viewer-component` skill that does not exist | [V] listing |

### 3.4 Content that SKILL.md promises but the repo lacks

[V] by file listing. Do not let a future session chase these:

- `web3d-integration-patterns`: all of `references/`, `scripts/` and `assets/`. The skill is one file.
- `react-three-fiber`: `references/hooks_guide.md`, `references/drei_helpers.md`.
- `threejs-webgl`: `scripts/texture_optimizer.py`, `scripts/gltf_validator.py`, `assets/shaders/`, `assets/hdri/`, `assets/draco/`.
- `motion-framer`: `references/variants_patterns.md`, `references/gesture_guide.md`.
- `modern-web-design`: every asset in `assets/README.md`, which says "Would be in `tokens/`".
- `animated-component-libraries`: `assets/component_showcase/`, `assets/examples/`.
- `react-spring-physics`: `assets/starter_spring/`, `assets/examples/`.
- `animejs`: `assets/starter_animejs/`, `assets/examples/`.
- `gsap-scrolltrigger`: the "self-contained HTML files" in `assets/examples/README.md`, such as `pin_animation.html`.

## 4. Recommended dependency set

### 4.1 Exact set

Install with exact versions and commit the lockfile.

```json
{
  "dependencies": {
    "@fontsource-variable/inter": "5.3.0",
    "@fontsource-variable/jetbrains-mono": "5.3.0",
    "@fontsource-variable/space-grotesk": "5.3.0",
    "@gsap/react": "2.1.2",
    "@react-three/drei": "10.7.9",
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
  },
  "overrides": {
    "stats-gl": { "three": "$three" }
  }
}
```

Optional, only if 3D text ships: `@fontsource/jetbrains-mono@5.3.0` for its `.woff` files. It was not part of the smoke build. [V for the file]

**Tailwind: recommended,** as a utility layer over the tokens in 2.10, through `@theme` in CSS. The Vite plugin built cleanly. [V]

### 4.2 Why not simply `latest`

| Pin | Instead of | Reason |
|---|---|---|
| `three 0.186.1` | 0.187.0 | `postprocessing` caps at `< 0.187.0`. Negative control failed with `ERESOLVE`, naming that exact peer. 0.187.0 was also published today. [V] |
| `@types/three 0.186.0` | 0.187.0 | Matches the three minor. No `0.186.1` types release exists. [V] |
| `motion 14.6.0` | 14.9.0 | 13 `14.x` releases between 2026-10-02 and today, the newest published today. 14.6.0 (2026-10-22) is the newest with over seven days of exposure. [V] Seven days is my policy, not a rule. [U] |
| `typescript 6.0.3` | 7.0.2 | `typescript-eslint` peers require `<6.1.0`. Both pass here: TS 6 in 2.95 s, TS 7 in 0.72 s. [V] Move to 7 once lint supports it, or now if the project drops typed lint. |

### 4.3 Proof, run on this exact set

All [V], in a scratch project with `--ignore-scripts` and no legacy peer flags.

| Check | Result |
|---|---|
| `npm install --package-lock-only` | Exit 0, 165 packages |
| Negative control with `three@0.187.0` | `ERESOLVE` on `postprocessing` peer, exit 1 |
| `npm ci --ignore-scripts` | 113 packages on Windows |
| Install scripts in the tree | Only `fsevents`, macOS-only |
| three copies in `node_modules` | 1 with the override, 2 without |
| `tsc --noEmit`, strict, `verbatimModuleSyntax` | Exit 0 under 6.0.3. An earlier run of the same code without the override also passed under 7.0.2 |
| `vite build` | Exit 0 in about 1 s |
| `npm audit --omit=dev` | 0 vulnerabilities |

The smoke app imports and uses the APIs named in section 2, including `<EffectComposer>`, `<Bloom>`, `useGSAP`, `SplitText`, `LazyMotion`, `subscribeWithSelector` and `useShallow`.

| Chunk | Size | Gzip |
|---|---|---|
| `three` | 736.85 KB | 186.84 KB |
| `r3f` (fiber, drei, postprocessing and helpers) | 711.33 KB | 220.72 KB |
| `anim` (gsap, motion) | 246.55 KB | 87.52 KB |
| app entry | 5.46 KB | 2.57 KB |

**Not proven:** first frame, shaders, bloom output, `vite dev`, and any frame rate. The first build step should be a real browser check on this machine.

### 4.4 Vite config

Use native Rolldown chunking. This is the only form I tested that splits three correctly. [V]

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 30 },
            { name: 'r3f', test: /node_modules[\\/](@react-three|postprocessing|three-stdlib|troika|n8ao|maath|camera-controls)/, priority: 20 },
            { name: 'anim', test: /node_modules[\\/](gsap|@gsap|motion|framer-motion|motion-dom|motion-utils)/, priority: 10 },
          ],
        },
      },
    },
  },
})
```

Lazy-load the canvas so the HUD paints first. [U]

### 4.5 Traps to remember

- **`stats-gl` drags in `three@0.170.0`** through a hard dependency of Drei. Without the override, `<StatsGl>` would pull a second three into the app. The smoke bundle held one copy only because that import was tree-shaken. [V]
- **Fiber caps React at `<19.4`.** The next React minor needs a Fiber release first. [V]
- **`@react-three/postprocessing` needs Fiber `>=9.7.0`.** [V]
- **Upgrade three and postprocessing together.** Check the peer cap first. [V for the cap]
- **Do not import `framer-motion` directly,** even though it resolves. [V]
- **`tunnel-rat` nests `zustand@4.5.7`.** It is a Drei dependency with its own store, so this looks harmless. [V for the nesting, U for harmless]
- **GSAP is not open source.** Its licence is "Standard 'no charge' license". [V] I did not read the terms, so check them before redistributing. [U]
- **Leave these out unless a need appears:** `pixi.js`, `animejs`, `@react-spring/*`, `popmotion`, `vanta`, `zdog`, `vanilla-tilt`, `ogl`, `leva`, `r3f-perf`. They add a second renderer, a redundant animation owner, or stale dependencies such as older `zustand` copies. [V for the dependency facts, U for the judgement]

## 5. Skills to copy into `.claude/skills/`

Nothing has been copied yet.

**Copy rule:** take `SKILL.md` and `references/` only, plus the repo's `LICENSE`. Skip `scripts/`, `assets/`, the plugin `commands/` and `agents/`, and all zips. This removes the stale starters, the broken generator, the CDN tags and every file that was not read by eye.

**Add a staleness note.** Each copied skill should point to this document, because its code samples still contain the stale patterns from 3.2.

| Skill | Why copy | Watch out for |
|---|---|---|
| `react-three-fiber` | Core 3D layer: hooks, Drei, instancing, pitfalls | Zustand, `null` args, deep imports, R3F 8 assumptions |
| `threejs-webgl` | Materials ranking, optimization checklist, renderer basics | `Clock`, `PCFSoftShadowMap` |
| `gsap-scrolltrigger` | Timelines, easing guide and `useGSAP` for camera and boot sequences | `ScrollTrigger.matchMedia`, "Club" notes; most scroll content is not needed |
| `motion-framer` | HUD presence, layout, gestures, variants | Use `motion/react`; `staggerChildren` is deprecated |
| `web3d-integration-patterns` | Animation ownership and the combination decision matrix | One file; skip every `framer-motion-3d` block |
| `modern-web-design` | Accessibility, interaction catalog, tokens, performance checklists | Contrast comments are wrong; web-page advice such as scrollytelling does not apply |

**Clean but not worth copying:**

| Skill | Reason |
|---|---|
| `lightweight-3d-effects` | Vanta needs a separate three, and none of the three libraries has had a release since 2023 |
| `animated-component-libraries` | Catalog for marketing pages. Some entries say "verify exact implementation". WebGL components add `ogl`. `shadcn` CLI pulls remote code. Border-beam and shimmer ideas can be rebuilt in CSS |
| `pixijs-2d` | Second WebGL context, partly stale. Revisit only if a dense 2D timeline needs it |
| `react-spring-physics` | Redundant with `motion`, and its Popmotion half is dead. The damping maths is in 2.12 |
| `animejs` | Whole skill targets the v3 API, and GSAP covers it |

**The other 12 skills** do not fit a single-view R3F ops UI: `aframe-webxr`, `babylonjs-engine`, `barba-js`, `blender-web-pipeline`, `locomotive-scroll`, `lottie-animations`, `playcanvas-engine`, `rive-interactive`, `scroll-reveal-libraries`, `skill-creator`, `spline-interactive`, `substance-3d-texturing`. `blender-web-pipeline` could return if custom GLB models are ever made. [U]

**Blocked:** none. No skill failed the security screen. [V]

**Licence mismatch:** the repo `LICENSE` says MIT, while all six plugin manifests say Apache-2.0. [V] Both are permissive, but keep the notice with the copied files. [U]

## 6. Open items

1. Run the first real browser check on this machine: first frame, bloom, `frameloop` switching, and the `THREE.Clock` warning. [U]
2. Measure the Arc iGPU and replace the budgets in 2.11. [U]
3. Test WebGL context loss and recovery. [U]
4. Read the GSAP licence before any redistribution. [U]
5. Decide on 3D text. DOM labels avoid both the woff2 limit and the troika CDN path. [U]
