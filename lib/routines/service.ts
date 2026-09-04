import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { ApiUser } from '@/lib/api/types'
import { canManageOrgAs } from '@/lib/orgMembers/permissions'
import { orgFeatureFlagEnabled } from '@/lib/organizations/feature-flags'
import {
  createConversation,
  createMessage,
  getConversation,
} from '@/lib/conversations/conversations'
import { encryptLinkedSecret, decryptLinkedSecret } from '@/lib/linked-computers/secret-envelope'
import { computeNextRunAtMs } from './scheduler'
import {
  claimDueScheduleRoutine,
  createRoutineDoc,
  createRunDoc,
  getRoutine,
  listDueScheduleRoutines,
  listRoutinesForAgent,
  listRunsForRoutine,
  tryClaimEventDedupe,
  updateRoutineDoc,
  updateRunDoc,
} from './store'
import type {
  BotRoutine,
  BotRoutineRun,
  RoutineAccessScope,
  RoutineEventPayload,
  RoutineTriggeredBy,
  RoutineTrigger,
} from './types'
import { ROUTINE_DEDUPE_TTL_MS } from './types'

export class RoutineAuthError extends Error {
  status: number
  constructor(message: string, status = 403) {
    super(message)
    this.status = status
  }
}

export class RoutineFlagDisabledError extends Error {
  constructor(orgId: string) {
    super(`botRoutinesEnabled is off for org ${orgId}`)
  }
}

export async function assertBotRoutinesEnabled(orgId: string): Promise<void> {
  if (!(await orgFeatureFlagEnabled(orgId, 'botRoutinesEnabled'))) {
    throw new RoutineFlagDisabledError(orgId)
  }
}

export async function assertCanManageRoutine(
  user: ApiUser,
  routine: Pick<BotRoutine, 'orgId' | 'ownerUserId' | 'accessScope'>,
): Promise<void> {
  if (routine.accessScope === 'personal') {
    if (user.uid !== routine.ownerUserId && user.role !== 'admin' && user.role !== 'ai') {
      throw new RoutineAuthError('Only the routine owner can manage this personal routine')
    }
    return
  }
  const ok = await canManageOrgAs(user, routine.orgId, 'admin')
  if (!ok) throw new RoutineAuthError('Organisation admin required for organisation routines')
}

export async function assertCanCreateRoutine(
  user: ApiUser,
  orgId: string,
  accessScope: RoutineAccessScope,
): Promise<void> {
  if (accessScope === 'organization') {
    const ok = await canManageOrgAs(user, orgId, 'admin')
    if (!ok) throw new RoutineAuthError('Organisation admin required for organisation routines')
  }
}

function normalizeTrigger(raw: unknown): RoutineTrigger {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('trigger is required')
  }
  const t = raw as Record<string, unknown>
  if (t.kind === 'schedule') {
    const cron = typeof t.cron === 'string' ? t.cron.trim() : ''
    if (!cron) throw new Error('schedule trigger requires cron')
    const tz = typeof t.tz === 'string' && t.tz.trim() ? t.tz.trim() : 'UTC'
    return { kind: 'schedule', cron, tz }
  }
  if (t.kind === 'event') {
    const source = typeof t.source === 'string' ? t.source.trim() : ''
    if (!['pib', 'webhook', 'github', 'slack', 'linear'].includes(source)) {
      throw new Error('event trigger source must be pib|webhook|github|slack|linear')
    }
    const filter: Record<string, string> = {}
    if (t.filter && typeof t.filter === 'object' && !Array.isArray(t.filter)) {
      for (const [k, v] of Object.entries(t.filter as Record<string, unknown>)) {
        if (typeof v === 'string') filter[k] = v
      }
    }
    return {
      kind: 'event',
      source: source as 'pib' | 'webhook' | 'github' | 'slack' | 'linear',
      filter,
    }
  }
  throw new Error('trigger.kind must be schedule or event')
}

export function hashHookSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

export function resolveRoutineHookSecret(routine: BotRoutine): string | null {
  if (routine.hookSecretCiphertext) {
    try {
      return decryptLinkedSecret(routine.hookSecretCiphertext, `routine-hook:${routine.routineId}`)
    } catch {
      return null
    }
  }
  return null
}

export async function createRoutine(input: {
  orgId: string
  agentId: string
  ownerUserId: string
  accessScope?: RoutineAccessScope
  name: string
  prompt: string
  trigger: unknown
  enabled?: boolean
}): Promise<{ routine: BotRoutine; hookSecret?: string }> {
  await assertBotRoutinesEnabled(input.orgId)
  const name = input.name.trim()
  const prompt = input.prompt.trim()
  if (!name) throw new Error('name is required')
  if (!prompt) throw new Error('prompt is required')
  const trigger = normalizeTrigger(input.trigger)
  const now = Date.now()
  const routineId = `rt_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  let hookId: string | null = null
  let hookSecretHash: string | null = null
  let hookSecretCiphertext: BotRoutine['hookSecretCiphertext'] = null
  let hookSecret: string | undefined
  if (trigger.kind === 'event' && trigger.source === 'webhook') {
    hookId = `hk_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    hookSecret = randomBytes(24).toString('hex')
    hookSecretHash = hashHookSecret(hookSecret)
    try {
      hookSecretCiphertext = encryptLinkedSecret(hookSecret, `routine-hook:${routineId}`)
    } catch {
      // Hash-only fallback when SOCIAL_TOKEN_MASTER_KEY is missing — callers must
      // retain the plaintext secret returned once at create time.
      hookSecretCiphertext = null
    }
  }
  const nextRunAt = trigger.kind === 'schedule'
    ? computeNextRunAtMs(trigger.cron, now, trigger.tz)
    : null
  const routine: BotRoutine = {
    routineId,
    orgId: input.orgId,
    agentId: input.agentId,
    ownerUserId: input.ownerUserId,
    accessScope: input.accessScope === 'organization' ? 'organization' : 'personal',
    name,
    prompt,
    trigger,
    triggerKind: trigger.kind,
    conversationId: null,
    enabled: input.enabled !== false,
    lastRunAt: null,
    nextRunAt,
    runCount: 0,
    hookId,
    hookSecretHash,
    hookSecretCiphertext,
    createdAtMs: now,
    updatedAtMs: now,
    status: 'active',
  }
  await createRoutineDoc(routine)
  return hookSecret ? { routine, hookSecret } : { routine }
}

export async function patchRoutine(
  routineId: string,
  patch: {
    name?: string
    prompt?: string
    trigger?: unknown
    enabled?: boolean
    status?: 'active' | 'archived'
  },
): Promise<BotRoutine> {
  const existing = await getRoutine(routineId)
  if (!existing) throw new Error('Routine not found')
  await assertBotRoutinesEnabled(existing.orgId)
  const now = Date.now()
  const updates: Partial<BotRoutine> = { updatedAtMs: now }
  if (typeof patch.name === 'string') {
    const name = patch.name.trim()
    if (!name) throw new Error('name is required')
    updates.name = name
  }
  if (typeof patch.prompt === 'string') {
    const prompt = patch.prompt.trim()
    if (!prompt) throw new Error('prompt is required')
    updates.prompt = prompt
  }
  if (patch.trigger !== undefined) {
    const trigger = normalizeTrigger(patch.trigger)
    updates.trigger = trigger
    updates.triggerKind = trigger.kind
    if (trigger.kind === 'schedule') {
      updates.nextRunAt = computeNextRunAtMs(trigger.cron, now, trigger.tz)
    } else {
      updates.nextRunAt = null
    }
  }
  if (typeof patch.enabled === 'boolean') updates.enabled = patch.enabled
  if (patch.status === 'active' || patch.status === 'archived') updates.status = patch.status
  await updateRoutineDoc(routineId, updates)
  return { ...existing, ...updates }
}

export async function archiveRoutine(routineId: string): Promise<BotRoutine> {
  return patchRoutine(routineId, { status: 'archived', enabled: false })
}

/**
 * Ensure a per-routine mirror conversation exists (bot + owner as participants).
 */
export async function ensureMirrorConversation(routine: BotRoutine): Promise<string> {
  if (routine.conversationId) {
    const existing = await getConversation(routine.conversationId)
    if (existing) return routine.conversationId
  }
  const conversation = await createConversation({
    orgId: routine.orgId,
    startedBy: routine.ownerUserId,
    title: `Routine: ${routine.name}`,
    participants: [
      { kind: 'user', uid: routine.ownerUserId, role: 'client' },
      { kind: 'agent', agentId: routine.agentId, name: routine.agentId },
    ],
    channelKind: 'messages',
  })
  await updateRoutineDoc(routine.routineId, {
    conversationId: conversation.id,
    updatedAtMs: Date.now(),
  })
  return conversation.id
}

/**
 * Fire a routine run.
 *
 * Dispatch path (chosen): **simplified conversation post** — create a user
 * message with the routine prompt in the mirror conversation via
 * `createMessage`. Full `enqueueLinkedRun` from the messages route is too
 * coupled (device bindings, model selection, attachments). A future completion
 * hook should mark the run succeeded/failed when the assistant message settles;
 * for now we mark `succeeded` once the prompt message is written (enqueued).
 */
export async function fireRoutine(input: {
  routine: BotRoutine
  triggeredBy: RoutineTriggeredBy
  eventSummary?: string
}): Promise<BotRoutineRun> {
  const { routine, triggeredBy } = input
  const now = Date.now()
  const runId = `rr_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const run: BotRoutineRun = {
    runId,
    routineId: routine.routineId,
    orgId: routine.orgId,
    agentId: routine.agentId,
    triggeredBy,
    eventSummary: input.eventSummary ?? null,
    status: 'queued',
    startedAtMs: now,
  }
  await createRunDoc(run)

  try {
    const conversationId = await ensureMirrorConversation(routine)
    const promptBody = triggeredBy.kind === 'event' && input.eventSummary
      ? `${routine.prompt}\n\n---\nEvent: ${input.eventSummary}`
      : routine.prompt

    const userMessage = await createMessage(conversationId, {
      conversationId,
      role: 'user',
      content: promptBody,
      authorKind: 'system',
      authorId: 'routine',
      authorDisplayName: `Routine · ${routine.name}`,
      status: 'completed',
    })

    // Placeholder assistant turn — linked/Hermes dispatch is deferred (see note above).
    const assistantMessage = await createMessage(conversationId, {
      conversationId,
      role: 'assistant',
      content: `Routine queued: ${routine.name}`,
      authorKind: 'agent',
      authorId: routine.agentId,
      authorDisplayName: routine.agentId,
      status: 'completed',
      richParts: [{
        type: 'action_card',
        kind: 'routine_run',
        title: routine.name,
        detail: input.eventSummary || `Triggered by ${triggeredBy.kind}`,
        status: 'succeeded',
        meta: { runId, routineId: routine.routineId },
      }],
    })

    // TODO(W5): wire completion hook from run-finalizer to update run status.
    await updateRunDoc(runId, {
      status: 'succeeded',
      messageId: assistantMessage.id,
      finishedAtMs: Date.now(),
    })

    if (triggeredBy.kind !== 'schedule') {
      await updateRoutineDoc(routine.routineId, {
        lastRunAt: now,
        runCount: (routine.runCount ?? 0) + 1,
        updatedAtMs: Date.now(),
      })
    }

    return {
      ...run,
      status: 'succeeded',
      messageId: userMessage.id,
      finishedAtMs: Date.now(),
    }
  } catch (err) {
    await updateRunDoc(runId, {
      status: 'failed',
      finishedAtMs: Date.now(),
      eventSummary: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

export async function processDueRoutines(nowMs = Date.now()): Promise<BotRoutineRun[]> {
  const due = await listDueScheduleRoutines(nowMs)
  const fired: BotRoutineRun[] = []
  for (const candidate of due) {
    if (!(await orgFeatureFlagEnabled(candidate.orgId, 'botRoutinesEnabled'))) continue
    const cron = candidate.trigger.kind === 'schedule' ? candidate.trigger.cron : '@hourly'
    const tz = candidate.trigger.kind === 'schedule' ? candidate.trigger.tz : 'UTC'
    const nextRunAt = computeNextRunAtMs(cron, nowMs, tz)
    const locked = await claimDueScheduleRoutine(candidate.routineId, nowMs, nextRunAt)
    if (!locked) continue
    try {
      const run = await fireRoutine({
        routine: locked,
        triggeredBy: { kind: 'schedule' },
      })
      fired.push(run)
    } catch {
      /* continue other routines */
    }
  }
  return fired
}

export async function fireRoutineById(
  routineId: string,
  triggeredBy: RoutineTriggeredBy,
  eventSummary?: string,
): Promise<BotRoutineRun> {
  const routine = await getRoutine(routineId)
  if (!routine) throw new Error('Routine not found')
  if (routine.status !== 'active' || !routine.enabled) throw new Error('Routine is not enabled')
  await assertBotRoutinesEnabled(routine.orgId)
  return fireRoutine({ routine, triggeredBy, eventSummary })
}

export async function fireRoutineForEvent(
  routine: BotRoutine,
  event: RoutineEventPayload,
): Promise<BotRoutineRun | null> {
  const claimed = await tryClaimEventDedupe(
    routine.routineId,
    event.eventId,
    Date.now() + ROUTINE_DEDUPE_TTL_MS,
  )
  if (!claimed) return null
  return fireRoutine({
    routine,
    triggeredBy: { kind: 'event', source: event.source, eventId: event.eventId },
    eventSummary: event.summary,
  })
}

export { listRoutinesForAgent, listRunsForRoutine, getRoutine }
