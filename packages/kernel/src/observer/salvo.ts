// The fan-out rule of DESIGN 2.5 and 7.4, on observedAt, because journals have no timestamps. Pure over a supplied clock, so
// it can also replay file creation times for the days before the kernel ran.
import type { NodeId, Salvo, SalvoId, SalvoSource, SessionId, WorldId } from '@naos/protocol';

/** Same numbers as `SALVO` in the UI's laws.ts. The `join` window is a gap: DESIGN's 73 % is measured on launch gaps. */
export const SALVO_RULE = { openCount: 3, openWindowMs: 1_000, joinWindowMs: 10_000 } as const;

export interface Launch {
  parentNodeId: NodeId;
  /** Launches of different runs or kinds under one parent are separate fan-outs. */
  group: string;
  nodeId: NodeId;
  sessionId: SessionId;
  worldId: WorldId;
  source: SalvoSource;
  observedAt: number;
}

export type SalvoOutcome =
  | { type: 'opened'; salvo: Salvo }
  | { type: 'joined'; salvoId: SalvoId; nodeId: NodeId }
  | null;

interface GroupState {
  recent: Launch[];
  open: Salvo | null;
  lastAt: number;
}

export class SalvoDetector {
  private readonly groups = new Map<string, GroupState>();

  launch(l: Launch): SalvoOutcome {
    const key = `${l.parentNodeId}\n${l.group}`;
    let g = this.groups.get(key);
    if (!g) this.groups.set(key, (g = { recent: [], open: null, lastAt: 0 }));
    g.lastAt = l.observedAt;

    if (g.open) {
      if (g.open.nodeIds.includes(l.nodeId)) return null;
      g.open.nodeIds.push(l.nodeId);
      return { type: 'joined', salvoId: g.open.salvoId, nodeId: l.nodeId };
    }
    g.recent = g.recent.filter((r) => l.observedAt - r.observedAt <= SALVO_RULE.openWindowMs && r.nodeId !== l.nodeId);
    g.recent.push(l);
    if (g.recent.length < SALVO_RULE.openCount) return null;

    const first = g.recent[0] as Launch;
    const salvo: Salvo = {
      salvoId: `${l.parentNodeId}/${l.group}/${first.observedAt}`,
      parentNodeId: l.parentNodeId,
      sessionId: l.sessionId,
      worldId: l.worldId,
      source: l.source,
      openedAt: l.observedAt,
      closedAt: null,
      nodeIds: g.recent.map((r) => r.nodeId),
    };
    g.open = salvo;
    g.recent = [];
    return { type: 'opened', salvo: { ...salvo, nodeIds: [...salvo.nodeIds] } };
  }

  /** Salvos whose last launch is more than the join window old. */
  closeExpired(now: number): Salvo[] {
    const closed: Salvo[] = [];
    for (const [key, g] of this.groups) {
      if (g.open && now - g.lastAt > SALVO_RULE.joinWindowMs) {
        g.open.closedAt = now;
        closed.push(g.open);
        g.open = null;
      }
      if (!g.open && now - g.lastAt > SALVO_RULE.joinWindowMs) this.groups.delete(key);
    }
    return closed;
  }
}

/** One launch group's birth times to closed salvos. A replay closes each salvo when the next launch misses its window. */
export function replaySalvos(launches: Launch[]): Salvo[] {
  const sorted = [...launches].sort((a, b) => a.observedAt - b.observedAt);
  const detector = new SalvoDetector();
  const out: Salvo[] = [];
  for (const l of sorted) {
    for (const s of detector.closeExpired(l.observedAt)) {
      s.closedAt = lastLaunch(s, sorted) + SALVO_RULE.joinWindowMs;
      out.push(s);
    }
    detector.launch(l);
  }
  for (const s of detector.closeExpired(Number.MAX_SAFE_INTEGER)) {
    s.closedAt = lastLaunch(s, sorted) + SALVO_RULE.joinWindowMs;
    out.push(s);
  }
  return out;
}

function lastLaunch(s: Salvo, launches: Launch[]): number {
  let last = s.openedAt;
  for (const l of launches) if (s.nodeIds.includes(l.nodeId) && l.observedAt > last) last = l.observedAt;
  return last;
}
