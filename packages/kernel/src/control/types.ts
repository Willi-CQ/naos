// What the Control files share with each other. The contract with the rest of the kernel is context.ts.
import type { ProfileView } from '@naos/protocol';

/** A file in agents/*.md. ProfileView plus what the UI has no need to see. */
export interface Profile extends ProfileView {
  /** The Markdown body, appended to the Claude Code system prompt. */
  prompt: string;
  maxTurns: number | null;
  /** 'none' keeps a repo's settings out even when the world is trusted. */
  settings: 'world' | 'none';
  /** false: no transcript, so no resume (AC 8, scratch). */
  persist: boolean;
}

/** Who asked. Limits depend on it: agents and the MCP shim are never the operator. */
export type Requester =
  | { kind: 'ui' }
  | { kind: 'mcp' }
  | { kind: 'agent'; parentId: string };
