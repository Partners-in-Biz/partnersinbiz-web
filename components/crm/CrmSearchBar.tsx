'use client'

import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { scopedApiPath, scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

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
      // network failure — show empty sections
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
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] focus-within:border-[var(--color-pib-accent)] transition-colors"
      >
        {loading ? (
          <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)] animate-spin">progress_activity</span>
        ) : (
          <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">search</span>
        )}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Search CRM…"
          className="flex-1 bg-transparent text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] outline-none min-w-0"
          aria-label="Search contacts, companies, and deals"
          autoComplete="off"
        />
        {query && (
          <button
            onClick={clearAndClose}
            className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
            aria-label="Clear search"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute top-full left-0 right-0 mt-1.5 rounded-[var(--radius-card)] border border-[var(--color-pib-line)] shadow-xl z-50 overflow-hidden"
          style={{ background: 'var(--color-sidebar, var(--color-pib-surface))' }}
        >
          {!hasResults ? (
            <p className="text-xs text-[var(--color-pib-text-muted)] px-4 py-3 text-center">
              No results for &ldquo;{query}&rdquo;
            </p>
          ) : (
            <div className="py-1.5 max-h-[400px] overflow-y-auto">
              {contacts.length > 0 && (
                <section>
                  <p className="eyebrow !text-[10px] px-4 py-1.5">Contacts</p>
                  {contacts.map(c => (
                    <Link
                      key={c.id}
                      href={crmPortalPath(`/portal/contacts/${c.id}`)}
                      onClick={clearAndClose}
                      className="flex items-center gap-2.5 px-4 py-2 hover:bg-[var(--color-pib-surface-2)] transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px] text-[var(--color-pib-text-muted)] shrink-0">person</span>
                      <span className="text-sm flex-1 truncate">{contactResultLabel(c)}</span>
                      <span className="text-xs text-[var(--color-pib-text-muted)] shrink-0">Contact</span>
                    </Link>
                  ))}
                </section>
              )}

              {companies.length > 0 && (
                <section>
                  {contacts.length > 0 && <div className="h-px bg-[var(--color-pib-line)] mx-4 my-1" />}
                  <p className="eyebrow !text-[10px] px-4 py-1.5">Companies</p>
                  {companies.map(co => (
                    <Link
                      key={co.id}
                      href={crmPortalPath(`/portal/companies/${co.id}`)}
                      onClick={clearAndClose}
                      className="flex items-center gap-2.5 px-4 py-2 hover:bg-[var(--color-pib-surface-2)] transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px] text-[var(--color-pib-text-muted)] shrink-0">business</span>
                      <span className="text-sm flex-1 truncate">{co.name}</span>
                      <span className="text-xs text-[var(--color-pib-text-muted)] shrink-0">Company</span>
                    </Link>
                  ))}
                </section>
              )}

              {deals.length > 0 && (
                <section>
                  {(contacts.length > 0 || companies.length > 0) && <div className="h-px bg-[var(--color-pib-line)] mx-4 my-1" />}
                  <p className="eyebrow !text-[10px] px-4 py-1.5">Deals</p>
                  {deals.map(d => (
                    <Link
                      key={d.id}
                      href={crmPortalPath(`/portal/deals/${d.id}`)}
                      onClick={clearAndClose}
                      className="flex items-center gap-2.5 px-4 py-2 hover:bg-[var(--color-pib-surface-2)] transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px] text-[var(--color-pib-text-muted)] shrink-0">handshake</span>
                      <span className="text-sm flex-1 truncate">{d.title}</span>
                      <span className="text-xs text-[var(--color-pib-text-muted)] shrink-0">
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
