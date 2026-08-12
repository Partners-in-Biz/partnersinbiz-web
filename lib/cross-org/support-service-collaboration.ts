import type { ServiceWorkspaceParticipant, ServiceWorkspaceParticipantRole } from '@/lib/service-workspaces/types'
import type { SupportParticipant, SupportParticipantRole } from '@/lib/support/types'

type Participant = SupportParticipant | ServiceWorkspaceParticipant
type ParticipantRole = SupportParticipantRole | ServiceWorkspaceParticipantRole
type ActorRef = { uid: string; displayName?: string; kind?: 'human' | 'agent' }

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function participantKey(orgId: string, userId: string): string {
  return `${clean(orgId)}:${clean(userId)}`
}

/**
 * Invitation is intentionally not active access. The route that persists this
 * transition must first obtain an allow decision for invite_participant from
 * CrossOrgPolicyService using the support/service action registry.
 */
export function inviteSupportServiceParticipant<T extends Participant>(input: {
  participants: readonly T[]
  participant: Pick<T, 'id' | 'orgId' | 'userId'> & { role: ParticipantRole }
  invitedByRef: ActorRef
}): T[] {
  const { participant } = input
  if (!clean(participant.id) || !clean(participant.orgId) || !clean(participant.userId)) throw new Error('participant identity is required')
  const key = participantKey(participant.orgId, participant.userId)
  if (input.participants.some((candidate) => participantKey(candidate.orgId, candidate.userId) === key && candidate.status !== 'revoked')) {
    throw new Error('participant is already invited or active')
  }
  return [...input.participants.filter((candidate) => participantKey(candidate.orgId, candidate.userId) !== key), {
    ...participant,
    status: 'invited',
    invitedByRef: input.invitedByRef,
  } as T]
}

/** A recipient may claim only their own invitation; no admin can claim on their behalf. */
export function claimSupportServiceParticipant<T extends Participant>(input: {
  participants: readonly T[]
  participantId: string
  claimantUserId: string
  now: unknown
}): T[] {
  const index = input.participants.findIndex((participant) => participant.id === input.participantId)
  if (index < 0) throw new Error('participant invitation not found')
  const existing = input.participants[index]
  if (existing.status !== 'invited') throw new Error('only an invited participant can be claimed')
  if (clean(existing.userId) !== clean(input.claimantUserId)) throw new Error('invitation claimant does not match participant')
  const next = [...input.participants]
  next[index] = { ...existing, status: 'active', acceptedAt: input.now } as T
  return next
}

/** Revocation preserves a durable record and prevents re-use of an active role. */
export function revokeSupportServiceParticipant<T extends Participant>(input: {
  participants: readonly T[]
  participantId: string
  revokedByRef: ActorRef
  now: unknown
}): T[] {
  const index = input.participants.findIndex((participant) => participant.id === input.participantId)
  if (index < 0) throw new Error('participant not found')
  const existing = input.participants[index]
  if (existing.status === 'revoked') return [...input.participants]
  const next = [...input.participants]
  next[index] = { ...existing, status: 'revoked', revokedAt: input.now, revokedByRef: input.revokedByRef } as T
  return next
}
