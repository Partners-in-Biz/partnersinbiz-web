import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import type { AgentTeamStoredDoc } from '@/lib/agents/types'
import { canManageLinkedAgent } from '@/lib/agents/org-agent-policy'
import { memberOrgRole } from '@/lib/messages/provision-custom-bot'

export type BotProfileAccess =
  | { ok: true; agent: Omit<AgentTeamStoredDoc, 'apiKey'>; canEditLook: boolean; canProvisionMailbox: boolean }
  | { ok: false; status: 403 | 404; error: string }

/**
 * Resolve a bot for a Bot mode profile action inside one org.
 * - Look (avatar) edits: any org member for shared bots; the owner for personal bots.
 * - Mailbox provisioning: platform admins, or whoever may manage a custom org bot.
 */
export async function resolveBotProfileAccess(input: {
  user: ApiUser
  orgId: string
  botId: string
}): Promise<BotProfileAccess> {
  const snap = await adminDb.collection('agent_team').doc(input.botId).get()
  if (!snap.exists) return { ok: false, status: 404, error: 'Bot not found' }
  const stored = snap.data() as AgentTeamStoredDoc
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { apiKey: _apiKey, ...agent } = stored
  if (agent.enabled === false) return { ok: false, status: 404, error: 'Bot not found' }
  if (agent.scopeOrgId && agent.scopeOrgId !== input.orgId) {
    return { ok: false, status: 404, error: 'Bot not found' }
  }

  const platformAdmin = input.user.role === 'admin' || input.user.role === 'ai'
  const isOwner = agent.ownerUserId === input.user.uid
  if (agent.accessScope === 'personal' && !isOwner && !platformAdmin) {
    return { ok: false, status: 403, error: 'Only the owner can change a personal Bot' }
  }

  const membership = await adminDb.collection('orgMembers').doc(`${input.orgId}_${input.user.uid}`).get()
  const role = platformAdmin ? 'owner' : memberOrgRole(membership.data()?.role)

  const canProvisionMailbox = platformAdmin || (
    Boolean(agent.scopeOrgId)
    && canManageLinkedAgent({ agent, actorUserId: input.user.uid, orgId: input.orgId, role })
  )

  return { ok: true, agent, canEditLook: true, canProvisionMailbox }
}
