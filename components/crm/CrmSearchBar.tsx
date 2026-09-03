'use client'

import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { scopedApiPath, scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { Icon } from '@/components/studio'

interface ContactResult {
  id: string
  name?: string
  email?: string
}

interface CompanyResult {
  id: string
  name: string
}

interface DealResult {
  id: string
  title: string
  currency?: string
  value?: number
}

interface Props {
  className?: string
  orgScope?: PortalOrgRouteScope
}

function contactResultLabel(contact: ContactResult): string {
  return contact.name?.trim() || contact.email?.trim() || 'Contact identity missing'
}

export function CrmSearchBar({ className, orgScope }: Props) {
  const [query, setQuery] = useState('')
  const [contacts, setContacts] = useState<ContactResult[]>([])
  const [companies, setCompanies] = useState<CompanyResult[]>([])
  const [deals, setDeals] = useState<DealResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchScope = useMemo(() => orgScope ?? {}, [orgScope])
  const crmApiPath = useCallback((path: string) => scopedApiPath(path, searchScope), [searchScope])
  const crmPortalPath = useCallback((path: string) => scopedPortalPath(path, searchScope), [searchScope])

  // Click-outside closes dropdown
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  const runSearch = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const [cRes, coRes, dRes] = await Promise.allSettled([
        fetch(crmApiPath(`/api/v1/crm/contacts?search=${encodeURIComponent(q)}&limit=5`)),
        fetch(crmApiPath(`/api/v1/crm/companies?search=${encodeURIComponent(q)}&limit=5`)),
        fetch(crmApiPath(`/api/v1/crm/deals?search=${encodeURIComponent(q)}&limit=5`)),
      ])

      if (cRes.status === 'fulfilled' && cRes.value.ok) {
        const body = await cRes.value.json()
        setContacts(body.data?.contacts ?? body.data ?? [])
      } else {
        setContacts([])
      }

      if (coRes.status === 'fulfilled' && coRes.value.ok) {
        const body = await coRes.value.json()
        setCompanies(body.data?.companies ?? body.data ?? [])
      } else {
        setCompanies([])
      }

      if (dRes.status === 'fulfilled' && dRes.value.ok) {
        const body = await dRes.value.json()
        setDeals(body.data?.deals ?? body.data ?? [])
      } else {
        setDeals([])
      }

      setOpen(true)
    } catch {
      // network failure - show empty sections
      setContacts([])
      setCompanies([])
      setDeals([])
      setOpen(true)
    } finally {
      setLoading(false)
    }
  }, [crmApiPath])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)

    if (timerRef.current) clearTimeout(timerRef.current)

    if (val.length < 2) {
      setOpen(false)
      setContacts([])
      setCompanies([])
      setDeals([])
      return
    }

    timerRef.current = setTimeout(() => {
      runSearch(val)
    }, 300)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  function clearAndClose() {
    setQuery('')
    setOpen(false)
    setContacts([])
    setCompanies([])
    setDeals([])
  }

  const hasResults = contacts.length > 0 || companies.length > 0 || deals.length > 0

  return (
    <div ref={containerRef} className={['relative', className].filter(Boolean).join(' ')}>
      {/* Input */}
      <div
        className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 transition-colors focus-within:border-primary/40"
      >
        {loading ? (
          <Icon name="progress_activity" className="text-[var(--color-pib-text-muted)]" />
        ) : (
          <Icon name="search" className="text-[var(--color-pib-text-muted)]" />
        )}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Search CRM…"
          className="min-w-0 flex-1 bg-transparent text-xs text-[var(--color-pib-text)] outline-none placeholder:text-[var(--color-pib-text-muted)]"
          aria-label="Search contacts, companies, and deals"
          autoComplete="off"
        />
        {query && (
          <button
            onClick={clearAndClose}
            className="text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
            aria-label="Clear search"
          >
            <Icon name="close" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute top-full left-0 right-0 z-50 mt-1 overflow-hidden rounded-lg border border-[var(--color-card-border)]"
          style={{ background: 'var(--color-sidebar, var(--color-pib-surface))' }}
        >
          {!hasResults ? (
            <p className="px-3 py-2.5 text-center text-xs text-[var(--color-pib-text-muted)]">
              No results for &ldquo;{query}&rdquo;
            </p>
          ) : (
            <div className="max-h-[400px] overflow-y-auto py-1">
              {contacts.length > 0 && (
                <section>
                  <p className="px-3 py-1 text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Contacts</p>
                  {contacts.map(c => (
                    <Link
                      key={c.id}
                      href={crmPortalPath(`/portal/contacts/${c.id}`)}
                      onClick={clearAndClose}
                      className="flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-white/[0.05]"
                    >
                      <span aria-hidden="true" className="shrink-0" style={{ width: '1.5rem', height: '1.5rem', borderRadius: '8px' }}>
                        <Icon name="person" />
                      </span>
                      <span className="flex-1 truncate text-xs text-[var(--color-pib-text)]">{contactResultLabel(c)}</span>
                      <span className="shrink-0 text-[11px] text-[var(--color-pib-text-muted)]">Contact</span>
                    </Link>
                  ))}
                </section>
              )}

              {companies.length > 0 && (
                <section>
                  {contacts.length > 0 && <div className="mx-3 my-1 h-px bg-[var(--color-card-border)]" />}
                  <p className="px-3 py-1 text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Companies</p>
                  {companies.map(co => (
                    <Link
                      key={co.id}
                      href={crmPortalPath(`/portal/companies/${co.id}`)}
                      onClick={clearAndClose}
                      className="flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-white/[0.05]"
                    >
                      <span aria-hidden="true" className="shrink-0" style={{ width: '1.5rem', height: '1.5rem', borderRadius: '8px' }}>
                        <Icon name="business" />
                      </span>
                      <span className="flex-1 truncate text-xs text-[var(--color-pib-text)]">{co.name}</span>
                      <span className="shrink-0 text-[11px] text-[var(--color-pib-text-muted)]">Company</span>
                    </Link>
                  ))}
                </section>
              )}

              {deals.length > 0 && (
                <section>
                  {(contacts.length > 0 || companies.length > 0) && <div className="mx-3 my-1 h-px bg-[var(--color-card-border)]" />}
                  <p className="px-3 py-1 text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Deals</p>
                  {deals.map(d => (
                    <Link
                      key={d.id}
                      href={crmPortalPath(`/portal/deals/${d.id}`)}
                      onClick={clearAndClose}
                      className="flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-white/[0.05]"
                    >
                      <span aria-hidden="true" className="shrink-0" style={{ width: '1.5rem', height: '1.5rem', borderRadius: '8px' }}>
                        <Icon name="handshake" />
                      </span>
                      <span className="flex-1 truncate text-xs text-[var(--color-pib-text)]">{d.title}</span>
                      <span className="shrink-0 text-[11px] text-[var(--color-pib-text-muted)]">
                        Deal{d.value != null ? ` · ${d.currency ?? ''} ${d.value.toLocaleString()}` : ''}
                      </span>
                    </Link>
                  ))}
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
