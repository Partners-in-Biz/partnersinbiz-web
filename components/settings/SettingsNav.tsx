'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface SettingsNavProps {
  name: string
  email: string
  initials: string
  role: string | null
  collapsed: boolean
}

const ACCOUNT_LINKS = [
  { href: '/portal/settings/account', label: 'Account settings', icon: 'manage_accounts' },
  { href: '/portal/settings/notifications', label: 'Notifications', icon: 'notifications' },
  { href: '/portal/settings/workspaces', label: 'My workspaces', icon: 'workspaces' },
]

const WORKSPACE_LINKS = [
  { href: '/portal/settings/profile', label: 'My profile', icon: 'person', minRole: null },
  { href: '/portal/settings/team', label: 'Team', icon: 'group', minRole: 'admin' },
  { href: '/portal/settings/custom-fields', label: 'Custom fields', icon: 'tune', minRole: 'admin' },
  { href: '/portal/settings/pipelines', label: 'Pipelines', icon: 'sync_alt', minRole: 'admin' },
  { href: '/portal/settings/scoring', label: 'Scoring', icon: 'star_rate', minRole: 'admin' },
  { href: '/portal/settings/products', label: 'Products', icon: 'inventory_2', minRole: 'admin' },
  { href: '/portal/settings/permissions', label: 'Permissions', icon: 'shield', minRole: 'owner' },
]

const ROLE_RANK: Record<string, number> = { owner: 4, admin: 3, member: 2, viewer: 1 }

function canSee(linkMinRole: string | null, userRole: string | null): boolean {
  if (!linkMinRole) return true
  if (!userRole) return false
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[linkMinRole] ?? 0)
}

export function SettingsNav({ name, email, initials, role, collapsed }: SettingsNavProps) {
  const pathname = usePathname()

  if (collapsed) {
    return (
      <nav className="flex-1 flex flex-col items-center gap-1 py-4 px-2">
        <Link
          href="/portal/dashboard"
          title="Back to portal"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors mb-2"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        </Link>
        {[...ACCOUNT_LINKS, ...WORKSPACE_LINKS.filter((l) => canSee(l.minRole, role))].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            title={link.label}
            className={[
              'w-8 h-8 flex items-center justify-center rounded-lg transition-colors',
              pathname === link.href || pathname.startsWith(link.href + '/')
                ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
                : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]',
            ].join(' ')}
          >
            <span className="material-symbols-outlined text-[18px]">{link.icon}</span>
          </Link>
        ))}
      </nav>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="p-4 border-b border-[var(--color-pib-line)]">
        <Link
          href="/portal/dashboard"
          className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors mb-4"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back to portal
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line-strong)] flex items-center justify-center text-sm font-medium text-[var(--color-pib-accent-hover)] shrink-0">
            {initials || '·'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{name || 'Client'}</p>
            <p className="text-[11px] text-[var(--color-pib-text-muted)] truncate">{email}</p>
          </div>
        </div>
      </div>

      <nav className="px-3 py-4 space-y-4">
        <div className="space-y-0.5">
          <p className="eyebrow !text-[10px] px-3 mb-2">Account</p>
          {ACCOUNT_LINKS.map((link) => {
            const on = pathname === link.href || pathname.startsWith(link.href + '/')
            return (
              <Link
                key={link.href}
                href={link.href}
                className={[
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  on
                    ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
                    : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]',
                ].join(' ')}
              >
                <span className={['material-symbols-outlined text-[18px] shrink-0', on ? 'text-[var(--color-pib-accent)]' : 'opacity-70'].join(' ')}>
                  {link.icon}
                </span>
                <span className="font-medium flex-1">{link.label}</span>
              </Link>
            )
          })}
        </div>

        <div className="space-y-0.5">
          <p className="eyebrow !text-[10px] px-3 mb-2">Workspace</p>
          {WORKSPACE_LINKS.filter((l) => canSee(l.minRole, role)).map((link) => {
            const on = pathname === link.href || pathname.startsWith(link.href + '/')
            return (
              <Link
                key={link.href}
                href={link.href}
                className={[
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  on
                    ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
                    : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]',
                ].join(' ')}
              >
                <span className={['material-symbols-outlined text-[18px] shrink-0', on ? 'text-[var(--color-pib-accent)]' : 'opacity-70'].join(' ')}>
                  {link.icon}
                </span>
                <span className="font-medium flex-1">{link.label}</span>
                {link.minRole && (
                  <span className="text-[9px] bg-[var(--color-pib-line-strong)] text-[var(--color-pib-text-muted)] px-1.5 py-0.5 rounded-full">
                    {link.minRole}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
