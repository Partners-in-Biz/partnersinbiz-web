'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { usePortalOrgScope } from '@/lib/portal/usePortalOrgScope'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'

interface SettingsNavProps {
  name: string
  email: string
  initials: string
  role: string | null
  /** When true the member may see CRM configuration links (pipelines, scoring,
   * products, automations, sequences, webhooks, custom fields, CRM setup).
   * Owner/admin always pass true via their full-access policy. */
  canAccessConfiguration?: boolean
  collapsed: boolean
}

const ACCOUNT_LINKS = [
  { href: '/portal/settings/account', label: 'Account settings', icon: 'manage_accounts' },
  { href: '/portal/settings/security', label: 'Security & 2FA', icon: 'security' },
  { href: '/portal/settings/sessions', label: 'Sessions', icon: 'devices' },
  { href: '/portal/settings/linked-computers', label: 'Linked Computers', icon: 'computer' },
  { href: '/portal/settings/notifications', label: 'Notifications', icon: 'notifications' },
  { href: '/portal/settings/workspaces', label: 'My workspaces', icon: 'workspaces' },
  { href: '/portal/personal/marketing', label: 'Personal marketing', icon: 'person' },
]

const WORKSPACE_LINKS = [
  { href: '/portal/settings/profile', label: 'My profile', icon: 'person', minRole: null },
  { href: '/portal/settings/organization', label: 'Organisation details', icon: 'business', minRole: null },
  { href: '/portal/settings/agents', label: 'Agents', icon: 'smart_toy', minRole: null },
  { href: '/portal/settings/agents/org-chart', label: 'Agent org chart', icon: 'account_tree', minRole: 'admin' },
  { href: '/portal/settings/team', label: 'Team', icon: 'group', minRole: 'admin' },
  { href: '/portal/communications', label: 'Communications', icon: 'forum', minRole: 'admin' },
  { href: '/portal/settings/custom-fields', label: 'Custom fields', icon: 'tune', configAccess: true },
  { href: '/portal/settings/crm-setup', label: 'CRM setup', icon: 'rocket_launch', configAccess: true },
  { href: '/portal/settings/pipelines', label: 'Pipelines', icon: 'sync_alt', configAccess: true },
  { href: '/portal/settings/scoring', label: 'Scoring', icon: 'star_rate', configAccess: true },
  { href: '/portal/settings/products', label: 'Products', icon: 'inventory_2', configAccess: true },
  { href: '/portal/settings/automations', label: 'Automations', icon: 'bolt', configAccess: true },
  { href: '/portal/settings/sequences', label: 'Sequences', icon: 'route', configAccess: true },
  { href: '/portal/settings/webhooks', label: 'Webhooks', icon: 'webhook', configAccess: true },
  { href: '/portal/settings/llm-providers', label: 'LLM providers', icon: 'smart_toy', minRole: null },
  { href: '/portal/settings/api-keys', label: 'API keys', icon: 'key', minRole: 'admin' },
  { href: '/portal/settings/domain', label: 'Custom domain', icon: 'language', minRole: 'admin' },
  { href: '/portal/settings/audit-log', label: 'Audit log', icon: 'history', minRole: 'admin' },
  { href: '/portal/settings/data-export', label: 'Data export', icon: 'cloud_download', minRole: 'admin' },
  { href: '/portal/settings/permissions', label: 'Permissions', icon: 'shield', minRole: 'owner' },
  { href: '/portal/settings/terminal-policy', label: 'Terminal policy', icon: 'terminal', minRole: 'owner' },
]

const ROLE_RANK: Record<string, number> = { owner: 4, admin: 3, member: 2, viewer: 1 }

function canSee(linkMinRole: string | null, userRole: string | null): boolean {
  if (!linkMinRole) return true
  if (!userRole) return false
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[linkMinRole] ?? 0)
}

type SettingsWorkspaceLink = {
  href: string
  label: string
  icon: string
  minRole?: string | null
  configAccess?: boolean
}

export function SettingsNav({
  name,
  email,
  initials,
  role,
  canAccessConfiguration = false,
  collapsed,
}: SettingsNavProps) {
  const pathname = usePathname()
  const routeScope = usePortalOrgScope()
  const backToPortalHref = scopedPortalPath('/portal/dashboard', routeScope)
  const scopedWorkspaceLinks = (WORKSPACE_LINKS as SettingsWorkspaceLink[])
    .filter((link) => {
      if (!canSee(link.minRole ?? null, role)) return false
      // CRM configuration links require the dedicated configuration module
      // grant; role alone is not enough for plain members. Owner/admin always
      // pass because their policy resolves to full workspace access.
      if (link.configAccess && !canAccessConfiguration && role !== 'owner' && role !== 'admin') return false
      return true
    })
    .map((link) => ({
      ...link,
      scopedHref: scopedPortalPath(link.href, routeScope),
    }))

  if (collapsed) {
    return (
      <nav className="flex-1 flex flex-col items-center gap-1 py-4 px-2">
        <Link
          href={backToPortalHref}
          title="Back to portal"
          aria-label="Back to portal"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors mb-2"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>
        </Link>
        {[
          ...ACCOUNT_LINKS.map((link) => ({ ...link, scopedHref: link.href })),
          ...scopedWorkspaceLinks,
        ].map((link) => (
          <Link
            key={link.href}
            href={link.scopedHref}
            title={link.label}
            aria-label={link.label}
            className={[
              'w-8 h-8 flex items-center justify-center rounded-lg transition-colors',
              pathname === link.href || pathname.startsWith(link.href + '/')
                ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
                : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]',
            ].join(' ')}
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{link.icon}</span>
          </Link>
        ))}
      </nav>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="p-4 border-b border-[var(--color-pib-line)]">
        <Link
          href={backToPortalHref}
          aria-label="Back to portal"
          className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors mb-4"
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">arrow_back</span>
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
                aria-label={link.label}
                className={[
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  on
                    ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
                    : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]',
                ].join(' ')}
              >
                <span className={['material-symbols-outlined text-[18px] shrink-0', on ? 'text-[var(--color-pib-accent)]' : 'opacity-70'].join(' ')} aria-hidden="true">
                  {link.icon}
                </span>
                <span className="font-medium flex-1">{link.label}</span>
              </Link>
            )
          })}
        </div>

        <div className="space-y-0.5">
          <p className="eyebrow !text-[10px] px-3 mb-2">Workspace</p>
          {scopedWorkspaceLinks.map((link) => {
            const on = pathname === link.href || pathname.startsWith(link.href + '/')
            return (
              <Link
                key={link.href}
                href={link.scopedHref}
                aria-label={link.label}
                className={[
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  on
                    ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
                    : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]',
                ].join(' ')}
              >
                <span className={['material-symbols-outlined text-[18px] shrink-0', on ? 'text-[var(--color-pib-accent)]' : 'opacity-70'].join(' ')} aria-hidden="true">
                  {link.icon}
                </span>
                <span className="font-medium flex-1">{link.label}</span>
                {link.minRole && (
                  <span className="text-[9px] bg-[var(--color-pib-cyan-soft)] text-[var(--color-pib-cyan)] px-1.5 py-0.5 rounded-full" aria-hidden="true">
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
