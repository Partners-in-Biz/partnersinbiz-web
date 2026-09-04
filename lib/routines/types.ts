/** PiB-owned bot routines (W5a/W5b) — not Hermes cron. */

export type RoutineAccessScope = 'personal' | 'organization'

export type RoutineStatus = 'active' | 'archived'

export type RoutineTriggerSchedule = {
  kind: 'schedule'
  cron: string
  tz: string
}

export type RoutineEventSource = 'pib' | 'webhook' | 'github' | 'slack' | 'linear'

export type RoutineTriggerEvent = {
  kind: 'event'
  source: RoutineEventSource
  filter: Record<string, string>
}

export type RoutineTrigger = RoutineTriggerSchedule | RoutineTriggerEvent

export type BotRoutine = {
  routineId: string
  orgId: string
  agentId: string
  ownerUserId: string
  accessScope: RoutineAccessScope
  name: string
  prompt: string
  trigger: RoutineTrigger
  /** Denormalized for Firestore queries. */
  triggerKind: 'schedule' | 'event'
  conversationId: string | null
  enabled: boolean
  lastRunAt: number | null
  nextRunAt: number | null
  runCount: number
  hookId?: string | null
  hookSecretHash?: string | null
  /** AES-GCM ciphertext when SOCIAL_TOKEN_MASTER_KEY is available. */
  hookSecretCiphertext?: EncryptedSecretCipher | null
  createdAtMs: number
  updatedAtMs: number
  status: RoutineStatus
}

export type RoutineRunStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type RoutineTriggeredBy =
  | { kind: 'schedule' }
  | { kind: 'manual'; userId: string }
  | { kind: 'event'; source: RoutineEventSource; eventId: string }

export type BotRoutineRun = {
  runId: string
  routineId: string
  orgId: string
  agentId: string
  triggeredBy: RoutineTriggeredBy
  eventSummary?: string | null
  messageId?: string | null
  status: RoutineRunStatus
  startedAtMs: number
  finishedAtMs?: number | null
}

export type BotRoutineEventDedupe = {
  id: string
  expiresAtMs: number
}

export type OrgIntegrationProvider = 'github' | 'slack' | 'linear'

export type EncryptedSecretCipher = {
  ciphertext: string
  iv: string
  tag: string
}

export type OrgIntegration = {
  orgId: string
  provider: OrgIntegrationProvider
  /** AES-GCM via encryptLinkedSecret when SOCIAL_TOKEN_MASTER_KEY is set. */
  secretCiphertext: EncryptedSecretCipher | null
  /** Fallback when encryption key is unavailable — SHA-256 hex of the HMAC secret. */
  secretHash?: string | null
  webhookPath: string
  enabled: boolean
  createdAtMs: number
}

export type RoutineEventPayload = {
  eventId: string
  source: RoutineEventSource
  summary?: string
  filter?: Record<string, string>
  data?: Record<string, unknown>
}

export const BOT_ROUTINES_COLLECTION = 'bot_routines'
export const BOT_ROUTINE_RUNS_COLLECTION = 'bot_routine_runs'
export const BOT_ROUTINE_EVENT_DEDUPE_COLLECTION = 'bot_routine_event_dedupe'
export const ORG_INTEGRATIONS_COLLECTION = 'org_integrations'

export const ROUTINE_DEDUPE_TTL_MS = 7 * 24 * 60 * 60 * 1000
