export type NativeClient = 'codex' | 'cursor';
export interface AgentProvider {
  client: NativeClient;
  installed: boolean;
  authenticated: boolean | null;
  auth: 'chatgpt' | 'api-key' | 'provider' | 'unknown';
  models: Array<{ id: string; name: string; default: boolean }>;
  message: string | null;
  loginCommand: string;
}
