'use client'
import UnifiedChat from '@/components/chat/UnifiedChat'

export type DockedChatProps = {
  orgId: string
  currentUserUid: string
  currentUserDisplayName: string
  orgName?: string
}

export function DockedChat({ orgId, currentUserUid, currentUserDisplayName, orgName }: DockedChatProps) {
  if (!orgId || !currentUserUid) {
    return <div className="p-4 text-sm text-on-surface-variant">Sign in to chat with Pip.</div>
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[var(--color-card-border)] px-3 py-2 text-sm font-semibold text-on-surface">
        <span className="material-symbols-outlined align-middle text-[18px] text-[var(--color-pib-accent)]">smart_toy</span> Pip
      </div>
      <div className="min-h-0 flex-1">
        <UnifiedChat
          orgId={orgId}
          currentUserUid={currentUserUid}
          currentUserDisplayName={currentUserDisplayName}
          orgName={orgName}
          scope="general"
          allowStartConversations
          allowSendMessages
          allowAgentParticipants
          compact
        />
      </div>
    </div>
  )
}
