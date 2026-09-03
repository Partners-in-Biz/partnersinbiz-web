import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { getAgentDispatchHermesProfileLink } from '@/lib/agents/team'
import { getLinkedRunResult } from '@/lib/linked-computers/run-queue-store'
import type { AgentId } from '@/lib/agents/types'
import type { ContextCompressionPlan } from '@/lib/chat/context-compression'
import { callHermesJson, HERMES_RUNS_COLLECTION } from '@/lib/hermes/server'
import type { ChatEvent, ChatUiAction, HermesProfileLink, RichMessagePart } from '@/lib/hermes/types'
import {
  dedupeStructured,
  extractMixedRichContent,
  richPartsFromEvents,
  richPartsFromPayload,
  isRichPayloadText,
  uiActionsFromEvents,
  uiActionsFromPayload,
} from '@/lib/hermes/rich-messages'
import { extractPibFences } from '@/lib/chat/pib-fences'
import { validatePart } from '@/lib/chat/parts'
import { applyAssistantTextDelta } from '@/lib/chat/applyAssistantTextDelta'
import {
  CONVERSATION_RUN_LOOKUP_GRACE_MS,
  CONVERSATION_RUN_LOST_ERROR,
  CONVERSATION_RUN_STALE_ERROR,
  CONVERSATION_RUN_STALE_TIMEOUT_MS,
  humanizeConversationRunError,
} from './run-policy'
import {
  CONVERSATIONS_COLLECTION,
  getConversation,
  messagesCollection,
  touchConversation,
} from './conversations'
import { buildThinkingTrace, mergeChatEvents } from './thinking-trace'

type JsonObject = Record<string, unknown>

export type ConversationRunFinalizeStatus =
  | 'queued'
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
  richParts?: RichMessagePart[]
  uiActions?: ChatUiAction[]
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

function finiteToken(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.min(Math.round(value), 50_000_000)
}

function finiteCostUsd(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  // Keep sub-cent precision for portal credits; clamp runaway values.
  return Math.min(Number(value.toFixed(8)), 1_000_000)
}

function asUsageRecord(value: unknown): JsonObject | null {
  const obj = asObject(value)
  if (!obj) return null
  const looksLikeUsage = [
    'input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens',
    'output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens',
    'total_tokens', 'totalTokens', 'cache_read_input_tokens', 'cache_read_tokens',
  ].some((key) => key in obj)
  return looksLikeUsage ? obj : null
}

function findUsageRecord(payload: unknown, depth = 0): JsonObject | null {
  const obj = asObject(payload)
  if (!obj || depth > 4) return null
  const direct = asUsageRecord(obj.usage) ?? asUsageRecord(obj.token_usage) ?? asUsageRecord(obj.tokenUsage)
  if (direct) return direct
  if (asUsageRecord(obj)) return obj
  for (const key of ['result', 'response', 'data', 'run', 'output', 'message', 'metrics']) {
    if (key in obj) {
      const nested = findUsageRecord(obj[key], depth + 1)
      if (nested) return nested
    }
  }
  return null
}

/**
 * Extract gateway-reported token/cost usage from a Hermes run payload.
 * Tolerates snake_case and camelCase OpenAI-style usage objects.
 */
export function extractRunUsage(payload: unknown): {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  costUsd: number | null
} | null {
  const usage = findUsageRecord(payload)
  if (!usage) return null
  const inputTokens = finiteToken(
    usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? usage.promptTokens,
  )
  const outputTokens = finiteToken(
    usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? usage.completionTokens,
  )
  const reasoningTokens = finiteToken(usage.reasoning_tokens ?? usage.reasoningTokens)
  const cacheReadTokens = finiteToken(
    usage.cache_read_input_tokens
    ?? usage.cache_read_tokens
    ?? usage.cacheReadTokens
    ?? usage.cached_tokens
    ?? usage.cachedTokens,
  )
  const cacheWriteTokens = finiteToken(
    usage.cache_creation_input_tokens
    ?? usage.cache_write_tokens
    ?? usage.cacheWriteTokens,
  )
  let totalTokens = finiteToken(usage.total_tokens ?? usage.totalTokens ?? usage.tokensTotal)
  if (totalTokens === null) {
    const parts = [inputTokens, outputTokens, reasoningTokens].filter((v): v is number => v !== null)
    if (parts.length > 0) totalTokens = parts.reduce((sum, v) => sum + v, 0)
  }
  const costUsd = finiteCostUsd(usage.cost_usd ?? usage.costUsd ?? usage.cost)
  if (
    inputTokens === null
    && outputTokens === null
    && totalTokens === null
    && reasoningTokens === null
    && cacheReadTokens === null
    && cacheWriteTokens === null
    && costUsd === null
  ) {
    return null
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd,
  }
}

function usagePatchFromPayload(payload: unknown): Record<string, unknown> {
  const usage = extractRunUsage(payload)
  if (!usage) return {}
  const compact: Record<string, number> = {}
  if (usage.inputTokens !== null) compact.inputTokens = usage.inputTokens
  if (usage.outputTokens !== null) compact.outputTokens = usage.outputTokens
  if (usage.totalTokens !== null) compact.totalTokens = usage.totalTokens
  if (usage.reasoningTokens !== null) compact.reasoningTokens = usage.reasoningTokens
  if (usage.cacheReadTokens !== null) compact.cacheReadTokens = usage.cacheReadTokens
  if (usage.cacheWriteTokens !== null) compact.cacheWriteTokens = usage.cacheWriteTokens
  if (usage.costUsd !== null) compact.costUsd = usage.costUsd
  return Object.keys(compact).length > 0 ? { usage: compact } : {}
}

/**
 * Persist the output of a /compress run as durable conversation context
 * compression. Idempotent: a second completion just overwrites the summary.
 */
export async function storeConversationCompression(input: {
  convId: string
  plan: ContextCompressionPlan
  summary: string
  runId?: string
}): Promise<void> {
  const summary = input.summary.trim()
  if (!summary) return
  await adminDb.collection(CONVERSATIONS_COLLECTION).doc(input.convId).update({
    contextCompression: {
      summary,
      compressedThroughMessageId: input.plan.compressedThroughMessageId,
      keepTurns: input.plan.keepTurns,
      ...(input.plan.focusTopic ? { focusTopic: input.plan.focusTopic } : {}),
      createdAt: new Date().toISOString(),
      ...(input.runId ? { runId: input.runId } : {}),
    },
  })
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
    .reduce((current, chunk) => applyAssistantTextDelta(current, chunk), '')
    .trim()
}

function richMessagePatchFromRun(data: unknown, events: ChatEvent[] = [], output?: string): {
  richParts?: RichMessagePart[]
  uiActions?: ChatUiAction[]
  /** Prose with embedded rich_parts JSON stripped (when mixed content was detected). */
  proseContent?: string
} {
  const mixed = typeof output === 'string' ? extractMixedRichContent(output) : null
  const fences = typeof output === 'string' ? extractPibFences(mixed?.prose ?? output) : { markdown: '', parts: [] }
  const richParts = dedupeStructured([
    ...richPartsFromPayload(data),
    ...richPartsFromPayload(output),
    ...(mixed?.richParts ?? []),
    ...fences.parts,
    ...richPartsFromEvents(events),
  ]).map((part) => {
    const checked = validatePart(part)
    return checked.ok ? checked.part : { type: 'status', title: 'Unsupported content', content: checked.reason }
  })
  const uiActions = dedupeStructured([
    ...uiActionsFromPayload(data),
    ...uiActionsFromPayload(output),
    ...(mixed?.uiActions ?? []),
    ...uiActionsFromEvents(events),
  ])
  return {
    ...(richParts.length > 0 ? { richParts } : {}),
    ...(uiActions.length > 0 ? { uiActions } : {}),
    ...(mixed?.extracted || fences.parts.length > 0 ? { proseContent: fences.markdown || mixed?.prose } : {}),
  }
}

function richPreviewFromParts(parts: RichMessagePart[] = []): string | null {
  for (const part of parts) {
    const candidate =
      typeof part.content === 'string' ? part.content
        : typeof part.markdown === 'string' ? part.markdown
          : typeof part.title === 'string' ? part.title
            : typeof part.question === 'string' ? part.question
              : typeof part.body === 'string' ? part.body
                : null
    const text = cleanString(candidate)
    if (text) return text
  }
  return null
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

const ACTIVE_LEDGER_STATUSES = ['started', 'submitted', 'running', 'pending', 'streaming'] as const

function metadataFromRunDoc(data: JsonObject): JsonObject {
  return asObject(data.metadata)
    ?? asObject(asObject(data.request)?.metadata)
    ?? asObject(asObject(data.response)?.metadata)
    ?? {}
}

function runDocUnifiedChatSource(data: JsonObject, metadata: JsonObject): boolean {
  return cleanString(metadata.source) === 'pib-unified-chat'
    || cleanString(data.source) === 'pib-unified-chat'
    || Boolean(cleanString(metadata.conversationId ?? metadata.conversation_id) && cleanString(metadata.messageId ?? metadata.message_id))
}

function runDocConversationId(data: JsonObject, metadata: JsonObject): string | null {
  return cleanString(metadata.conversationId ?? metadata.conversation_id)
    ?? cleanString(data.conversationId ?? data.conversation_id)
}

function runDocMessageId(data: JsonObject, metadata: JsonObject): string | null {
  return cleanString(metadata.messageId ?? metadata.message_id)
    ?? cleanString(data.messageId ?? data.message_id)
}

async function buildAgentLink(agentId: AgentId, orgId: string, runtimeTarget?: string | null): Promise<HermesProfileLink> {
  const agentLink = await getAgentDispatchHermesProfileLink(agentId, orgId, { runtimeTarget })
  if (!agentLink) throw new HermesConversationRunError('Agent not found', 404)
  return agentLink
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
  if (msgData.role !== 'assistant') {
    throw new HermesConversationRunError('Message is not an assistant run', 409)
  }
  const storedRunId = cleanString(msgData.runId)
  if (!storedRunId || storedRunId !== runId) {
    throw new HermesConversationRunError('Run does not match this message', 409)
  }
  const storedAgentId = cleanString(msgData.dispatchAgentId)
  if (!storedAgentId || (input.agentId && input.agentId !== storedAgentId)) {
    throw new HermesConversationRunError('Agent does not match this message', 409)
  }
  const messageAlreadyCompleted = msgData.status === 'completed'

  const linkedDeviceId = cleanString(msgData.linkedDeviceId)
  if (linkedDeviceId) {
    if (messageAlreadyCompleted) {
      return {
        status: 'completed',
        content: cleanString(msgData.content) ?? '',
        runId,
        alreadyFinal: true,
      }
    }
    if (msgData.status === 'failed') {
      const error = cleanString(msgData.error) ?? 'The linked computer run failed.'
      return { status: 'failed', content: '', error, runId, alreadyFinal: true }
    }
    const linkedResult = await getLinkedRunResult({
      jobId: runId,
      deviceId: linkedDeviceId,
      conversationId: input.convId,
      assistantMessageId: input.msgId,
    })
    if (!linkedResult) {
      throw new HermesConversationRunError('Linked computer run not found', 404)
    }
    // /compress run completed on a linked computer: persist the summary so the
    // next dispatch uses compressed context.
    if (msgData.contextCompressionPlan && linkedResult.status === 'completed' && linkedResult.content) {
      await storeConversationCompression({
        convId: input.convId,
        plan: msgData.contextCompressionPlan as ContextCompressionPlan,
        summary: linkedResult.content,
        runId: linkedResult.runId,
      }).catch((err) => console.error('[store-conversation-compression-failed]', {
        convId: input.convId,
        msgId: input.msgId,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
    return {
      status: linkedResult.status,
      runId: linkedResult.runId,
      ...(linkedResult.content !== undefined ? { content: linkedResult.content } : {}),
      ...(linkedResult.error ? { error: linkedResult.error } : {}),
    }
  }

  const storedEvents = Array.isArray(msgData.events) ? msgData.events as ChatEvent[] : []
  // Client SSE events are useful for a public thinking trail, but must not become
  // authoritative run output / rich payload when Hermes itself returned nothing.
  const clientEvents = Array.isArray(input.events) ? input.events : []
  const eventsForThinking = mergeChatEvents(storedEvents, clientEvents)
  const events = storedEvents
  const thinking = buildThinkingTrace(eventsForThinking)
  const thinkingPatch = thinking ? { thinking } : {}
  const eventsPersistPatch = eventsForThinking.length > 0 ? { events: eventsForThinking } : {}
  const agentId = resolveAgentId(storedAgentId as AgentId, msgData)
  if (!agentId) throw new HermesConversationRunError('Agent not found for run', 404)

  const createdAtMs = createdAtToMillis(msgData.createdAt)
  const ageMs = createdAtMs ? Date.now() - createdAtMs : 0
  const runtimeTarget = cleanString(msgData.dispatchRuntimeTargetId)
    ?? cleanString(conversation.workspaceContext?.runtimeTarget)
  const agentLink = await buildAgentLink(agentId, conversation.orgId, runtimeTarget)
  const { response, data } = await callHermesJson(agentLink, `/v1/runs/${encodeURIComponent(runId)}`)

  if (!response.ok) {
    if (response.status === 404 && (!ageMs || ageMs > CONVERSATION_RUN_LOOKUP_GRACE_MS)) {
      await msgRef.update({
        content: '',
        status: 'failed',
        error: CONVERSATION_RUN_LOST_ERROR,
        runId,
        ...eventsPersistPatch,
        ...thinkingPatch,
      })
      await updateRunDoc(msgData.runDocId, runId, {
        status: 'lost',
        response: data,
        error: CONVERSATION_RUN_LOST_ERROR,
      })
      await touchConversation(input.convId, `[run lost] ${CONVERSATION_RUN_LOST_ERROR}`, 'assistant', input.msgId)
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
    const rawOutput =
      extractHermesRunOutput(data) ||
      extractOutputFromEvents(events) ||
      'Agent completed but returned no text output.'
    const richPatch = richMessagePatchFromRun(data, events, rawOutput)
    const existingRichPatch = {
      ...(!richPatch.richParts && Array.isArray(msgData.richParts) ? { richParts: msgData.richParts as RichMessagePart[] } : {}),
      ...(!richPatch.uiActions && Array.isArray(msgData.uiActions) ? { uiActions: msgData.uiActions as ChatUiAction[] } : {}),
    }
    const { proseContent: _proseContent, ...richFields } = richPatch
    const ledgerRichPatch = { ...existingRichPatch, ...richFields }
    const outputIsStructuredJson = isRichPayloadText(rawOutput)
    // Pure JSON envelope → empty prose; mixed prose+rich_parts → keep prose only.
    const output = outputIsStructuredJson
      ? ''
      : typeof richPatch.proseContent === 'string'
        ? richPatch.proseContent
        : rawOutput
    const previewOutput = output || richPreviewFromParts(ledgerRichPatch.richParts) || 'Agent returned a rich response.'

    const usagePatch = usagePatchFromPayload(data)

    if (messageAlreadyCompleted) {
      await updateRunDoc(msgData.runDocId, runId, {
        status: 'completed',
        response: data,
        output: previewOutput,
        error: FieldValue.delete(),
        ...ledgerRichPatch,
        ...usagePatch,
      })
      return {
        status: 'completed',
        content: typeof msgData.content === 'string' ? msgData.content : output,
        runId,
        hermesStatus,
        alreadyFinal: true,
        ...ledgerRichPatch,
      }
    }

    await msgRef.update({
      content: output,
      status: 'completed',
      runId,
      error: FieldValue.delete(),
      ...eventsPersistPatch,
      ...thinkingPatch,
      // Preserve mid-run open_context attachments (email/invoice drafts) that
      // create routes wrote before Hermes completed.
      ...ledgerRichPatch,
      ...usagePatch,
    })
    await updateRunDoc(msgData.runDocId, runId, {
      status: 'completed',
      response: data,
      output: previewOutput,
      error: FieldValue.delete(),
      ...richFields,
      ...usagePatch,
    })
    await touchConversation(input.convId, previewOutput, 'assistant', input.msgId)

    // /compress run completed: persist the summary as durable conversation
    // context compression (the reply is also visible in the thread).
    if (msgData.contextCompressionPlan) {
      await storeConversationCompression({
        convId: input.convId,
        plan: msgData.contextCompressionPlan as ContextCompressionPlan,
        summary: output,
        runId,
      }).catch((err) => console.error('[store-conversation-compression-failed]', {
        convId: input.convId,
        msgId: input.msgId,
        error: err instanceof Error ? err.message : String(err),
      }))
    }

    // Standing /goal loop: auto-continue when the conversation has an active Hermes goal.
    // Compression runs summarize context only — they must not extend a goal loop.
    if (!msgData.contextCompressionPlan) {
      try {
        const { maybeContinueConversationGoal } = await import('@/lib/chat/hermes-goal-continue')
        await maybeContinueConversationGoal({
          convId: input.convId,
          completedAssistantMessageId: input.msgId,
          assistantContent: output,
          runId,
        })
      } catch (goalErr) {
        console.error('[goal-continue-failed]', {
          convId: input.convId,
          msgId: input.msgId,
          error: goalErr instanceof Error ? goalErr.message : String(goalErr),
        })
      }
    }

    return { status: 'completed', content: output, runId, hermesStatus, ...richFields }
  }

  if (messageAlreadyCompleted) {
    await updateRunDoc(msgData.runDocId, runId, {
      status: hermesStatus,
      response: data,
    })
    return {
      status: 'completed',
      runId,
      content: typeof msgData.content === 'string' ? msgData.content : '',
      hermesStatus,
      alreadyFinal: true,
    }
  }

  if (isFailedStatus(hermesStatus)) {
    const rawError = extractHermesRunError(data)
      || extractHermesRunOutput(data)
      || `Run ${hermesStatus}`
    const error = humanizeConversationRunError(rawError)
    const richPatch = richMessagePatchFromRun(data, events)
    const usagePatch = usagePatchFromPayload(data)
    await msgRef.update({
      content: error,
      status: 'failed',
      error,
      runId,
      ...eventsPersistPatch,
      ...thinkingPatch,
      ...richPatch,
      ...usagePatch,
    })
    await updateRunDoc(msgData.runDocId, runId, {
      status: hermesStatus,
      response: data,
      error,
      ...richPatch,
      ...usagePatch,
    })
    await touchConversation(input.convId, `[run ${hermesStatus}] ${error}`, 'assistant', input.msgId)
    return { status: 'failed', content: error, error, runId, hermesStatus, ...richPatch }
  }

  if (isWaitingForApprovalStatus(hermesStatus)) {
    const richPatch = richMessagePatchFromRun(data, events)
    await msgRef.update({
      status: 'waiting_approval',
      runId,
      ...eventsPersistPatch,
      ...thinkingPatch,
      ...richPatch,
    })
    await updateRunDoc(msgData.runDocId, runId, {
      status: hermesStatus,
      response: data,
      ...richPatch,
    })
    return { status: 'waiting_approval', runId, hermesStatus, ...richPatch }
  }

  if (ageMs > CONVERSATION_RUN_STALE_TIMEOUT_MS) {
    await msgRef.update({
      content: '',
      status: 'failed',
      error: CONVERSATION_RUN_STALE_ERROR,
      runId,
      ...eventsPersistPatch,
      ...thinkingPatch,
    })
    await updateRunDoc(msgData.runDocId, runId, {
      status: 'timed_out',
      response: data,
      error: CONVERSATION_RUN_STALE_ERROR,
    })
    await touchConversation(input.convId, `[run timed out] ${CONVERSATION_RUN_STALE_ERROR}`, 'assistant', input.msgId)
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

  const candidates: PendingConversationRun[] = []
  const candidateKeys = new Set<string>()
  const addCandidate = (candidate: PendingConversationRun) => {
    const key = `${candidate.convId}:${candidate.msgId}:${candidate.runId}`
    if (candidateKeys.has(key)) return
    candidateKeys.add(key)
    candidates.push(candidate)
  }
  try {
    const messagesSnap = await adminDb
      .collectionGroup('messages')
      .where('status', 'in', ['pending', 'streaming'])
      .limit(maxRuns)
      .get()

    for (const msgDoc of messagesSnap.docs) {
      const convId = msgDoc.ref.parent.parent?.id
      if (!convId) continue
      const data = msgDoc.data()
      const runId = cleanString(data.runId)
      if (!runId) continue

      const agentId = resolveAgentId(undefined, data)
      if (!agentId) continue

      addCandidate({
        convId,
        msgId: msgDoc.id,
        runId,
        agentId,
        createdAtMs: createdAtToMillis(data.createdAt),
        events: Array.isArray(data.events) ? data.events as ChatEvent[] : [],
      })
    }
  } catch (err) {
    console.warn('[conversation-run-pending-query-fallback]', err)
  }

  try {
    const activeRunsSnap = await adminDb
      .collection(HERMES_RUNS_COLLECTION)
      .where('status', 'in', [...ACTIVE_LEDGER_STATUSES])
      .limit(maxRuns)
      .get()

    await Promise.all(activeRunsSnap.docs.map(async (runDoc) => {
      const data = runDoc.data() ?? {}
      const metadata = metadataFromRunDoc(data)
      if (!runDocUnifiedChatSource(data, metadata)) return

      const convId = runDocConversationId(data, metadata)
      const msgId = runDocMessageId(data, metadata)
      const runId = cleanString(data.hermesRunId ?? data.runId ?? metadata.runId ?? metadata.run_id)
      if (!convId || !msgId || !runId) return

      const msgDoc = await adminDb.collection(CONVERSATIONS_COLLECTION).doc(convId).collection('messages').doc(msgId).get()
      if (!msgDoc.exists) return
      const msgData = msgDoc.data() ?? {}
      const agentId = resolveAgentId(cleanString(metadata.dispatchAgentId ?? metadata.agentId) as AgentId | undefined, msgData)
      if (!agentId) return

      addCandidate({
        convId,
        msgId,
        runId,
        agentId,
        createdAtMs: createdAtToMillis(msgData.createdAt) || createdAtToMillis(data.createdAt),
        events: Array.isArray(msgData.events) ? msgData.events as ChatEvent[] : [],
      })
    }))
  } catch (err) {
    console.warn('[conversation-run-ledger-query-fallback]', err)
  }

  if (candidates.length > 0) {
    return candidates
      .sort((a, b) => a.createdAtMs - b.createdAtMs)
      .slice(0, maxRuns)
  }

  const convSnap = await adminDb
    .collection(CONVERSATIONS_COLLECTION)
    .orderBy('updatedAt', 'desc')
    .limit(conversationLimit)
    .get()

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

      addCandidate({
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
    delegations: {
      candidates: 0,
      processed: 0,
      completed: 0,
      failed: 0,
      running: 0,
      skipped: 0,
      errors: 0,
    },
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

  // Subagent branches: hermes-features-delegation children complete outside the
  // unified-chat messageId path — re-enter parent thread with branch + summary.
  try {
    const { reconcilePendingDelegationRuns } = await import('@/lib/conversations/delegation-finalizer')
    summary.delegations = await reconcilePendingDelegationRuns({
      maxRuns: input.maxRuns ?? 25,
    })
  } catch (err) {
    summary.delegations.errors += 1
    console.error('[delegation-run-reconcile-hook-error]', err)
  }

  return summary
}
