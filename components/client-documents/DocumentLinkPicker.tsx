'use client'

import { useEffect, useRef, useState } from 'react'

type DocItem = {
  id: string
  title?: string
  shareToken?: string
  shareEnabled?: boolean
}

type ApiResponse = {
  success: boolean
  data: DocItem[]
}

export interface DocumentLinkPickerProps {
  open: boolean
  onClose: () => void
  onSelect: (href: string, label: string) => void
}

export function DocumentLinkPicker({ open, onClose, onSelect }: DocumentLinkPickerProps) {
  const [docs, setDocs] = useState<DocItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    setLoading(true)
    setError(null)
    fetch('/api/v1/client-documents?limit=20')
      .then((r) => r.json())
      .then((body: ApiResponse) => {
        if (body.success && Array.isArray(body.data)) {
          // US-209: only documents that produce a working public link.
          // A document is publicly viewable when sharing is enabled AND it has
          // a share token (i.e. it has been published + shared). Private /
          // unshared documents are dropped entirely so the user can only pick
          // links that actually resolve at /d/{shareToken}.
          setDocs(body.data.filter((d) => d.shareEnabled === true && Boolean(d.shareToken)))
        } else {
          setError('Could not load documents.')
        }
      })
      .catch(() => setError('Could not load documents.'))
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [open])

  const filtered = query.trim()
    ? docs.filter((d) =>
        (d.title ?? 'Untitled').toLowerCase().includes(query.trim().toLowerCase()),
      )
    : docs

  function handleSelect(doc: DocItem) {
    // The list is already filtered to publicly viewable docs, but re-check so a
    // bad row can never produce a dead link.
    if (!doc.shareEnabled || !doc.shareToken) return
    // US-209: app-relative public share URL with document-specific click
    // tracking. The public share view (/d/[shareToken]) reads `dlid` + utm
    // params for per-document click attribution from emails.
    const href =
      `/d/${doc.shareToken}` +
      `?utm_source=email&utm_medium=document-link` +
      `&dlid=${encodeURIComponent(doc.id)}`
    onSelect(href, doc.title ?? 'Document')
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Insert document link"
    >
      <div
        className="relative w-full max-w-lg mx-4 rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--color-pib-surface)', border: '1px solid var(--color-pib-line)' }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-4 border-b"
          style={{ borderColor: 'var(--color-pib-line)' }}
        >
          <span
            className="material-symbols-outlined text-xl"
            style={{ color: 'var(--color-pib-accent)' }}
            aria-hidden="true"
          >
            attach_file
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-headline text-base leading-tight">Insert document link</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-pib-text-muted)' }}>
              Choose a shared document to link in your email
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg transition-colors hover:bg-white/5"
            aria-label="Close"
            style={{ color: 'var(--color-pib-text-muted)' }}
          >
            <span className="material-symbols-outlined text-xl" aria-hidden="true">close</span>
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--color-pib-line)' }}>
          <div className="relative">
            <span
              className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-lg pointer-events-none"
              style={{ color: 'var(--color-pib-text-muted)' }}
              aria-hidden="true"
            >
              search
            </span>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter documents…"
              className="w-full pl-9 pr-4 py-2 rounded-lg text-sm bg-transparent outline-none"
              style={{
                background: 'var(--color-pib-surface-2)',
                border: '1px solid var(--color-pib-line)',
                color: 'var(--color-pib-text)',
              }}
            />
          </div>
        </div>

        {/* Document list */}
        <div className="overflow-y-auto" style={{ maxHeight: '340px' }}>
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm"
              style={{ color: 'var(--color-pib-text-muted)' }}>
              <span className="material-symbols-outlined text-xl animate-spin" aria-hidden="true">progress_activity</span>
              Loading documents…
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm"
              style={{ color: '#F87171' }}>
              <span className="material-symbols-outlined text-xl" aria-hidden="true">error</span>
              {error}
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center px-6">
              <span
                className="material-symbols-outlined text-4xl"
                style={{ color: 'var(--color-pib-text-muted)' }}
                aria-hidden="true"
              >
                description
              </span>
              <p className="font-headline text-base">No documents found</p>
              <p className="text-xs" style={{ color: 'var(--color-pib-text-muted)' }}>
                {query.trim()
                  ? 'Try a different search term.'
                  : 'Publish and enable sharing on a document first, then return here to link it.'}
              </p>
            </div>
          )}

          {!loading && !error && filtered.map((doc) => (
            <button
              key={doc.id}
              onClick={() => handleSelect(doc)}
              className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors border-b last:border-b-0"
              style={{
                borderColor: 'var(--color-pib-line)',
                background: 'transparent',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--color-pib-surface-2)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
              }}
            >
              <span
                className="material-symbols-outlined text-xl flex-shrink-0"
                style={{ color: 'var(--color-pib-accent)' }}
                aria-hidden="true"
              >
                description
              </span>
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-medium truncate"
                  style={{ color: 'var(--color-pib-text)' }}
                >
                  {doc.title ?? 'Untitled document'}
                </p>
              </div>
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-label uppercase tracking-wide flex-shrink-0"
                style={{
                  background: 'rgba(74,222,128,0.10)',
                  border: '1px solid rgba(74,222,128,0.30)',
                  color: '#86EFAC',
                }}
              >
                Shared
              </span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end px-5 py-3 border-t"
          style={{ borderColor: 'var(--color-pib-line)' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm transition-colors"
            style={{
              background: 'var(--color-pib-surface-2)',
              border: '1px solid var(--color-pib-line)',
              color: 'var(--color-pib-text-muted)',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
