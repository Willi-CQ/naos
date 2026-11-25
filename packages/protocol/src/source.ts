export const SESSION_CLIENTS = ['claude-code', 'codex', 'cursor'] as const;
export type SessionClient = (typeof SESSION_CLIENTS)[number];
export type SessionCapability = 'activity' | 'tools' | 'tokens' | 'context' | 'cost' | 'hierarchy' | 'text' | 'steer' | 'stop' | 'approve';

export interface SessionSource {
  client: SessionClient;
  nativeSessionId: string;
  transport: 'disk' | 'stream' | 'hook';
  capabilities: SessionCapability[];
}

export const CLIENT_NAME: Record<SessionClient, string> = {
  'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor',
};

export const CLIENT_MARK: Record<SessionClient, string> = {
  'claude-code': 'CL', codex: 'CX', cursor: 'CU',
};

/** Existing Claude ids are kept so owned sessions still join their observer records. */
export const sessionKey = (client: SessionClient, nativeId: string): string =>
  client === 'claude-code' ? nativeId : `${client}:${nativeId}`;

export function sessionSource(session: { sessionId: string; origin: 'observer' | 'control'; source?: SessionSource }): SessionSource {
  return session.source ?? {
    client: 'claude-code', nativeSessionId: session.sessionId, transport: session.origin === 'control' ? 'stream' : 'disk',
    capabilities: session.origin === 'control'
      ? ['activity', 'tools', 'tokens', 'context', 'cost', 'hierarchy', 'text', 'steer', 'stop', 'approve']
      : ['activity', 'tools', 'tokens', 'context', 'cost', 'hierarchy', 'text'],
  };
}
