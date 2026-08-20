import type { MessagesExperienceMode } from '@/lib/messages/experience-mode'

export type MessagesSurface = 'admin' | 'portal'

export interface HermesMessagesCapabilities {
  allowStartConversations: boolean
  allowSendMessages: boolean
  allowAgentParticipants: boolean
  allowArchiveConversations: boolean
}

export interface HermesMessagesShellProps {
  surface: MessagesSurface
  orgId: string
  currentUserUid: string
  currentUserDisplayName: string
  orgName?: string
  userRole?: string
  initialConvId?: string
  initialExperienceMode?: MessagesExperienceMode
  capabilities: HermesMessagesCapabilities
}
