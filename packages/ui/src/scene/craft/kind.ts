// INTERSTELLAR 25: what a craft is. Model class picks the hull, agent type picks the mission, and neither ever changes a state.
// Pure, because the rails, the marks and the meshes must agree, and strings here come from disk and can change on any release.

export const HULLS = ['scout', 'cruiser', 'capital', 'longrange', 'default'] as const;
export type HullClass = (typeof HULLS)[number];

export const ROLES = ['plain', 'probe', 'survey', 'tug', 'command', 'drone'] as const;
export type Role = (typeof ROLES)[number];

/** How large the craft stays. A tender and a bead keep the family's shape at a size that says they serve something. */
export type CraftSize = 'vessel' | 'tender' | 'bead';

export interface CraftKind {
  hull: HullClass;
  role: Role;
  size: CraftSize;
}

/** The node kinds of the protocol, as a plain string: an unknown one must fall through, not fail to compile a build. */
export interface CraftFacts {
  client?: string | null;
  /** `claude-opus-5-5`, `us.anthropic.claude-sonnet-5-5`, `opus[1m]`, or nothing yet. */
  model: string | null | undefined;
  /** `Explore`, `Plan`, `general-purpose`, `workflow-subagent`, a custom name, or nothing for a main thread. */
  agentType?: string | null | undefined;
  /** A managed agent's profile: `recon`, `plan`, `build`, `orchestrator`. */
  profile?: string | null | undefined;
  /** `main`, `subagent`, `teammate`, `workflow-agent`. */
  node?: string | null | undefined;
}

export function hullClassOf(model: string | null | undefined): HullClass {
  const m = model?.toLowerCase() ?? '';
  // Fable first: it is the rare one, and a longer name must not be read as a shorter family.
  if (m.includes('fable')) return 'longrange';
  if (m.includes('opus')) return 'capital';
  if (m.includes('sonnet')) return 'cruiser';
  if (m.includes('haiku')) return 'scout';
  if (m.includes('astra')) return 'capital';
  if (m.includes('sol') || m.includes('terra') || m.includes('codex')) return 'cruiser';
  if (m.includes('luna') || m.includes('mini')) return 'scout';
  return 'default';
}

const ROLE_WORDS: ReadonlyArray<readonly [RegExp, Role]> = [
  [/orchestrat|coordinat|supervis|command|lead/, 'command'],
  [/explor|recon|search|research|scout|find|discover/, 'probe'],
  [/plan|analy|architect|review|audit|survey|design|critic/, 'survey'],
  [/general|build|code|coder|implement|engineer|develop|fix|worker|long|test|refactor|migrat/, 'tug'],
];

const roleOfName = (name: string): Role | null => {
  const n = name.toLowerCase();
  for (const [re, role] of ROLE_WORDS) if (re.test(n)) return role;
  return null;
};

/**
 * A workflow agent is a drone whatever it was typed, since `general-purpose` shows up on those too. A main thread with no name is the
 * general builder: it is the ship the user is steering, and most of a real fleet is exactly that. Only a name nobody knows is plain.
 */
export function roleOf(f: Pick<CraftFacts, 'agentType' | 'profile' | 'node'>): Role {
  if (f.node === 'workflow-agent' || f.agentType === 'workflow-subagent') return 'drone';
  const profile = f.profile ? roleOfName(f.profile) : null;
  if (profile) return profile;
  if (f.agentType) return roleOfName(f.agentType) ?? 'plain';
  if (f.profile) return 'plain';
  return f.node === 'main' || f.node === undefined || f.node === null ? 'tug' : 'plain';
}

export function sizeOf(node: string | null | undefined): CraftSize {
  if (node === 'workflow-agent') return 'bead';
  if (node === 'subagent' || node === 'teammate') return 'tender';
  return 'vessel';
}

export const craftKindOf = (f: CraftFacts): CraftKind => ({
  hull: f.client === 'codex' ? 'longrange' : f.client === 'cursor' ? 'scout' : hullClassOf(f.model),
  role: roleOf(f), size: sizeOf(f.node),
});

/** Every pair once: index in a table of `HULLS.length * ROLES.length`. */
export const kindIndex = (hull: HullClass, role: Role): number => HULLS.indexOf(hull) * ROLES.length + ROLES.indexOf(role);

export const KIND_COUNT = HULLS.length * ROLES.length;

/** Length of a ship relative to a cruiser. A film ship's true ratio of 8 to 1 would leave a scout invisible beside a capital. */
export const HULL_LENGTH: Record<HullClass, number> = { scout: 0.55, cruiser: 0.8, capital: 1.15, longrange: 1.3, default: 0.66 };

/** How much smaller a tender or bead is than the ship its class would be. */
export const SIZE_LENGTH: Record<CraftSize, number> = { vessel: 1, tender: 0.42, bead: 0.2 };

export const craftLength = (k: Pick<CraftKind, 'hull' | 'size'>, base: number): number => base * HULL_LENGTH[k.hull] * SIZE_LENGTH[k.size];

/** CSS px, the least a mark may be at System zoom. Hull class grows from there, so the size of a mark also says the class. */
export const MARK_LENGTH: Record<HullClass, number> = { scout: 15, default: 16, cruiser: 18, longrange: 21, capital: 22 };

/** A tender is drawn small on purpose. Its mark says only the mission, because at this size nothing else survives. */
export const TENDER_MARK = 11;
export const BEAD_MARK = 6;

export const markLength = (k: Pick<CraftKind, 'hull' | 'size'>): number => (k.size === 'bead' ? BEAD_MARK : k.size === 'tender' ? TENDER_MARK : MARK_LENGTH[k.hull]);
