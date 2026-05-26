import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'
import type { AgentMailboxActor } from '@/lib/mailbox/agentEmail'
import {
  authorizeAgentMailboxDelegation,
  type AgentMailboxActionClass,
  type AgentMailboxDelegationEvidence,
} from '@/lib/mailbox/agentEmailAuthorization'

export function agentMailboxActorFromUser(user: ApiUser): AgentMailboxActor {
  return { actorId: user.agentId ? `agent:${user.agentId}` : user.uid, actorType: user.role === 'ai' ? 'agent' : 'user' }
}

export function agentMailboxContextFromBody(body: Record<string, unknown>, user: ApiUser): { orgId: string | null; uid: string | null } {
  const orgId = typeof body.orgId === 'string' ? body.orgId : user.orgId ?? null
  const uid = typeof body.uid === 'string'
    ? body.uid
    : typeof body.requestingUserId === 'string'
      ? body.requestingUserId
      : user.role === 'ai'
        ? null
        : user.uid
  return { orgId, uid }
}

export function agentMailboxContextFromRequest(req: NextRequest, user: ApiUser): { orgId: string | null; uid: string | null; searchParams: URLSearchParams } {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId') ?? user.orgId ?? null
  const uid = searchParams.get('uid') ?? searchParams.get('requestingUserId') ?? (user.role === 'ai' ? null : user.uid)
  return { orgId, uid, searchParams }
}

export async function authorizeAgentMailboxRequest(input: {
  user: ApiUser
  orgId: string
  uid: string
  actionClass: AgentMailboxActionClass
  delegationEvidenceId?: unknown
  delegationEvidence?: unknown
}): Promise<AgentMailboxDelegationEvidence> {
  return authorizeAgentMailboxDelegation(input)
}
