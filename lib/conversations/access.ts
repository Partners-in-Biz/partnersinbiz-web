import { resolveOrgScope } from '@/lib/api/orgScope'
import type { ApiUser } from '@/lib/api/types'
import type { Conversation } from './types'

/**
 * Conversation access semantics:
 * - platform admin/AI callers retain operational access;
 * - participants can access private/shared conversations;
 * - org-visible Workspace conversations are available to any caller whose
 *   authenticated org scope includes the conversation org.
 */
export function canAccessConversation(user: ApiUser, conversation: Conversation): boolean {
  if (user.role === 'admin' || user.role === 'ai') return true
  if (conversation.participantUids.includes(user.uid)) return true
  if (conversation.workspaceContext?.shareMode !== 'org') return false
  return resolveOrgScope(user, conversation.orgId).ok
}

export function conversationVisibilityLabel(conversation: Conversation): string {
  const shareMode = conversation.workspaceContext?.shareMode
  if (shareMode === 'org') return 'Organisation'
  if (shareMode === 'shared') return 'Shared'
  return 'Private'
}
