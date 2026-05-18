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
  const drawerWidth = 'clamp(420px, 34vw, 560px)'

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (!open) return

    const pushRoot = document.querySelector<HTMLElement>('[data-message-push-root]')
    if (!pushRoot) return

    const previousMargin = pushRoot.style.marginRight
    const previousTransition = pushRoot.style.transition
    const media = window.matchMedia('(min-width: 768px)')

    function syncPageInset() {
      pushRoot.style.marginRight = open && media.matches ? drawerWidth : previousMargin
    }

    if (!previousTransition) {
      pushRoot.style.transition = 'margin-right 180ms ease'
    }
    syncPageInset()
    media.addEventListener('change', syncPageInset)

    return () => {
      media.removeEventListener('change', syncPageInset)
      pushRoot.style.marginRight = previousMargin
      pushRoot.style.transition = previousTransition
    }
  }, [drawerWidth, open])

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!disabled) setOpen((value) => !value)
        }}
        disabled={disabled}
        title={disabled ? disabledReason ?? 'Select a workspace first' : open ? 'Close messages' : 'Open messages'}
        aria-label={open ? 'Close messages' : 'Open messages'}
        aria-pressed={open}
        className={[
          'relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40',
          open
            ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
            : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]',
        ].join(' ')}
      >
        <span className="material-symbols-outlined text-[20px]">forum</span>
      </button>

      {open && orgId && (
        <div className="fixed right-0 top-0 z-[80] h-dvh w-full md:w-[clamp(420px,34vw,560px)]">
          <aside className="flex h-full min-h-0 w-full flex-col border-l border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] shadow-2xl">
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
            <div className="flex min-h-0 flex-1 overflow-hidden">
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
