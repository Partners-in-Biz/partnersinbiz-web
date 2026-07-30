import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from './types'

export type ActorType = 'user' | 'agent' | 'system'

export interface ActorInfo {
  /** Primary owner / creator identity. Always the human for user-delegation. */
  createdBy: string
  createdByType: ActorType
  /**
   * Agent that performed the write when an agent acted for a human (user-delegation)
   * or when a pure agent API key performed the write (`pip`, `theo`, …).
   * Never use this field as the ownership / ACL principal.
   */
  createdByAgentId?: string
}

export interface LastActorInfo {
  updatedBy: string
  updatedByType: ActorType
  updatedAt: FieldValue
  updatedByAgentId?: string
}

/** Loose user shape used by CRM auth context (role optional). */
export type ActorUserLike = {
  uid?: string
  role?: string
  authKind?: ApiUser['authKind'] | string
  agentId?: string
  actingForUserId?: string
}

function cleanAgentId(user: ActorUserLike): string | undefined {
  const explicit = typeof user.agentId === 'string' ? user.agentId.trim() : ''
  if (explicit) return explicit
  // Pure agent API keys use uid `agent:pip` (etc).
  if (
    (user.role === 'ai' || user.authKind === 'agent_api_key' || user.authKind === 'legacy_ai_key')
    && typeof user.uid === 'string'
    && user.uid.startsWith('agent:')
  ) {
    const id = user.uid.slice('agent:'.length).trim()
    return id || undefined
  }
  return undefined
}

/** True when the caller is a pure agent/system key (no human owner). */
export function isPureAgentCaller(user: ActorUserLike | null | undefined): boolean {
  if (!user) return false
  return user.role === 'ai'
    || user.authKind === 'agent_api_key'
    || user.authKind === 'legacy_ai_key'
}

/** True when an agent is acting (delegated or pure). */
export function isAgentAssisted(user: ActorUserLike | null | undefined): boolean {
  if (!user) return false
  if (user.authKind === 'user_delegation' && user.agentId) return true
  return isPureAgentCaller(user)
}

/**
 * Human owner uid for ACL / createdBy when a user asked an agent to act.
 * Falls back to the raw uid for pure agent or direct human session.
 */
export function ownerUidFrom(user: ActorUserLike): string {
  if (user.authKind === 'user_delegation') {
    return (user.actingForUserId || user.uid || '').trim()
  }
  return (user.uid || '').trim()
}

/**
 * Returns creation-time actor fields for a Firestore write.
 *
 * Contract:
 * - **Owner (`createdBy`)** = the human who asked, for user-delegation and direct sessions.
 * - **Agent (`createdByAgentId`)** = which agent performed the action (when any).
 * - Pure agent API keys / legacy AI keys own as `createdByType: 'agent'` (cron/system only).
 * - `system` is reserved for platform writes without an authenticated user.
 */
export function actorFrom(user: ApiUser): ActorInfo {
  const agentId = cleanAgentId(user)
  const ownerUid = ownerUidFrom(user)

  if (user.authKind === 'user_delegation') {
    return {
      createdBy: ownerUid,
      createdByType: 'user',
      ...(agentId ? { createdByAgentId: agentId } : {}),
    }
  }

  if (isPureAgentCaller(user)) {
    return {
      createdBy: user.uid,
      createdByType: 'agent',
      ...(agentId ? { createdByAgentId: agentId } : {}),
    }
  }

  return {
    createdBy: ownerUid || user.uid,
    createdByType: 'user',
  }
}

/**
 * Returns update-time actor fields (plus a server timestamp) for a
 * Firestore update. Pair with `actorFrom` on creates.
 *
 * Same ownership rules: human remains `updatedBy` under user-delegation;
 * agent identity is only in `updatedByAgentId`.
 */
export function lastActorFrom(user: ApiUser): LastActorInfo {
  const agentId = cleanAgentId(user)
  const ownerUid = ownerUidFrom(user)

  if (user.authKind === 'user_delegation') {
    return {
      updatedBy: ownerUid,
      updatedByType: 'user',
      updatedAt: FieldValue.serverTimestamp(),
      ...(agentId ? { updatedByAgentId: agentId } : {}),
    }
  }

  if (isPureAgentCaller(user)) {
    return {
      updatedBy: user.uid,
      updatedByType: 'agent',
      updatedAt: FieldValue.serverTimestamp(),
      ...(agentId ? { updatedByAgentId: agentId } : {}),
    }
  }

  return {
    updatedBy: ownerUid || user.uid,
    updatedByType: 'user',
    updatedAt: FieldValue.serverTimestamp(),
  }
}

/**
 * Adds agent audit attribution to records whose primary owner is a member.
 * Delegation deliberately never changes `createdBy` or `createdByRef`.
 */
export function delegatedAgentAttribution(
  user: ActorUserLike | null | undefined,
): { createdByAgentId?: string } {
  const agentId = user ? cleanAgentId(user) : undefined
  if (!agentId) return {}
  // Prefer recording agent id whenever an agent is involved (delegation or pure agent).
  if (user?.authKind === 'user_delegation' || isPureAgentCaller(user)) {
    return { createdByAgentId: agentId }
  }
  return {}
}

/** Agent-only update attribution (does not touch ownership). */
export function agentUpdateAttribution(
  user: ActorUserLike | null | undefined,
): { updatedByAgentId?: string } {
  const agentId = user ? cleanAgentId(user) : undefined
  if (!agentId) return {}
  if (user?.authKind === 'user_delegation' || isPureAgentCaller(user)) {
    return { updatedByAgentId: agentId }
  }
  return {}
}

/** Ownership type for a write (`user` for delegation/session, `agent` for pure agent keys). */
export function actorTypeFrom(user: ApiUser): ActorType {
  return actorFrom(user).createdByType
}

/**
 * Full create-time write fields: ownership + agent assist + update mirrors.
 * Prefer this over `createdBy: user.uid` so agent keys never become owners under
 * user-delegation, and agent assist is always recorded when present.
 */
export function createAttribution(user: ApiUser): ActorInfo & {
  updatedBy: string
  updatedByType: ActorType
  updatedAt: FieldValue
  updatedByAgentId?: string
} {
  const created = actorFrom(user)
  const updated = lastActorFrom(user)
  return {
    ...created,
    updatedBy: updated.updatedBy,
    updatedByType: updated.updatedByType,
    updatedAt: updated.updatedAt,
    ...(updated.updatedByAgentId ? { updatedByAgentId: updated.updatedByAgentId } : {}),
  }
}

/**
 * CRM create attribution for human-owned commercial records.
 * Pure agent API keys omit human ownership fields; agent id is still recorded
 * on `createdByAgentId` / `updatedByAgentId`.
 */
export function crmCreateAttribution(
  user: ActorUserLike | null | undefined,
  actorUid: string | undefined,
  isAgent: boolean,
): {
  createdBy?: string
  updatedBy?: string
  createdByAgentId?: string
  updatedByAgentId?: string
} {
  return {
    ...(isAgent || !actorUid
      ? {}
      : {
          createdBy: actorUid,
          updatedBy: actorUid,
        }),
    ...delegatedAgentAttribution(user),
    ...agentUpdateAttribution(user),
  }
}

/**
 * CRM update attribution (does not change ownership / createdBy).
 */
export function crmUpdateAttribution(
  user: ActorUserLike | null | undefined,
  actorUid: string | undefined,
  isAgent: boolean,
): {
  updatedBy?: string
  updatedByAgentId?: string
} {
  return {
    ...(isAgent || !actorUid ? {} : { updatedBy: actorUid }),
    ...agentUpdateAttribution(user),
  }
}

/**
 * Human-readable attribution label for lists and detail headers.
 * Prefer resolved display name for the owner; append "via {agent}" when assisted.
 */
export function formatActorLabel(input: {
  createdBy?: string | null
  createdByType?: ActorType | string | null
  createdByAgentId?: string | null
  ownerDisplayName?: string | null
}): string {
  const ownerName = (input.ownerDisplayName || '').trim()
  const createdBy = (input.createdBy || '').trim()
  const agentId = (input.createdByAgentId || '').trim()
  const agentLabel = agentId
    ? agentId.charAt(0).toUpperCase() + agentId.slice(1)
    : ''

  let ownerLabel = ownerName
  if (!ownerLabel) {
    if (createdBy.includes('@')) ownerLabel = createdBy
    else if (input.createdByType === 'agent' || createdBy.startsWith('agent:')) {
      const bare = createdBy.startsWith('agent:') ? createdBy.slice('agent:'.length) : createdBy
      ownerLabel = bare ? bare.charAt(0).toUpperCase() + bare.slice(1) : 'AI agent'
    } else if (createdBy) {
      ownerLabel = 'Team member'
    } else {
      ownerLabel = 'Unknown'
    }
  }

  if (agentLabel && input.createdByType !== 'agent' && !createdBy.startsWith('agent:')) {
    return `${ownerLabel} via ${agentLabel}`
  }
  if (agentLabel && (input.createdByType === 'agent' || createdBy.startsWith('agent:'))) {
    return agentLabel
  }
  return ownerLabel
}
