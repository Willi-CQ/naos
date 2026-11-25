// All strings live here, so a German set is a swap later (DESIGN 5.2).
import type { ToolFamily } from '@naos/protocol';
import type { VisualState } from '../core/state.ts';

/** State words of section 6. Those with a metric get it from model.ts. */
export const STATE_WORD: Record<VisualState, string> = {
  queued: 'QUEUED', spawning: 'SPAWNING', starting: 'STARTING', ready: 'READY',
  thinking: 'THINK', writing: 'WRITE', generating: 'MODEL', tool: 'TOOL',
  approve: 'APPROVE', answer: 'ANSWER', plan: 'PLAN', source: 'SOURCE', parked: 'PARKED',
  idle: 'IDLE', 'idle-shell': 'IDLE, SHELL', interrupted: 'INTERRUPTED', compacting: 'COMPACTING', retrying: 'RETRY', 'no-signal': 'NO SIGNAL',
  'rate-limited': 'LIMIT', errored: 'ERROR', 'no-budget': 'NO BUDGET', stopping: 'STOPPING', crashed: 'CRASHED', orphaned: 'ORPHANED', lost: 'LOST',
  finished: 'DONE', exited: 'EXITED', abandoned: 'ABANDONED', failed: 'FAILED', stopped: 'STOPPED', unknown: 'UNKNOWN',
};

/** For the Scene mirror and the announcer. */
export const STATE_SPOKEN: Record<VisualState, string> = {
  queued: 'queued', spawning: 'spawning', starting: 'starting', ready: 'ready',
  thinking: 'thinking', writing: 'writing', generating: 'model call in flight', tool: 'running a tool',
  approve: 'needs approval', answer: 'needs an answer', plan: 'has a plan to review', source: 'waiting at source', parked: 'parked',
  idle: 'idle', 'idle-shell': 'idle with a shell', interrupted: 'interrupted', compacting: 'compacting', retrying: 'retrying', 'no-signal': 'no signal',
  'rate-limited': 'rate limited', errored: 'error', 'no-budget': 'out of budget', stopping: 'stopping', crashed: 'crashed', orphaned: 'orphaned', lost: 'lost',
  finished: 'finished', exited: 'exited', abandoned: 'abandoned', failed: 'failed', stopped: 'stopped', unknown: 'state unknown',
};

export const FAMILY_WORD: Record<ToolFamily, string> = {
  shell: 'SHELL', read: 'READ', edit: 'EDIT', web: 'WEB', mcp: 'MCP', launch: 'LAUNCH', send: 'SEND', ask: 'TOOL', other: 'TOOL',
};

export const LAMP_NAME = {
  you: 'YOU', source: 'SOURCE', fault: 'FAULT', retry: 'RETRY', low: 'LOW', limit: 'LIMIT', sensor: 'SENSOR',
} as const;

export const LAMP_SPOKEN = {
  you: 'Needs you', source: 'At source', fault: 'Faults', retry: 'Retrying', low: 'Low context', limit: 'Limit', sensor: 'Sensor',
} as const;

export const SECTION = {
  needs: 'NEEDS YOU', source: 'AT SOURCE', sourceHere: 'AT SOURCE, elsewhere', trouble: 'TROUBLE', low: 'LOW CONTEXT', landed: 'LANDED, LAST HOUR', channel: 'CHANNEL',
  away: 'WHILE YOU WERE AWAY', tape: 'TAPE', manifest: 'MANIFEST', sky: 'SKY', altimeter: 'ALTIMETER', worktrees: 'WORKTREES', lineage: 'LINEAGE', grants: 'STANDING GRANTS',
  armillary: 'ARMILLARY', daily: 'WORLDS THAT DAY',
} as const;

export const COPY = {
  skip: 'Skip to decisions',
  kernelLost: 'Kernel not responding',
  kernelAbsent: 'Kernel not running',
  noSignal: 'NO SIGNAL',
  cannotAnswer: 'cannot be answered now',
  disabledLost: 'Disabled: the kernel link is lost.',
  sceneOff: 'Scene unavailable: the fleet is fully operable from the rails.',
  noMatch: 'Nothing here matches.',
  untitled: 'untitled',
  noHistory: 'No history yet.',
  channelEmpty: 'Select a craft with J or K.',
  channelNone: 'No rows yet.',
  textUnavailable: 'text unavailable',
  textVeiled: 'Veil on: text stays sealed.',
  textSealed: 'W show text',
  textOpen: 'W seal',
  answerHere: 'answer here',
  dive: 'dive to craft',
  ownWindow: 'answer in its own window',
  landLaunch: 'launch into this world',
  readOnly: 'READ ONLY',
  hintLaunch: 'launch a craft',
  stopUnavailable: 'Stop arrives with the control plane.',
  noOverlay: 'That arrives with the control plane.',
  veiled: 'VEILED',
  veilOn: 'Veil on',
  veilOff: 'Veil off',
  arrowsWeeks: 'LEFT RIGHT scrub  SHIFT walks weeks',
  stripCaption: '30 days, one tick per day, height is work done.',
} as const;

export const HINTS: ReadonlyArray<readonly [string, string]> = [['L', 'launch'], ['F', 'find'], ['T', 'sky'], ['$', 'ledger'], ['?', 'laws']];

export const LAWS: ReadonlyArray<readonly [string, string]> = [
  ['Mass is spend', "A world's size is its spend over the retained 30 days, log scale. Bytes stand in until the usage index ends."],
  ['Altitude is context', 'A low orbit is a nearly full context window, log scale.'],
  ['Motion is tokens', 'A craft moves only while tokens flow. Corona flow advances only with fleet tokens.'],
  ['Only need you can answer bends the sky', 'Nothing else distorts it: not errors, not worlds, not need you must answer elsewhere.'],
  ['Light is late', 'Observed craft show their real signal delay, and say so.'],
  ['Work leaves light', 'Every finished agent becomes a city light and a sky star. Every fan-out burns a spoke.'],
  ['The hole follows fleet activity', 'The disk responds to work across all clients. Each client keeps its own quota; one limit does not dim the others.'],
];

/** The key tables of the Laws dialog, section 3.4. */
export const KEY_TABLE: ReadonlyArray<{ head: string; rows: ReadonlyArray<readonly [string, string]> }> = [
  {
    head: 'Global',
    rows: [
      ['Space', 'Attend: oldest decision, or oldest wait at source'],
      ['Ctrl+.', 'Attend from anywhere, also in text fields'],
      ['Enter', 'Open the selection. Never approves anything'],
      ['Esc', 'Up one level, or close the top overlay. Decides nothing'],
      ['J K, Down Up', 'Next and previous in attention order'],
      ['1 to 9, 0', 'A world by slot, 0 for System'],
      ['L, Shift+L', 'Launch one craft, or start a mission'],
      ['F, /', 'Find'],
      ['P', 'Project atlas and constellation'],
      ['M, Shift+M', 'Manifest per craft or per world, collapse the rail'],
      ['T', 'Sky'],
      ['C, $', 'Ledger'],
      ['V', 'Veil, recording mode'],
      ['H', 'Cinema'],
      ['Q', 'Cycle the Tape filter'],
      ['G', 'Geiger on or off'],
      ['N', 'Mute all sound'],
      ['?', 'Laws and keys'],
      [',', 'Settings'],
      ['. hold 600 ms', 'Stop the selected owned craft'],
      ['Shift+. hold 1200 ms', 'All stop, every owned craft'],
    ],
  },
  {
    head: 'Selected craft',
    rows: [['I', 'Focus the follow-up box'], ['W', 'Show text in the Channel for this craft'], ['B', 'Add budget'], ['O', 'Fork'], ['U', 'Resume an exited craft']],
  },
  {
    head: 'Camera',
    rows: [
      ['Drag', 'Orbit around the focus. Poles included'], ['Wheel, pinch', 'Zoom toward the pointer, down to low orbit'], ['Right drag, Shift drag', 'Pan'],
      ['Left Right', 'Orbit'], ['PageUp PageDown', 'Over the top, or under'], ['+ -', 'Zoom'], ['Shift+arrows', 'Pan'], ['Home, 0 at System', 'Back to the composed view'],
    ],
  },
  {
    head: 'Docket focused',
    rows: [
      ['A', 'Approve'], ['E', 'Edit, then approve'], ['S', 'Always, this session'], ['Shift+S', 'Always in this project'], ['D', 'Deny'],
      ['X', 'Deny and stop the turn'], ['R', 'Redirect'], ['1 to 4', 'Pick a question option'], ['J K', 'Next or previous decision'],
      ['O', 'Open wide'], ['V hold', 'Read through the veil'], ['Esc', 'Leave undecided'], ['Enter', 'Nothing. Never approves'],
    ],
  },
];

export const SETTING_TEXT = {
  title: 'SETTINGS',
  boot: 'Boot', bootHint: 'What plays at start',
  alert: 'Alert sound', alertHint: 'One ping when an answerable decision opens',
  geiger: 'Geiger', geigerHint: 'A tick per response',
  mute: 'Mute all sound', muteHint: 'N toggles this',
  notifications: 'Notifications', notificationsHint: 'The kernel raises them when no window is focused',
  comfort: 'Comfort rows', comfortHint: 'Rows 24 px, body 14 px',
  quality: 'Quality', qualityHint: 'Auto steps with the measured frame time',
  scene: 'Scene', sceneHint: 'Off keeps the Plate',
  singleKeys: 'Single keys', singleKeysHint: 'Off leaves only Ctrl+. and native controls',
  idleDrift: 'Idle drift', idleDriftHint: 'The camera drifts slowly at System level. Off on battery and under reduced motion',
  longArm: 'Long arm delay', longArmHint: 'Decisions arm after 1 s instead of 350 ms',
} as const;
