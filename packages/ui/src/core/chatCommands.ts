export interface ChatCommandQuery { name: string; argument: string; hasArgument: boolean; rest: string }

/** Commands occupy the first line. A doubled slash escapes a literal provider message. */
export function chatCommandQuery(draft: string): ChatCommandQuery | null {
  const start = draft.trimStart();
  if (!start.startsWith('/') || start.startsWith('//')) return null;
  const match = /^\/([^\s]*)(?:[ \t]+([^\r\n]*))?(?:\r?\n([\s\S]*))?$/.exec(start);
  if (!match) return null;
  const name = match[1]!.toLowerCase(), argument = match[2]?.trim() ?? '';
  const aliases: Record<string, [string, string]> = {
    codex: ['provider', 'codex'], claude: ['provider', 'claude-code'], cursor: ['provider', 'cursor'],
    build: ['mode', 'build'], plan: ['mode', 'plan'], read: ['mode', 'read'],
  };
  const alias = Object.hasOwn(aliases, name) ? aliases[name] : undefined;
  return { name: alias?.[0] ?? name, argument: alias?.[1] ?? argument, hasArgument: !!alias || match[2] !== undefined, rest: match[3] ?? '' };
}

export function literalChatMessage(draft: string): string {
  const text = draft.trim();
  return text.startsWith('//') ? text.slice(1) : text;
}

export function matchChatChoices<T extends { id: string; label: string; description: string }>(choices: readonly T[], search: string): T[] {
  const term = search.trim().toLowerCase();
  if (!term) return [...choices];
  const normalized = (value: string) => value.toLowerCase().replace(/^\//, '').replace(/[-_\s]/g, '');
  const exact = choices.find(choice => choice.id.toLowerCase() === term)
    ?? choices.find(choice => normalized(choice.label) === normalized(term));
  if (exact) return [exact];
  return choices.filter(choice => `${choice.id} ${choice.label} ${choice.description}`.toLowerCase().includes(term));
}
