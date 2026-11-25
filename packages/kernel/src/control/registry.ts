// The dedupe contract of AC 13. Filled before query(), so the Observer can recognise a managed session from its first record.
import type { AgentId, SessionId } from '@naos/protocol';
import type { ManagedRegistry } from '../context.ts';

interface Keys { sessions: Set<SessionId>; pids: Set<number>; titles: Set<string> }

export class Registry implements ManagedRegistry {
  #sessions = new Map<SessionId, AgentId>();
  #pids = new Map<number, AgentId>();
  #titles = new Map<string, AgentId>();
  #keys = new Map<AgentId, Keys>();

  lookup(key: { sessionId?: SessionId; pid?: number; title?: string }): AgentId | null {
    if (key.sessionId !== undefined) {
      const hit = this.#sessions.get(key.sessionId);
      if (hit) return hit;
    }
    if (key.pid !== undefined) {
      const hit = this.#pids.get(key.pid);
      if (hit) return hit;
    }
    if (key.title !== undefined) return this.#titles.get(key.title) ?? null;
    return null;
  }

  register(agentId: AgentId, key: { sessionId: SessionId; pid?: number; title?: string }): void {
    let keys = this.#keys.get(agentId);
    if (!keys) this.#keys.set(agentId, (keys = { sessions: new Set(), pids: new Set(), titles: new Set() }));
    keys.sessions.add(key.sessionId);
    this.#sessions.set(key.sessionId, agentId);
    if (key.pid !== undefined) {
      keys.pids.add(key.pid);
      this.#pids.set(key.pid, agentId);
    }
    if (key.title !== undefined) {
      keys.titles.add(key.title);
      this.#titles.set(key.title, agentId);
    }
  }

  /** A pid is only true while the process lives. After that Windows can hand it to anything. */
  dropPid(agentId: AgentId, pid: number): void {
    this.#keys.get(agentId)?.pids.delete(pid);
    if (this.#pids.get(pid) === agentId) this.#pids.delete(pid);
  }

  unregister(agentId: AgentId): void {
    const keys = this.#keys.get(agentId);
    if (!keys) return;
    for (const id of keys.sessions) this.#sessions.delete(id);
    for (const pid of keys.pids) this.#pids.delete(pid);
    for (const title of keys.titles) this.#titles.delete(title);
    this.#keys.delete(agentId);
  }
}
