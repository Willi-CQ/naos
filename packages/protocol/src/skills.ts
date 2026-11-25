import type { SessionClient } from './source.ts';

export type ProjectSkillSource = 'shared' | 'claude-code' | 'codex' | 'cursor';
export interface ProjectSkill {
  /** Opaque, project-scoped reference. It never contains an absolute path. */
  id: string;
  name: string;
  description: string;
  source: ProjectSkillSource;
  scope: 'project' | 'user';
  kind: 'skill' | 'command';
  client: SessionClient | 'shared';
  requiresTrust: boolean;
}
export interface SkillInstructions extends ProjectSkill {
  instructions: string;
  truncated: boolean;
}
