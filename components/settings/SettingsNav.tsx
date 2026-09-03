'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { usePortalOrgScope } from '@/lib/portal/usePortalOrgScope'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'
import { Avatar, Icon } from '@/components/studio'

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
  { href: '/portal/settings/security', label: 'Security and 2FA', icon: 'security' },
  { href: '/portal/settings/sessions', label: 'Sessions', icon: 'devices' },
  { href: '/portal/settings/linked-computers', label: 'Linked computers', icon: 'computer' },
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

function SettingsNavLink({
  href,
  label,
  icon,
  active,
  collapsed,
  /** @deprecated Role hint retained for callers; not rendered (Studio has no role pills). */
  minRole: _minRole,
}: {
  href: string
  label: string
  icon: string
  active: boolean
  collapsed?: boolean
  minRole?: string | null
}) {
  void _minRole
  if (collapsed) {
    return (
      <Link
        href={href}
        title={label}
        aria-label={label}
        data-active={active ? 'true' : undefined}
        className="pib-nav-item inline-flex items-center justify-center !px-0 min-h-11 w-11"
      >
        <Icon name={icon} />
      </Link>
    )
  }

  return (
    <Link
      href={href}
      aria-label={label}
      data-active={active ? 'true' : undefined}
      className="pib-nav-item inline-flex items-center gap-2 min-h-11 w-full px-2"
    >
      <Icon name={icon} className="shrink-0" />
      <span className="flex-1 truncate">{label}</span>
    </Link>
  )
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
      if (link.configAccess && !canAccessConfiguration && role !== 'owner' && role !== 'admin') return false
      return true
    })
    .map((link) => ({
      ...link,
      scopedHref: scopedPortalPath(link.href, routeScope),
    }))

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  if (collapsed) {
    return (
      <nav className="flex-1 flex flex-col items-center gap-0.5 py-3 px-1.5">
        <Link
          href={backToPortalHref}
          title="Back to portal"
          aria-label="Back to portal"
          className="pib-nav-item inline-flex items-center justify-center !px-0 min-h-11 w-11 mb-1"
        >
          <Icon name="arrow_back" />
        </Link>
        {[
          ...ACCOUNT_LINKS.map((link) => ({ ...link, scopedHref: link.href, minRole: null as string | null })),
          ...scopedWorkspaceLinks,
        ].map((link) => (
          <SettingsNavLink
            key={link.href}
            href={link.scopedHref}
            label={link.label}
            icon={link.icon}
            active={isActive(link.href)}
            collapsed
            minRole={link.minRole ?? null}
          />
        ))}
      </nav>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="p-3 border-b border-[var(--sc-line)]">
        <Link
          href={backToPortalHref}
          aria-label="Back to portal"
          className="pib-nav-item inline-flex items-center gap-2 min-h-11 w-full px-2 mb-3"
        >
          <Icon name="arrow_back" className="shrink-0" />
          <span>Back to portal</span>
        </Link>
        <div className="flex items-center gap-3 px-1">
          <Avatar size="sm" initials={initials || '·'} />
          <div className="min-w-0">
            <p className="sc-body truncate text-[0.875rem] text-[var(--sc-ink)] m-0">{name || 'Client'}</p>
            <p className="sc-tiny truncate text-[var(--sc-ink-soft)] m-0">{email}</p>
          </div>
        </div>
      </div>

      <nav className="px-2 py-3 space-y-4">
        <div className="space-y-0.5">
          <p className="sc-tiny px-2 mb-1 text-[var(--sc-ink-soft)]">Account</p>
          {ACCOUNT_LINKS.map((link) => (
            <SettingsNavLink
              key={link.href}
              href={link.href}
              label={link.label}
              icon={link.icon}
              active={isActive(link.href)}
            />
          ))}
        </div>

        <div className="space-y-0.5">
          <p className="sc-tiny px-2 mb-1 text-[var(--sc-ink-soft)]">Workspace</p>
          {scopedWorkspaceLinks.map((link) => (
            <SettingsNavLink
              key={link.href}
              href={link.scopedHref}
              label={link.label}
              icon={link.icon}
              active={isActive(link.href)}
              minRole={link.minRole ?? null}
            />
          ))}
        </div>
      </nav>
    </div>
  )
}
