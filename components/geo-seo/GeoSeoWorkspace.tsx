import Link from 'next/link'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

export type GeoSeoWorkspaceRecord = {
  id: string
  orgId?: string | null
  siteName?: string | null
  siteUrl?: string | null
  status?: string | null
  mode?: string | null
  currentGeoScore?: number | null
  previousGeoScore?: number | null
  lastAuditAt?: string | null
  nextAuditAt?: string | null
  linkedSeoSprintId?: string | null
  auditState?: string | null
  reportState?: string | null
  sourceCompanyId?: string | null
  sourceCompanyName?: string | null
  projectId?: string | null
  approvalGateTaskId?: string | null
}

type GeoSeoWorkspaceProps = {
  workspaces: GeoSeoWorkspaceRecord[]
  surface?: 'admin' | 'admin-org' | 'portal'
  orgScope?: PortalOrgRouteScope
  basePath?: string
  emptyActionHref?: string
}

export function geoSeoLabel(value: string | null | undefined, fallback = 'not-started') {
  return value?.replace(/_/g, ' ') || fallback
}

export function geoSeoScoreDelta(workspace: GeoSeoWorkspaceRecord) {
  if (typeof workspace.currentGeoScore !== 'number' || typeof workspace.previousGeoScore !== 'number') return null
  const delta = workspace.currentGeoScore - workspace.previousGeoScore
  return `${delta >= 0 ? '+' : ''}${delta} pts`
}

export function geoSeoDateLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString('en-ZA') : 'Not scheduled'
}

function workspaceHref(workspaceId: string, surface: 'admin' | 'admin-org' | 'portal', basePath?: string, orgScope?: PortalOrgRouteScope) {
  const path = `${basePath || '/portal/geo-seo'}/workspaces/${encodeURIComponent(workspaceId)}`
  return surface === 'portal' ? scopedPortalPath(path, orgScope || {}) : path
}

export function GeoSeoWorkspace({
  workspaces,
  surface = 'admin',
  orgScope,
  basePath,
  emptyActionHref,
}: GeoSeoWorkspaceProps) {
  const sourceCompanyName = orgScope?.sourceCompanyName?.trim()
  const targetWorkspaceName = orgScope?.orgSlug?.trim() || orgScope?.orgId?.trim()

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="pib-label mb-2">{surface === 'admin-org' ? 'Internal operator surface' : 'Marketing Hub sibling service'}</p>
          <h1 className="pib-page-title">GEO SEO Manager</h1>
          <p className="pib-page-sub max-w-3xl">
            {surface === 'admin-org'
              ? 'Internal AI search visibility operations for this client. Workspace reads are scoped by the resolved organisation and reports stay gated before client visibility.'
              : 'AI search visibility operating system for workspaces, audits, answer-engine readiness, and approval-gated client reporting.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-[var(--color-pib-text-muted)]">
          <span className="pill">Separate from SEO Sprint Manager</span>
          <span className="pill">Reports approval-gated</span>
        </div>
      </header>

      {sourceCompanyName && (
        <section className="pib-card border-[var(--color-pib-accent)]/40 bg-[var(--color-pib-accent-soft)]/10 p-4" aria-label="CRM company workspace context">
          <p className="eyebrow !text-[10px]">Opened from CRM company</p>
          <h2 className="mt-1 text-base font-semibold text-[var(--color-pib-text)]">
            {sourceCompanyName} is linked to {targetWorkspaceName || 'this organisation workspace'}
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--color-pib-text-muted)]">
            GEO SEO delivery belongs to the linked organisation workspace. The CRM company remains preserved as source context for breadcrumbs, handoffs, and relationship history.
          </p>
        </section>
      )}

      <section className="pib-card p-4" aria-label="GEO SEO report approval gate">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[var(--color-pib-accent)]">verified_user</span>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-pib-text)]">Client report actions gated</h2>
            <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
              Share, publish, and client-visible report actions require explicit approval. This workspace can prepare audits and internal report drafts without sending or publishing them.
            </p>
          </div>
        </div>
      </section>

      {workspaces.length === 0 ? (
        <section className="pib-card py-12 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">psychology_alt</span>
          <h2 className="mt-3 text-lg font-display text-[var(--color-pib-text)]">No GEO SEO workspaces yet</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
            Create a GEO SEO workspace when the approved data/API slice is ready. Workspace setup stays internal until a report is approved for client visibility.
          </p>
          {emptyActionHref && (
            <Link href={emptyActionHref} className="pib-btn-primary mt-5 inline-flex text-sm">
              Prepare workspace
            </Link>
          )}
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {workspaces.map((workspace) => (
            <article key={workspace.id} className="pib-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="eyebrow">{geoSeoLabel(workspace.mode, 'monitoring')}</p>
                  <h2 className="mt-1 text-xl font-display text-[var(--color-pib-text)]">{workspace.siteName || workspace.siteUrl || 'GEO SEO workspace'}</h2>
                  {workspace.siteUrl && <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{workspace.siteUrl}</p>}
                </div>
                {typeof workspace.currentGeoScore === 'number' && (
                  <div className="rounded-2xl border border-[var(--color-pib-border)] px-4 py-3 text-center">
                    <p className="text-2xl font-display text-[var(--color-pib-text)]">{workspace.currentGeoScore}</p>
                    <p className="text-xs text-[var(--color-pib-text-muted)]">GEO score</p>
                  </div>
                )}
              </div>

              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                <span className="pill justify-center">Workspace {geoSeoLabel(workspace.status, 'draft')}</span>
                <span className="pill justify-center">Audit {geoSeoLabel(workspace.auditState)}</span>
                <span className="pill justify-center">Report {geoSeoLabel(workspace.reportState)}</span>
              </div>

              <div className="mt-5 grid gap-3 text-sm text-[var(--color-pib-text-muted)] sm:grid-cols-2">
                <p>Score movement: <span className="font-semibold text-[var(--color-pib-text)]">{geoSeoScoreDelta(workspace) || 'No baseline yet'}</span></p>
                <p>Linked SEO sprint: <span className="font-semibold text-[var(--color-pib-text)]">{workspace.linkedSeoSprintId ? 'Connected' : 'Not linked'}</span></p>
                <p>Last audit: <span className="font-semibold text-[var(--color-pib-text)]">{workspace.lastAuditAt ? geoSeoDateLabel(workspace.lastAuditAt) : 'Not run'}</span></p>
                <p>Next audit: <span className="font-semibold text-[var(--color-pib-text)]">{geoSeoDateLabel(workspace.nextAuditAt)}</span></p>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link href={workspaceHref(workspace.id, surface, basePath, orgScope)} className="pib-btn-secondary text-sm">
                  Open workspace
                </Link>
                <span className="text-xs text-[var(--color-pib-text-muted)]">Reports remain internal drafts until approved.</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
