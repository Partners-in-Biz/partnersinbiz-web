'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useOrg } from '@/lib/contexts/OrgContext'
import type { OrganizationSummary } from '@/lib/organizations/types'

const LS_RECENT_KEY = 'pib_recent_orgs'
const MAX_RECENTS = 5

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(LS_RECENT_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function saveRecents(ids: string[]) {
  try {
    localStorage.setItem(LS_RECENT_KEY, JSON.stringify(ids))
  } catch {}
}

function pushRecent(current: string[], id: string): string[] {
  const deduped = [id, ...current.filter((x) => x !== id)]
  return deduped.slice(0, MAX_RECENTS)
}

export function OrgSwitcher() {
  const { selectedOrgId, orgName, orgs: contextOrgs, setOrg, clearOrg } = useOrg()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [recentIds, setRecentIds] = useState<string[]>(() => (typeof window === 'undefined' ? [] : loadRecents()))
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open])

  function toggleOpen() {
    setOpen((current) => {
      if (current) setSearch('')
      return !current
    })
  }

  function selectOrg(org: OrganizationSummary) {
    const next = pushRecent(recentIds, org.id)
    setRecentIds(next)
    saveRecents(next)
    setOrg(org.id, org.name)
    setOpen(false)
    setSearch('')
    // Keep the top-level section (e.g. /messages, /projects) but drop any
    // deeper record path — a project or post ID from the old org is meaningless.
    const orgMatch = pathname.match(/^\/admin\/org\/[^/]+\/([^/]+)/)
    const section = orgMatch ? `/${orgMatch[1]}` : '/dashboard'
    router.push(`/admin/org/${org.slug}${section}`)
  }

  function selectAllOrgs() {
    clearOrg()
    setOpen(false)
    setSearch('')
    router.push('/admin/dashboard')
  }

  const label = orgName || selectedOrgId || 'All orgs'
  const initial = (orgName || 'A')[0]?.toUpperCase()

  const recentOrgs = recentIds
    .map((id) => contextOrgs.find((o) => o.id === id))
    .filter(Boolean) as OrganizationSummary[]

  const filtered = search.trim()
    ? contextOrgs.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()))
    : contextOrgs

  return (
    <div ref={ref} className="relative px-3">
      <button
        onClick={toggleOpen}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] rounded-lg text-[var(--color-pib-text)] hover:border-[var(--color-pib-line-strong)] transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="w-6 h-6 rounded-md bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line)] flex items-center justify-center text-[10px] font-bold text-[var(--color-pib-accent-hover)] shrink-0">
          {initial}
        </span>
        <span className="truncate flex-1 text-left">{label}</span>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">unfold_more</span>
      </button>

      {open && (
        <div className="absolute left-3 right-3 mt-1.5 z-50 bg-[var(--color-pib-surface)] border border-[var(--color-pib-line-strong)] rounded-xl shadow-2xl overflow-hidden">
          {/* All orgs */}
          <button
            onClick={selectAllOrgs}
            className="w-full text-left px-3 py-2.5 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.03] transition-colors border-b border-[var(--color-pib-line)] flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">grid_view</span>
            All orgs
          </button>

          {/* Recents */}
          {recentOrgs.length > 0 && (
            <div className="border-b border-[var(--color-pib-line)]">
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                Recent
              </p>
              {recentOrgs.map((org) => (
                <button
                  key={org.id}
                  onClick={() => selectOrg(org)}
                  className={[
                    'w-full text-left px-3 py-2 text-sm transition-colors hover:bg-white/[0.03] flex items-center gap-2',
                    selectedOrgId === org.id ? 'text-[var(--color-pib-accent-hover)]' : 'text-[var(--color-pib-text)]',
                  ].join(' ')}
                >
                  <span className="w-5 h-5 rounded-md bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] flex items-center justify-center text-[10px] font-bold text-[var(--color-pib-text-muted)] shrink-0">
                    {org.name?.[0]?.toUpperCase() ?? '?'}
                  </span>
                  {org.name}
                </button>
              ))}
            </div>
          )}

          {/* Search + full list */}
          <div className="px-3 py-2 border-b border-[var(--color-pib-line)]">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-[var(--color-pib-surface-2)] rounded-lg">
              <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)] shrink-0">search</span>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search orgs…"
                className="flex-1 bg-transparent text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] outline-none"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              )}
            </div>
          </div>

          <div className="max-h-48 overflow-y-auto">
            {filtered.map((org) => (
              <button
                key={org.id}
                onClick={() => selectOrg(org)}
                className={[
                  'w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-white/[0.03] flex items-center gap-2',
                  selectedOrgId === org.id ? 'text-[var(--color-pib-accent-hover)]' : 'text-[var(--color-pib-text)]',
                ].join(' ')}
              >
                <span className="w-5 h-5 rounded-md bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] flex items-center justify-center text-[10px] font-bold text-[var(--color-pib-text-muted)] shrink-0">
                  {org.name?.[0]?.toUpperCase() ?? '?'}
                </span>
                {org.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2.5 text-xs text-[var(--color-pib-text-muted)]">No orgs match &quot;{search}&quot;</p>
            )}
            {contextOrgs.length === 0 && !search && (
              <p className="px-3 py-2.5 text-xs text-[var(--color-pib-text-muted)]">No organisations yet</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
