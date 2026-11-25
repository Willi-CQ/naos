import type { SkillInstructions } from '@naos/protocol';

export interface ProjectPromptSkill {
  name: string;
  source: string;
  scope: 'project' | 'user';
  kind: 'skill' | 'command';
}

export interface ProjectPromptContext {
  project: string;
  focus: string;
  skill?: ProjectPromptSkill;
}

export interface VisibleProjectPrompt {
  context: ProjectPromptContext | null;
  text: string;
}

const contextLine = (context: ProjectPromptContext): string =>
  `[[naos-context:v1:${encodeURIComponent(JSON.stringify(context))}]]`;

export function projectPrompt(project: string, focus: string | null, text: string, skill?: SkillInstructions | null): string {
  const context: ProjectPromptContext = { project, focus: focus && focus !== '.' ? focus : '.' };
  if (skill) context.skill = { name: skill.name, source: skill.source, scope: skill.scope, kind: skill.kind };
  const instructions = skill?.instructions.replaceAll('[[/naos-context]]', '[NAOS context boundary]') ?? '';
  return [
    contextLine(context),
    'Read and follow the project instructions and nearby code before acting. Use the selected path as a starting point, and expand into the project when the requested work needs it.',
    ...(skill ? [`The user selected the ${skill.kind} workflow "${skill.name}". Apply its instructions to this request while preserving the provider's own tools and permission rules.`, '--- selected workflow instructions ---', instructions, '--- end selected workflow instructions ---'] : []),
    '[[/naos-context]]',
    '',
    text,
  ].join('\n');
}

export function visibleProjectPrompt(value: string): VisibleProjectPrompt {
  const match = /^\[\[naos-context:v1:([^\]\r\n]+)\]\]\r?\n[\s\S]*?\r?\n\[\[\/naos-context\]\]\r?\n(?:\r?\n)?/.exec(value);
  if (match) {
    try {
      const data = JSON.parse(decodeURIComponent(match[1]!)) as Partial<ProjectPromptContext>;
      if (typeof data.project === 'string' && typeof data.focus === 'string') {
        const context: ProjectPromptContext = { project: data.project, focus: data.focus };
        if (data.skill && typeof data.skill.name === 'string' && typeof data.skill.source === 'string' && (data.skill.scope === 'project' || data.skill.scope === 'user') && (data.skill.kind === 'skill' || data.skill.kind === 'command')) {
          context.skill = { name: data.skill.name, source: data.skill.source, scope: data.skill.scope, kind: data.skill.kind };
        }
        return { context, text: value.slice(match[0].length) };
      }
    } catch { /* Keep malformed context visible as ordinary user text. */ }
  }

  const legacy = /^Project area: ([^\r\n]+)\r?\n\r?\n/.exec(value);
  if (legacy) return { context: { project: '', focus: legacy[1]! }, text: value.slice(legacy[0].length) };
  return { context: null, text: value };
}
