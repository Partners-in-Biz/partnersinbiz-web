import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'
import type { AgentMailboxActor } from '@/lib/mailbox/agentEmail'
import {
  authorizeAgentMailboxDelegation,
  type AgentMailboxActionClass,
  type AgentMailboxDelegationEvidence,
} from '@/lib/mailbox/agentEmailAuthorization'
import { resolveMailboxOrgIdForActor } from '@/lib/mailbox/staff-mailbox-remap'

export type AgentMailboxResolvedContext = {
  orgId: string | null
  uid: string | null
  conversationOrgId?: string
  searchParams?: URLSearchParams
}

export function agentMailboxActorFromUser(user: ApiUser): AgentMailboxActor {
  return { actorId: user.agentId ? `agent:${user.agentId}` : user.uid, actorType: user.role === 'ai' ? 'agent' : 'user' }
}

export function agentMailboxContextFromBody(body: Record<string, unknown>, user: ApiUser): { orgId: string | null; uid: string | null } {
  const orgId = typeof body.orgId === 'string' ? body.orgId : user.orgId ?? user.activeOrgId ?? null
  // User-delegation tokens are minted for one acting human. Ignore request-supplied
  // uid/requestingUserId so prompt injection cannot retarget another mailbox.
  if (user.authKind === 'user_delegation') {
    return { orgId, uid: user.actingForUserId || user.uid || null }
  }
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
  const orgId = searchParams.get('orgId') ?? user.orgId ?? user.activeOrgId ?? null
  if (user.authKind === 'user_delegation') {
    return { orgId, uid: user.actingForUserId || user.uid || null, searchParams }
  }
  const uid = searchParams.get('uid') ?? searchParams.get('requestingUserId') ?? (user.role === 'ai' ? null : user.uid)
  return { orgId, uid, searchParams }
}

async function applyStaffMailboxRemap(input: {
  orgId: string | null
  uid: string | null
}): Promise<{ orgId: string | null; uid: string | null; conversationOrgId?: string }> {
  if (!input.orgId || !input.uid) return { orgId: input.orgId, uid: input.uid }
  const resolved = await resolveMailboxOrgIdForActor({
    uid: input.uid,
    requestedOrgId: input.orgId,
  })
  return {
    orgId: resolved.orgId,
    uid: input.uid,
    ...(resolved.conversationOrgId ? { conversationOrgId: resolved.conversationOrgId } : {}),
  }
}

/** Resolve mailbox tenant for API handlers — remaps PiB staff client-chat orgIds onto the platform mailbox. */
export async function resolveAgentMailboxContextFromBody(
  body: Record<string, unknown>,
  user: ApiUser,
): Promise<AgentMailboxResolvedContext> {
  const base = agentMailboxContextFromBody(body, user)
  return applyStaffMailboxRemap(base)
}

export async function resolveAgentMailboxContextFromRequest(
  req: NextRequest,
  user: ApiUser,
): Promise<AgentMailboxResolvedContext & { searchParams: URLSearchParams }> {
  const base = agentMailboxContextFromRequest(req, user)
  const remapped = await applyStaffMailboxRemap(base)
  return { ...remapped, searchParams: base.searchParams }
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
