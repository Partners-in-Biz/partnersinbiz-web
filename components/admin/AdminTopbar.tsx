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
    <header className="pib-glass-bar pib-topbar-dense sticky top-0 z-30 justify-between px-3 md:px-4 shrink-0">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open menu"
          className="md:hidden flex flex-col justify-center items-center h-8 w-8 gap-[3px] rounded-md hover:bg-white/[0.06] transition-colors -ml-1"
        >
          <span className="block w-3.5 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
          <span className="block w-3.5 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
          <span className="block w-3.5 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
        </button>
        <span className="eyebrow !text-[10px]">Admin console</span>
        <span className="hidden sm:inline w-1 h-1 rounded-full bg-[var(--color-pib-line-strong)]" />
        <span className="hidden sm:inline text-xs text-[var(--color-pib-text-muted)]">
          Partners in Biz
        </span>
      </div>
      <div className="flex items-center gap-2 md:gap-2.5">
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
        <div className="h-7 w-7 rounded-full border border-[var(--color-pib-line-strong)] bg-[var(--color-pib-cyan-soft)] flex items-center justify-center text-[11px] font-medium text-[#5EEAD4]">
          {initials || '·'}
        </div>
        <a
          href="/api/auth/logout"
          className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors inline-flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">logout</span>
          <span className="hidden sm:inline">Sign out</span>
        </a>
      </div>
    </header>
  )
}
