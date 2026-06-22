'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

interface SearchResult {
  id: string
  title: string
  subtitle: string
  icon: string
  href: string
}

interface ShortcutItem {
  keys: string[]
  label: string
  href?: string
}

const SHORTCUTS: ShortcutItem[] = [
  { keys: ['⌘', 'K'], label: 'Open command palette' },
  { keys: ['Esc'], label: 'Close / dismiss' },
  { keys: ['⌘', '⇧', 'S'], label: 'Open social compose', href: '/portal/social/compose' },
  { keys: ['⌘', '⇧', 'N'], label: 'New document', href: '/portal/documents/new' },
]

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Autofocus when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Escape closes
  useEffect(() => {
    if (!open) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        const item = results[selectedIndex]
        if (item) {
          e.preventDefault()
          navigate(item.href)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results, selectedIndex])

  const navigate = useCallback((href: string) => {
    router.push(href)
    onClose()
  }, [router, onClose])

  // Debounced search
  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!query.trim()) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const q = encodeURIComponent(query.trim())
        const [contactsRes, docsRes] = await Promise.allSettled([
          fetch(`/api/v1/contacts?q=${q}&limit=5`).then(r => r.json()),
          fetch(`/api/v1/client-documents?q=${q}&limit=5`).then(r => r.json()),
        ])

        const combined: SearchResult[] = []

        if (contactsRes.status === 'fulfilled') {
          const body = contactsRes.value as { success?: boolean; data?: unknown }
          const raw = body?.data
          const items: Record<string, unknown>[] = Array.isArray(raw)
            ? (raw as Record<string, unknown>[])
            : Array.isArray((raw as { items?: unknown } | null)?.items)
            ? ((raw as { items: Record<string, unknown>[] }).items)
            : []
          items.forEach(c => {
            const id = String(c.id ?? c.contactId ?? '')
            const name = String(c.name ?? c.firstName ?? c.fullName ?? 'Untitled contact')
            if (id) {
              combined.push({ id: `contact-${id}`, title: name, subtitle: 'Contact', icon: 'person', href: `/portal/contacts/${id}` })
            }
          })
        }

        if (docsRes.status === 'fulfilled') {
          const body = docsRes.value as { success?: boolean; data?: unknown }
          const raw = body?.data
          const items: Record<string, unknown>[] = Array.isArray(raw)
            ? (raw as Record<string, unknown>[])
            : Array.isArray((raw as { items?: unknown } | null)?.items)
            ? ((raw as { items: Record<string, unknown>[] }).items)
            : []
          items.forEach(d => {
            const id = String(d.id ?? d.documentId ?? '')
            const title = String(d.title ?? d.name ?? 'Untitled document')
            if (id) {
              combined.push({ id: `doc-${id}`, title, subtitle: 'Document', icon: 'description', href: `/portal/documents/${id}` })
            }
          })
        }

        setResults(combined)
        setSelectedIndex(0)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl mx-4 rounded-2xl border border-[var(--color-pib-line)] shadow-2xl overflow-hidden"
        style={{ background: 'var(--color-pib-surface)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-pib-line)]">
          <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-text-muted)] shrink-0">search</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search contacts, documents…"
            className="flex-1 bg-transparent text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          {loading && (
            <span className="shrink-0 w-4 h-4 border-2 border-[var(--color-pib-accent)] border-t-transparent rounded-full animate-spin" />
          )}
          {!loading && (
            <kbd className="shrink-0 text-[10px] text-[var(--color-pib-text-muted)] bg-white/[0.06] border border-[var(--color-pib-line)] rounded px-1.5 py-0.5">Esc</kbd>
          )}
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto">
          {/* Results */}
          {query.trim() && !loading && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-[var(--color-pib-text-muted)]">
              <span className="material-symbols-outlined text-[32px] opacity-40">search_off</span>
              <p className="text-sm">No results for &ldquo;{query}&rdquo;</p>
            </div>
          )}

          {results.length > 0 && (
            <div className="py-2">
              <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-pib-text-muted)]">
                Results
              </p>
              {results.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.href)}
                  className={[
                    'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                    idx === selectedIndex
                      ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
                      : 'text-[var(--color-pib-text)] hover:bg-white/[0.04]',
                  ].join(' ')}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <span className={[
                    'material-symbols-outlined text-[18px] shrink-0',
                    idx === selectedIndex ? 'text-[var(--color-pib-accent)]' : 'text-[var(--color-pib-text-muted)]',
                  ].join(' ')}>
                    {item.icon}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{item.title}</span>
                    <span className="block text-[11px] text-[var(--color-pib-text-muted)]">{item.subtitle}</span>
                  </span>
                  <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)] opacity-50">arrow_forward</span>
                </button>
              ))}
            </div>
          )}

          {/* Shortcuts (shown when query is empty) */}
          {!query.trim() && (
            <div className="py-2">
              <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-pib-text-muted)]">
                Keyboard shortcuts
              </p>
              {SHORTCUTS.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)] shrink-0">keyboard</span>
                  <span className="flex-1 text-sm text-[var(--color-pib-text)]">
                    {s.href ? (
                      <button
                        type="button"
                        onClick={() => navigate(s.href!)}
                        className="hover:text-[var(--color-pib-accent)] transition-colors text-left"
                      >
                        {s.label}
                      </button>
                    ) : (
                      s.label
                    )}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {s.keys.map((k, ki) => (
                      <kbd
                        key={ki}
                        className="text-[10px] text-[var(--color-pib-text-muted)] bg-white/[0.06] border border-[var(--color-pib-line)] rounded px-1.5 py-0.5 font-mono"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
