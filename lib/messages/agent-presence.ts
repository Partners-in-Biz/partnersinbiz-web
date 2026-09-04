/**
 * Org-scoped agent presence for Bot roster avatars and computer activity chrome.
 *
 * Doc id: `${orgId}_${agentId}` in `agent_presence`.
 *
 * Desktop/browser session "Using the computer" writes are skipped here — those
 * stores lack a clean orgId+agentId call site on status→running; the UI chip
 * activates from live workbench session props instead.
 */
import { adminDb } from '@/lib/firebase/admin'

export const AGENT_PRESENCE_COLLECTION = 'agent_presence'

export const AGENT_PRESENCE_DONE_DECAY_MS = 60_000

export type AgentPresenceState =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'waiting'
  | 'blocked'
  | 'done'

export type AgentPresence = {
  orgId: string
  agentId: string
  state: AgentPresenceState
  conversationId?: string
  currentStep?: string
  deviceId?: string
  updatedAtMs: number
}

export type AgentPresenceWriteInput = {
  orgId: string
  agentId: string
  state: AgentPresenceState
  conversationId?: string | null
  currentStep?: string | null
  deviceId?: string | null
  updatedAtMs?: number
}

function presenceDocId(orgId: string, agentId: string): string {
  return `${orgId}_${agentId}`
}

function cleanOptional(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function fromStored(data: Record<string, unknown>, fallback: { orgId: string; agentId: string }): AgentPresence | null {
  const orgId = typeof data.orgId === 'string' ? data.orgId.trim() : fallback.orgId
  const agentId = typeof data.agentId === 'string' ? data.agentId.trim() : fallback.agentId
  if (!orgId || !agentId) return null
  const state = data.state
  if (
    state !== 'idle'
    && state !== 'thinking'
    && state !== 'working'
    && state !== 'waiting'
    && state !== 'blocked'
    && state !== 'done'
  ) {
    return null
  }
  const updatedAtMs = typeof data.updatedAtMs === 'number' && Number.isFinite(data.updatedAtMs)
    ? data.updatedAtMs
    : 0
  return {
    orgId,
    agentId,
    state,
    updatedAtMs,
    ...(cleanOptional(data.conversationId as string | undefined) ? { conversationId: cleanOptional(data.conversationId as string) } : {}),
    ...(cleanOptional(data.currentStep as string | undefined) ? { currentStep: cleanOptional(data.currentStep as string) } : {}),
    ...(cleanOptional(data.deviceId as string | undefined) ? { deviceId: cleanOptional(data.deviceId as string) } : {}),
  }
}

/** Pure: after 60s, `done` reads as `idle` for roster display. */
export function decayDoneToIdle(presence: AgentPresence, nowMs: number): AgentPresence {
  if (presence.state !== 'done') return presence
  if (nowMs - presence.updatedAtMs < AGENT_PRESENCE_DONE_DECAY_MS) return presence
  return { ...presence, state: 'idle', currentStep: undefined }
}

/**
 * Map conversation / linked-run status strings onto presence.
 * Unknown statuses return null (caller should skip the write).
 */
export function presenceFromRunStatus(
  status: string,
  currentStep?: string | null,
): { state: AgentPresenceState; currentStep?: string } | null {
  const normalized = status.trim().toLowerCase()
  const step = cleanOptional(currentStep ?? undefined)
  switch (normalized) {
    case 'queued':
    case 'pending':
      return { state: 'thinking', ...(step ? { currentStep: step } : {}) }
    case 'streaming':
    case 'running':
    case 'claimed':
      return { state: 'working', ...(step ? { currentStep: step } : {}) }
    case 'waiting_approval':
    case 'waiting_for_approval':
    case 'approval_required':
      return { state: 'waiting', ...(step ? { currentStep: step } : {}) }
    case 'failed':
    case 'error':
    case 'errored':
    case 'cancelled':
    case 'canceled':
    case 'expired':
      return { state: 'blocked', ...(step ? { currentStep: step } : {}) }
    case 'completed':
    case 'complete':
    case 'succeeded':
    case 'success':
    case 'done':
    case 'finished':
      return { state: 'done', ...(step ? { currentStep: step } : {}) }
    default:
      return null
  }
}

export async function setAgentPresence(input: AgentPresenceWriteInput): Promise<AgentPresence> {
  const orgId = input.orgId.trim()
  const agentId = input.agentId.trim()
  if (!orgId || !agentId) throw new Error('orgId and agentId are required')
  const updatedAtMs = input.updatedAtMs ?? Date.now()
  const conversationId = cleanOptional(input.conversationId ?? undefined)
  const currentStep = cleanOptional(input.currentStep ?? undefined)
  const deviceId = cleanOptional(input.deviceId ?? undefined)
  const presence: AgentPresence = {
    orgId,
    agentId,
    state: input.state,
    updatedAtMs,
    ...(conversationId ? { conversationId } : {}),
    ...(currentStep ? { currentStep } : {}),
    ...(deviceId ? { deviceId } : {}),
  }
  await adminDb.collection(AGENT_PRESENCE_COLLECTION).doc(presenceDocId(orgId, agentId)).set(presence, { merge: true })
  return presence
}

export async function getAgentPresence(orgId: string, agentId: string, nowMs = Date.now()): Promise<AgentPresence | null> {
  const cleanOrg = orgId.trim()
  const cleanAgent = agentId.trim()
  if (!cleanOrg || !cleanAgent) return null
  const snap = await adminDb.collection(AGENT_PRESENCE_COLLECTION).doc(presenceDocId(cleanOrg, cleanAgent)).get()
  if (!snap.exists) return null
  const presence = fromStored(snap.data() ?? {}, { orgId: cleanOrg, agentId: cleanAgent })
  if (!presence) return null
  return decayDoneToIdle(presence, nowMs)
}

export async function listAgentPresenceForOrg(orgId: string, nowMs = Date.now()): Promise<AgentPresence[]> {
  const cleanOrg = orgId.trim()
  if (!cleanOrg) return []
  const snap = await adminDb.collection(AGENT_PRESENCE_COLLECTION).where('orgId', '==', cleanOrg).get()
  const rows: AgentPresence[] = []
  for (const doc of snap.docs) {
    const presence = fromStored(doc.data() ?? {}, {
      orgId: cleanOrg,
      agentId: String(doc.data()?.agentId ?? '').trim(),
    })
    if (!presence) continue
    rows.push(decayDoneToIdle(presence, nowMs))
  }
  return rows
}

/** Best-effort presence write — never blocks the caller. */
export function publishAgentPresence(input: AgentPresenceWriteInput): void {
  void setAgentPresence(input).catch((err) => {
    console.error('[agent-presence-write-failed]', {
      orgId: input.orgId,
      agentId: input.agentId,
      state: input.state,
      error: err instanceof Error ? err.message : String(err),
    })
  })
}
