'use client'

import Link from 'next/link'

export type LinkedWorkspace = {
  id: string
  slug: string
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
  mode: WorkspaceMode
  workspace?: LinkedWorkspace | null
}

function adminOrgPath(slug: string, path = '') {
  const encodedSlug = encodeURIComponent(slug)
  return `/admin/org/${encodedSlug}${path}`
}

function portalPath(workspace: LinkedWorkspace, path: string) {
  const params = new URLSearchParams()
  params.set('orgId', workspace.id)
  if (workspace.slug) params.set('orgSlug', workspace.slug)
  return `${path}?${params.toString()}`
}

function adminActions(workspace: LinkedWorkspace): WorkspaceAction[] {
  const slug = workspace.slug
  const workspaceId = encodeURIComponent(workspace.id)

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
      description: 'Client reporting and performance review workspace.',
      icon: 'bar_chart',
      href: `/admin/reports?orgId=${workspaceId}`,
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

function portalActions(workspace: LinkedWorkspace): WorkspaceAction[] {
  return [
    {
      title: 'Marketing',
      description: 'Planning, campaign command, growth channels, and client-facing marketing workspace.',
      icon: 'campaign',
      href: portalPath(workspace, '/portal/campaigns'),
    },
    {
      title: 'SEO',
      description: 'Sprints, keyword work, content plans, audits, pages, blog drafts, and performance.',
      icon: 'travel_explore',
      href: portalPath(workspace, '/portal/seo'),
    },
    {
      title: 'Social',
      description: 'Review queue, compose, calendar, account connections, vault, and social history.',
      icon: 'diversity_3',
      href: portalPath(workspace, '/portal/social'),
    },
    {
      title: 'Ads',
      description: 'Campaigns, ad sets, creatives, audiences, budgets, conversions, and experiments.',
      icon: 'ads_click',
      href: portalPath(workspace, '/portal/ads'),
    },
    {
      title: 'Campaigns',
      description: 'Email and content campaign work that belongs to the client organisation.',
      icon: 'outgoing_mail',
      href: portalPath(workspace, '/portal/campaigns'),
    },
    {
      title: 'Research',
      description: 'Discovery, market notes, client intelligence, and research records.',
      icon: 'manage_search',
      href: portalPath(workspace, '/portal/research'),
    },
    {
      title: 'Reports',
      description: 'Client reporting and performance review workspace.',
      icon: 'bar_chart',
      href: portalPath(workspace, '/portal/reports'),
    },
    {
      title: 'Projects',
      description: 'Delivery projects, tasks, approvals, and shared project context.',
      icon: 'folder_managed',
      href: portalPath(workspace, '/portal/projects'),
    },
    {
      title: 'Documents',
      description: 'Proposals, reports, shared documents, and client document approvals.',
      icon: 'description',
      href: portalPath(workspace, '/portal/documents'),
    },
    {
      title: 'Brand',
      description: 'Brand profile, positioning, and reusable client identity inputs.',
      icon: 'palette',
      href: portalPath(workspace, '/portal/branding'),
    },
    {
      title: 'Communications',
      description: 'Client messages, conversations, inbox context, and communication history.',
      icon: 'forum',
      href: portalPath(workspace, '/portal/messages'),
    },
    {
      title: 'Capture sources',
      description: 'Lead capture forms, sources, imports, and attribution setup.',
      icon: 'input',
      href: portalPath(workspace, '/portal/capture-sources'),
    },
    {
      title: 'Integrations',
      description: 'Platform, account, tracking, and external service connections.',
      icon: 'hub',
      href: portalPath(workspace, '/portal/integrations'),
    },
    {
      title: 'Email domains',
      description: 'Sending domains, authentication, and email readiness.',
      icon: 'alternate_email',
      href: portalPath(workspace, '/portal/email-domains'),
    },
    {
      title: 'Settings',
      description: 'Organisation settings, CRM setup, permissions, and workspace controls.',
      icon: 'settings',
      href: portalPath(workspace, '/portal/settings/organization'),
    },
    {
      title: 'Wiki',
      description: 'Durable client knowledge, operating notes, and internal handoff context.',
      icon: 'menu_book',
      href: portalPath(workspace, '/portal/wiki'),
    },
  ]
}

export function CompanyWorkspacePanel({ companyName, mode, workspace }: CompanyWorkspacePanelProps) {
  if (!workspace) {
    return (
      <div className="bento-card p-8 text-center">
        <span aria-hidden="true" className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">link_off</span>
        <p className="eyebrow mt-4 !text-[10px] text-amber-200">Organisation workspace not linked</p>
        <h2 className="mt-2 font-display text-xl text-[var(--color-pib-text)]">Connect this company to a client organisation</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
          {companyName} is available as a CRM company, but it is not linked to a client organisation workspace yet.
        </p>
      </div>
    )
  }

  const actions = mode === 'portal' ? portalActions(workspace) : adminActions(workspace)
  const eyebrow = mode === 'portal' ? 'Linked organisation workspace' : 'Organisation workspace'
  const dashboardHref = mode === 'portal'
    ? portalPath(workspace, '/portal/dashboard')
    : adminOrgPath(workspace.slug, '/dashboard')

  return (
    <div className="space-y-5">
      <div className="bento-card p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="eyebrow !text-[10px]">{eyebrow}</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--color-pib-text)]">{workspace.name} workspace</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
              Run the client organisation work from this CRM company record. Work opened here stays inside the linked organisation workspace.
            </p>
          </div>
          <Link
            href={dashboardHref}
            aria-label={`Open ${workspace.name} dashboard for ${companyName}`}
            className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">dashboard</span>
            Dashboard
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {actions.map((action) => (
          <Link
            key={`${action.title}-${action.href}`}
            href={action.href}
            aria-label={`Open ${action.title === 'SEO' ? 'SEO' : action.title.toLowerCase()} workspace for ${companyName}`}
            className="group rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4 transition-colors hover:border-[var(--color-pib-accent)] hover:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-[var(--color-pib-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-pib-bg)]"
          >
            <div className="flex items-start justify-between gap-3">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">{action.icon}</span>
              <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)] transition-colors group-hover:text-[var(--color-pib-text)]">open_in_new</span>
            </div>
            <h3 className="mt-4 text-sm font-semibold text-[var(--color-pib-text)]">{action.title}</h3>
            <p className="mt-2 line-clamp-3 text-xs leading-5 text-[var(--color-pib-text-muted)]">{action.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
