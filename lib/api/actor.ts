import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from './types'

export type ActorType = 'user' | 'agent' | 'system'

export interface ActorInfo {
  createdBy: string
  createdByType: ActorType
  /**
   * Present only when a human delegated this action to an agent. The human
   * remains the owner; this is the durable audit link to the acting agent.
   */
  createdByAgentId?: string
}

/**
 * Returns creation-time actor fields for a Firestore write.
 *
 * `createdByType` is `agent` when the authenticated user has role `ai`,
 * otherwise `user`. `system` is reserved for platform writes made without
 * an authenticated user (e.g. cron jobs, internal migrations).
 */
export function actorFrom(user: ApiUser): ActorInfo {
  return {
    createdBy: user.uid,
    createdByType: user.role === 'ai' ? 'agent' : 'user',
    ...(user.authKind === 'user_delegation' && user.agentId
      ? { createdByAgentId: user.agentId }
      : {}),
  }
}

/**
 * Returns update-time actor fields (plus a server timestamp) for a
 * Firestore update. Pair with `actorFrom` on creates.
 */
export function lastActorFrom(user: ApiUser): {
  updatedBy: string
  updatedByType: ActorType
  updatedAt: FieldValue
  updatedByAgentId?: string
} {
  return {
    updatedBy: user.uid,
    updatedByType: user.role === 'ai' ? 'agent' : 'user',
    updatedAt: FieldValue.serverTimestamp(),
    ...(user.authKind === 'user_delegation' && user.agentId
      ? { updatedByAgentId: user.agentId }
      : {}),
  }
}

/**
 * Adds agent audit attribution to records whose primary owner is a member.
 * Delegation deliberately never changes `createdBy` or `createdByRef`.
 */
export function delegatedAgentAttribution(
  user: Pick<ApiUser, 'authKind' | 'agentId'> | null | undefined,
): { createdByAgentId?: string } {
  return user?.authKind === 'user_delegation' && user.agentId
    ? { createdByAgentId: user.agentId }
    : {}
}
