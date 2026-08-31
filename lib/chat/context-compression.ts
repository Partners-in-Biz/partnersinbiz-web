/**
 * Conversation context compression for Messages (/context, /compress).
 *
 * Architecture: Firestore + /v1/runs. /compress dispatches a real Hermes run
 * on the selected agent; the run's reply becomes a durable summary stored on
 * the conversation (`contextCompression`). Later dispatches use the summary +
 * the most recent turns instead of the raw history tail. /context reports what
 * is consuming the window and how close the conversation is to the fixed
 * history slice.
 *
 * Pure helpers only — no Firebase, no HTTP. Server modules (messages route,
 * hermes-features slash handlers, run finalizer) use these.
 */

import { redactDelegationSecretsFromText } from '@/lib/api/delegation-text'

export const HISTORY_WINDOW = 30
export const DEFAULT_COMPRESS_KEEP_TURNS = 5
export const MAX_COMPRESS_KEEP_TURNS = 30

/** Durable compression state stored on the conversation doc. */
export interface ConversationContextCompression {
  summary: string
  /** Messages up to and including this id are summarized; later ones stay raw. */
  compressedThroughMessageId: string
  /** Number of latest exchanges kept intact. */
  keepTurns: number
  focusTopic?: string
  createdAt: string
  runId?: string
}

/** Plan carried on the pending assistant message of a /compress run. */
export interface ContextCompressionPlan {
  keepTurns: number
  compressedThroughMessageId: string
  focusTopic?: string
}

export type CompressAction = 'compress' | 'status' | 'clear'

export interface CompressArgs {
  action: CompressAction
  keepTurns: number
  focusTopic?: string
}

/** Minimal structural view of a conversation message (avoids import cycles). */
export interface CompressibleMessage {
  id: string
  role: string
  content?: string
  error?: string
  status?: string
  attachments?: Array<{ name: string }>
  authorDisplayName?: string
  authorId?: string
  createdAt?: unknown
}

export function parseCompressArgs(args: string): CompressArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean).map((token) => token.toLowerCase())
  if (tokens[0] === 'status' || tokens[0] === 'show') {
    return { action: 'status', keepTurns: DEFAULT_COMPRESS_KEEP_TURNS }
  }
  if (tokens[0] === 'clear' || tokens[0] === 'reset') {
    return { action: 'clear', keepTurns: DEFAULT_COMPRESS_KEEP_TURNS }
  }

  let keepTurns = DEFAULT_COMPRESS_KEEP_TURNS
  let focusTopic: string | undefined
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === 'here' && tokens[index + 1]) {
      const parsed = Number.parseInt(tokens[index + 1] ?? '', 10)
      if (Number.isFinite(parsed)) {
        keepTurns = Math.min(MAX_COMPRESS_KEEP_TURNS, Math.max(1, parsed))
        index += 1
      }
      continue
    }
    if (token === 'focus' && tokens[index + 1]) {
      focusTopic = tokens.slice(index + 1).join(' ').trim()
      break
    }
  }

  return { action: 'compress', keepTurns, focusTopic }
}

/** Rough token estimate (chars / 4). Used only for /context reporting. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

function messageAuthorLabel(message: CompressibleMessage): string {
  if (message.authorDisplayName?.trim()) return message.authorDisplayName.trim()
  if (message.authorId?.trim()) return message.authorId.trim()
  return message.role
}

function normalizeHistoryContent(message: CompressibleMessage): string {
  const content = typeof message.content === 'string' ? message.content.trim() : ''
  if (content) return redactDelegationSecretsFromText(content.replace(/\s+$/g, ''))
  if (message.error) return redactDelegationSecretsFromText(`[${message.status ?? 'failed'}: ${message.error}]`)
  if (message.attachments?.length) {
    return `[attachments: ${message.attachments.map((attachment) => attachment.name).join(', ')}]`
  }
  return ''
}

function isConversational(message: CompressibleMessage): boolean {
  return message.role === 'user' || message.role === 'assistant'
}

function indexOfMessage(messages: CompressibleMessage[], messageId: string): number {
  return messages.findIndex((message) => message.id === messageId)
}

/**
 * Compute where to cut when compressing. Walks the ascending message list and
 * keeps the last `keepTurns` user exchanges (user message + everything after
 * it) intact; everything before that window becomes the summary input.
 */
export function computeCompressionPlan(
  messages: CompressibleMessage[],
  currentMessageId: string,
  args: string,
): ContextCompressionPlan | null {
  const parsed = parseCompressArgs(args)
  if (parsed.action !== 'compress') return null

  // Walk backwards counting user exchanges (the latest user message marks the
  // latest exchange; its assistant reply follows it).
  let seenUserExchanges = 0
  let keptStartIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.id === currentMessageId) continue
    if (!isConversational(message)) continue
    if (message.role === 'user') {
      seenUserExchanges += 1
      if (seenUserExchanges === parsed.keepTurns) {
        keptStartIndex = index
        break
      }
    }
  }

  if (keptStartIndex <= 0) return null

  const compressedThrough = messages[keptStartIndex - 1]
  if (!compressedThrough) return null

  return {
    keepTurns: parsed.keepTurns,
    compressedThroughMessageId: compressedThrough.id,
    ...(parsed.focusTopic ? { focusTopic: parsed.focusTopic } : {}),
  }
}

/**
 * Block fed to the /compress run: the older messages that must be summarized.
 * Only messages at or before the cut are included, so the agent's summary does
 * not duplicate the recent turns.
 */
export function buildCompressionInputBlock(
  messages: CompressibleMessage[],
  currentMessageId: string,
  plan: ContextCompressionPlan,
): string {
  const cutIndex = indexOfMessage(messages, plan.compressedThroughMessageId)
  const compressible = messages
    .filter((message, index) => index <= cutIndex && message.id !== currentMessageId)
    .filter(isConversational)
    .map((message) => ({ message, content: normalizeHistoryContent(message) }))
    .filter(({ content }) => content.length > 0)

  if (compressible.length === 0) return ''

  const lines = compressible.map(({ message, content }) => {
    const label = message.role === 'assistant'
      ? `${messageAuthorLabel(message)} (assistant)`
      : `${messageAuthorLabel(message)} (user)`
    const clipped = content.length > 2000 ? `${content.slice(0, 2000).trimEnd()}…` : content
    return `${label}: ${clipped}`
  })

  return [
    `[Conversation context to compress — older messages; the latest ${plan.keepTurns} exchanges are kept intact]`,
    ...lines,
    '---',
    '',
  ].join('\n')
}

/** Task instruction block injected into the /compress run prompt. */
export function buildCompressionTaskPromptBlock(plan: ContextCompressionPlan): string {
  const focusLine = plan.focusTopic
    ? `- Preserve every fact related to the focus topic "${plan.focusTopic}" in full detail.`
    : ''
  return [
    '[Context compression task]',
    'You are compressing the older part of this conversation so the active context stays small.',
    '- Summarize ONLY the "[Conversation context to compress]" block above. Do not summarize the recent exchanges after it.',
    '- Preserve: decisions, facts, names, IDs, numbers, links, task references, approvals, blockers, and open threads.',
    '- Keep the summary tight: aim for under ~600 words unless the material genuinely needs more.',
    focusLine,
    '- Reply with ONLY the summary text. No preamble, no "Here is the summary", no JSON envelope.',
    '- This summary becomes permanent context for future turns, so it must stand alone and remain accurate.',
    '---',
    '',
  ].filter(Boolean).join('\n')
}

/**
 * History block injected into normal (non-compression) dispatch prompts.
 * When a durable compression exists, the summary is injected first and the
 * recent messages after the cut are kept in full (still bounded by the window).
 */
export function buildConversationHistoryBlock(
  messages: CompressibleMessage[],
  currentMessageId: string,
  compression?: ConversationContextCompression | null,
): string {
  const priorMessages = messages
    .filter((message) => message.id !== currentMessageId)
    .filter(isConversational)
    .map((message) => ({ message, content: normalizeHistoryContent(message) }))
    .filter(({ content }) => content.length > 0)

  let kept = priorMessages
  if (compression) {
    const cutIndex = indexOfMessage(messages, compression.compressedThroughMessageId)
    kept = priorMessages.filter(({ message }) => indexOfMessage(messages, message.id) > cutIndex)
  }

  const keptSlice = kept.slice(-HISTORY_WINDOW)
  if (keptSlice.length === 0 && !compression) return ''

  const lines = keptSlice.map(({ message, content }) => {
    const label = message.role === 'assistant'
      ? `${messageAuthorLabel(message)} (assistant)`
      : `${messageAuthorLabel(message)} (user)`
    const clipped = content.length > 2000 ? `${content.slice(0, 2000).trimEnd()}…` : content
    return `${label}: ${clipped}`
  })

  const summaryBlock = compression
    ? [
      `[Compressed earlier context — /compress here ${compression.keepTurns}${compression.focusTopic ? `, focus "${compression.focusTopic}"` : ''}]`,
      redactDelegationSecretsFromText(compression.summary),
      '',
    ]
    : []

  return [
    '[Recent conversation history — use this to preserve context and answer the latest user message as part of the ongoing thread]',
    ...summaryBlock,
    ...lines,
    '---',
    '',
  ].filter(Boolean).join('\n')
}

/** Counts and estimates backing the /context reply. */
export interface ContextUsageSnapshot {
  totalMessages: number
  userMessages: number
  assistantMessages: number
  exchanges: number
  historyWindow: number
  historyBlockTokens: number
  compression: ConversationContextCompression | null
  model: string | null
  compressedMessages: number
}

export function buildContextUsageSnapshot(input: {
  messages: CompressibleMessage[]
  conversation: {
    contextCompression?: ConversationContextCompression | null
    model?: string | null
    provider?: string | null
  } | null
}): ContextUsageSnapshot {
  const messages = input.messages
  const conversation = input.conversation
  const userMessages = messages.filter((message) => message.role === 'user').length
  const assistantMessages = messages.filter((message) => message.role === 'assistant').length
  const compression = conversation?.contextCompression ?? null

  const historyBlock = buildConversationHistoryBlock(messages, '', compression)
  const compressedMessages = compression
    ? messages.filter((message) => {
      const cutIndex = indexOfMessage(messages, compression.compressedThroughMessageId)
      return cutIndex >= 0 && indexOfMessage(messages, message.id) <= cutIndex
    }).length
    : 0

  const model = conversation?.model
    ? `${conversation.model}${conversation.provider ? ` (${conversation.provider})` : ''}`
    : null

  return {
    totalMessages: messages.length,
    userMessages,
    assistantMessages,
    exchanges: userMessages,
    historyWindow: HISTORY_WINDOW,
    historyBlockTokens: estimateTokens(historyBlock),
    compression,
    model,
    compressedMessages,
  }
}

/** Human-readable reply for /context (mirrors the other hermes-features handlers). */
export function buildContextReport(snapshot: ContextUsageSnapshot): string {
  const lines = [
    '**Context usage — this conversation**',
    `Messages: ${snapshot.totalMessages} (${snapshot.userMessages} user / ${snapshot.assistantMessages} assistant)`,
    `Exchanges: ${snapshot.exchanges}`,
    `History window sent to the agent: last ${snapshot.historyWindow} messages`,
    `Estimated tokens in the history block: ~${snapshot.historyBlockTokens}`,
    snapshot.model ? `Selected model: ${snapshot.model}` : 'Selected model: auto',
    '',
  ]

  if (snapshot.compression) {
    lines.push(
      `Compression: active (${snapshot.compressedMessages} older messages summarized, latest ${snapshot.compression.keepTurns} exchanges kept intact)`,
      `Summary: ${snapshot.compression.summary.length} chars, stored ${snapshot.compression.createdAt}`,
      snapshot.compression.focusTopic ? `Focus topic preserved: ${snapshot.compression.focusTopic}` : '',
      '',
    )
  } else {
    lines.push('Compression: none yet', '')
  }

  lines.push(
    'Messages already only send the last 30 into the agent context; beyond that the tail is dropped.',
    'Usage: `/context` · `/compress` · `/compress here 5` (keep the latest 5 exchanges) · `/compress focus <topic>` · `/compress status` · `/compress clear`',
  )

  return lines.filter(Boolean).join('\n')
}
