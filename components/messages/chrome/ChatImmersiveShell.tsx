'use client'

import { ChatChromeToggle } from '@/components/messages/chrome/ChatChromeToggle'
import { ComputerActivityChip } from '@/components/messages/chrome/ComputerActivityChip'
import { useChatChrome } from '@/components/messages/chrome/ChatChromeProvider'

/**
 * Full-viewport immersive wrapper used when site chrome is hidden.
 * Toggle reveals chrome transiently; pin keeps it until unpin.
 */
export function ChatImmersiveShell({
  children,
  onShowChrome,
  computerActivityActive = false,
  onOpenComputerActivity,
}: {
  children: React.ReactNode
  /** Optional override — defaults to context reveal() */
  onShowChrome?: () => void
  /** When true, shows the computer activity chip beside the chrome toggle. */
  computerActivityActive?: boolean
  onOpenComputerActivity?: () => void
}) {
  const chrome = useChatChrome()
  const handleShow = onShowChrome ?? chrome.reveal

  return (
    <div
      data-testid="bot-mode-immersive-shell"
      className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--color-pib-bg)] text-[var(--color-pib-text)]"
    >
      <ChatChromeToggle
        revealed={false}
        onToggle={handleShow}
      />
      <ComputerActivityChip
        active={computerActivityActive}
        onOpen={onOpenComputerActivity ?? handleShow}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  )
}

/** @deprecated Prefer ChatImmersiveShell */
export function BotModeImmersiveShell({
  children,
  onShowChrome,
}: {
  children: React.ReactNode
  onShowChrome: () => void
}) {
  return <ChatImmersiveShell onShowChrome={onShowChrome}>{children}</ChatImmersiveShell>
}
