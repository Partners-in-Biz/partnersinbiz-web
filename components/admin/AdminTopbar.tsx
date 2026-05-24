import type { ReactNode } from 'react'
import { NotificationBell } from '@/components/crm/NotificationBell'

interface AdminTopbarProps {
  userEmail: string
  userUid: string
  orgId: string
  onMenuClick?: () => void
  onToggleLayout?: () => void
  messageAction?: ReactNode
}

export function AdminTopbar({ userEmail, userUid, orgId, onMenuClick, messageAction }: AdminTopbarProps) {
  const initials = userEmail.split(/[.\s@]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')

  return (
    <header className="h-14 sticky top-0 z-30 bg-[var(--color-pib-bg)]/80 backdrop-blur-md flex items-center justify-between px-4 md:px-6 border-b border-[var(--color-pib-line)] shrink-0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open menu"
          className="md:hidden flex flex-col justify-center items-center w-9 h-9 gap-[4px] rounded-lg hover:bg-white/[0.06] transition-colors -ml-1.5"
        >
          <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
          <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
          <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
        </button>
        <span className="eyebrow !text-[10px]">Admin console</span>
        <span className="hidden sm:inline w-1 h-1 rounded-full bg-[var(--color-pib-line-strong)]" />
        <span className="hidden sm:inline text-xs text-[var(--color-pib-text-muted)]">
          Partners in Biz
        </span>
      </div>
      <div className="flex items-center gap-3 md:gap-4">
        <NotificationBell mode="admin" orgId={orgId} userId={userUid} />
        {messageAction}
        {/* Temporarily hidden while the admin layout switcher is being revisited.
        <button
          onClick={onToggleLayout}
          title="Switch to topbar layout"
          className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">dock_to_right</span>
        </button>
        */}
        <span className="hidden sm:inline text-xs font-mono text-[var(--color-pib-text-muted)] truncate max-w-[200px]">
          {userEmail}
        </span>
        <div className="w-8 h-8 rounded-full bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line-strong)] flex items-center justify-center text-xs font-medium text-[var(--color-pib-accent-hover)]">
          {initials || '·'}
        </div>
        <a
          href="/api/auth/logout"
          className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors inline-flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[18px]">logout</span>
          <span className="hidden sm:inline">Sign out</span>
        </a>
      </div>
    </header>
  )
}
