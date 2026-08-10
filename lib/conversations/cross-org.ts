import type { ApiUser } from '@/lib/api/types'
import { createCrossOrgPolicyService, type CrossOrgDecisionResult } from '@/lib/cross-org/policy-service'
import type {
  Conversation,
  ConversationMessage,
  CrossOrgConversationParticipant,
} from './types'

/**
 * Runtime adapter for normal Conversations that are deliberately shared by two
 * organisations. The Conversation remains owned by `conversation.orgId`; a
 * foreign organisation is never admitted by a legacy org-wide share mode.
 *
 * Cross-org access is always the intersection of: active named principal,
 * active two-org thread, and the canonical PartnerLink/scope/grant decision.
 * This makes a revoked link, grant, membership, or thread fail closed on the
 * next request without trusting a stale Conversation participant snapshot.
 */
export type CrossOrgConversationAction =
  | 'read'
  | 'reply'
  | 'manage'
  | 'attachment.read'
  | 'attachment.upload'
  | 'agent.append'

export interface CrossOrgConversationPolicy {
  decide(input: {
    actor: { userId: string; orgId: string; platformAdmin?: boolean }
    resourceType: 'conversation'
    resourceId: string
    action: CrossOrgConversationAction
    item?: string
    partnerLinkId: string
    requiredCapability: 'messages'
    recordDecision: false
  }): Promise<Pick<CrossOrgDecisionResult, 'allowed' | 'reasonCode' | 'chain'>>
}

export interface CrossOrgConversationAccessInput {
  conversation: Conversation
  user: ApiUser
  action: CrossOrgConversationAction
  item?: string
  policy?: CrossOrgConversationPolicy
}

export interface CrossOrgConversationAccessResult {
  allowed: boolean
  reason?:
    | 'NOT_CROSS_ORG'
    | 'THREAD_FROZEN'
    | 'EXPLICIT_PARTICIPANT_REQUIRED'
    | 'OWNER_MANAGEMENT_REQUIRED'
    | string
  principalId?: string
}

function activePrincipalForUser(
  participants: CrossOrgConversationParticipant[],
  user: ApiUser,
): CrossOrgConversationParticipant | null {
  if (!user.orgId) return null
  if (user.role === 'ai') {
    if (!user.agentId) return null
    return participants.find((participant) => (
      participant.kind === 'agent'
      && participant.agentId === user.agentId
      && participant.orgId === user.orgId
      && participant.status === 'active'
    )) ?? null
  }
  return participants.find((participant) => (
    participant.kind === 'user'
    && participant.uid === user.uid
    && participant.orgId === user.orgId
    && participant.status === 'active'
  )) ?? null
}

function principalPolicyUserId(principal: CrossOrgConversationParticipant): string | null {
  const userId = principal.kind === 'user' ? principal.uid : principal.memberUid
  return typeof userId === 'string' && userId.trim() ? userId : null
}

export function isCrossOrgConversation(conversation: Conversation): boolean {
  return Boolean(conversation.crossOrg)
}

/** Only the source-org named owner may change external principals/agents. */
export function canManageCrossOrgConversation(user: ApiUser, conversation: Conversation): boolean {
  const binding = conversation.crossOrg
  if (!binding || user.role === 'ai' || user.orgId !== binding.ownerOrgId) return false
  return binding.participants.some((participant) => (
    participant.kind === 'user'
    && participant.uid === user.uid
    && participant.orgId === binding.ownerOrgId
    && participant.role === 'owner'
    && participant.status === 'active'
  ))
}

export async function evaluateCrossOrgConversationAccess(
  input: CrossOrgConversationAccessInput,
): Promise<CrossOrgConversationAccessResult> {
  const binding = input.conversation.crossOrg
  if (!binding) return { allowed: false, reason: 'NOT_CROSS_ORG' }
  if (binding.status !== 'active') return { allowed: false, reason: 'THREAD_FROZEN' }

  const principal = activePrincipalForUser(binding.participants, input.user)
  if (!principal || !input.user.orgId || !binding.participantOrgIds.includes(input.user.orgId)) {
    return { allowed: false, reason: 'EXPLICIT_PARTICIPANT_REQUIRED' }
  }
  if (input.action === 'manage' && !canManageCrossOrgConversation(input.user, input.conversation)) {
    return { allowed: false, reason: 'OWNER_MANAGEMENT_REQUIRED', principalId: principal.principalId }
  }

  // Owners remain subject to their ordinary Conversation access checks. The
  // canonical cross-org grant guards only foreign-org reads/actions.
  if (input.user.orgId === binding.ownerOrgId) return { allowed: true, principalId: principal.principalId }

  const userId = principalPolicyUserId(principal)
  if (!userId) return { allowed: false, reason: 'EXPLICIT_PARTICIPANT_REQUIRED' }
  const policy = input.policy ?? createCrossOrgPolicyService()
  const decision = await policy.decide({
    actor: { userId, orgId: input.user.orgId, platformAdmin: input.user.role === 'admin' },
    resourceType: 'conversation',
    resourceId: input.conversation.id,
    action: input.action,
    ...(input.item ? { item: input.item } : {}),
    partnerLinkId: binding.partnerLinkId,
    requiredCapability: 'messages',
    // Polling/list reads must not create a high-volume audit event. Lifecycle
    // and mutable grant operations retain their append-only audit evidence.
    recordDecision: false,
  })
  return decision.allowed
    ? { allowed: true, principalId: principal.principalId }
    : { allowed: false, reason: decision.reasonCode, principalId: principal.principalId }
}

/** Per-message and attachment visibility is a subset of active principals. */
export async function canReadCrossOrgConversationMessage(input: {
  conversation: Conversation
  message: ConversationMessage
  user: ApiUser
  policy?: CrossOrgConversationPolicy
}): Promise<boolean> {
  const decision = await evaluateCrossOrgConversationAccess({
    conversation: input.conversation,
    user: input.user,
    action: 'read',
    item: input.message.id,
    policy: input.policy,
  })
  if (!decision.allowed || !decision.principalId) return false
  const visibleTo = input.message.visibility?.principalIds
  return !visibleTo || visibleTo.includes(decision.principalId)
}

/** A revocation executor increments this epoch to fence cached context/runs. */
export function crossOrgConversationAccessEpoch(conversation: Conversation): number | null {
  return conversation.crossOrg?.accessEpoch ?? null
}

function assertManageableBinding(conversation: Conversation) {
  const binding = conversation.crossOrg
  if (!binding) throw new Error('Conversation is not a cross-organisation thread')
  if (binding.status !== 'active') throw new Error('Cross-organisation thread is not active')
  return binding
}

/** Add or restore an explicit principal and fence cached context immediately. */
export function addCrossOrgConversationParticipant(input: {
  conversation: Conversation
  actor: ApiUser
  participant: CrossOrgConversationParticipant
  now?: unknown
}): Conversation {
  if (!canManageCrossOrgConversation(input.actor, input.conversation)) {
    throw new Error('Only the source-org owner may manage cross-organisation participants')
  }
  const binding = assertManageableBinding(input.conversation)
  if (!binding.participantOrgIds.includes(input.participant.orgId)) {
    throw new Error('Participant organisation is outside this bilateral thread')
  }
  const nextParticipants = binding.participants.filter((participant) => participant.principalId !== input.participant.principalId)
  nextParticipants.push({
    ...input.participant,
    status: 'active',
    addedByUid: input.actor.uid,
    ...(input.now !== undefined ? { addedAt: input.now as never } : {}),
  })
  return {
    ...input.conversation,
    crossOrg: {
      ...binding,
      accessEpoch: binding.accessEpoch + 1,
      participants: nextParticipants,
    },
  }
}

/** Remove a principal immediately and fence cached context/runs. */
export function removeCrossOrgConversationParticipant(input: {
  conversation: Conversation
  actor: ApiUser
  principalId: string
  now?: unknown
}): Conversation {
  if (!canManageCrossOrgConversation(input.actor, input.conversation)) {
    throw new Error('Only the source-org owner may manage cross-organisation participants')
  }
  const binding = assertManageableBinding(input.conversation)
  const index = binding.participants.findIndex((participant) => participant.principalId === input.principalId)
  if (index < 0) throw new Error('Cross-organisation participant not found')
  const existing = binding.participants[index]
  if (existing.role === 'owner') throw new Error('Source-org owner cannot be removed from the bilateral thread')
  const nextParticipants = [...binding.participants]
  nextParticipants[index] = {
    ...existing,
    status: 'removed',
    removedByUid: input.actor.uid,
    ...(input.now !== undefined ? { removedAt: input.now as never } : {}),
  }
  return {
    ...input.conversation,
    crossOrg: {
      ...binding,
      accessEpoch: binding.accessEpoch + 1,
      participants: nextParticipants,
    },
  }
}

/** Freeze or revoke the thread immediately; foreign access fails closed on the next request. */
export function setCrossOrgConversationStatus(input: {
  conversation: Conversation
  actor: ApiUser
  status: 'active' | 'frozen' | 'revoked'
}): Conversation {
  if (!canManageCrossOrgConversation(input.actor, input.conversation)) {
    throw new Error('Only the source-org owner may change cross-organisation thread status')
  }
  const binding = assertManageableBinding(input.conversation)
  if (binding.status === input.status) return input.conversation
  return {
    ...input.conversation,
    crossOrg: {
      ...binding,
      status: input.status,
      accessEpoch: binding.accessEpoch + 1,
    },
  }
}
