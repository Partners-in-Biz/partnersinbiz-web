'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from '@/components/studio'

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

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

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
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl mx-4 overflow-hidden rounded-[var(--st-radius-raised)] bg-[var(--sc-surface)] text-[var(--sc-ink)] shadow-[var(--sc-shadow)]"
        style={{ boxShadow: 'var(--sc-shadow), inset 0 0 0 1px var(--sc-edge-light, var(--sc-line))' }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 px-3 min-h-11 border-b border-[var(--sc-line)]">
          <Icon name="search" className="shrink-0 text-[var(--sc-ink-soft)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search contacts, documents…"
            className="flex-1 bg-transparent sc-body text-[var(--sc-ink)] placeholder:text-[var(--sc-ink-soft)] outline-none min-h-11"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search"
          />
          {loading && (
            <span
              className="shrink-0 h-3.5 w-3.5 border-2 border-[var(--sc-accent)] border-t-transparent rounded-full animate-spin"
              aria-hidden="true"
            />
          )}
          {!loading && (
            <kbd className="sc-tiny shrink-0 text-[var(--sc-ink-soft)] border border-[var(--sc-line)] rounded-[var(--st-radius)] px-1.5 py-0.5">
              Esc
            </kbd>
          )}
        </div>

        <div className="max-h-[52vh] overflow-y-auto">
          {query.trim() && !loading && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 gap-1.5 text-[var(--sc-ink-soft)]">
              <Icon name="search_off" className="opacity-50" />
              <p className="sc-body text-[0.8125rem] m-0">No results for &ldquo;{query}&rdquo;.</p>
            </div>
          )}

          {results.length > 0 && (
            <div className="py-1">
              <p className="sc-tiny px-3 py-1 text-[var(--sc-ink-soft)]">Results</p>
              {results.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.href)}
                  className={[
                    'w-full flex items-center gap-2 px-3 min-h-11 text-left transition-colors',
                    idx === selectedIndex
                      ? 'bg-[var(--sc-canvas)] text-[var(--sc-ink)]'
                      : 'text-[var(--sc-ink)] hover:bg-[var(--sc-canvas)]',
                  ].join(' ')}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <Icon name={item.icon} className="shrink-0 text-[var(--sc-ink-soft)]" />
                  <span className="flex-1 min-w-0">
                    <span className="block sc-body text-[0.875rem] truncate">{item.title}</span>
                    <span className="block sc-tiny text-[var(--sc-ink-soft)]">{item.subtitle}</span>
                  </span>
                  <Icon name="arrow_forward" className="text-[var(--sc-ink-soft)] opacity-50" />
                </button>
              ))}
            </div>
          )}

          {!query.trim() && (
            <div className="py-1">
              <p className="sc-tiny px-3 py-1 text-[var(--sc-ink-soft)]">Keyboard shortcuts</p>
              {SHORTCUTS.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center gap-2 px-3 min-h-11"
                >
                  <Icon name="keyboard" className="shrink-0 text-[var(--sc-ink-soft)]" />
                  <span className="flex-1 sc-body text-[0.875rem] text-[var(--sc-ink)]">
                    {s.href ? (
                      <button
                        type="button"
                        onClick={() => navigate(s.href!)}
                        className="hover:underline underline-offset-2 text-left"
                      >
                        {s.label}
                      </button>
                    ) : (
                      s.label
                    )}
                  </span>
                  <span className="flex items-center gap-0.5 shrink-0">
                    {s.keys.map((k, ki) => (
                      <kbd
                        key={ki}
                        className="sc-tiny text-[var(--sc-ink-soft)] border border-[var(--sc-line)] rounded-[var(--st-radius)] px-1.5 py-0.5"
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
