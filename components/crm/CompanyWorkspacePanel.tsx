'use client'

import Link from 'next/link'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'

export type LinkedWorkspace = {
  id: string
  orgId?: string
  slug: string
  orgSlug?: string
  name: string
}

type WorkspaceMode = 'admin' | 'portal'

type WorkspaceAction = {
  title: string
  description: string
  icon: string
  href: string
}

interface CompanyWorkspacePanelProps {
  companyName: string
  companyId?: string
  mode: WorkspaceMode
  workspace?: LinkedWorkspace | null
  crmOrgId?: string
  crmOrgSlug?: string
}

function adminOrgPath(slug: string, path = '') {
  const encodedSlug = encodeURIComponent(slug)
  return `/admin/org/${encodedSlug}${path}`
}

function adminActions(workspace: LinkedWorkspace): WorkspaceAction[] {
  const slug = workspace.slug

  return [
    {
      title: 'Marketing',
      description: 'Planning, campaign command, growth channels, and client-facing marketing workspace.',
      icon: 'campaign',
      href: adminOrgPath(slug, '/marketing'),
    },
    {
      title: 'SEO',
      description: 'Sprints, keyword work, content plans, audits, pages, blog drafts, and performance.',
      icon: 'travel_explore',
      href: adminOrgPath(slug, '/seo'),
    },
    {
      title: 'Social',
      description: 'Review queue, compose, calendar, account connections, vault, and social history.',
      icon: 'diversity_3',
      href: adminOrgPath(slug, '/social'),
    },
    {
      title: 'Ads',
      description: 'Campaigns, ad sets, creatives, audiences, budgets, conversions, and experiments.',
      icon: 'ads_click',
      href: adminOrgPath(slug, '/ads/campaigns'),
    },
    {
      title: 'Campaigns',
      description: 'Email and content campaign work that belongs to the client organisation.',
      icon: 'outgoing_mail',
      href: adminOrgPath(slug, '/campaigns'),
    },
    {
      title: 'Research',
      description: 'Discovery, market notes, client intelligence, and research records.',
      icon: 'manage_search',
      href: adminOrgPath(slug, '/research'),
    },
    {
      title: 'Reports',
      description: 'Operator reporting and performance review for this selected client org.',
      icon: 'bar_chart',
      href: adminOrgPath(slug, '/dashboard?panel=reports'),
    },
    {
      title: 'Projects',
      description: 'Delivery projects, tasks, approvals, and shared project context.',
      icon: 'folder_managed',
      href: adminOrgPath(slug, '/projects'),
    },
    {
      title: 'Documents',
      description: 'Proposals, reports, shared documents, and client document approvals.',
      icon: 'description',
      href: adminOrgPath(slug, '/documents'),
    },
    {
      title: 'Brand',
      description: 'Brand profile, positioning, and reusable client identity inputs.',
      icon: 'palette',
      href: adminOrgPath(slug, '/brand'),
    },
    {
      title: 'Communications',
      description: 'Client messages, conversations, inbox context, and communication history.',
      icon: 'forum',
      href: adminOrgPath(slug, '/messages'),
    },
    {
      title: 'Capture sources',
      description: 'Lead capture forms, sources, imports, and attribution setup.',
      icon: 'input',
      href: adminOrgPath(slug, '/capture-sources'),
    },
    {
      title: 'Integrations',
      description: 'Platform, account, tracking, and external service connections.',
      icon: 'hub',
      href: adminOrgPath(slug, '/integrations'),
    },
    {
      title: 'Email domains',
      description: 'Sending domains, authentication, and email readiness.',
      icon: 'alternate_email',
      href: adminOrgPath(slug, '/email-domains'),
    },
    {
      title: 'Settings',
      description: 'Organisation settings, CRM setup, permissions, and workspace controls.',
      icon: 'settings',
      href: adminOrgPath(slug, '/settings'),
    },
    {
      title: 'Wiki',
      description: 'Durable client knowledge, operating notes, and internal handoff context.',
      icon: 'menu_book',
      href: adminOrgPath(slug, '/wiki'),
    },
  ]
}

function companyMarketingActions(scope: {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
  sourceCompanyName?: string
}): WorkspaceAction[] {
  return [
    {
      title: 'Marketing',
      description: 'This company’s campaigns, brand, social, ads, and SEO. Separate from organisation marketing and Personal.',
      icon: 'campaign',
      href: scopedPortalPath('/portal/marketing', scope),
    },
    {
      title: 'Campaigns',
      description: 'Content and email campaigns that belong to this CRM company.',
      icon: 'outgoing_mail',
      href: scopedPortalPath('/portal/campaigns', scope),
    },
    {
      title: 'Social',
      description: 'Compose, calendar, approvals, and connected brand accounts for this company.',
      icon: 'diversity_3',
      href: scopedPortalPath('/portal/social', scope),
    },
    {
      title: 'Brand',
      description: 'Brand profile, colours, voice, and assets owned by this company.',
      icon: 'palette',
      href: scopedPortalPath('/portal/branding', scope),
    },
    {
      title: 'Ads',
      description: 'Paid campaigns, ad accounts, and spend that belong to this company.',
      icon: 'ads_click',
      href: scopedPortalPath('/portal/ads', scope),
    },
    {
      title: 'SEO',
      description: 'Sprints, keywords, and search work owned by this company.',
      icon: 'travel_explore',
      href: scopedPortalPath('/portal/seo', scope),
    },
  ]
}

function portalActions(scope: {
  orgId?: string
  id?: string
  orgSlug?: string
  slug?: string
  sourceCompanyId?: string
  sourceCompanyName?: string
}, options: { includeSettings?: boolean } = {}): WorkspaceAction[] {
  const includeSettings = options.includeSettings !== false
  const actions: WorkspaceAction[] = [
    {
      title: 'Research',
      description: 'Discovery, market notes, client intelligence, and research records.',
      icon: 'manage_search',
      href: scopedPortalPath('/portal/research', scope),
    },
    {
      title: 'Reports',
      description: 'Client reporting and performance review workspace.',
      icon: 'bar_chart',
      href: scopedPortalPath('/portal/reports', scope),
    },
    {
      title: 'Projects',
      description: 'Delivery projects, tasks, approvals, and shared project context.',
      icon: 'folder_managed',
      href: scopedPortalPath('/portal/projects', scope),
    },
    {
      title: 'Documents',
      description: 'Proposals, reports, shared documents, and client document approvals.',
      icon: 'description',
      href: scopedPortalPath('/portal/documents', scope),
    },
    {
      title: 'Communications',
      description: 'Client messages, conversations, inbox context, and communication history.',
      icon: 'forum',
      href: scopedPortalPath('/portal/messages', scope),
    },
    {
      title: 'Capture sources',
      description: 'Lead capture forms, sources, imports, and attribution setup.',
      icon: 'input',
      href: scopedPortalPath('/portal/capture-sources', scope),
    },
    {
      title: 'Integrations',
      description: 'Platform, account, tracking, and external service connections.',
      icon: 'hub',
      href: scopedPortalPath('/portal/integrations', scope),
    },
    {
      title: 'Email domains',
      description: 'Sending domains, authentication, and email readiness.',
      icon: 'alternate_email',
      href: scopedPortalPath('/portal/email-domains', scope),
    },
    {
      title: 'Wiki',
      description: 'Durable client knowledge, operating notes, and internal handoff context.',
      icon: 'menu_book',
      href: scopedPortalPath('/portal/wiki', scope),
    },
  ]
  if (includeSettings) {
    actions.splice(actions.length - 1, 0, {
      title: 'Settings',
      description: 'Organisation settings, CRM setup, permissions, and workspace controls.',
      icon: 'settings',
      href: scopedPortalPath('/portal/settings/organization', scope),
    })
  }
  return actions
}

function ActionGrid({
  companyName,
  actions,
}: {
  companyName: string
  actions: WorkspaceAction[]
}) {
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
      {actions.map((action) => (
        <Link
          key={`${action.title}-${action.href}`}
          href={action.href}
          aria-label={`Open ${action.title === 'SEO' ? 'SEO' : action.title.toLowerCase()} workspace for ${companyName}`}
          className="pib-card pib-card-hover group p-3 focus:outline-none focus:ring-2 focus:ring-[var(--color-pib-accent)]"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="pib-icon-tint"><span className="material-symbols-outlined text-[16px]">{action.icon}</span></span>
              <h3 className="truncate text-xs font-semibold text-[var(--color-pib-text)]">{action.title}</h3>
            </div>
            <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-[var(--color-pib-text-muted)] transition-colors group-hover:text-[var(--color-pib-text)]">open_in_new</span>
          </div>
          <p className="mt-1.5 line-clamp-3 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{action.description}</p>
        </Link>
      ))}
    </div>
  )
}

export function CompanyWorkspacePanel({
  companyName,
  companyId,
  mode,
  workspace,
  crmOrgId,
  crmOrgSlug,
}: CompanyWorkspacePanelProps) {
  const companyScope = mode === 'portal' && companyId
    ? {
        orgId: workspace?.orgId || workspace?.id || crmOrgId,
        orgSlug: workspace?.orgSlug || workspace?.slug || crmOrgSlug,
        sourceCompanyId: companyId,
        sourceCompanyName: companyName,
      }
    : null
  const portalCompanyMarketing = companyScope ? companyMarketingActions(companyScope) : []

  if (!workspace) {
    const unlinkedCompanyActions = mode === 'portal' && companyScope
      ? portalActions(companyScope, { includeSettings: false })
      : []
    return (
      <div className="space-y-4">
        {mode === 'portal' && portalCompanyMarketing.length > 0 ? (
          <div className="pib-surface overflow-hidden">
            <div className="pib-surface-header">
              <p className="pib-label">Company marketing</p>
              <h2 className="mt-0.5 text-sm font-semibold text-[var(--color-pib-text)]">{companyName} marketing</h2>
              <p className="mt-0.5 max-w-3xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
                Campaigns, accounts, and brand for this CRM company. This does not require a linked organisation workspace and stays separate from Personal.
              </p>
            </div>
            <ActionGrid companyName={companyName} actions={portalCompanyMarketing} />
          </div>
        ) : null}
        {unlinkedCompanyActions.length > 0 ? (
          <div className="pib-surface overflow-hidden">
            <div className="pib-surface-header">
              <p className="pib-label">Company workspace</p>
              <h2 className="mt-0.5 text-sm font-semibold text-[var(--color-pib-text)]">{companyName} work</h2>
              <p className="mt-0.5 max-w-3xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
                Projects, documents, research, and reports for this company on your book. Not shared with a client organisation yet — invite to link when you want them to see progress.
              </p>
            </div>
            <ActionGrid companyName={companyName} actions={unlinkedCompanyActions} />
          </div>
        ) : null}
        <div className="pib-surface overflow-hidden">
          <div className="border-b border-[var(--color-pib-line)] p-4 text-center">
            <span aria-hidden="true" className="material-symbols-outlined text-[22px] text-[var(--color-pib-text-muted)]">link_off</span>
            <p className="pib-label mt-2 text-[var(--color-pib-accent)]">Not shared yet</p>
            <h2 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">Invite to link an organisation</h2>
            <p className="mx-auto mt-1 max-w-2xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
              {companyName} work stays on your book until linked. After linking, module defaults share progress into their portal (with per-record Keep private).
            </p>
            {mode === 'portal' && companyId ? (
              <Link
                href={`/portal/partners?companyId=${encodeURIComponent(companyId)}&companyName=${encodeURIComponent(companyName)}`}
                aria-label={`Invite ${companyName} to link workspaces`}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-pib-line)] px-3 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">handshake</span>
                Invite {companyName} to link workspaces
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  const workspaceScope = mode === 'portal' && companyId
    ? { ...workspace, sourceCompanyId: companyId, sourceCompanyName: companyName }
    : workspace
  const linkedActions = mode === 'portal' ? portalActions(workspaceScope) : adminActions(workspace)
  const eyebrow = mode === 'portal' ? 'Linked organisation workspace' : 'Operator organisation workspace'
  const dashboardHref = mode === 'portal'
    ? scopedPortalPath('/portal/dashboard', workspaceScope)
    : adminOrgPath(workspace.slug, '/dashboard')

  return (
    <div className="space-y-4">
      {mode === 'portal' && portalCompanyMarketing.length > 0 ? (
        <div className="pib-surface overflow-hidden">
          <div className="pib-surface-header">
            <p className="pib-label">Company marketing</p>
            <h2 className="mt-0.5 truncate text-sm font-semibold text-[var(--color-pib-text)]">{companyName} marketing</h2>
            <p className="mt-0.5 max-w-3xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
              This company&apos;s campaigns, accounts, and brand. Separate from the linked organisation workspace and from Personal.
            </p>
          </div>
          <ActionGrid companyName={companyName} actions={portalCompanyMarketing} />
        </div>
      ) : null}

      <div className="pib-surface overflow-hidden">
        <div className="pib-surface-header">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="pib-label">{eyebrow}</p>
              <h2 className="mt-0.5 truncate text-sm font-semibold text-[var(--color-pib-text)]">{workspace.name} workspace</h2>
              <p className="mt-0.5 max-w-3xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
                {mode === 'portal'
                  ? 'Client organisation workspace for projects, documents, wiki, and reports. Marketing for this CRM company lives in the company marketing section above.'
                  : 'Run PiB operator work for this selected client org. Links stay inside the admin command surface with the slug scope visible in the URL.'}
              </p>
            </div>
            <Link
              href={dashboardHref}
              aria-label={`Open ${workspace.name} dashboard for ${companyName}`}
              className="btn-pib-primary h-8 shrink-0 gap-1.5 px-2.5 text-xs"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">dashboard</span>
              Dashboard
            </Link>
          </div>
        </div>
        <ActionGrid companyName={companyName} actions={linkedActions} />
      </div>
    </div>
  )
}
