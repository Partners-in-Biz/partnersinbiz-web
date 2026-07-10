import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import type { Conversation } from './types'

/**
 * Conversation access semantics:
 * - platform administrators retain operational access only inside their org scope;
 * - AI callers must be an explicit agent participant;
 * - participants can access private/shared conversations;
 * - org-visible Workspace conversations are available to any caller whose
 *   authenticated org scope includes the conversation org.
 */
export function canAccessConversation(user: ApiUser, conversation: Conversation): boolean {
  if (user.role === 'ai') {
    if (!user.orgId || user.orgId !== conversation.orgId) return false
    const agentId = user.agentId ?? user.uid
    return conversation.participantAgentIds.includes(agentId as Conversation['participantAgentIds'][number])
  }
  if (!canAccessOrg(user, conversation.orgId)) return false
  if (user.role === 'admin') return true
  if (conversation.participantUids.includes(user.uid)) return true
  if (conversation.workspaceContext?.shareMode !== 'org') return false
  return true
}

/** Remove server filesystem locations before returning a conversation to browser/API callers. */
export function publicConversationView(conversation: Conversation): Conversation {
  const participants = conversation.participants.map((participant) => {
    if (participant.kind !== 'user') return participant
    const { email: _email, ...publicParticipant } = participant
    return publicParticipant
  }) as Conversation['participants']
  if (!conversation.workspaceContext) return { ...conversation, participants }
  const {
    vpsPath: _vpsPath,
    localPath: _localPath,
    agentDomainPath: _agentDomainPath,
    localAgentDomainPath: _localAgentDomainPath,
    ...workspaceContext
  } = conversation.workspaceContext
  return { ...conversation, participants, workspaceContext: workspaceContext as Conversation['workspaceContext'] }
}

/** Access-management is narrower than read access: owner or scoped admin only. */
export function canManageConversationAccess(user: ApiUser, conversation: Conversation): boolean {
  if (user.role === 'ai' || !canAccessOrg(user, conversation.orgId)) return false
  if (user.role === 'admin') return true
  const ownerUid = conversation.workspaceContext?.ownerUserId ?? conversation.startedBy
  return user.uid === ownerUid
}

/** Mutation access excludes organisation-wide readers who are not explicit participants. */
export function canReplyConversation(user: ApiUser, conversation: Conversation): boolean {
  if (!canAccessConversation(user, conversation)) return false
  if (user.role === 'admin' || user.role === 'ai') return true
  return conversation.participantUids.includes(user.uid)
}

/** Persistent prompt context is controlled by the canonical owner or scoped administrators. */
export function canManageConversationContext(user: ApiUser, conversation: Conversation): boolean {
  return canManageConversationAccess(user, conversation)
}

export function conversationVisibilityLabel(conversation: Conversation): string {
  const shareMode = conversation.workspaceContext?.shareMode
  if (shareMode === 'org') return 'Organisation'
  if (shareMode === 'shared') return 'Shared'
  return 'Private'
}
