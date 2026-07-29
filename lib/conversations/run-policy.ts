export const CONVERSATION_RUN_DISPATCH_GRACE_MS = 2 * 60 * 1000
export const CONVERSATION_RUN_STALE_TIMEOUT_MS = 90 * 60 * 1000
export const CONVERSATION_RUN_LOOKUP_GRACE_MS = 30 * 1000

export const CONVERSATION_RUN_STALE_ERROR =
  'Agent run timed out after 90 minutes. Please send the message again or requeue the work.'

export const CONVERSATION_RUN_LOST_ERROR =
  'The agent gateway lost this run after restarting. Please send the message again or requeue the work.'

/** Classic agent-browser / CDP failure text that is often a red herring mid-run kill. */
export const CONVERSATION_BROWSER_CONNECT_ERROR =
  'Unable to connect. Is the computer able to access the url?'

export const CONVERSATION_BROWSER_CONNECT_USER_ERROR =
  'This run was interrupted (gateway restart or browser tool failure). Send the message again. Prefer platform API / CRM tools over browser navigation on the VPS.'

/**
 * Map raw Hermes/tool failure strings into stable, user-safe Messages errors.
 * Never invent secrets; only rewrite known operational failure shapes.
 */
export function humanizeConversationRunError(raw: string | null | undefined): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) {
    return 'The agent run failed. Please send the message again.'
  }
  const lower = text.toLowerCase()
  // agent-browser / CDP — often a red herring when the gateway was SIGTERM'd mid-run
  if (
    lower.includes('unable to connect')
    || (lower.includes('is the computer able to access') && lower.includes('url'))
  ) {
    return CONVERSATION_BROWSER_CONNECT_USER_ERROR
  }
  // Mid-run gateway kill (OAuth restart, skill sync, etc.)
  if (
    lower.includes('connection reset')
    || lower.includes('connection refused')
    || lower.includes('broken pipe')
    || lower.includes('server disconnected')
    || lower.includes('client connector error')
    || lower.includes('gateway lost this run')
    || lower.includes('signal=sigterm')
    || lower.includes('sigterm')
    || lower.includes('exit_code": -15')
    || lower.includes('exit_code":-15')
    || lower.includes('exit code -15')
    || lower.includes('exit_code_meaning')
    || (lower.includes('shutdown context') && lower.includes('sigterm'))
  ) {
    return CONVERSATION_RUN_LOST_ERROR
  }
  // Cap length so tool dumps never fill the chat bubble.
  if (text.length > 500) return `${text.slice(0, 500).trim()}…`
  return text
}
