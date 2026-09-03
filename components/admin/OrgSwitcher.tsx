'use client'

import { useEffect, useLayoutEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, usePathname } from 'next/navigation'
import { useOrg } from '@/lib/contexts/OrgContext'
import type { OrganizationSummary } from '@/lib/organizations/types'

import { Icon } from '@/components/studio'

const LS_RECENT_KEY = 'pib_recent_orgs'
const MAX_RECENTS = 5
const MENU_MIN_WIDTH = 280
const MENU_VIEWPORT_GAP = 8

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

type MenuPosition = {
  top: number
  left: number
  width: number
  maxHeight: number
}

function positionMenu(trigger: HTMLElement): MenuPosition {
  const rect = trigger.getBoundingClientRect()
  const width = Math.min(
    Math.max(rect.width, MENU_MIN_WIDTH),
    window.innerWidth - MENU_VIEWPORT_GAP * 2,
  )
  let left = rect.left
  if (left + width > window.innerWidth - MENU_VIEWPORT_GAP) {
    left = Math.max(MENU_VIEWPORT_GAP, window.innerWidth - MENU_VIEWPORT_GAP - width)
  }
  const top = Math.min(rect.bottom + 6, window.innerHeight - MENU_VIEWPORT_GAP)
  const maxHeight = Math.max(160, window.innerHeight - top - MENU_VIEWPORT_GAP)
  return { top, left, width, maxHeight }
}

export function OrgSwitcher() {
  const { selectedOrgId, orgName, orgs: contextOrgs, setOrg, clearOrg } = useOrg()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null)
  const [recentIds, setRecentIds] = useState<string[]>(() => (typeof window === 'undefined' ? [] : loadRecents()))
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
      setSearch('')
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setMenuPos(null)
      return
    }

    const update = () => {
      if (!triggerRef.current) return
      setMenuPos(positionMenu(triggerRef.current))
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

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
    // deeper record path  -  a project or post ID from the old org is meaningless.
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

  const menu = open && menuPos && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Organisations"
          className="fixed z-[80] bg-[var(--color-pib-surface)] border border-[var(--color-pib-line-strong)] rounded-md overflow-hidden"
          style={{
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            maxHeight: menuPos.maxHeight,
          }}
        >
          <div className="flex flex-col max-h-[inherit]">
            <button
              onClick={selectAllOrgs}
              className="w-full text-left px-3.5 py-2.5 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.03] transition-colors border-b border-[var(--color-pib-line)] flex items-center gap-2.5 shrink-0"
            >
              <Icon name="grid_view" className="text-[18px]" />
              All orgs
            </button>

            {recentOrgs.length > 0 && (
              <div className="border-b border-[var(--color-pib-line)] shrink-0">
                <p className="px-3.5 pt-2.5 pb-1 text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                  Recent
                </p>
                {recentOrgs.map((org) => (
                  <button
                    key={org.id}
                    onClick={() => selectOrg(org)}
                    className={[
                      'w-full text-left px-3.5 py-2 text-sm transition-colors hover:bg-white/[0.03] flex items-center gap-2.5',
                      selectedOrgId === org.id ? 'text-[var(--color-pib-accent-hover)]' : 'text-[var(--color-pib-text)]',
                    ].join(' ')}
                  >
                    <span className="w-5 h-5 rounded-md bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] flex items-center justify-center text-[10px] font-medium text-[var(--color-pib-text-muted)] shrink-0">
                      {org.name?.[0]?.toUpperCase() ?? '?'}
                    </span>
                    <span className="truncate">{org.name}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="px-3.5 py-2 border-b border-[var(--color-pib-line)] shrink-0">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--color-pib-surface-2)] rounded-lg">
                <Icon name="search" className="text-[16px] text-[var(--color-pib-text-muted)] shrink-0" />
                <input aria-label="Search orgs"
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search orgs…"
                  className="flex-1 bg-transparent text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] outline-none"
                />
                {search && (
                  <button aria-label="Search orgs…" onClick={() => setSearch('')} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
                    <Icon name="close" className="text-[14px]" />
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-y-auto min-h-0 flex-1">
              {filtered.map((org) => (
                <button
                  key={org.id}
                  onClick={() => selectOrg(org)}
                  className={[
                    'w-full text-left px-3.5 py-2.5 text-sm transition-colors hover:bg-white/[0.03] flex items-center gap-2.5',
                    selectedOrgId === org.id ? 'text-[var(--color-pib-accent-hover)]' : 'text-[var(--color-pib-text)]',
                  ].join(' ')}
                >
                  <span className="w-5 h-5 rounded-md bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] flex items-center justify-center text-[10px] font-medium text-[var(--color-pib-text-muted)] shrink-0">
                    {org.name?.[0]?.toUpperCase() ?? '?'}
                  </span>
                  <span className="truncate">{org.name}</span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-3.5 py-2.5 text-xs text-[var(--color-pib-text-muted)]">No orgs match &quot;{search}&quot;</p>
              )}
              {contextOrgs.length === 0 && !search && (
                <p className="px-3.5 py-2.5 text-xs text-[var(--color-pib-text-muted)]">No organisations yet</p>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <div ref={ref} className="relative px-3">
      <button
        ref={triggerRef}
        onClick={toggleOpen}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] rounded-lg text-[var(--color-pib-text)] hover:border-[var(--color-pib-line-strong)] transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="w-6 h-6 rounded-md bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line)] flex items-center justify-center text-[10px] font-medium text-[var(--color-pib-accent-hover)] shrink-0">
          {initial}
        </span>
        <span className="truncate flex-1 text-left">{label}</span>
        <Icon name="unfold_more" className="text-[18px] text-[var(--color-pib-text-muted)]" />
      </button>
      {menu}
    </div>
  )
}
