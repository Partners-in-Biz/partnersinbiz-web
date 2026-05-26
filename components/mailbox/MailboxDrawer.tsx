'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type MailboxAccountsResponse = {
  data?: {
    accounts?: Array<{ id: string }>
  }
}

export function MailboxDrawer() {
  const [hasConnectedAccount, setHasConnectedAccount] = useState(false)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const drawerWidth = 'clamp(420px, 34vw, 560px)'
  const drawerPortalTarget = typeof document === 'undefined' ? null : document.body

  useEffect(() => {
    let cancelled = false

    async function loadAccounts() {
      try {
        const res = await fetch('/api/v1/admin/mailbox/accounts')
        const body = (await res.json()) as MailboxAccountsResponse
        if (!cancelled && res.ok) {
          setHasConnectedAccount((body.data?.accounts ?? []).length > 0)
        }
      } catch {
        if (!cancelled) setHasConnectedAccount(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadAccounts()

    return () => {
      cancelled = true
    }
  }, [])

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

    if (!previousTransition) pushRoot.style.transition = 'margin-right 180ms ease'
    syncPageInset()
    media.addEventListener('change', syncPageInset)

    return () => {
      media.removeEventListener('change', syncPageInset)
      pushRoot.style.marginRight = previousMargin
      pushRoot.style.transition = previousTransition
    }
  }, [drawerWidth, open])

  if (loading || !hasConnectedAccount) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={open ? 'Close email' : 'Open email'}
        aria-label={open ? 'Close email' : 'Open email'}
        aria-pressed={open}
        className={[
          'relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
          open
            ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
            : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]',
        ].join(' ')}
      >
        <span className="material-symbols-outlined text-[20px]">mail</span>
      </button>

      {open && drawerPortalTarget && createPortal(
        <div className="fixed right-0 top-0 z-[80] h-dvh w-full md:w-[clamp(420px,34vw,560px)]">
          <aside
            aria-label="Email mailbox"
            className="flex h-full min-h-0 w-full flex-col border-l border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] shadow-2xl"
          >
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-pib-line)] px-4">
              <div className="flex-1 min-w-0">
                <p className="eyebrow !text-[10px]">Email</p>
                <p className="truncate text-xs text-[var(--color-pib-text-muted)]">Mailbox</p>
              </div>
              <a
                href="/admin/email/mailbox"
                className="hidden sm:inline-flex rounded-lg border border-[var(--color-pib-line)] px-3 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
              >
                Full view
              </a>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close email"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <iframe
              title="Email mailbox"
              src="/admin/email/mailbox?compact=1"
              className="min-h-0 flex-1 border-0 bg-[var(--color-pib-bg)]"
            />
          </aside>
        </div>,
        drawerPortalTarget,
      )}
    </>
  )
}
