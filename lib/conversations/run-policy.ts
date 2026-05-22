export const CONVERSATION_RUN_DISPATCH_GRACE_MS = 2 * 60 * 1000
export const CONVERSATION_RUN_STALE_TIMEOUT_MS = 90 * 60 * 1000
export const CONVERSATION_RUN_LOOKUP_GRACE_MS = 30 * 1000

export const CONVERSATION_RUN_STALE_ERROR =
  'Agent run timed out after 90 minutes. Please send the message again or requeue the work.'

export const CONVERSATION_RUN_LOST_ERROR =
  'The agent gateway lost this run after restarting. Please send the message again or requeue the work.'
