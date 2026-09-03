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
  'The agent hit a temporary computer/gateway interruption. Partners in Biz is retrying automatically — leave this chat open.'

function conversationRunErrorText(raw: string | null | undefined): string {
  return typeof raw === 'string' ? raw.trim() : ''
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
}

/**
 * True when a linked-run failure must not become a permanent chat failure.
 * The runtime reattaches/reclaims; the web requeues as a safety net.
 */
export function isRecoverableConversationRunError(raw: string | null | undefined): boolean {
  return isConversationBrowserToolFailure(raw) || isConversationInfrastructureInterrupt(raw)
}

/**
 * Map raw Hermes/tool failure strings into stable, user-safe Messages errors.
 * Never invent secrets; only rewrite known operational failure shapes.
 */
export function humanizeConversationRunError(raw: string | null | undefined): string {
  const text = conversationRunErrorText(raw)
  if (!text) {
    return 'The agent run failed. Please send the message again.'
  }
  if (/\breal_profile_guard\b/.test(text)) {
    console.error('PIB_REAL_PROFILE_GUARD', text)
    return "This computer's owner has enabled browsing as themselves; your chat cannot run there."
  }
  if (isConversationBrowserToolFailure(text) || isConversationInfrastructureInterrupt(text)) {
    // Prefer recovery copy when something still surfaces; auto-requeue is the primary path.
    return CONVERSATION_RUN_RECOVERING_USER_ERROR
  }
  // Cap length so tool dumps never fill the chat bubble.
  if (text.length > 500) return `${text.slice(0, 500).trim()}…`
  return text
}
