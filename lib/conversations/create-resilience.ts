/**
 * Client/server helpers for resilient conversation create.
 *
 * Protects against the failure mode where POST /conversations succeeds on the
 * server but the browser loses the response ("Failed to fetch") and treats a
 * successful create as a failure.
 */

export const CREATE_CONVERSATION_RECONCILE_WINDOW_MS = 90_000
export const COMPANY_COWORK_ENSURE_BUDGET_MS = 8_000

export type CreateConversationReconcileCriteria = {
  startedBy: string
  scope: string
  scopeRefId?: string | null
  companyId?: string | null
  projectId?: string | null
  workspaceId?: string | null
  runtimeTarget?: string | null
  agentIds?: string[]
  title?: string | null
  nowMs?: number
  windowMs?: number
}

export type ReconcileConversationCandidate = {
  id: string
  startedBy?: string
  scope?: string
  scopeRefId?: string
  participantAgentIds?: string[]
  messageCount?: number
  title?: string
  createdAt?: unknown
  updatedAt?: unknown
  lastMessageAt?: unknown
  workspaceContext?: {
    workspaceId?: string
    runtimeTarget?: string
    companyId?: string | null
    projectId?: string
  } | null
}

export function isNetworkFetchFailure(error: unknown): boolean {
  if (!error) return false
  const raw = error instanceof Error ? error.message : String(error)
  const lower = raw.toLowerCase()
  return (
    lower.includes('failed to fetch')
    || lower.includes('networkerror')
    || lower.includes('network request failed')
    || lower.includes('load failed')
    || lower.includes('fetch failed')
    || lower.includes('internet_disconnected')
    || lower.includes('err_internet')
    || lower.includes('err_network')
    || lower.includes('err_connection')
    || (error instanceof TypeError && lower.includes('fetch'))
  )
}

/**
 * True when a fetch/stream was intentionally cancelled (tab change, conversation
 * switch, superseded catalogue poll, computer-offline reconnect). Browsers often
 * surface this as DOMException AbortError with message
 * "signal is aborted without reason" — not a user-actionable failure.
 */
export function isAbortError(error: unknown): boolean {
  if (!error) return false
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') {
    return true
  }
  if (error instanceof Error && error.name === 'AbortError') return true
  const raw = error instanceof Error ? error.message : String(error)
  const lower = raw.toLowerCase()
  return (
    lower.includes('signal is aborted')
    || lower.includes('aborted without reason')
    || lower.includes('the operation was aborted')
    || lower.includes('the user aborted a request')
  )
}

/**
 * User-facing copy for browser-side network failures (not Hermes/agent bugs).
 * Chrome often reports TypeError "Failed to fetch" or net::ERR_INTERNET_DISCONNECTED.
 * Returns null for intentional aborts so callers can skip scary banners.
 */
export function formatClientNetworkError(
  error: unknown,
  fallback = 'Network request failed',
): string | null {
  if (isAbortError(error)) return null
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'Your browser is offline. Reconnect and refresh — the agent reply may already be saved.'
  }
  if (!isNetworkFetchFailure(error)) {
    const raw = error instanceof Error ? error.message : String(error || '')
    return raw || fallback
  }
  return 'Network dropped while talking to Partners in Biz. Check your connection and refresh — the agent may already have finished.'
}

export function formatCreateConversationNetworkError(phase: 'checking' | 'unconfirmed' = 'unconfirmed'): string {
  if (phase === 'checking') {
    return 'Network glitch — checking if the chat was created…'
  }
  return 'Network glitch while starting the chat. Refresh Messages — it may already exist.'
}

export function conversationTimestampMs(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000
  }
  if (typeof value === 'object') {
    const row = value as {
      seconds?: unknown
      _seconds?: unknown
      toMillis?: () => number
      toDate?: () => Date
    }
    if (typeof row.toMillis === 'function') {
      const ms = row.toMillis()
      return Number.isFinite(ms) ? ms : null
    }
    if (typeof row.toDate === 'function') {
      const date = row.toDate()
      const ms = date?.getTime?.()
      return typeof ms === 'number' && Number.isFinite(ms) ? ms : null
    }
    const seconds = typeof row.seconds === 'number'
      ? row.seconds
      : typeof row._seconds === 'number'
        ? row._seconds
        : null
    if (seconds != null && Number.isFinite(seconds)) return seconds * 1000
  }
  return null
}

function sameStringSet(left: string[] | undefined, right: string[] | undefined): boolean {
  const a = [...(left ?? [])].map((value) => value.trim()).filter(Boolean).sort()
  const b = [...(right ?? [])].map((value) => value.trim()).filter(Boolean).sort()
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

function optionalMatch(expected: string | null | undefined, actual: string | null | undefined): boolean {
  const want = expected?.trim()
  if (!want) return true
  return (actual?.trim() || '') === want
}

/**
 * Find a conversation that was likely created by a just-failed-on-client create
 * request. Prefers the newest candidate that matches scope/runtime/agents and
 * was created/updated inside the reconcile window.
 */
export function matchReconciledCreatedConversation(
  conversations: ReconcileConversationCandidate[],
  criteria: CreateConversationReconcileCriteria,
): ReconcileConversationCandidate | null {
  const nowMs = criteria.nowMs ?? Date.now()
  const windowMs = criteria.windowMs ?? CREATE_CONVERSATION_RECONCILE_WINDOW_MS
  const expectedTitle = criteria.title?.trim() || ''
  const expectedAgents = criteria.agentIds ?? []

  const matches = conversations.filter((conversation) => {
    if ((conversation.startedBy || '') !== criteria.startedBy) return false
    if ((conversation.scope || 'general') !== (criteria.scope || 'general')) return false
    if (!optionalMatch(criteria.scopeRefId, conversation.scopeRefId)) return false
    if (!optionalMatch(criteria.companyId, conversation.workspaceContext?.companyId ?? null)) return false
    if (!optionalMatch(criteria.projectId, conversation.workspaceContext?.projectId ?? conversation.scopeRefId)) return false
    if (!optionalMatch(criteria.workspaceId, conversation.workspaceContext?.workspaceId)) return false
    if (!optionalMatch(criteria.runtimeTarget, conversation.workspaceContext?.runtimeTarget)) return false
    if (!sameStringSet(expectedAgents, conversation.participantAgentIds)) return false
    if ((conversation.messageCount ?? 0) > 0) return false
    if (expectedTitle) {
      const title = (conversation.title || '').trim()
      if (title && title !== expectedTitle && title !== 'New conversation') return false
    }

    const createdMs = conversationTimestampMs(conversation.createdAt)
      ?? conversationTimestampMs(conversation.updatedAt)
      ?? conversationTimestampMs(conversation.lastMessageAt)
    // List APIs sometimes omit create timestamps; allow a match when the row is
    // otherwise exact and still empty (just-created).
    if (createdMs == null) return true
    return nowMs - createdMs <= windowMs && createdMs <= nowMs + 5_000
  })

  if (matches.length === 0) return null

  return matches.reduce((best, candidate) => {
    const bestMs = conversationTimestampMs(best.createdAt)
      ?? conversationTimestampMs(best.updatedAt)
      ?? conversationTimestampMs(best.lastMessageAt)
      ?? 0
    const candidateMs = conversationTimestampMs(candidate.createdAt)
      ?? conversationTimestampMs(candidate.updatedAt)
      ?? conversationTimestampMs(candidate.lastMessageAt)
      ?? 0
    return candidateMs >= bestMs ? candidate : best
  })
}

export function newConversationCreateIdempotencyKey(): string {
  const prefix = 'conversation-create'
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}:${globalThis.crypto.randomUUID()}`
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
    return `${prefix}:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`
}

/**
 * Run company Cowork ensure with a hard budget so conversation create can still
 * return quickly. Hard identity failures still reject; timeouts soft-succeed so
 * the first message path can finish provisioning.
 */
export async function ensureCompanyCoworkFolderWithinBudget<T extends { ok: boolean }>(
  ensure: () => Promise<T>,
  budgetMs: number = COMPANY_COWORK_ENSURE_BUDGET_MS,
): Promise<T | { ok: true; deferred: true; reason: 'company_ensure_timeout' }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      ensure(),
      new Promise<{ ok: true; deferred: true; reason: 'company_ensure_timeout' }>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: true, deferred: true, reason: 'company_ensure_timeout' }),
          budgetMs,
        )
      }),
    ])
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
}
