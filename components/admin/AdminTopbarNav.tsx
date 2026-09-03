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
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { Avatar, Icon } from '@/components/studio'
import {
  OPERATOR_NAV_TOPBAR,
  workspaceNav,
  type NavItem,
} from './navConfig'

interface AdminTopbarNavProps {
  userEmail: string
  userUid: string
  orgId: string
  /** @deprecated Layout switcher is retired. Prop kept for API compatibility. */
  onToggleLayout: () => void
  onOpenSearch?: () => void
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
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-active={isActive ? 'true' : undefined}
        className="pib-nav-item min-h-11 whitespace-nowrap"
      >
        <Icon name={item.icon} className={isActive ? 'text-[var(--sc-accent)]' : 'opacity-70'} />
        <span className="hidden lg:inline font-medium">{item.label}</span>
        <Icon name="expand_more" className={['transition-transform duration-150', open ? 'rotate-180' : ''].join(' ')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 min-w-[160px] overflow-hidden rounded-[var(--st-radius-raised)] border border-[var(--sc-line)] bg-[var(--sc-surface)] py-1 shadow-[var(--sc-shadow)]">
          {item.children!.map((child) => {
            const childActive = pathname === child.href || pathname.startsWith(child.href + '/')
            return (
              <Link
                key={child.href}
                href={child.href}
                data-active={childActive ? 'true' : undefined}
                className="pib-nav-item w-full rounded-none"
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
      data-active={isActive ? 'true' : undefined}
      className="pib-nav-item min-h-11 whitespace-nowrap"
    >
      <Icon name={item.icon} className={isActive ? 'text-[var(--sc-accent)]' : 'opacity-70'} />
      <span className="hidden lg:inline font-medium">{item.label}</span>
    </Link>
  )
}

function NavItemRenderer({ item, pathname }: { item: NavItem; pathname: string }) {
  if (item.children?.length) return <TopbarDropdown item={item} pathname={pathname} />
  return <TopbarNavLink item={item} pathname={pathname} />
}

// ── Main topbar nav ─────────────────────────────────────────────────────────

export function AdminTopbarNav({
  userEmail,
  userUid,
  orgId,
  onOpenSearch,
  messageAction,
}: AdminTopbarNavProps) {
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
      <header
        className="sticky top-0 z-30 shrink-0 border-b border-[var(--sc-line)] bg-[var(--sc-canvas)]"
        style={{ height: 'calc(var(--sc-u) * 14)' }}
      >
        <div className="flex h-full w-full items-center gap-2 px-3">

          {/* Brand */}
          <Link href="/admin/dashboard" className="mr-1 flex shrink-0 items-center gap-1.5">
            <Image src="/pib-logo-512.png" alt="Partners in Biz" width={20} height={20} className="rounded object-contain" />
            <span className="sc-tiny hidden text-[var(--sc-ink)] sm:block">Partners in Biz</span>
            <span className="sc-tiny text-[var(--sc-ink-soft)]">
              {isWorkspaceMode ? workspaceLabel : 'Admin'}
            </span>
          </Link>

          {/* Org switcher */}
          <div className="hidden shrink-0 md:block">
            <OrgSwitcher />
          </div>

          <div className="hidden h-4 w-px shrink-0 bg-[var(--sc-line)] md:block" />

          {/* Nav + tools — scrollable */}
          <nav className="scrollbar-none hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:flex">
            {navItems.map((item) => (
              <NavItemRenderer key={item.href} item={item} pathname={pathname} />
            ))}
          </nav>

          {/* Right side */}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {onOpenSearch ? (
              <button
                type="button"
                onClick={onOpenSearch}
                data-tip="Search (⌘K)"
                data-tip-side="bottom"
                aria-label="Search"
                className="flex h-11 w-11 items-center justify-center rounded text-[var(--sc-ink-soft)] hover:bg-black/[0.05] hover:text-[var(--sc-ink)] transition-colors"
              >
                <Icon name="search" />
              </button>
            ) : null}
            <ThemeToggle />
            <NotificationBell mode="admin" orgId={orgId} userId={userUid} />
            {messageAction}
            {isWorkspaceMode && selectedOrg?.id && (
              <PortalViewSwitch orgId={selectedOrg.id} compact />
            )}
            <Avatar initials={initials || '·'} size="sm" alt="" />
            <a
              href="/api/auth/logout"
              aria-label="Logout"
              className="inline-flex items-center gap-1 text-xs text-[var(--sc-ink-soft)] hover:text-[var(--sc-ink)] transition-colors"
            >
              <Icon name="logout" />
            </a>

            {/* Mobile hamburger */}
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Open menu"
              className="md:hidden flex min-h-11 min-w-11 flex-col items-center justify-center gap-[3px] rounded hover:bg-black/[0.05] transition-colors"
            >
              <span className="block h-[1.5px] w-3.5 bg-[var(--sc-ink-soft)]" />
              <span className="block h-[1.5px] w-3.5 bg-[var(--sc-ink-soft)]" />
              <span className="block h-[1.5px] w-3.5 bg-[var(--sc-ink-soft)]" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex flex-col md:hidden">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 mt-14 flex max-h-[80vh] flex-col gap-0.5 overflow-y-auto border-b border-[var(--sc-line)] bg-[var(--sc-surface)] p-3">
            <OrgSwitcher />
            <div className="my-1.5 h-px bg-[var(--sc-line)]" />
            {isWorkspaceMode && selectedOrg?.id && (
              <PortalViewSwitch orgId={selectedOrg.id} />
            )}
            {isWorkspaceMode && selectedOrg?.id && (
              <div className="my-1.5 h-px bg-[var(--sc-line)]" />
            )}
            {navItems.map((item) => (
              <MobileNavItem key={item.href} item={item} pathname={pathname} />
            ))}
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
        data-active={isActive ? 'true' : undefined}
        className="pib-nav-item min-h-11"
      >
        <Icon name={item.icon} className={isActive ? 'text-[var(--sc-accent)]' : 'opacity-70'} />
        {item.label}
      </Link>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-active={isActive ? 'true' : undefined}
        className="pib-nav-item min-h-11 w-full"
      >
        <Icon name={item.icon} className={isActive ? 'text-[var(--sc-accent)]' : 'opacity-70'} />
        <span className="flex-1 text-left">{item.label}</span>
        <Icon name="expand_more" className={['transition-transform duration-150', open ? 'rotate-180' : ''].join(' ')} />
      </button>
      {open && (
        <div className="ml-7 mt-0.5 flex flex-col gap-0.5">
          {item.children!.map((child) => {
            const childActive = pathname === child.href || pathname.startsWith(child.href + '/')
            return (
              <Link
                key={child.href}
                href={child.href}
                data-active={childActive ? 'true' : undefined}
                className="pib-nav-item min-h-11"
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
