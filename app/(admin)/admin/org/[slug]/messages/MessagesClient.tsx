'use client'

import UnifiedChat from '@/components/chat/UnifiedChat'

interface MessagesClientProps {
  orgId: string
  uid: string
  displayName: string
  initialConvId?: string
}

export default function MessagesClient({ orgId, uid, displayName, initialConvId }: MessagesClientProps) {
  // Mobile: edge-to-edge, fills viewport below the 56px admin topbar.
  // Desktop: keeps the page header and respects main's py-8 (64px) + topbar (56px).
  return (
    <div
      className="flex flex-col gap-0 lg:gap-4 overflow-hidden -mx-4 -my-8 lg:mx-0 lg:my-0 h-[calc(100dvh-56px)] lg:h-[calc(100dvh-120px)]"
    >
      <div className="hidden lg:block shrink-0">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
          Workspace / Messages
        </p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">Messages</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Multi-participant conversations with your team and agents.
        </p>
      </div>

      <UnifiedChat
        orgId={orgId}
        currentUserUid={uid}
        currentUserDisplayName={displayName}
        initialConvId={initialConvId}
        allowDeleteConversations
      />
    </div>
  )
}
