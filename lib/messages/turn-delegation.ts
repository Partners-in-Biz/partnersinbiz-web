import {
  buildDelegationAuthPromptBlock,
  mintMessagesDispatchDelegation,
  type MintedDelegation,
} from '@/lib/api/delegations'
import type { ApiUser } from '@/lib/api/types'

/**
 * Mint a fresh user-delegation token for one human-triggered Messages turn.
 * Never reuse a stale pib_dlg_ from an earlier turn or a cached conversation blob.
 */
export async function mintFreshMessagesTurnDelegation(input: {
  user: ApiUser
  orgId: string
  agentId: string
  conversationId: string
  /** Ignored — accepted only so callers cannot accidentally treat history tokens as live. */
  staleTokenFromHistory?: string | null
}): Promise<MintedDelegation | null> {
  void input.staleTokenFromHistory
  return mintMessagesDispatchDelegation({
    user: input.user,
    orgId: input.orgId,
    agentId: input.agentId,
    conversationId: input.conversationId,
  })
}

export function buildMessagesTurnDelegationPrompt(input: {
  delegation: MintedDelegation
  orgId: string
  agentId: string
  apiBaseUrl?: string
}): string {
  return buildDelegationAuthPromptBlock({
    token: input.delegation.token,
    expiresAt: input.delegation.expiresAt,
    orgId: input.orgId,
    agentId: input.agentId,
    actingForUserId: input.delegation.actingForUserId,
    scopes: input.delegation.scopes,
    mailboxDelegationEvidenceId: input.delegation.mailboxDelegationEvidenceId,
    apiBaseUrl: input.apiBaseUrl,
  })
}
