import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { getAgentDecryptedKey } from '@/lib/agents/team'
import type { AgentId, AgentTeamDoc } from '@/lib/agents/types'
import { callHermesJson, HERMES_RUNS_COLLECTION } from '@/lib/hermes/server'
import type { ChatEvent, HermesProfileLink } from '@/lib/hermes/types'
import {
  CONVERSATION_RUN_LOOKUP_GRACE_MS,
  CONVERSATION_RUN_LOST_ERROR,
  CONVERSATION_RUN_STALE_ERROR,
  CONVERSATION_RUN_STALE_TIMEOUT_MS,
} from './run-policy'
import {
  CONVERSATIONS_COLLECTION,
  getConversation,
  messagesCollection,
  touchConversation,
} from './conversations'

type JsonObject = Record<string, unknown>

export type ConversationRunFinalizeStatus =
  | 'completed'
  | 'failed'
  | 'running'
  | 'waiting_approval'

export interface ConversationRunFinalizeResult {
  status: ConversationRunFinalizeStatus
  runId: string
  content?: string
  error?: string
  hermesStatus?: string
  httpStatus?: number
  alreadyFinal?: boolean
}

export interface PendingConversationRun {
  convId: string
  msgId: string
  runId: string
  agentId: AgentId
  createdAtMs: number
  events: ChatEvent[]
}

export class HermesConversationRunError extends Error {
  status: number
  hermes: unknown

  constructor(message: string, status: number, hermes?: unknown) {
    super(message)
    this.name = 'HermesConversationRunError'
    this.status = status
    this.hermes = hermes
  }
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function textFromUnknown(value: unknown, depth = 0): string | null {
  if (depth > 5 || value == null) return null

  const str = cleanString(value)
  if (str) return str

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => textFromUnknown(item, depth + 1))
      .filter((part): part is string => Boolean(part))
    return parts.length > 0 ? parts.join('\n').trim() : null
  }

  const obj = asObject(value)
  if (!obj) return null

  const priorityKeys = [
    'output_text',
    'text',
    'content',
    'message',
    'markdown',
    'summary',
    'final',
    'answer',
    'result',
    'output',
    'response',
    'data',
  ]

  for (const key of priorityKeys) {
    if (key in obj) {
      const nested = textFromUnknown(obj[key], depth + 1)
      if (nested) return nested
    }
  }

  const choices = Array.isArray(obj.choices) ? obj.choices : null
  if (choices) {
    const text = textFromUnknown(choices, depth + 1)
    if (text) return text
  }

  return null
}

function nestedStatus(value: unknown, depth = 0): string | null {
  if (depth > 3) return null
  const obj = asObject(value)
  if (!obj) return null

  const direct = cleanString(obj.status ?? obj.state ?? obj.run_status ?? obj.runStatus)
  if (direct) return direct.toLowerCase()

  for (const key of ['run', 'result', 'response', 'data']) {
    if (key in obj) {
      const status = nestedStatus(obj[key], depth + 1)
      if (status) return status
    }
  }

  return null
}

export function normalizeHermesRunStatus(data: unknown): string {
  return nestedStatus(data) ?? 'unknown'
}

export function extractHermesRunOutput(data: unknown): string {
  const obj = asObject(data)
  if (!obj) return textFromUnknown(data) ?? ''

  for (const key of ['output', 'result', 'response', 'message', 'content', 'data']) {
    if (key in obj) {
      const text = textFromUnknown(obj[key])
      if (text) return text
    }
  }

  return ''
}

export function extractHermesRunError(data: unknown): string | undefined {
  const obj = asObject(data)
  if (!obj) return undefined

  for (const key of ['error', 'reason', 'detail', 'details']) {
    const text = textFromUnknown(obj[key])
    if (text) return text
  }

  return undefined
}

export function extractOutputFromEvents(events: ChatEvent[] = []): string {
  return events
    .flatMap((event) => {
      if (typeof event.delta === 'string' && event.delta.length > 0) return [event.delta]
      const text = cleanString(event.text)
      if (text && !event.error) return [text]
      return []
    })
    .join('')
    .trim()
}

function isCompletedStatus(status: string): boolean {
  return ['completed', 'complete', 'succeeded', 'success', 'done', 'finished'].includes(status)
}

function isFailedStatus(status: string): boolean {
  return ['failed', 'error', 'errored', 'cancelled', 'canceled', 'stopped', 'interrupted'].includes(status)
}

function isWaitingForApprovalStatus(status: string): boolean {
  return ['waiting_for_approval', 'approval_required'].includes(status)
}

function createdAtToMillis(value: unknown): number {
  const maybeTimestamp = value as { toMillis?: () => number; seconds?: number; _seconds?: number } | undefined
  if (!maybeTimestamp) return 0
  if (typeof maybeTimestamp.toMillis === 'function') return maybeTimestamp.toMillis()
  const seconds = maybeTimestamp.seconds ?? maybeTimestamp._seconds
  return typeof seconds === 'number' ? seconds * 1000 : 0
}

async function buildAgentLink(agentId: AgentId, orgId: string): Promise<HermesProfileLink> {
  const agentSnap = await adminDb.collection('agent_team').doc(agentId).get()
  if (!agentSnap.exists) {
    throw new HermesConversationRunError('Agent not found', 404)
  }

  const agentData = agentSnap.data() as AgentTeamDoc
  const decryptedKey = await getAgentDecryptedKey(agentId)

  return {
    orgId,
    profile: agentId,
    baseUrl: agentData.baseUrl,
    ...(decryptedKey ? { apiKey: decryptedKey } : {}),
    enabled: agentData.enabled,
    capabilities: { runs: true, dashboard: false, cron: false, models: false, tools: true, files: false, terminal: false },
    permissions: { superAdmin: false, restrictedAdmin: false, client: true, allowedUserIds: [] },
  }
}

async function updateRunDoc(
  runDocId: unknown,
  runId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const data = {
    ...patch,
    hermesRunId: runId,
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (typeof runDocId === 'string' && runDocId.trim()) {
    await adminDb.collection(HERMES_RUNS_COLLECTION).doc(runDocId).set(data, { merge: true })
    return
  }

  const snap = await adminDb
    .collection(HERMES_RUNS_COLLECTION)
    .where('hermesRunId', '==', runId)
    .limit(1)
    .get()
  if (!snap.empty) await snap.docs[0].ref.set(data, { merge: true })
}

function resolveAgentId(inputAgentId: AgentId | undefined, msgData: JsonObject): AgentId | null {
  const candidate =
    inputAgentId ||
    cleanString(msgData.dispatchAgentId) ||
    cleanString(msgData.authorId)
  return candidate ? candidate as AgentId : null
}

export async function finalizeConversationRun(input: {
  convId: string
  msgId: string
  runId: string
  agentId?: AgentId
  events?: ChatEvent[]
}): Promise<ConversationRunFinalizeResult> {
  const runId = input.runId.trim()
  if (!runId) throw new HermesConversationRunError('runId is required', 400)

  const conversation = await getConversation(input.convId)
  if (!conversation) throw new HermesConversationRunError('Conversation not found', 404)

  const msgRef = messagesCollection(input.convId).doc(input.msgId)
  const msgDoc = await msgRef.get()
  if (!msgDoc.exists) throw new HermesConversationRunError('Message not found', 404)

  const msgData = msgDoc.data() ?? {}
  if (msgData.status === 'completed') {
    return {
      status: 'completed',
      runId,
      content: typeof msgData.content === 'string' ? msgData.content : '',
      alreadyFinal: true,
    }
  }

  const events = input.events ?? (Array.isArray(msgData.events) ? msgData.events as ChatEvent[] : [])
  const agentId = resolveAgentId(input.agentId, msgData)
  if (!agentId) throw new HermesConversationRunError('Agent not found for run', 404)

  const createdAtMs = createdAtToMillis(msgData.createdAt)
  const ageMs = createdAtMs ? Date.now() - createdAtMs : 0
  const agentLink = await buildAgentLink(agentId, conversation.orgId)
  const { response, data } = await callHermesJson(agentLink, `/v1/runs/${encodeURIComponent(runId)}`)

  if (!response.ok) {
    if (response.status === 404 && (!ageMs || ageMs > CONVERSATION_RUN_LOOKUP_GRACE_MS)) {
      await msgRef.update({
        content: '',
        status: 'failed',
        error: CONVERSATION_RUN_LOST_ERROR,
        runId,
        ...(events.length > 0 ? { events } : {}),
      })
      await updateRunDoc(msgData.runDocId, runId, {
        status: 'lost',
        response: data,
        error: CONVERSATION_RUN_LOST_ERROR,
      })
      await touchConversation(input.convId, `[run lost] ${CONVERSATION_RUN_LOST_ERROR}`, 'assistant')
      return {
        status: 'failed',
        content: '',
        error: CONVERSATION_RUN_LOST_ERROR,
        runId,
        httpStatus: response.status,
      }
    }

    if (response.status === 404) {
      return { status: 'running', runId, hermesStatus: 'not_found', httpStatus: response.status }
    }

    throw new HermesConversationRunError('Failed to fetch Hermes run', response.status || 502, data)
  }

  const hermesStatus = normalizeHermesRunStatus(data)

  if (isCompletedStatus(hermesStatus)) {
    const output =
      extractHermesRunOutput(data) ||
      extractOutputFromEvents(events) ||
      'Agent completed but returned no text output.'
    await msgRef.update({
      content: output,
      status: 'completed',
      runId,
      error: FieldValue.delete(),
      ...(events.length > 0 ? { events } : {}),
    })
    await updateRunDoc(msgData.runDocId, runId, {
      status: 'completed',
      response: data,
      output,
      error: FieldValue.delete(),
    })
    await touchConversation(input.convId, output, 'assistant')
    return { status: 'completed', content: output, runId, hermesStatus }
  }

  if (isFailedStatus(hermesStatus)) {
    const error = extractHermesRunError(data) ?? `Run ${hermesStatus}`
    await msgRef.update({
      content: error,
      status: 'failed',
      error,
      runId,
      ...(events.length > 0 ? { events } : {}),
    })
    await updateRunDoc(msgData.runDocId, runId, {
      status: hermesStatus,
      response: data,
      error,
    })
    await touchConversation(input.convId, `[run ${hermesStatus}] ${error}`, 'assistant')
    return { status: 'failed', content: error, error, runId, hermesStatus }
  }

  if (isWaitingForApprovalStatus(hermesStatus)) {
    await msgRef.update({
      status: 'waiting_approval',
      runId,
      ...(events.length > 0 ? { events } : {}),
    })
    await updateRunDoc(msgData.runDocId, runId, {
      status: hermesStatus,
      response: data,
    })
    return { status: 'waiting_approval', runId, hermesStatus }
  }

  if (ageMs > CONVERSATION_RUN_STALE_TIMEOUT_MS) {
    await msgRef.update({
      content: '',
      status: 'failed',
      error: CONVERSATION_RUN_STALE_ERROR,
      runId,
      ...(events.length > 0 ? { events } : {}),
    })
    await updateRunDoc(msgData.runDocId, runId, {
      status: 'timed_out',
      response: data,
      error: CONVERSATION_RUN_STALE_ERROR,
    })
    await touchConversation(input.convId, `[run timed out] ${CONVERSATION_RUN_STALE_ERROR}`, 'assistant')
    return {
      status: 'failed',
      content: '',
      error: CONVERSATION_RUN_STALE_ERROR,
      runId,
      hermesStatus,
    }
  }

  await updateRunDoc(msgData.runDocId, runId, {
    status: hermesStatus,
    response: data,
  })
  return { status: 'running', runId, hermesStatus }
}

export async function findPendingConversationRuns(input: {
  conversationLimit?: number
  messageScanLimit?: number
  maxRuns?: number
} = {}): Promise<PendingConversationRun[]> {
  const conversationLimit = input.conversationLimit ?? 80
  const messageScanLimit = input.messageScanLimit ?? 20
  const maxRuns = input.maxRuns ?? 25

  const convSnap = await adminDb
    .collection(CONVERSATIONS_COLLECTION)
    .orderBy('updatedAt', 'desc')
    .limit(conversationLimit)
    .get()

  const candidates: PendingConversationRun[] = []
  await Promise.all(convSnap.docs.map(async (convDoc) => {
    const messagesSnap = await convDoc.ref
      .collection('messages')
      .orderBy('createdAt', 'desc')
      .limit(messageScanLimit)
      .get()

    for (const msgDoc of messagesSnap.docs) {
      const data = msgDoc.data()
      const status = data.status
      const runId = cleanString(data.runId)
      if (!runId || (status !== 'pending' && status !== 'streaming')) continue

      const agentId = resolveAgentId(undefined, data)
      if (!agentId) continue

      candidates.push({
        convId: convDoc.id,
        msgId: msgDoc.id,
        runId,
        agentId,
        createdAtMs: createdAtToMillis(data.createdAt),
        events: Array.isArray(data.events) ? data.events as ChatEvent[] : [],
      })
    }
  }))

  return candidates
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
    .slice(0, maxRuns)
}

export async function reconcilePendingConversationRuns(input: {
  conversationLimit?: number
  messageScanLimit?: number
  maxRuns?: number
} = {}) {
  const candidates = await findPendingConversationRuns(input)
  const summary = {
    candidates: candidates.length,
    processed: 0,
    completed: 0,
    failed: 0,
    running: 0,
    waitingApproval: 0,
    errors: 0,
  }

  for (const candidate of candidates) {
    try {
      const result = await finalizeConversationRun(candidate)
      summary.processed += 1
      if (result.status === 'completed') summary.completed += 1
      else if (result.status === 'failed') summary.failed += 1
      else if (result.status === 'waiting_approval') summary.waitingApproval += 1
      else summary.running += 1
    } catch (err) {
      summary.errors += 1
      console.error('[conversation-run-reconcile-error]', {
        convId: candidate.convId,
        msgId: candidate.msgId,
        runId: candidate.runId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return summary
}
