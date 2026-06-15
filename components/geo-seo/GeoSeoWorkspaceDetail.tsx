import Link from 'next/link'
import {
  geoSeoDateLabel,
  geoSeoLabel,
  geoSeoScoreDelta,
  type GeoSeoWorkspaceRecord,
} from '@/components/geo-seo/GeoSeoWorkspace'
import type { PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

type GeoSeoWorkspaceDetailProps = {
  workspace: GeoSeoWorkspaceRecord
  surface?: 'admin' | 'portal'
  orgScope?: PortalOrgRouteScope
  backHref: string
}

function workspaceTitle(workspace: GeoSeoWorkspaceRecord) {
  return workspace.siteName || workspace.siteUrl || 'GEO SEO workspace'
}

function sourceCompanyName(workspace: GeoSeoWorkspaceRecord, orgScope?: PortalOrgRouteScope) {
  return orgScope?.sourceCompanyName?.trim() || workspace.sourceCompanyName?.trim() || null
}

function linkedOrgName(workspace: GeoSeoWorkspaceRecord, orgScope?: PortalOrgRouteScope) {
  return orgScope?.orgSlug?.trim() || orgScope?.orgId?.trim() || workspace.orgId?.trim() || 'linked organisation workspace'
}

function sourceToLinkedLabel(sourceName: string | null, targetName: string) {
  return sourceName ? `${sourceName} → ${targetName}` : targetName
}

function detailRows(workspace: GeoSeoWorkspaceRecord) {
  return [
    { label: 'Workspace state', value: geoSeoLabel(workspace.status, 'draft') },
    { label: 'Operating mode', value: geoSeoLabel(workspace.mode, 'monitoring') },
    { label: 'Latest audit', value: geoSeoLabel(workspace.auditState) },
    { label: 'Latest report', value: geoSeoLabel(workspace.reportState) },
    { label: 'Last audit date', value: workspace.lastAuditAt ? geoSeoDateLabel(workspace.lastAuditAt) : 'Not run' },
    { label: 'Next audit date', value: geoSeoDateLabel(workspace.nextAuditAt) },
  ]
}

export function GeoSeoWorkspaceDetail({
  workspace,
  surface = 'admin',
  orgScope,
  backHref,
}: GeoSeoWorkspaceDetailProps) {
  const title = workspaceTitle(workspace)
  const sourceName = sourceCompanyName(workspace, orgScope)
  const targetName = linkedOrgName(workspace, orgScope)
  const sourceLinkedLabel = sourceToLinkedLabel(sourceName, targetName)
  const delta = geoSeoScoreDelta(workspace)
  const score = typeof workspace.currentGeoScore === 'number' ? workspace.currentGeoScore : null
  const isPortal = surface === 'portal'

  return (
    <div className="space-y-6">
      <nav aria-label="GEO SEO workspace breadcrumbs" className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-pib-text-muted)]">
        <Link href={isPortal ? '/portal' : '/admin'} className="hover:text-[var(--color-pib-text)]">Marketing Hub</Link>
        <span aria-hidden="true">/</span>
        <Link href={backHref} className="hover:text-[var(--color-pib-text)]">GEO SEO</Link>
        <span aria-hidden="true">/</span>
        <span className="font-semibold text-[var(--color-pib-text)]">{sourceLinkedLabel}</span>
        <span aria-hidden="true">/</span>
        <span className="font-semibold text-[var(--color-pib-text)]">{title}</span>
      </nav>

      <Link href={backHref} className="pib-btn-secondary inline-flex text-sm">
        Back to GEO SEO
      </Link>

      <header className="pib-card p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="pib-label mb-2">{isPortal ? 'Client GEO workspace' : 'GEO SEO workspace'}</p>
            <h1 className="pib-page-title">{title}</h1>
            {workspace.siteUrl && (
              <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{workspace.siteUrl}</p>
            )}
            <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
              Track AI-search visibility, audit state, score movement, linked SEO delivery, and approval-gated report progress from the same workspace surface.
            </p>
          </div>

          <div className="min-w-36 rounded-2xl border border-[var(--color-pib-border)] bg-[var(--color-pib-surface)] px-5 py-4 text-center">
            <p className="font-display text-4xl text-[var(--color-pib-text)]">{score ?? '-'}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">GEO score</p>
            <p className="mt-2 text-sm font-semibold text-[var(--color-pib-accent)]">{delta || 'No baseline yet'}</p>
          </div>
        </div>
      </header>

      {sourceName && (
        <section className="pib-card border-[var(--color-pib-accent)]/40 bg-[var(--color-pib-accent-soft)]/10 p-4" aria-label="CRM company workspace context">
          <p className="eyebrow !text-[10px]">Opened from CRM company</p>
          <h2 className="mt-1 text-base font-semibold text-[var(--color-pib-text)]">
            {sourceName} is linked to {targetName}
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--color-pib-text-muted)]">
            This detail page stays in the linked organisation workspace while keeping the CRM company context available for relationship history, breadcrumbs, and handoffs.
          </p>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-[1fr_0.75fr]">
        <div className="pib-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="pib-label mb-2">Workspace state</p>
              <h2 className="font-display text-2xl text-[var(--color-pib-text)]">Delivery control</h2>
            </div>
            <span className="pill">Reports approval-gated</span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {detailRows(workspace).map((row) => (
              <div key={row.label} className="rounded-2xl border border-[var(--color-pib-border)] bg-[var(--color-pib-surface)] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">{row.label}</p>
                <p className="mt-2 text-sm font-semibold text-[var(--color-pib-text)]">{row.value}</p>
              </div>
            ))}
          </div>
        </div>

        <aside className="pib-card p-5">
          <p className="pib-label mb-2">Client report actions gated</p>
          <h2 className="font-display text-xl text-[var(--color-pib-text)]">Approval before visibility</h2>
          <p className="mt-3 text-sm leading-6 text-[var(--color-pib-text-muted)]">
            Share, publish, and client-visible report actions remain internal until an approval gate is recorded. Drafts can be prepared here without exposing them to the client portal.
          </p>
          <div className="mt-5 space-y-2 text-sm text-[var(--color-pib-text-muted)]">
            <p>Linked SEO sprint: <span className="font-semibold text-[var(--color-pib-text)]">{workspace.linkedSeoSprintId ? 'Connected' : 'Not linked'}</span></p>
            <p>Project handoff: <span className="font-semibold text-[var(--color-pib-text)]">{workspace.projectId ? 'Connected' : 'Not linked'}</span></p>
            <p>Approval task: <span className="font-semibold text-[var(--color-pib-text)]">{workspace.approvalGateTaskId ? 'Connected' : 'Not linked'}</span></p>
          </div>
        </aside>
      </section>
    </div>
  )
}
