'use client'
import type { ContextReferenceSeed } from '@/lib/context-references/types'
import UnifiedChat from '@/components/chat/UnifiedChat'

export type DockedChatProps = {
  orgId: string
  currentUserUid: string
  currentUserDisplayName: string
  orgName?: string
  contextSeed?: ContextReferenceSeed | null
  onClose?: () => void
}

export function DockedChat({ orgId, currentUserUid, currentUserDisplayName, orgName, contextSeed, onClose }: DockedChatProps) {
  if (!orgId || !currentUserUid) {
    return <div className="p-4 text-sm text-on-surface-variant">Sign in to chat with Pip.</div>
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center border-b border-[var(--color-card-border)] px-3 py-2">
        <span className="material-symbols-outlined align-middle text-[18px] text-[var(--color-pib-accent)]">smart_toy</span>
        <span className="ml-1.5 flex-1 text-sm font-semibold text-on-surface">Pip</span>
        {onClose && (
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors" aria-label="Close chat">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        )}
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
          currentPageContext={contextSeed ?? undefined}
        />
      </div>
    </div>
  )
}
