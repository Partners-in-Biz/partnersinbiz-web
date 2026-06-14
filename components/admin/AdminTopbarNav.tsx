'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useOrg } from '@/lib/contexts/OrgContext'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { OrgSwitcher } from './OrgSwitcher'
import { NotificationBell } from '@/components/crm/NotificationBell'
import { PortalViewSwitch } from './PortalViewSwitch'
import {
  OPERATOR_NAV_TOPBAR,
  workspaceNav,
  type NavItem,
} from './navConfig'

interface AdminTopbarNavProps {
  userEmail: string
  userUid: string
  orgId: string
  onToggleLayout: () => void
  messageAction?: ReactNode
}

// ── Dropdown nav item ───────────────────────────────────────────────────────

function isItemActive(item: NavItem, pathname: string) {
  if (pathname === item.href || pathname.startsWith(item.href + '/')) return true
  if (item.children?.some((child) => pathname === child.href || pathname.startsWith(child.href + '/'))) return true
  return item.activePatterns?.some((pattern) => pathname === pattern || pathname.startsWith(pattern + '/')) ?? false
}

function TopbarDropdown({ item, pathname }: { item: NavItem; pathname: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isActive = isItemActive(item, pathname)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  // close on nav
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false)
  }, [pathname])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={[
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-all duration-150',
          isActive
            ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
            : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]',
        ].join(' ')}
      >
        <span className={['material-symbols-outlined text-[18px] shrink-0', isActive ? 'text-[var(--color-pib-accent)]' : 'opacity-70'].join(' ')}>
          {item.icon}
        </span>
        <span className="hidden lg:inline font-medium">{item.label}</span>
        <span className={['material-symbols-outlined text-[14px] transition-transform duration-150', open ? 'rotate-180' : ''].join(' ')}>
          expand_more
        </span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[160px] bg-[var(--color-sidebar)] border border-[var(--color-pib-line)] rounded-xl shadow-xl py-1 overflow-hidden">
          {item.children!.map((child) => {
            const childActive = pathname === child.href || pathname.startsWith(child.href + '/')
            return (
              <Link
                key={child.href}
                href={child.href}
                className={[
                  'block px-4 py-2 text-sm transition-colors',
                  childActive
                    ? 'text-[var(--color-pib-accent-hover)] bg-[var(--color-pib-accent-soft)]'
                    : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]',
                ].join(' ')}
              >
                {child.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Direct nav link ─────────────────────────────────────────────────────────

function TopbarNavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive = isItemActive(item, pathname)
  return (
    <Link
      href={item.href}
      className={[
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-all duration-150',
        isActive
          ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
          : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]',
      ].join(' ')}
    >
      <span className={['material-symbols-outlined text-[18px] shrink-0', isActive ? 'text-[var(--color-pib-accent)]' : 'opacity-70'].join(' ')}>
        {item.icon}
      </span>
      <span className="hidden lg:inline font-medium">{item.label}</span>
    </Link>
  )
}

function NavItemRenderer({ item, pathname }: { item: NavItem; pathname: string }) {
  if (item.children?.length) return <TopbarDropdown item={item} pathname={pathname} />
  return <TopbarNavLink item={item} pathname={pathname} />
}

// ── Main topbar nav ─────────────────────────────────────────────────────────

export function AdminTopbarNav({ userEmail, userUid, orgId, messageAction }: AdminTopbarNavProps) {
  const pathname = usePathname()
  const { selectedOrgId, orgs } = useOrg()
  const [mobileOpen, setMobileOpen] = useState(false)

  const routeOrgSlug = pathname.match(/^\/admin\/org\/([^/]+)/)?.[1]
  const routeOrg = routeOrgSlug ? orgs.find((o) => o.slug === routeOrgSlug) : undefined
  const selectedOrg = routeOrg ?? orgs.find((o) => o.id === selectedOrgId)
  const isWorkspaceMode = !!selectedOrg
  const isPlatformWorkspace = selectedOrg?.type === 'platform_owner' || selectedOrg?.id === PIB_PLATFORM_ORG_ID
  const workspaceLabel = isPlatformWorkspace ? 'Platform admin' : 'Org admin'
  const navItems = isWorkspaceMode ? workspaceNav(selectedOrg.slug) : OPERATOR_NAV_TOPBAR

  const initials = userEmail.split(/[.\s@]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileOpen(false)
  }, [pathname])

  return (
    <>
      <header className="h-14 sticky top-0 z-30 bg-[var(--color-pib-bg)]/95 backdrop-blur-md border-b border-[var(--color-pib-line)] shrink-0">
        <div className="flex items-center h-full px-4 gap-3">

          {/* Brand */}
          <Link href="/admin/dashboard" className="flex items-center gap-2 shrink-0 mr-2">
            <Image src="/pib-logo-512.png" alt="Partners in Biz" width={24} height={24} className="rounded-md object-contain" />
            <span className="hidden sm:block font-display text-base leading-none">Partners in Biz</span>
            <span className={['pill !text-[10px] !py-0.5 !px-2', isWorkspaceMode ? 'pill-accent' : ''].join(' ')}>
              {isWorkspaceMode ? workspaceLabel : 'Admin'}
            </span>
          </Link>

          {/* Org switcher */}
          <div className="hidden md:block shrink-0">
            <OrgSwitcher />
          </div>

          <div className="w-px h-5 bg-[var(--color-pib-line)] shrink-0 hidden md:block" />

          {/* Nav + tools — scrollable */}
          <nav className="hidden md:flex items-center gap-0.5 overflow-x-auto scrollbar-none flex-1 min-w-0">
            {navItems.map((item) => (
              <NavItemRenderer key={item.href} item={item} pathname={pathname} />
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <NotificationBell mode="admin" orgId={orgId} userId={userUid} />
            {messageAction}
            {isWorkspaceMode && selectedOrg?.id && (
              <PortalViewSwitch orgId={selectedOrg.id} compact />
            )}
            {/* Temporarily hidden while the admin layout switcher is being revisited.
            <button
              onClick={onToggleLayout}
              title="Switch to sidebar layout"
              className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">dock_to_right</span>
            </button>
            */}
            <div className="w-8 h-8 rounded-full bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line-strong)] flex items-center justify-center text-xs font-medium text-[var(--color-pib-accent-hover)]">
              {initials || '·'}
            </div>
            <a
              href="/api/auth/logout"
              className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors inline-flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[18px]">logout</span>
            </a>

            {/* Mobile hamburger */}
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Open menu"
              className="md:hidden flex flex-col justify-center items-center w-9 h-9 gap-[4px] rounded-lg hover:bg-white/[0.06] transition-colors"
            >
              <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
              <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
              <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex flex-col">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 mt-14 bg-[var(--color-sidebar)] border-b border-[var(--color-pib-line)] p-4 flex flex-col gap-1 max-h-[80vh] overflow-y-auto">
            <OrgSwitcher />
            <div className="h-px bg-[var(--color-pib-line)] my-2" />
            {isWorkspaceMode && selectedOrg?.id && (
              <PortalViewSwitch orgId={selectedOrg.id} />
            )}
            {isWorkspaceMode && selectedOrg?.id && (
              <div className="h-px bg-[var(--color-pib-line)] my-2" />
            )}
            {navItems.map((item) => (
              <MobileNavItem key={item.href} item={item} pathname={pathname} />
            ))}
            {/* Temporarily hidden while the admin layout switcher is being revisited.
            <div className="h-px bg-[var(--color-pib-line)] my-2" />
            <button
              onClick={onToggleLayout}
              className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] rounded-lg hover:bg-white/[0.04]"
            >
              <span className="material-symbols-outlined text-[18px]">dock_to_right</span>
              Switch to sidebar layout
            </button>
            */}
          </div>
        </div>
      )}
    </>
  )
}

// ── Mobile nav item (expandable accordion) ──────────────────────────────────

function MobileNavItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const [open, setOpen] = useState(false)
  const isActive = isItemActive(item, pathname)

  if (!item.children?.length) {
    return (
      <Link
        href={item.href}
        className={[
          'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
          isActive
            ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
            : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]',
        ].join(' ')}
      >
        <span className="material-symbols-outlined text-[18px] opacity-70">{item.icon}</span>
        {item.label}
      </Link>
    )
  }

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={[
          'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
          isActive
            ? 'text-[var(--color-pib-accent-hover)]'
            : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]',
        ].join(' ')}
      >
        <span className="material-symbols-outlined text-[18px] opacity-70">{item.icon}</span>
        <span className="flex-1 text-left">{item.label}</span>
        <span className={['material-symbols-outlined text-[14px] transition-transform duration-150', open ? 'rotate-180' : ''].join(' ')}>
          expand_more
        </span>
      </button>
      {open && (
        <div className="ml-8 mt-0.5 flex flex-col gap-0.5">
          {item.children!.map((child) => {
            const childActive = pathname === child.href || pathname.startsWith(child.href + '/')
            return (
              <Link
                key={child.href}
                href={child.href}
                className={[
                  'block px-3 py-1.5 rounded-lg text-sm transition-colors',
                  childActive
                    ? 'text-[var(--color-pib-accent-hover)] bg-[var(--color-pib-accent-soft)]'
                    : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]',
                ].join(' ')}
              >
                {child.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
