export const CONVERSATION_RUN_DISPATCH_GRACE_MS = 2 * 60 * 1000
export const CONVERSATION_RUN_STALE_TIMEOUT_MS = 90 * 60 * 1000
export const CONVERSATION_RUN_LOOKUP_GRACE_MS = 30 * 1000

/** How many automatic recoveries the platform will attempt before surfacing a failure. */
export const CONVERSATION_RUN_MAX_AUTO_RECOVERIES = 2

export const CONVERSATION_RUN_STALE_ERROR =
  'Agent run timed out after 90 minutes. Please send the message again or requeue the work.'

export const CONVERSATION_RUN_LOST_ERROR =
  'The agent gateway lost this run after restarting. Please send the message again or requeue the work.'

/** Classic agent-browser / CDP failure text that is often a red herring mid-run kill. */
export const CONVERSATION_BROWSER_CONNECT_ERROR =
  'Unable to connect. Is the computer able to access the url?'

/**
 * Legacy copy kept for tests/history. Live recoveries no longer surface this as a
 * terminal chat failure — the platform requeues automatically instead.
 */
export const CONVERSATION_BROWSER_CONNECT_USER_ERROR =
  'This run was interrupted (gateway restart or browser tool failure). Send the message again. Prefer platform API / CRM tools over browser navigation on the VPS.'

export const CONVERSATION_RUN_RECOVERING_USER_ERROR =
  'The computer dropped this run. Send the message again.'

/** Legacy essay that used to appear as a failed bubble while polling/requeue ran. */
export const CONVERSATION_RUN_RECOVERING_LEGACY_USER_ERROR =
  'The agent hit a temporary computer/gateway interruption. Partners in Biz is retrying automatically — leave this chat open.'

export const CONVERSATION_STREAM_FALLBACK_ACTIVITY = 'Still working'

/**
 * Selected computer / Local Hermes unreachable (Mac or linked computer offline,
 * tunnel returning 502 on `local-profiles/<agent>`). Not a transient run recovery:
 * there is no reachable host to requeue on, so say so instead of "retrying".
 */
export const CONVERSATION_LOCAL_HERMES_OFFLINE_USER_ERROR =
  'Selected computer offline — Local Hermes unreachable. Send the message again once it reconnects.'

export function localHermesOfflineUserError(runtimeLabel?: string | null): string {
  const label = typeof runtimeLabel === 'string' ? runtimeLabel.trim() : ''
  if (!label) return CONVERSATION_LOCAL_HERMES_OFFLINE_USER_ERROR
  return `${label} offline — Local Hermes unreachable. Send the message again once it reconnects.`
}

/** Client-side finalize polling gave up: the run never answered within the poll budget. */
export const CONVERSATION_CLIENT_FINALIZE_EXHAUSTED_ERROR =
  'Run timed out - the agent may still be working. Refresh to check.'

export interface ConversationRunErrorContext {
  /** Machine label at dispatch time, e.g. "Peet's Mac" or "peets-mac-mini". */
  runtimeLabel?: string | null
  /** Resolved runtime kind at dispatch time (local / vps / remote / legacy / linked-computer). */
  runtimeKind?: string | null
  /** workspaceDispatchFailureCode ?? runtimeDispatchFailureCode stored with the failed message. */
  failureCode?: string | null
}

function conversationRunErrorText(raw: string | null | undefined): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/** Runtime kinds that live on a customer/operator machine rather than the Partners VPS. */
export function isLocalConversationRuntimeKind(kind: string | null | undefined): boolean {
  const lower = typeof kind === 'string' ? kind.trim().toLowerCase() : ''
  return lower === 'local' || lower === 'linked-computer'
}

/**
 * Dispatch/selection failure codes that, on a local runtime, mean the host itself
 * is unreachable: the sanitized 5xx/network dispatch failure and the stale /
 * unhealthy / missing / disabled runtime-target selections.
 */
const LOCAL_HERMES_OFFLINE_FAILURE_CODES = new Set([
  'dispatch_unavailable',
  'runtime_target_stale',
  'runtime_target_unhealthy',
  'runtime_target_not_found',
  'runtime_target_disabled',
])

/**
 * Selected-computer-offline class. Classified by runtime kind + stored failure
 * code, never by free text: dispatch failures are sanitized to fixed strings, and
 * agent prose that merely mentions "local-profiles" or "computer unavailable" must
 * not trigger this. VPS runtimes are never labelled Local Hermes offline.
 */
export function isLocalHermesUnreachableError(
  raw: string | null | undefined,
  context: ConversationRunErrorContext = {},
): boolean {
  if (!isLocalConversationRuntimeKind(context.runtimeKind)) return false
  const code = typeof context.failureCode === 'string' ? context.failureCode.trim() : ''
  if (code && LOCAL_HERMES_OFFLINE_FAILURE_CODES.has(code)) return true
  return conversationRunErrorText(raw) === CONVERSATION_CLIENT_FINALIZE_EXHAUSTED_ERROR
}

/** Browser/CDP tool death that Hermes often elevates to whole-run failure. */
export function isConversationBrowserToolFailure(raw: string | null | undefined): boolean {
  const lower = conversationRunErrorText(raw).toLowerCase()
  if (!lower) return false
  return lower.includes('unable to connect')
    || (lower.includes('is the computer able to access') && lower.includes('url'))
}

/** Infrastructure blips: runtime upgrade, gateway drain/restart, process SIGTERM. */
export function isConversationInfrastructureInterrupt(raw: string | null | undefined): boolean {
  const lower = conversationRunErrorText(raw).toLowerCase()
  if (!lower) return false
  return lower.includes('connection reset')
    || lower.includes('connection refused')
    || lower.includes('broken pipe')
    || lower.includes('server disconnected')
    || lower.includes('client connector error')
    || lower.includes('gateway lost this run')
    || lower.includes('gateway_draining')
    || lower.includes('draining existing work')
    || lower.includes('runtime restarting')
    || lower.includes('reattachment retry window')
    || lower.includes('signal=sigterm')
    || lower.includes('sigterm')
    || lower.includes('exit_code": -15')
    || lower.includes('exit_code":-15')
    || lower.includes('exit code -15')
    || lower.includes('exit_code_meaning')
    || lower.includes('econnreset')
    || lower.includes('econnrefused')
    || lower.includes('socket hang up')
    || lower.includes('fetch failed')
    || lower.includes('networkerror')
    || (lower.includes('shutdown context') && lower.includes('sigterm'))
    || lower.includes('rate limit')
    || lower.includes('ratelimit')
    || lower.includes('too many requests')
    || lower.includes('resource_exhausted')
    || lower.includes('resource exhausted')
    || lower.includes('overloaded')
    || lower.includes('computational limit')
    || /\b429\b/.test(lower)
}

/**
 * True when a linked-run failure must not become a permanent chat failure.
 * The runtime reattaches/reclaims; the web requeues as a safety net. Only runs a
 * reachable device reported qualify; an offline computer never reaches this path.
 */
export function isRecoverableConversationRunError(raw: string | null | undefined): boolean {
  return isConversationBrowserToolFailure(raw) || isConversationInfrastructureInterrupt(raw)
}

/**
 * Map raw Hermes/tool failure strings into stable, user-safe Messages errors.
 * Never invent secrets; only rewrite known operational failure shapes.
 */
export function humanizeConversationRunError(
  raw: string | null | undefined,
  context: ConversationRunErrorContext = {},
): string {
  const text = conversationRunErrorText(raw)
  if (!text) {
    return 'The agent run failed. Please send the message again.'
  }
  if (/\breal_profile_guard\b/.test(text)) {
    console.error('PIB_REAL_PROFILE_GUARD', text)
    return "This computer's owner has enabled browsing as themselves; your chat cannot run there."
  }
  if (/\borg_mismatch\b/.test(text)) {
    return 'This agent profile belongs to a different organisation on that computer. Re-pair the computer.'
  }
  if (/\bgrant_not_active\b/.test(text) || /device grant not active/i.test(text)) {
    return "The organisation's access to this computer is paused."
  }
  if (/\b(?:linked_device_)?hermes_update_required\b/.test(text)) {
    return 'Hermes on this computer is too old. It will update automatically when idle.'
  }
  if (/\bhermes_update_failed\b/.test(text)) {
    return 'Hermes could not update on this computer. It keeps working on the previous version; see the runbook.'
  }
  if (isLocalHermesUnreachableError(text, context)) {
    return localHermesOfflineUserError(context.runtimeLabel)
  }
  if (
    text === CONVERSATION_RUN_RECOVERING_LEGACY_USER_ERROR
    || text.toLowerCase().includes('retrying automatically')
    || text.toLowerCase().includes('leave this chat open')
    || text.toLowerCase().includes('live event stream unavailable')
  ) {
    return CONVERSATION_RUN_RECOVERING_USER_ERROR
  }
  if (isConversationBrowserToolFailure(text) || isConversationInfrastructureInterrupt(text)) {
    return CONVERSATION_RUN_RECOVERING_USER_ERROR
  }
  // Cap length so tool dumps never fill the chat bubble.
  if (text.length > 500) return `${text.slice(0, 500).trim()}…`
  return text
}
