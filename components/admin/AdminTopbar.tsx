import type { ReactNode } from 'react'
import { NotificationBell } from '@/components/crm/NotificationBell'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { Avatar, Crumbs, Icon } from '@/components/studio'

interface AdminTopbarProps {
  userEmail: string
  userUid: string
  orgId: string
  onMenuClick?: () => void
  /** @deprecated Layout switcher is retired. Prop kept for API compatibility. */
  onToggleLayout?: () => void
  onOpenSearch?: () => void
  messageAction?: ReactNode
}

export function AdminTopbar({
  userEmail,
  userUid,
  orgId,
  onMenuClick,
  onOpenSearch,
  messageAction,
}: AdminTopbarProps) {
  const initials = userEmail.split(/[.\s@]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')

  return (
    <header
      className="st-topbar sticky top-0 z-30 flex shrink-0 items-center justify-between gap-2 bg-[var(--sc-canvas)] px-3 md:px-4"
      style={{ height: 'calc(var(--sc-u) * 14)' }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open menu"
          className="md:hidden flex min-h-11 min-w-11 flex-col items-center justify-center gap-[3px] rounded hover:bg-black/[0.05] transition-colors -ml-1"
        >
          <span className="block h-[1.5px] w-3.5 bg-[var(--sc-ink-soft)]" />
          <span className="block h-[1.5px] w-3.5 bg-[var(--sc-ink-soft)]" />
          <span className="block h-[1.5px] w-3.5 bg-[var(--sc-ink-soft)]" />
        </button>
        <Crumbs
          items={[
            { label: 'Admin console' },
            { label: 'Partners in Biz' },
          ]}
        />
      </div>
      <div className="flex items-center gap-1 md:gap-1.5">
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
        <Avatar initials={initials || '·'} size="sm" alt="" />
        <a
          href="/api/auth/logout"
          className="inline-flex items-center gap-1 text-xs text-[var(--sc-ink-soft)] hover:text-[var(--sc-ink)] transition-colors"
        >
          <Icon name="logout" />
          <span className="hidden sm:inline">Sign out</span>
        </a>
      </div>
    </header>
  )
}
