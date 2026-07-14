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

function portalActions(workspace: LinkedWorkspace): WorkspaceAction[] {
  return [
    {
      title: 'Marketing',
      description: 'Planning, campaign command, growth channels, and client-facing marketing workspace.',
      icon: 'campaign',
      href: scopedPortalPath('/portal/marketing', workspace),
    },
    {
      title: 'SEO',
      description: 'Sprints, keyword work, content plans, audits, pages, blog drafts, and performance.',
      icon: 'travel_explore',
      href: scopedPortalPath('/portal/seo', workspace),
    },
    {
      title: 'Social',
      description: 'Review queue, compose, calendar, account connections, vault, and social history.',
      icon: 'diversity_3',
      href: scopedPortalPath('/portal/social', workspace),
    },
    {
      title: 'Ads',
      description: 'Campaigns, ad sets, creatives, audiences, budgets, conversions, and experiments.',
      icon: 'ads_click',
      href: scopedPortalPath('/portal/ads', workspace),
    },
    {
      title: 'Campaigns',
      description: 'Email and content campaign work that belongs to the client organisation.',
      icon: 'outgoing_mail',
      href: scopedPortalPath('/portal/campaigns', workspace),
    },
    {
      title: 'Research',
      description: 'Discovery, market notes, client intelligence, and research records.',
      icon: 'manage_search',
      href: scopedPortalPath('/portal/research', workspace),
    },
    {
      title: 'Reports',
      description: 'Client reporting and performance review workspace.',
      icon: 'bar_chart',
      href: scopedPortalPath('/portal/reports', workspace),
    },
    {
      title: 'Projects',
      description: 'Delivery projects, tasks, approvals, and shared project context.',
      icon: 'folder_managed',
      href: scopedPortalPath('/portal/projects', workspace),
    },
    {
      title: 'Documents',
      description: 'Proposals, reports, shared documents, and client document approvals.',
      icon: 'description',
      href: scopedPortalPath('/portal/documents', workspace),
    },
    {
      title: 'Brand',
      description: 'Brand profile, positioning, and reusable client identity inputs.',
      icon: 'palette',
      href: scopedPortalPath('/portal/branding', workspace),
    },
    {
      title: 'Communications',
      description: 'Client messages, conversations, inbox context, and communication history.',
      icon: 'forum',
      href: scopedPortalPath('/portal/messages', workspace),
    },
    {
      title: 'Capture sources',
      description: 'Lead capture forms, sources, imports, and attribution setup.',
      icon: 'input',
      href: scopedPortalPath('/portal/capture-sources', workspace),
    },
    {
      title: 'Integrations',
      description: 'Platform, account, tracking, and external service connections.',
      icon: 'hub',
      href: scopedPortalPath('/portal/integrations', workspace),
    },
    {
      title: 'Email domains',
      description: 'Sending domains, authentication, and email readiness.',
      icon: 'alternate_email',
      href: scopedPortalPath('/portal/email-domains', workspace),
    },
    {
      title: 'Settings',
      description: 'Organisation settings, CRM setup, permissions, and workspace controls.',
      icon: 'settings',
      href: scopedPortalPath('/portal/settings/organization', workspace),
    },
    {
      title: 'Wiki',
      description: 'Durable client knowledge, operating notes, and internal handoff context.',
      icon: 'menu_book',
      href: scopedPortalPath('/portal/wiki', workspace),
    },
  ]
}

export function CompanyWorkspacePanel({ companyName, companyId, mode, workspace }: CompanyWorkspacePanelProps) {
  if (!workspace) {
    const leadWorkspaceItems = [
      {
        title: 'Company chat',
        description: 'Use the Chat tab to keep discovery, qualification, proposal, and handoff discussion scoped to this CRM company.',
        icon: 'forum',
      },
      {
        title: 'CRM knowledge',
        description: 'Keep pre-client notes in the company record until the account is promoted to a full organisation workspace.',
        icon: 'menu_book',
      },
      {
        title: 'Organisation control gate',
        description: 'Link or create an organisation before delivery work such as campaigns, SEO, social, ads, wiki, and reports.',
        icon: 'approval_delegation',
      },
    ]

    return (
      <div className="pib-surface overflow-hidden">
        <div className="border-b border-[var(--color-pib-line)] p-4 text-center">
          <span aria-hidden="true" className="material-symbols-outlined text-[22px] text-[var(--color-pib-text-muted)]">link_off</span>
          <p className="pib-label mt-2 text-[var(--color-pib-accent)]">Lead workspace</p>
          <h2 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">CRM-only company workspace</h2>
          <p className="mx-auto mt-1 max-w-2xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
            {companyName} is available as a CRM company, but it is not linked to a selected organisation command surface yet. Keep pre-client context here; convert or link the organisation before running delivery work.
          </p>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-3">
          {leadWorkspaceItems.map((item) => (
            <div key={item.title} className="pib-card p-3">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="pib-icon-tint"><span className="material-symbols-outlined text-[16px]">{item.icon}</span></span>
                <h3 className="text-xs font-semibold text-[var(--color-pib-text)]">{item.title}</h3>
              </div>
              <p className="mt-1.5 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const workspaceScope = mode === 'portal' && companyId
    ? { ...workspace, sourceCompanyId: companyId, sourceCompanyName: companyName }
    : workspace
  const actions = mode === 'portal' ? portalActions(workspaceScope) : adminActions(workspace)
  const eyebrow = mode === 'portal' ? 'Linked organisation workspace' : 'Operator organisation workspace'
  const dashboardHref = mode === 'portal'
    ? scopedPortalPath('/portal/dashboard', workspaceScope)
    : adminOrgPath(workspace.slug, '/dashboard')

  return (
    <div className="pib-surface overflow-hidden">
      <div className="pib-surface-header">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="pib-label">{eyebrow}</p>
            <h2 className="mt-0.5 truncate text-sm font-semibold text-[var(--color-pib-text)]">{workspace.name} workspace</h2>
            <p className="mt-0.5 max-w-3xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
              {mode === 'portal'
                ? 'Run the client organisation work from this CRM company record. Work opened here stays inside the linked organisation workspace.'
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
    </div>
  )
}
