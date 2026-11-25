// First Flight, DESIGN 12.1: the smallest real flight. One Haiku craft, no settings, strict MCP, and one Write, so the very first
// thing a new install sees is a real approval. The role is written here, not in agents/, so no edit can widen it.
import { FIRST_FLIGHT_PROFILE } from '@naos/protocol';
import fs from 'node:fs';
import path from 'node:path';
import type { Profile } from './types.ts';

export const FIRST_FLIGHT_BUDGET_USD = 0.02;

export const firstFlightProfile = (): Profile => ({
  name: FIRST_FLIGHT_PROFILE,
  description: 'One Haiku craft in a scratch folder, writing one file.',
  model: 'claude-haiku-5-5',
  effort: 'low',
  permissionMode: 'default',
  defaultBudgetUsd: FIRST_FLIGHT_BUDGET_USD,
  worktree: false,
  tools: ['Write'],
  orchestrator: false,
  source: 'builtin',
  prompt: '',
  maxTurns: 4,
  settings: 'none',
  persist: true,
});

export function firstFlightFolder(home: string): string {
  const dir = path.join(home, 'first-flight');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const firstFlightPrompt = (agentId: string): string =>
  `Use the Write tool to create the file flight-${agentId}.txt in the current folder, with the single line: first flight. Then reply with the word done.`;
