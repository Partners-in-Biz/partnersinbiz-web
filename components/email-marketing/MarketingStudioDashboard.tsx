import { Icon } from '@/components/studio'
import Link from 'next/link'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { CompanyMarketingSection } from '@/components/marketing/CompanyMarketingSection'
import { MarketingStudioNav } from './MarketingStudioNav'
import { ProgramList } from './ProgramList'

type MarketingStudioDashboardProps = {
  scope: PortalOrgRouteScope
}

const HEALTH_LINKS = [
  {
    label: 'Domain setup',
    detail: 'Sender domains and verification',
    href: '/portal/email-domains',
    icon: 'dns',
  },
  {
    label: 'List health',
    detail: 'Audience quality and risk',
    href: '/portal/email-list-health',
    icon: 'health_and_safety',
  },
  {
    label: 'Deliverability',
    detail: 'Sending readiness and incidents',
    href: '/portal/email-deliverability',
    icon: 'mark_email_read',
  },
] as const

const SUPPORT_LINKS = [
  { label: 'Sequences', href: '/portal/settings/sequences', icon: 'route' },
  { label: 'Templates', href: '/portal/email-templates', icon: 'view_quilt' },
  { label: 'Audience segments', href: '/portal/segments', icon: 'group_work' },
  { label: 'Capture sources', href: '/portal/capture-sources', icon: 'inventory_2' },
  { label: 'Email analytics', href: '/portal/email-analytics', icon: 'query_stats' },
  { label: 'SEO', href: '/portal/seo', icon: 'trending_up' },
  { label: 'Social overview', href: '/portal/social', icon: 'share' },
] as const

export function MarketingStudioDashboard({ scope }: MarketingStudioDashboardProps) {
  const workspaceLabel = scope.sourceCompanyName?.trim()

  return (
    <main className="min-w-0 space-y-8 text-[var(--color-pib-text)]" data-module-accent="blue">
      <div className="min-w-0 overflow-hidden rounded-[6px] border border-[var(--color-card-border)] bg-[var(--color-card)]/55 shadow-[0_16px_48px_rgba(0,0,0,0.16)]">
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--color-card-border)] bg-black/[0.08] px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="shrink-0 text-[18px]" aria-hidden="true">
              stacked_email
            </span>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">
                Workspace / Marketing
              </p>
              <div className="flex min-w-0 items-baseline gap-2">
                <h1 className="truncate text-sm leading-tight">Marketing Studio</h1>
                {workspaceLabel ? <span className="hidden truncate text-xs text-[var(--color-pib-text-muted)] sm:inline">· {workspaceLabel}</span> : null}
              </div>
            </div>
          </div>
          <Link
            href={scopedPortalPath('/portal/campaigns/email/new', scope)}
            className="btn-pib-primary btn-pib-sm inline-flex shrink-0 items-center gap-1.5"
          >
            <Icon name="add" />
            <span className="hidden sm:inline">Create email campaign</span>
            <span className="sm:hidden">Create</span>
          </Link>
        </header>

        <MarketingStudioNav scope={scope} />

        {scope.sourceCompanyId ? (
          <section
            aria-label="Company marketing workspace"
            className="border-b border-[var(--color-card-border)] bg-primary/[0.035] px-3 py-3 sm:px-4"
          >
            <p className="text-[10px] font-label uppercase tracking-[0.18em] text-primary">Company marketing</p>
            <h2 className="mt-1 text-sm">{workspaceLabel || 'This company'}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
              This company&apos;s campaigns, accounts, and brand stay here. They do not mix with organisation marketing or Personal.
            </p>
          </section>
        ) : null}

        <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
          <section aria-labelledby="marketing-work-queue" className="min-w-0 border-b border-[var(--color-card-border)] lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-3">
              <div>
                <p className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Programs</p>
                <h2 id="marketing-work-queue" className="mt-0.5 text-sm">Work queue</h2>
              </div>
              <span className="text-[11px] text-[var(--color-pib-text-muted)]">Open an existing workspace</span>
            </div>
            <ProgramList scope={scope} />
          </section>

          <aside className="min-w-0">
            <section aria-labelledby="sender-health-heading" className="border-b border-[var(--color-card-border)]">
              <div className="px-3 pb-1 pt-3">
                <p className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Readiness</p>
                <h2 id="sender-health-heading" className="mt-0.5 text-sm">Sender health</h2>
              </div>
              <div className="px-1.5 pb-2">
                {HEALTH_LINKS.map((item) => (
                  <Link
                    key={item.label}
                    href={scopedPortalPath(item.href, scope)}
                    className="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-white/[0.025]"
                  >
                    <span className="!h-7 !w-7 shrink-0" aria-hidden="true">
                      <Icon name={item.icon} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-[var(--color-pib-text)]">{item.label}</span>
                      <span className="block truncate text-[11px] text-[var(--color-pib-text-muted)]">{item.detail}</span>
                    </span>
                    <Icon name="chevron_right" />
                  </Link>
                ))}
              </div>
            </section>

            <section aria-labelledby="marketing-tools-heading" className="px-3 py-3">
              <h2 id="marketing-tools-heading" className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Tools</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SUPPORT_LINKS.map((item) => (
                  <Link
                    key={item.label}
                    href={scopedPortalPath(item.href, scope)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-[11px] text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.03] hover:text-[var(--color-pib-text)]"
                  >
                    <Icon name={item.icon} />
                    {item.label}
                  </Link>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <footer className="flex min-w-0 items-center gap-2 overflow-x-auto border-t border-[var(--color-card-border)] bg-black/[0.06] px-3 py-2 text-[10px] text-[var(--color-pib-text-muted)]">
          <Icon name="info" />
          <span className="whitespace-nowrap">Live counts stay in their source workspaces until the unified program data contract is available.</span>
        </footer>
      </div>
      {scope.sourceCompanyId ? null : <CompanyMarketingSection scope={scope} />}
    </main>
  )
}
