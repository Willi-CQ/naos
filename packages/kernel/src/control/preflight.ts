// What a launch would load, before it happens. No spawn and no model call. Everything here comes from resolveSettings and the
// file system. Spawn-derived numbers appear only as `loadout`, measured at the last spawn in a trusted repo (DESIGN 3.8).
import { resolveSettings as sdkResolve, type ResolvedSettings, type ResolveSettingsOptions } from '@anthropic-ai/claude-agent-sdk';
import type { AdmissionState, PlanState, PreflightResult, SpawnSpec } from '@naos/protocol';
import { DEFAULT_LIMITS, FIRST_FLIGHT_PROFILE, WORLD_DESIGNER_PROFILE } from '@naos/protocol';
import fs from 'node:fs';
import path from 'node:path';
import type { KernelContext } from '../context.ts';
import { WORLD_DESIGNER_BUDGET_USD, worldDesignerProfile } from './designer.ts';
import { FIRST_FLIGHT_BUDGET_USD, firstFlightFolder, firstFlightProfile } from './firstflight.ts';
import type { Store } from './store.ts';
import type { Profile } from './types.ts';
import { gitInfo } from './worktree.ts';

export type ResolveSettings = (o: ResolveSettingsOptions) => Promise<ResolvedSettings>;

export interface PreflightDeps {
  ctx: KernelContext;
  store: Store;
  profile(name: string): Profile | undefined;
  admission(): AdmissionState;
  /** Why a launch of this many craft would be refused now, in plain words. */
  admissionBlock(copies: number): string | null;
  resolveSettings?: ResolveSettings;
}

const usedPercent = (plan: PlanState | null): number | null =>
  plan?.fiveHourLeft === null || plan?.fiveHourLeft === undefined ? null : Math.round((1 - plan.fiveHourLeft) * 100);

export async function preflight(spec: SpawnSpec, d: PreflightDeps): Promise<PreflightResult> {
  const { worlds, config, bus } = d.ctx;
  const first = spec.profile === FIRST_FLIGHT_PROFILE;
  const designer = spec.profile === WORLD_DESIGNER_PROFILE;
  const profile = designer ? worldDesignerProfile() : first ? firstFlightProfile() : d.profile(spec.profile);
  const warnings: string[] = [];
  let blocked: string | null = null;

  const known = spec.worldId ? worlds.get(spec.worldId) : undefined;
  const folder = first ? firstFlightFolder(config.home) : spec.cwd ? path.resolve(spec.cwd) : known?.projectRoot ?? null;
  if (spec.worldId && !known) blocked = 'That world is not known.';
  if (!folder) blocked ??= 'Name a world or a folder.';

  const exists = folder !== null && fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory() === true;
  if (folder && !exists) blocked ??= 'That folder does not exist.';
  const git = folder && exists ? await gitInfo(folder) : null;
  const root = git?.root ?? folder ?? '';
  // find, not ensure: a preflight on an unknown folder must not create a world.
  const world = known ?? (root ? worlds.find(root) : undefined);
  const trusted = !first && !designer && profile?.settings !== 'none' && world?.trusted === true;

  if (!profile) blocked ??= `No profile named ${spec.profile}.`;
  const wantsWorktree = !first && (spec.worktree ?? profile?.worktree ?? false);
  const worktreePossible = git?.isGit === true && git.hasCommit;
  if (wantsWorktree && git && !git.isGit) warnings.push('Not a git folder, so this craft gets no worktree.');
  else if (wantsWorktree && git && !git.hasCommit) warnings.push('This repository has no commits, so this craft gets no worktree.');
  if (exists && !trusted && !first) warnings.push('Unknown repo: its settings, hooks and MCP servers stay out, and the tool set is tighter.');

  const sources: string[] = [];
  const hooks: string[] = [];
  if (exists && folder) {
    try {
      const resolved = await (d.resolveSettings ?? sdkResolve)({ cwd: folder, settingSources: trusted ? ['user', 'project', 'local'] : [] });
      for (const s of resolved.sources) if (!sources.includes(s.source)) sources.push(s.source);
      hooks.push(...Object.keys(resolved.effective.hooks ?? {}));
    } catch (e) {
      warnings.push(`Settings could not be read: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  const admission = d.admission();
  const copies = Math.max(1, spec.copies ?? 1);
  const closed = d.admissionBlock(copies);
  if (closed) {
    if (spec.queue) warnings.push(`${closed} This launch will wait on the Pad.`);
    else blocked ??= closed;
  }

  return {
    world: { worldId: world?.worldId ?? null, name: world?.name ?? (root ? path.basename(root) : ''), root, isGit: git?.isGit ?? false, trusted },
    profile: first ? FIRST_FLIGHT_PROFILE : designer ? WORLD_DESIGNER_PROFILE : spec.profile,
    model: first || designer ? profile!.model : spec.model ?? profile?.model ?? '',
    budgetUsd: first ? FIRST_FLIGHT_BUDGET_USD : designer ? WORLD_DESIGNER_BUDGET_USD : spec.budgetUsd ?? profile?.defaultBudgetUsd ?? 0,
    treeBudgetUsd: spec.mission?.treeBudgetUsd ?? null,
    sources,
    hooks,
    cwd: { exists, isGit: git?.isGit ?? false, worktreePossible },
    admission,
    plan: { fiveHourUsedPercent: usedPercent(bus.state().plan), freezeAtPercent: DEFAULT_LIMITS.admissionStopPercent },
    connectors: 'off',
    loadout: trusted && world?.projectRoot ? d.store.loadout(world.projectRoot) : null,
    warnings,
    blocked,
  };
}
