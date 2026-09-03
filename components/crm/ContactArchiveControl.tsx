'use client'

import { useState } from 'react'
import { Icon } from '@/components/studio'

export function ContactArchiveControl({
  contactName,
  archiving = false,
  onArchive,
}: {
  contactName: string
  archiving?: boolean
  onArchive: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  function handleArchive() {
    setConfirmOpen(true)
  }

  function confirmArchive() {
    setConfirmOpen(false)
    onArchive()
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-red-100">Archive contact</p>
            <p className="mt-1 text-xs leading-5 text-red-100/70">
              Soft-archive this CRM record when it should leave active lists but remain recoverable in audit history.
            </p>
          </div>
          <button
            type="button"
            onClick={handleArchive}
            disabled={archiving}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-300/30 bg-red-400/15 px-3 py-2 text-xs font-medium text-red-100 transition-colors hover:bg-red-400/25 disabled:opacity-50"
          >
            <Icon name="archive" className="text-[15px]" />
            {archiving ? 'Archiving...' : 'Archive contact'}
          </button>
        </div>
      </div>

      {confirmOpen && (
        <section
          role="alertdialog"
          aria-labelledby="contact-archive-confirm-title"
          aria-describedby="contact-archive-confirm-description"
          className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              <Icon name="warning" className="mt-0.5 text-red-300" />
              <div>
                <p className="eyebrow !text-[10px] text-red-200">Archive confirmation</p>
                <h3 id="contact-archive-confirm-title" className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">
                  Archive {contactName}?
                </h3>
                <p id="contact-archive-confirm-description" className="mt-2 text-sm text-red-100/90">
                  This contact will leave active CRM lists, but audit history and past activity stay recoverable.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="flex h-8 items-center rounded-md border border-[var(--color-card-border)] px-2 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                aria-label="Cancel archive contact"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmArchive}
                disabled={archiving}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-300/30 bg-red-400/15 px-3 py-2 text-xs font-medium text-red-100 transition-colors hover:bg-red-400/25 disabled:opacity-50"
                aria-label={`Confirm archive ${contactName}`}
              >
                <Icon name="archive" className="text-[15px]" />
                {archiving ? 'Archiving...' : 'Archive contact'}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
