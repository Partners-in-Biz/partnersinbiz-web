import { orgChatConfigDoc } from '@/lib/conversations/conversations'
import { DEFAULT_CHAT_CONFIG } from '@/lib/conversations/types'

export interface OrgChatVisibilityPolicy {
  enableClientToAdminChat: boolean
  enableClientToPiBTeamChat: boolean
}

export async function getOrgChatVisibilityPolicy(orgId: string): Promise<OrgChatVisibilityPolicy> {
  const snapshot = await orgChatConfigDoc(orgId).get()
  const data = snapshot.exists ? snapshot.data() : null

  return {
    enableClientToAdminChat:
      data && typeof data.enableClientToAdminChat === 'boolean'
        ? data.enableClientToAdminChat
        : DEFAULT_CHAT_CONFIG.enableClientToAdminChat,
    enableClientToPiBTeamChat:
      data && typeof data.enableClientToPiBTeamChat === 'boolean'
        ? data.enableClientToPiBTeamChat
        : DEFAULT_CHAT_CONFIG.enableClientToPiBTeamChat,
  }
}
