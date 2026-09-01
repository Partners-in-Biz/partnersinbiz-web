import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { getProjectForUser } from '@/lib/projects/access'
import { selectActiveProjectId } from '@/lib/projects/chatProgress'
import { projectLinkedToOrganization } from '@/lib/projects/organization-link'
import type { Conversation, ConversationAttachment, ConversationMessage } from './types'
import { canManageCrossOrgConversation } from './cross-org'

type ProjectConversationAuthorization =
  | { ok: true; projectId: string | null }
  | { ok: false; status: number; error: string }

type ProjectConversationAuthorizationOptions = {
  getProjectForUser?: typeof getProjectForUser
  projectLinkedToOrganization?: typeof projectLinkedToOrganization
}

export function conversationProjectId(conversation: Conversation): string | null {
  const value = conversation.workspaceContext?.projectId
    ?? selectActiveProjectId(conversation)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Revalidates the mutable project/org relationship behind a durable thread. */
export async function authorizeConversationProject(
  user: ApiUser,
  conversation: Conversation,
  options: ProjectConversationAuthorizationOptions = {},
): Promise<ProjectConversationAuthorization> {
  const projectId = conversationProjectId(conversation)
  if (!projectId) return { ok: true, projectId: null }
  const getProject = options.getProjectForUser ?? getProjectForUser
  const linkedCheck = options.projectLinkedToOrganization ?? projectLinkedToOrganization

  let projectAccess = await getProject(projectId, user, conversation.orgId)
  // PiB staff named on a client thread often lack client-org membership, while
  // the project holder lives on pib-platform-owner. Retry without the client
  // org scope, then still require the project to be linked to this conversation org.
  if (!projectAccess.ok && isPlatformStaffScopedUser(user)) {
    projectAccess = await getProject(projectId, user, PIB_PLATFORM_ORG_ID)
    if (!projectAccess.ok) {
      projectAccess = await getProject(projectId, user)
    }
  }
  if (!projectAccess.ok) return { ok: false, status: projectAccess.status, error: projectAccess.error }
  const linked = await linkedCheck({
    projectId,
    project: projectAccess.doc.data() ?? {},
    orgId: conversation.orgId,
  })
  if (!linked) return { ok: false, status: 403, error: 'Project is outside this organisation' }
  return { ok: true, projectId }
}

function isPlatformStaffScopedUser(user: ApiUser): boolean {
  return user.activeOrgId === PIB_PLATFORM_ORG_ID
    || user.orgId === PIB_PLATFORM_ORG_ID
    || (user.orgIds ?? []).includes(PIB_PLATFORM_ORG_ID)
}

/**
 * Conversation access semantics:
 * - human callers, including administrators, need explicit participation for
 *   private/shared conversations;
 * - AI callers must be an explicit agent participant;
 * - participants can access private/shared conversations;
 * - org-visible Workspace conversations are available to any caller whose
 *   authenticated org scope includes the conversation org.
 * - PiB staff named on a client-company thread may stay in that chat without
 *   joining the client org as a member.
 */
export function canAccessConversation(user: ApiUser, conversation: Conversation): boolean {
  if (user.role === 'ai') {
    if (!user.orgId || user.orgId !== conversation.orgId) return false
    const agentId = user.agentId ?? user.uid
    return (conversation.participantAgentIds ?? []).includes(agentId as Conversation['participantAgentIds'][number])
  }
  const namedParticipant = (conversation.participantUids ?? []).includes(user.uid)
  if (canAccessOrg(user, conversation.orgId)) {
    if (namedParticipant) return true
    if (conversation.workspaceContext?.shareMode !== 'org') return false
    return true
  }
  return namedParticipant && isPlatformStaffScopedUser(user)
}

/** Remove server-only fields and expose only the caller's own read state. */
export function publicConversationView(conversation: Conversation, userUid?: string): Conversation {
  const participants = (conversation.participants ?? []).map((participant) => {
    if (participant.kind !== 'user') return participant
    const publicParticipant = { ...participant }
    delete publicParticipant.email
    return publicParticipant
  }) as Conversation['participants']
  const publicConversation = { ...conversation, participants }
  delete publicConversation.unreadCounts
  delete publicConversation.readStateByUser
  delete publicConversation.unreadCount
  delete publicConversation.lastReadMessageId
  delete publicConversation.lastReadMessageCount
  delete publicConversation.lastReadAt
  if (userUid) {
    const shareMode = conversation.workspaceContext?.shareMode
    const readKey = conversation.crossOrg
      ? (conversation.crossOrg.participants.find((participant) => (
        participant.kind === 'user'
        && participant.uid === userUid
        && participant.status === 'active'
      ))?.principalId ?? userUid)
      : userUid
    const readState = conversation.readStateByUser?.[readKey] ?? conversation.readStateByUser?.[userUid]
    const explicitUnreadCount = conversation.unreadCounts?.[readKey] ?? conversation.unreadCounts?.[userUid]
    const persistedReadMessageCount = typeof readState?.lastReadMessageCount === 'number'
      ? readState.lastReadMessageCount
      : Number.NaN
    const baseReadMessageCount = Number.isFinite(persistedReadMessageCount)
      ? Math.max(0, Math.floor(persistedReadMessageCount ?? 0))
      : 0
    const derivedUnreadCount = Number.isFinite(readState?.lastReadMessageCount)
      ? Math.max(0, (conversation.messageCount ?? 0) - baseReadMessageCount)
      : shareMode === 'org'
        ? Math.max(0, Math.floor(conversation.messageCount ?? 0))
        : 0
    const computedUnreadCount = Number.isFinite(explicitUnreadCount)
      ? Math.max(0, Math.floor(explicitUnreadCount ?? 0))
      : derivedUnreadCount
    if (Number.isFinite(computedUnreadCount)) {
      publicConversation.unreadCount = computedUnreadCount
    }
    if (readState?.lastReadMessageId) publicConversation.lastReadMessageId = readState.lastReadMessageId
    if (Number.isFinite(readState?.lastReadMessageCount)) {
      publicConversation.lastReadMessageCount = Math.max(0, Math.floor(readState?.lastReadMessageCount ?? 0))
    }
    if (readState?.lastReadAt) publicConversation.lastReadAt = readState.lastReadAt
  }
  if (!conversation.workspaceContext) return publicConversation
  const workspaceContext: Partial<Conversation['workspaceContext']> = { ...conversation.workspaceContext }
  delete workspaceContext.vpsPath
  delete workspaceContext.localPath
  delete workspaceContext.vpsWorkingPath
  delete workspaceContext.localWorkingPath
  delete workspaceContext.agentDomainPath
  delete workspaceContext.localAgentDomainPath
  return { ...publicConversation, workspaceContext: workspaceContext as Conversation['workspaceContext'] }
}

/** Replace persisted storage URLs/paths with the authenticated application download route. */
export function publicConversationAttachmentView(
  attachment: ConversationAttachment,
  conversationId: string,
): ConversationAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    url: `/api/v1/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachment.id)}`,
  }
}

/** Browser-safe message serializer used by both create and list responses. */
export function publicConversationMessageView(message: ConversationMessage): ConversationMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    ...(message.mentions ? { mentions: message.mentions } : {}),
    ...(message.mentionIds ? { mentionIds: message.mentionIds } : {}),
    ...(message.attachments
      ? { attachments: message.attachments.map((attachment) => publicConversationAttachmentView(attachment, message.conversationId)) }
      : {}),
    ...(message.contextRefs ? { contextRefs: message.contextRefs } : {}),
    ...(message.slashCommand ? { slashCommand: message.slashCommand } : {}),
    ...(message.agentEffort !== undefined ? { agentEffort: message.agentEffort } : {}),
    ...(message.model ? { model: message.model } : {}),
    ...(message.provider ? { provider: message.provider } : {}),
    ...(message.runId ? { runId: message.runId } : {}),
    ...(message.status ? { status: message.status } : {}),
    ...(message.error ? { error: message.error } : {}),
    ...(message.thinking ? { thinking: message.thinking } : {}),
    ...(message.richParts ? { richParts: message.richParts } : {}),
    ...(message.rich_parts ? { rich_parts: message.rich_parts } : {}),
    // Email/invoice/document canvas buttons — must reach the browser. Dropping
    // these made "Review email draft" invisible even when Firestore had them.
    ...((() => {
      const actions = Array.isArray(message.uiActions) && message.uiActions.length > 0
        ? message.uiActions
        : Array.isArray(message.ui_actions) && message.ui_actions.length > 0
          ? message.ui_actions
          : null
      return actions ? { uiActions: actions, ui_actions: actions } : {}
    })()),
    ...(message.projectCommandEvent ? { projectCommandEvent: message.projectCommandEvent } : {}),
    authorKind: message.authorKind,
    authorId: message.authorId,
    authorDisplayName: message.authorDisplayName,
    ...(message.dispatchAgentId ? { dispatchAgentId: message.dispatchAgentId } : {}),
    ...(message.createdAt ? { createdAt: message.createdAt } : {}),
  }
}

/** Access-management is narrower than read access: owner or scoped admin only. */
export function canManageConversationAccess(user: ApiUser, conversation: Conversation): boolean {
  if (conversation.crossOrg) return canManageCrossOrgConversation(user, conversation)
  if (user.role === 'ai' || !canAccessOrg(user, conversation.orgId)) return false
  if (user.role === 'admin') return true
  const ownerUid = conversation.workspaceContext?.ownerUserId ?? conversation.startedBy
  return user.uid === ownerUid
}

/** Organisation sessions are collaborative: every scoped org member may reply. */
export function canReplyConversation(user: ApiUser, conversation: Conversation): boolean {
  if (!canAccessConversation(user, conversation)) return false
  if (user.role === 'ai') return true // AI read access already requires explicit agent participation.
  if (conversation.workspaceContext?.shareMode === 'org') return true
  return (conversation.participantUids ?? []).includes(user.uid)
}

/** Permanent deletion is reserved for the canonical owner or a scoped administrator. */
export function canDeleteConversation(user: ApiUser, conversation: Conversation): boolean {
  return canManageConversationAccess(user, conversation)
}

/** A participant may stop work in their conversation; scoped administrators retain the kill switch. */
export function canStopConversationRun(user: ApiUser, conversation: Conversation): boolean {
  if (user.role === 'admin') return canAccessOrg(user, conversation.orgId)
  return canReplyConversation(user, conversation)
}

/** Completed agent output may be appended by a scoped administrator or an explicit AI participant. */
export function canAppendAgentMessage(user: ApiUser, conversation: Conversation): boolean {
  if (user.role === 'admin') return canAccessOrg(user, conversation.orgId)
  if (user.role !== 'ai') return false
  return canAccessConversation(user, conversation)
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
