// Synthetic transcript records with the shapes of RF 3. Placeholder text only, nothing here came from a real transcript.
const T0 = Date.parse('2026-10-30T10:00:00.000Z');

export const iso = (offsetMs: number, base = T0): string => new Date(base + offsetMs).toISOString();

interface Envelope { at?: number; cwd?: string; session?: string; base?: number; extra?: object }

const envelope = (e: Envelope = {}): object => ({
  parentUuid: null,
  isSidechain: false,
  uuid: `u-${e.at ?? 0}-${Math.round(Math.random() * 1e9)}`,
  sessionId: e.session ?? 's',
  cwd: e.cwd ?? 'c:/work/repo',
  gitBranch: 'main',
  version: '2.1.314',
  entrypoint: 'sdk-ts',
  userType: 'external',
  timestamp: iso(e.at ?? 0, e.base),
  ...e.extra,
});

export const usage = (input: number, output: number, extra: object = {}): object => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  ...extra,
});

export const userPrompt = (text: string, e: Envelope = {}, fields: object = {}): object => ({
  ...envelope(e), type: 'user', message: { role: 'user', content: text }, turnOrigin: 'human', ...fields,
});

interface AssistantInit {
  id: string;
  model?: string;
  stop?: string | null;
  usage?: object;
  content?: object[];
}

export const assistant = (a: AssistantInit, e: Envelope = {}, fields: object = {}): object => ({
  ...envelope(e),
  type: 'assistant',
  message: {
    id: a.id,
    model: a.model ?? 'claude-opus-5-5',
    role: 'assistant',
    content: a.content ?? [{ type: 'text', text: 'placeholder' }],
    stop_reason: a.stop === undefined ? 'end_turn' : a.stop,
    usage: a.usage ?? usage(10, 5),
  },
  ...fields,
});

export const toolUse = (id: string, name: string, input: object = {}): object => ({ type: 'tool_use', id, name, input });

export const toolResult = (id: string, e: Envelope = {}, fields: object = {}, isError = false): object => ({
  ...envelope(e),
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'placeholder', is_error: isError }] },
  ...fields,
});

export const apiRequest = (e: Envelope = {}, model = 'claude-opus-5-5'): object => ({
  type: 'api-request', sessionId: e.session ?? 's', timestamp: iso(e.at ?? 0, e.base), querySource: 'repl_main_thread',
  params: { model }, id: 'req',
});

export const costState = (usd: number): object => ({ type: 'cost-state', totalCostUSD: usd, sessionId: 's' });
