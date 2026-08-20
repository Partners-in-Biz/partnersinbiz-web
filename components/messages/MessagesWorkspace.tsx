'use client'

import AgentRunSession from '@/components/agents/AgentRunSession'
import HermesMessagesShell from '@/components/messages/hermes-desktop/HermesMessagesShell'
import type { MessagesSurface } from '@/components/messages/hermes-desktop/types'
import type { MessagesExperienceMode } from '@/lib/messages/experience-mode'

interface MessagesWorkspaceProps {
  surface: MessagesSurface
  orgId: string
  currentUserUid: string
  currentUserDisplayName: string
  orgSlug?: string
  orgName?: string
  userRole?: string
  initialConvId?: string
  initialAgentId?: string
  initialRunId?: string
  initialTaskId?: string
  initialTaskTitle?: string
  initialExperienceMode?: MessagesExperienceMode
  allowStartConversations?: boolean
  allowSendMessages?: boolean
  allowAgentParticipants?: boolean
  allowArchiveConversations?: boolean
}

export function MessagesWorkspace({
  surface,
  orgId,
  currentUserUid,
  currentUserDisplayName,
  orgSlug,
  orgName,
  userRole,
  initialConvId,
  initialAgentId,
  initialRunId,
  initialTaskId,
  initialTaskTitle,
  initialExperienceMode,
  allowStartConversations = true,
  allowSendMessages = true,
  allowAgentParticipants,
  allowArchiveConversations = true,
}: MessagesWorkspaceProps) {
  const isAdmin = surface === 'admin'

  if (isAdmin && initialAgentId && initialRunId) {
    return (
      <AgentRunSession
        agentId={initialAgentId}
        runId={initialRunId}
        orgId={orgId}
        orgSlug={orgSlug ?? ''}
        currentUserUid={currentUserUid}
        currentUserDisplayName={currentUserDisplayName}
        taskId={initialTaskId}
        taskTitle={initialTaskTitle}
      />
    )
  }

  return (
    <HermesMessagesShell
      surface={surface}
      orgId={orgId}
      orgName={orgName}
      currentUserUid={currentUserUid}
      currentUserDisplayName={currentUserDisplayName}
      userRole={userRole}
      initialConvId={initialConvId}
      initialExperienceMode={initialExperienceMode}
      capabilities={{
        allowStartConversations,
        allowSendMessages,
        allowAgentParticipants: allowAgentParticipants ?? (isAdmin || userRole === 'admin'),
        allowArchiveConversations,
      }}
    />
  )
}
