'use client'

import Link from 'next/link'
import Image from 'next/image'
import { SupportDrawer } from '@/components/support/SupportDrawer'
import { NotificationBell } from '@/components/crm/NotificationBell'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { MessageDrawer } from '@/components/chat/MessageDrawer'
import { ThemedSelect } from '@/components/ui/ThemedSelect'
import type { ContextReferenceSeed } from '@/lib/context-references/types'
import {
  isPortalNavActive,
  type PortalNavItem,
  type PortalWorkspaceOption,
} from './PortalSidebar'

export interface PortalTopbarProps {
  variant: 'sidebar' | 'topbar'
  pathname: string
  dashboardHref: string
  changelogHref: string
  profileHref: string
  portalWorkspaceLabel: string
  pageLabel: string
  workspaceOptions: PortalWorkspaceOption[]
  activeOrgId: string
  orgName: string
  workspaceSwitcherLocked: boolean
  onOrgSwitch: (orgId: string) => void
  canOpenAdminView: boolean
  adminViewHref: string
  changelogUnread: number
  initials: string
  uid: string
  displayName: string
  currentPageContext: ContextReferenceSeed | null
  allowAgentParticipants: boolean
  navItems: PortalNavItem[]
  drawerOpen: boolean
  onOpenDrawer: () => void
  onCloseDrawer: () => void
  onToggleDrawer: () => void
  onBack: () => void
  onOpenCommandPalette: () => void
  onToggleLayout: () => void
  onLogout: () => void
}

export function PortalTopbar({
  variant,
  pathname,
  dashboardHref,
  changelogHref,
  profileHref,
  portalWorkspaceLabel,
  pageLabel,
  workspaceOptions,
  activeOrgId,
  orgName,
  workspaceSwitcherLocked,
  onOrgSwitch,
  canOpenAdminView,
  adminViewHref,
  changelogUnread,
  initials,
  uid,
  displayName,
  currentPageContext,
  allowAgentParticipants,
  navItems,
  drawerOpen,
  onOpenDrawer,
  onCloseDrawer,
  onToggleDrawer,
  onBack,
  onOpenCommandPalette,
  onToggleLayout,
  onLogout,
}: PortalTopbarProps) {
  if (variant === 'topbar') {
    return (
      <>
        <header className="pib-chrome-sticky pib-topbar-dense sticky top-0 z-30 shrink-0">
          <div className="flex items-center h-full px-3 gap-1.5 sm:px-4">
            {/* Brand */}
            <Link href={dashboardHref} className="flex items-center gap-1.5 shrink-0 mr-1">
              <Image src="/pib-logo-512.png" alt="Partners in Biz" width={22} height={22} className="rounded-md object-contain" />
              <span className="hidden sm:block font-display text-sm leading-none">Partners in Biz</span>
              <span className="pill !text-[10px] !py-0.5 !px-1.5">{portalWorkspaceLabel}</span>
            </Link>

            {/* Workspace switcher */}
            {workspaceOptions.length > 0 && (
              <div className="hidden md:block shrink-0">
                <ThemedSelect
                  id="portal-topbar-workspace-switcher"
                  ariaLabel="Switch portal workspace"
                  value={activeOrgId}
                  options={workspaceOptions.map(org => ({ value: org.id, label: org.name }))}
                  onValueChange={onOrgSwitch}
                  disabled={workspaceSwitcherLocked}
                  className="min-w-[140px]"
                  buttonClassName="!h-8 !text-xs"
                  menuClassName="bg-[var(--color-pib-surface)] text-[var(--color-pib-text)]"
                />
              </div>
            )}

            <button
              type="button"
              onClick={onBack}
              aria-label="Go back"
              title="Go back"
              className="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>
            </button>

            <div className="w-px h-4 bg-[var(--color-pib-line)] shrink-0 hidden md:block" />

            {/* Nav — scrollable */}
            <nav className="hidden md:flex items-center gap-0.5 overflow-x-auto scrollbar-none flex-1 min-w-0">
              {navItems.map(item => {
                const on = isPortalNavActive(pathname, item)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-active={on ? 'true' : undefined}
                    className="pib-nav-item whitespace-nowrap shrink-0"
                  >
                    <span className={['material-symbols-outlined text-[18px] shrink-0', on ? 'text-[var(--color-pib-accent)]' : 'opacity-70'].join(' ')}>
                      {item.icon}
                    </span>
                    <span className="hidden lg:inline font-medium">{item.label}</span>
                  </Link>
                )
              })}
            </nav>

            {/* Right side */}
            <div className="flex items-center gap-1 ml-auto shrink-0">
              {canOpenAdminView && (
                <Link
                  href={adminViewHref}
                  data-tip="Switch to admin view"
                  data-tip-side="bottom"
                  aria-label="Switch to admin view"
                  className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">person</span>
                </Link>
              )}
              <Link
                href={changelogHref}
                data-tip={changelogUnread > 0 ? `What's new (${changelogUnread} unread)` : "What's new"}
                data-tip-side="bottom"
                aria-label="What's new"
                className="relative flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05]"
              >
                <span className="material-symbols-outlined text-[18px]">campaign</span>
                {changelogUnread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-pib-accent)] text-[10px] font-semibold text-white flex items-center justify-center">
                    {changelogUnread > 9 ? '9+' : changelogUnread}
                  </span>
                )}
              </Link>
              <button
                onClick={onOpenCommandPalette}
                data-tip="Search (⌘K)"
                data-tip-side="bottom"
                aria-label="Search"
                className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05]"
              >
                <span className="material-symbols-outlined text-[18px]">search</span>
              </button>
              <ThemeToggle />
              <NotificationBell />
              <MessageDrawer
                orgId={activeOrgId}
                orgName={orgName}
                currentUserUid={uid}
                currentUserDisplayName={displayName}
                currentPageContext={currentPageContext}
                allowAgentParticipants={allowAgentParticipants}
              />
              <button
                onClick={onToggleLayout}
                data-tip="Switch to sidebar layout"
                data-tip-side="bottom"
                aria-label="Switch to sidebar layout"
                className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">dock_to_right</span>
              </button>
              <SupportDrawer
                orgId={activeOrgId}
                currentPageContext={currentPageContext}
                triggerClassName="hidden sm:inline-flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
              />
              <div className="w-7 h-7 rounded-full bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line-strong)] flex items-center justify-center text-[11px] font-medium text-[var(--color-pib-accent-hover)]">
                <Link
                  href={profileHref}
                  data-tip="My profile"
                  data-tip-side="bottom"
                  aria-label="My profile"
                  className="grid h-full w-full place-items-center rounded-full"
                >
                  {initials || '·'}
                </Link>
              </div>
              <button
                onClick={onLogout}
                data-tip="Sign out"
                data-tip-side="bottom"
                aria-label="Sign out"
                className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors p-1"
              >
                <span className="material-symbols-outlined text-[18px]">logout</span>
              </button>
              {/* Mobile hamburger — keep touch target */}
              <button
                type="button"
                onClick={onToggleDrawer}
                aria-label="Open menu"
                className="md:hidden flex flex-col justify-center items-center min-h-11 min-w-11 w-11 h-11 gap-[4px] rounded-lg hover:bg-white/[0.06] transition-colors"
              >
                <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
                <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
                <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
              </button>
            </div>
          </div>
        </header>

        {/* Mobile drawer in topbar mode */}
        {drawerOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex flex-col">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCloseDrawer} />
            <div className="pib-chrome-sticky relative z-10 mt-11 flex max-h-[80vh] flex-col gap-0.5 overflow-y-auto p-3">
              {navItems.map(item => {
                const on = isPortalNavActive(pathname, item)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-active={on ? 'true' : undefined}
                    className="pib-nav-item min-h-11 w-full"
                  >
                    <span className={['material-symbols-outlined text-[18px] shrink-0', on ? 'text-[var(--color-pib-accent)]' : 'opacity-70'].join(' ')}>{item.icon}</span>
                    <span className="flex-1 font-medium">{item.label}</span>
                  </Link>
                )
              })}
              <div className="h-px bg-[var(--color-pib-line)] my-1.5" />
              <button
                onClick={onToggleLayout}
                className="pib-nav-item min-h-11 w-full text-left"
              >
                <span className="material-symbols-outlined text-[18px]">dock_to_right</span>
                Switch to sidebar layout
              </button>
              {canOpenAdminView && (
                <Link
                  href={adminViewHref}
                  className="pib-nav-item min-h-11 w-full"
                >
                  <span className="material-symbols-outlined text-[18px] inline-flex items-center justify-center min-w-[18px] min-h-[18px] leading-none">person</span>
                  Switch to admin view
                </Link>
              )}
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <header className="pib-chrome-sticky pib-topbar-dense sticky top-0 z-30 flex items-center gap-2 px-3 md:px-5">
      {/* Mobile hamburger — keep touch target */}
      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label="Open menu"
        className="md:hidden flex flex-col justify-center items-center min-h-11 min-w-11 w-11 h-11 gap-[4px] rounded-lg hover:bg-white/[0.06] transition-colors -ml-1.5"
      >
        <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
        <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
        <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
      </button>
      <button
        type="button"
        onClick={onBack}
        aria-label="Go back"
        data-tip="Go back"
        data-tip-side="bottom"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>
      </button>
      <span className="eyebrow !text-[10px]">Client portal</span>
      <span className="hidden sm:inline w-1 h-1 rounded-full bg-[var(--color-pib-line-strong)]" />
      <span className="hidden sm:inline text-xs text-[var(--color-pib-text-muted)]">
        {pageLabel}
      </span>
      <div className="ml-auto flex items-center gap-1">
        {canOpenAdminView && (
          <Link
            href={adminViewHref}
            data-tip="Switch to admin view"
            data-tip-side="bottom"
            aria-label="Switch to admin view"
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">person</span>
          </Link>
        )}
        <Link
          href={changelogHref}
          data-tip={changelogUnread > 0 ? `What's new (${changelogUnread} unread)` : "What's new"}
          data-tip-side="bottom"
          aria-label="What's new"
          className="relative flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05]"
        >
          <span className="material-symbols-outlined text-[18px]">campaign</span>
          {changelogUnread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-pib-accent)] text-[10px] font-semibold text-white flex items-center justify-center">
              {changelogUnread > 9 ? '9+' : changelogUnread}
            </span>
          )}
        </Link>
        <button
          onClick={onOpenCommandPalette}
          data-tip="Search (⌘K)"
          data-tip-side="bottom"
          aria-label="Search"
          className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05]"
        >
          <span className="material-symbols-outlined text-[18px]">search</span>
        </button>
        <ThemeToggle />
        <NotificationBell />
        <MessageDrawer
          orgId={activeOrgId}
          orgName={orgName}
          currentUserUid={uid}
          currentUserDisplayName={displayName}
          currentPageContext={currentPageContext}
          allowAgentParticipants={allowAgentParticipants}
        />
        <SupportDrawer
          orgId={activeOrgId}
          currentPageContext={currentPageContext}
          triggerClassName="hidden sm:inline-flex items-center gap-1.5 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
        />
      </div>
    </header>
  )
}
