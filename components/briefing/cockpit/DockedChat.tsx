'use client'

import { Icon } from '@/components/studio'
import type { ContextReferenceSeed } from '@/lib/context-references/types'
import UnifiedChat from '@/components/chat/UnifiedChat'

export type DockedChatProps = {
  orgId: string
  currentUserUid: string
  currentUserDisplayName: string
  orgName?: string
  contextSeed?: ContextReferenceSeed | null
  onContextActionResolved?: () => void
  /** Fires when Pip starts/finishes a run so the desk can pick up her latest draft. */
  onConversationLifecycle?: (event: { conversationId: string; phase: 'running' | 'completed' | 'idle' }) => void
  onClose?: () => void
}

export function DockedChat({ orgId, currentUserUid, currentUserDisplayName, orgName, contextSeed, onContextActionResolved, onConversationLifecycle, onClose }: DockedChatProps) {
  if (!orgId || !currentUserUid) {
    return <div className="p-4 text-sm text-[var(--color-pib-text-muted)]">Sign in to chat with Pip.</div>
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--color-pib-line)] px-3 py-2">
        <span aria-hidden="true"><Icon name="smart_toy" /></span>
        <span className="flex-1 text-sm text-[var(--color-pib-text)]">Pip</span>
        {onClose && (
          <button onClick={onClose} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors" aria-label="Close chat">
            <Icon name="close" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <UnifiedChat
          orgId={orgId}
          currentUserUid={currentUserUid}
          currentUserDisplayName={currentUserDisplayName}
          orgName={orgName}
          includeAllScopes
          scope="general"
          allowStartConversations
          allowSendMessages
          allowAgentParticipants
          compact
          preferCurrentPageContext
          currentPageContext={contextSeed ?? undefined}
          onContextActionResolved={onContextActionResolved}
          onConversationLifecycle={onConversationLifecycle}
        />
      </div>
    </div>
  )
}
