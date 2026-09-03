'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Icon } from '@/components/studio'

interface SearchResult {
  id: string
  type: 'contact' | 'project' | 'task' | 'invoice'
  title: string
  subtitle?: string
  url: string
}

interface SearchResponse {
  results: SearchResult[]
  query: string
  total: number
}

export default function GlobalSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Debounced search
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults([])
      setSelectedIndex(-1)
      return
    }

    const timer = setTimeout(() => {
      setLoading(true)
      fetch(`/api/v1/search?q=${encodeURIComponent(query)}&limit=5`)
        .then((r) => r.json())
        .then((data: SearchResponse) => {
          setResults(data.results || [])
          setSelectedIndex(-1)
          setLoading(false)
        })
        .catch(() => {
          setLoading(false)
        })
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return

    switch (e.key) {
      case 'Escape':
        setOpen(false)
        break
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1))
        break
      case 'Enter':
        e.preventDefault()
        if (selectedIndex >= 0 && results[selectedIndex]) {
          router.push(results[selectedIndex].url)
          setOpen(false)
          setQuery('')
        }
        break
    }
  }

  const groupedResults = {
    contacts: results.filter((r) => r.type === 'contact'),
    projects: results.filter((r) => r.type === 'project'),
    tasks: results.filter((r) => r.type === 'task'),
    invoices: results.filter((r) => r.type === 'invoice'),
  }

  const typeIcons = {
    contact: '👤',
    project: '📁',
    task: '✓',
    invoice: '📄',
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] hover:border-[var(--color-pib-line-strong)] text-[var(--color-pib-text-muted)] text-sm cursor-text transition-colors min-w-[200px]"
        onClick={() => {
          setOpen(true)
          setTimeout(() => inputRef.current?.focus(), 0)
        }}
      >
        <Icon name="search" className="text-[18px] flex-shrink-0" />
        <input aria-label="Search"
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search…"
          className="bg-transparent outline-none text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] flex-1 min-w-0"
        />
        {loading && (
          <div className="w-3 h-3 border border-[var(--color-pib-text-muted)] border-t-transparent animate-spin flex-shrink-0" style={{ borderRadius: '50%' }} />
        )}
      </div>

      {open && query.length >= 2 && (
        <div className="absolute top-full mt-2 left-0 w-80 rounded-md bg-[var(--color-pib-surface)] border border-[var(--color-pib-line-strong)] z-50 overflow-hidden">
          {!results.length && loading ? (
            <div className="p-4 text-sm text-[var(--color-pib-text-muted)] text-center">Searching…</div>
          ) : !results.length && !loading ? (
            <div className="p-4 text-sm text-[var(--color-pib-text-muted)] text-center">
              No results for &quot;{query}&quot;
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {groupedResults.contacts.length > 0 && (
                <div>
                  <p className="px-3 pt-3 pb-1.5 eyebrow !text-[10px]">
                    Contacts
                  </p>
                  {groupedResults.contacts.map((result, idx) => (
                    <Link
                      key={result.id}
                      href={result.url}
                      onClick={() => {
                        setOpen(false)
                        setQuery('')
                      }}
                      className="block px-3 py-2 hover:bg-white/[0.04] transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true" className="text-base">{typeIcons.contact}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--color-pib-text)] truncate">{result.title}</p>
                          {result.subtitle && (
                            <p className="text-xs text-[var(--color-pib-text-muted)] truncate">{result.subtitle}</p>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {groupedResults.projects.length > 0 && (
                <div>
                  <p className="px-3 pt-3 pb-1.5 eyebrow !text-[10px]">
                    Projects
                  </p>
                  {groupedResults.projects.map((result) => (
                    <Link
                      key={result.id}
                      href={result.url}
                      onClick={() => {
                        setOpen(false)
                        setQuery('')
                      }}
                      className="block px-3 py-2 hover:bg-white/[0.04] transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true" className="text-base">{typeIcons.project}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--color-pib-text)] truncate">{result.title}</p>
                          {result.subtitle && (
                            <p className="text-xs text-[var(--color-pib-text-muted)] truncate">{result.subtitle}</p>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {groupedResults.tasks.length > 0 && (
                <div>
                  <p className="px-3 pt-3 pb-1.5 eyebrow !text-[10px]">
                    Tasks
                  </p>
                  {groupedResults.tasks.map((result) => (
                    <Link
                      key={result.id}
                      href={result.url}
                      onClick={() => {
                        setOpen(false)
                        setQuery('')
                      }}
                      className="block px-3 py-2 hover:bg-white/[0.04] transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true" className="text-base">{typeIcons.task}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--color-pib-text)] truncate">{result.title}</p>
                          {result.subtitle && (
                            <p className="text-xs text-[var(--color-pib-text-muted)] truncate">{result.subtitle}</p>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {groupedResults.invoices.length > 0 && (
                <div>
                  <p className="px-3 pt-3 pb-1.5 eyebrow !text-[10px]">
                    Invoices
                  </p>
                  {groupedResults.invoices.map((result) => (
                    <Link
                      key={result.id}
                      href={result.url}
                      onClick={() => {
                        setOpen(false)
                        setQuery('')
                      }}
                      className="block px-3 py-2 hover:bg-white/[0.04] transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true" className="text-base">{typeIcons.invoice}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--color-pib-text)] truncate">{result.title}</p>
                          {result.subtitle && (
                            <p className="text-xs text-[var(--color-pib-text-muted)] truncate">{result.subtitle}</p>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
