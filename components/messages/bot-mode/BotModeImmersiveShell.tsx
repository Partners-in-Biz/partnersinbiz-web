'use client'

import { BotModeChromeToggle } from '@/components/messages/bot-mode/BotModeChromeToggle'

export function BotModeImmersiveShell({
  children,
  onShowChrome,
}: {
  children: React.ReactNode
  onShowChrome: () => void
}) {
  return (
    <div
      data-testid="bot-mode-immersive-shell"
      className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-black text-[var(--color-pib-text)]"
    >
      <BotModeChromeToggle revealed={false} onToggle={onShowChrome} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  )
}
