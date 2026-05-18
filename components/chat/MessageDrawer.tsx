'use client'

import { useEffect, useState } from 'react'
import UnifiedChat from './UnifiedChat'

interface MessageDrawerProps {
  orgId?: string
  orgName?: string
  currentUserUid: string
  currentUserDisplayName: string
  allowAgentParticipants?: boolean
  allowDeleteConversations?: boolean
  disabledReason?: string
}

export function MessageDrawer({
  orgId,
  orgName,
  currentUserUid,
  currentUserDisplayName,
  allowAgentParticipants = true,
  allowDeleteConversations = false,
  disabledReason,
}: MessageDrawerProps) {
  const [open, setOpen] = useState(false)
  const disabled = !orgId

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!disabled) setOpen(true)
        }}
        disabled={disabled}
        title={disabled ? disabledReason ?? 'Select a workspace first' : 'Open messages'}
        aria-label="Open messages"
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-[20px]">forum</span>
      </button>

      {open && orgId && (
        <div className="fixed inset-0 z-[80]">
          <button
            type="button"
            aria-label="Close messages"
            className="absolute inset-0 h-full w-full cursor-default bg-black/55 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute right-0 top-0 flex h-dvh w-full max-w-[560px] flex-col border-l border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] shadow-2xl sm:w-[min(560px,92vw)]">
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-pib-line)] px-4">
              <div className="flex-1 min-w-0">
                <p className="eyebrow !text-[10px]">Messages</p>
                {orgName && (
                  <p className="truncate text-xs text-[var(--color-pib-text-muted)]">{orgName}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close messages"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <UnifiedChat
                orgId={orgId}
                currentUserUid={currentUserUid}
                currentUserDisplayName={currentUserDisplayName}
                orgName={orgName}
                allowAgentParticipants={allowAgentParticipants}
                allowDeleteConversations={allowDeleteConversations}
                compact
              />
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
