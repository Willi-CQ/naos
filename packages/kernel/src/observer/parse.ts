// Turns a transcript line into a plain object, and counts what it does not know. The format can change on any release,
// so nothing here throws. Field names may be logged, values never.
import type { SensorState } from '@naos/protocol';

export type Raw = Record<string, unknown>;

const API_REQUEST = Buffer.from('{"type":"api-request');
const API_REQUEST_LEN = API_REQUEST.length;
const QUOTE = 0x22;

/** `api-request-blob` and `api-request-shape` hold prompts and are 214 MB of nothing we use. `api-request` itself is parsed. */
export const isApiRequestLine = (line: Buffer): boolean =>
  line.length >= API_REQUEST_LEN && line.subarray(0, API_REQUEST_LEN).equals(API_REQUEST);
export const isApiRequestBody = (line: Buffer): boolean => isApiRequestLine(line) && line[API_REQUEST_LEN] !== QUOTE;

/** The census, the 2.1.314 reader, and this machine's live records (RF 3.1). */
const KNOWN_TYPES = new Set([
  'assistant', 'user', 'attachment', 'system', 'api-request', 'api-request-blob', 'api-request-shape', 'last-prompt',
  'ai-title', 'custom-title', 'atis-latch', 'queue-operation', 'mode', 'frame-link', 'file-history-snapshot',
  'file-history-delta', 'tools-used', 'bridge-session', 'cost-state', 'artifact-autoreact-ledger', 'artifact-comment-monitor',
  'progress', 'summary', 'tag', 'relocated', 'continued-in', 'ended-by-model', 'agent-name', 'agent-color', 'agent-setting',
  'pr-link', 'worktree-state', 'permission-mode', 'isolation-latch', 'content-replacement', 'fork-context-ref',
  'observer-ref', 'history-suppression', 'attribution-snapshot', 'dev-mods', 'memory-mode',
]);

/** Top level names seen in records we read. A rare new name lights SENSOR, a rename does not take the parser down. */
const KNOWN_FIELDS = new Set([
  'type', 'subtype', 'uuid', 'parentUuid', 'logicalParentUuid', 'isSidechain', 'sessionId', 'cwd', 'gitBranch', 'version',
  'entrypoint', 'userType', 'timestamp', 'agentId', 'slug', 'message', 'requestId', 'requestRef', 'apiBlockIndex', 'effort',
  'perTurnEffort', 'requestedModel', 'advisorModel', 'thinkingDisplay', 'thinkingDurationMs', 'attributionAgent',
  'attributionSkill', 'attributionMcpServer', 'attributionMcpTool', 'isApiErrorMessage', 'error', 'apiError',
  'apiErrorStatus', 'apiErrorParams', 'quotaLimits', 'serverClassifierRequest', 'isAbortedMidStream', 'wireIngestContext',
  'wireToolInputs', 'toolUseResult', 'sourceToolAssistantUUID', 'sourceToolUseID', 'permissionDecision', 'toolDenialKind',
  'toolDenialUnanswered', 'origin', 'turnOrigin', 'promptSource', 'permissionMode', 'turnPosition', 'promptId', 'isMeta',
  'isCompactSummary', 'toolEndsTurn', 'wakeupSource', 'serverClassifierContext', 'classifierBoundary', 'imagePasteIds',
  'isVisibleInTranscriptOnly', 'mergedSendUuids', 'queueSkipAttachments', 'queueSkipSlashCommands', 'queueTranscriptOnly',
  'sandboxed', 'turnAttributionKey', 'turnCompanion', 'attachment', 'rendered', 'renderedRole', 'renderedBesideToolResult',
  'renderedInHumanTurn', 'level', 'content', 'compactMetadata', 'commandRun', 'commandOutcome', 'retryAttempt', 'maxRetries',
  'retryInMs', 'source', 'operation', 'reason', 'commandUuid', 'deliveryId', 'lastPrompt', 'leafUuid', 'aiTitle', 'customTitle',
  'atis', 'mode', 'frameUrl', 'path', 'title', 'artifactCount', 'isSnapshotUpdate', 'messageId', 'snapshot', 'snapshotMessageId',
  'backup', 'trackingPath', 'tools', 'artifacts', 'accountUuid', 'v', 'hasUnknownModelCost', 'modelUsage', 'startTime',
  'totalAPIDuration', 'totalAPIDurationWithoutRetries', 'totalCostUSD', 'totalDuration', 'totalLinesAdded',
  'totalLinesRemoved', 'totalToolDuration', 'worktreeSession', 'base', 'cacheControl', 'id', 'keep', 'params', 'querySource',
  'requestDigest', 'shapeHash', 'tail', 'relocatedCwd', 'summary', 'leafUuid', 'tag', 'agentName', 'agentColor',
  'agentSetting', 'prNumber', 'prUrl', 'prRepository', 'bridgeSessionId', 'sessionUrl', 'environmentId', 'lastSequenceNum',
  'ownerAccountUuid', 'ownerOrganizationUuid',
]);

export class Sensor {
  readonly state: SensorState = { unknownRecords: 0, unknownFields: 0, tailResets: 0, parseErrors: 0 };
  dirty = false;
  /** Names only, for a log line. Bounded, because an unknown name could carry anything a future CLI puts there. */
  readonly unknownTypes = new Set<string>();
  readonly unknownFieldNames = new Set<string>();

  bump(key: keyof SensorState, by = 1): void {
    this.state[key] += by;
    this.dirty = true;
  }
}

const NAME_LIMIT = 64;

/** Null for a line to skip. A prefix skip costs nothing, and only a bad line is counted. */
export function parseLine(line: Buffer, sensor: Sensor): Raw | null {
  if (isApiRequestBody(line)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.toString('utf8'));
  } catch {
    sensor.bump('parseErrors');
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    sensor.bump('parseErrors');
    return null;
  }
  const raw = parsed as Raw;
  const type = raw.type;
  if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) {
    sensor.bump('unknownRecords');
    if (typeof type === 'string' && sensor.unknownTypes.size < NAME_LIMIT) sensor.unknownTypes.add(type.slice(0, 40));
    return null;
  }
  for (const key in raw) {
    if (!KNOWN_FIELDS.has(key)) {
      sensor.bump('unknownFields');
      if (sensor.unknownFieldNames.size < NAME_LIMIT) sensor.unknownFieldNames.add(key.slice(0, 40));
    }
  }
  return raw;
}

/** Journal records have types of their own, so they pass here without touching the transcript counters. */
export function parseJournalLine(line: Buffer, sensor: Sensor): Raw | null {
  try {
    const parsed: unknown = JSON.parse(line.toString('utf8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Raw;
  } catch {
    // Counted below.
  }
  sensor.bump('parseErrors');
  return null;
}

export const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const obj = (v: unknown): Raw | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Raw) : null);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function timeOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** `resetsAt` comes as epoch seconds in some records and epoch ms in others. */
export function epochMs(v: unknown): number | null {
  const t = timeOf(v);
  if (t === null) return null;
  return t < 1e12 ? t * 1000 : t;
}
