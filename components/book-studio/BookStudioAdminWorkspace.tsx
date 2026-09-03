'use client'

import Link from 'next/link'
import { AppShell, EmptyState, PageHeader, PageTabs, Surface } from '@/components/ui/AppFoundation'
import { StatCard } from '@/components/ui/StatCard'

type GateStatus = 'passed' | 'warning' | 'blocked' | 'missing_evidence' | 'not_applicable'
type BookStage = 'intake' | 'research' | 'brief' | 'quality_gates' | 'publishing_packet' | 'manual_upload_review' | 'analytics_reconciliation'
type BookRisk = 'on_track' | 'needs_evidence' | 'blocked' | 'client_review'

export type BookStudioGate = {
  id: string
  label: string
  status: GateStatus
  owner?: string
  evidence?: string[]
}

export type BookStudioProject = {
  id: string
  title: string
  stage: BookStage
  risk: BookRisk
  nextAction: string
  gates: BookStudioGate[]
}

type BookStudioAdminWorkspaceProps = {
  orgId: string
  orgName: string
  orgSlug?: string
  projects?: BookStudioProject[]
  error?: string
}

const stages: Array<{ id: BookStage; label: string; description: string }> = [
  { id: 'intake', label: 'Intake', description: 'Client org, source doc, source task, and project owner are confirmed.' },
  { id: 'research', label: 'Research', description: 'Book research item is linked with source evidence and provenance.' },
  { id: 'brief', label: 'Brief', description: 'Client-safe Book Brief is prepared before approval-sensitive production.' },
  { id: 'quality_gates', label: 'Quality gates', description: 'Rights, safety, claims, AI disclosure, and review gates are resolved.' },
  { id: 'publishing_packet', label: 'Publishing packet', description: 'Metadata, files, channel plan, ISBN/imprint, and launch checklist are package-bound.' },
  { id: 'manual_upload_review', label: 'Manual upload/review', description: 'Human reviewer approves the exact package/listing pair before external upload.' },
  { id: 'analytics_reconciliation', label: 'Analytics/reconciliation', description: 'Manual reports separate estimated, reported, and settled performance.' },
]

const defaultGates: BookStudioGate[] = [
  { id: 'client-safe', label: 'Client-safe artifact', status: 'missing_evidence', owner: 'Iris', evidence: [] },
  { id: 'rights', label: 'Rights and source register', status: 'missing_evidence', owner: 'Sage', evidence: [] },
  { id: 'package', label: 'Checksum-bound package', status: 'missing_evidence', owner: 'Theo', evidence: [] },
  { id: 'release-review', label: 'Human release review', status: 'blocked', owner: 'Quinn', evidence: [] },
]

const bridgeFlows = [
  { label: 'Research', description: 'Link Research items with provenance, confidence, unknowns, source URLs, and decision-log refs before an idea advances.' },
  { label: 'Client Documents', description: 'Attach specs, review packets, approval snapshots, and sourceSpecVersion so client-safe decisions survive beyond chat.' },
  { label: 'Projects/Kanban', description: 'Carry approvalGateTaskId, dependent task IDs, reviewer agent, expected artifacts, and evidence comments on the delivery board.' },
  { label: 'Artifact links', description: 'Store manuscripts, covers, exports, package assets, and evidence as href/checksum/version references; never store credentials or raw secret payloads.' },
]

function slugFromName(value: string) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || 'workspace'
}

function statusLabel(status: GateStatus) {
  switch (status) {
    case 'passed': return 'Passed'
    case 'warning': return 'Warning'
    case 'blocked': return 'Blocked'
    case 'not_applicable': return 'Not applicable'
    case 'missing_evidence':
    default: return 'Missing evidence'
  }
}

function riskLabel(project: BookStudioProject) {
  if (project.risk === 'blocked') return 'blocked by rights'
  if (project.risk === 'needs_evidence') return 'needs evidence'
  if (project.risk === 'client_review') return 'client review gated'
  return 'on track'
}

function ProjectCard({ project }: { project: BookStudioProject }) {
  const canRequestApproval = project.gates.every((gate) => ['passed', 'not_applicable'].includes(gate.status))

  return (
    <Surface aria-label={`${project.title} book project`} className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="sc-tiny">{riskLabel(project)}</p>
          <h2 className="text-xl text-[var(--color-pib-text)]">{project.title}</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)]">{project.nextAction}</p>
        </div>
        <span className="pib-pill pib-pill-rose">
          {stages.find((stage) => stage.id === project.stage)?.label ?? project.stage}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {project.gates.map((gate) => {
          const hasEvidence = (gate.evidence?.length ?? 0) > 0
          return (
            <div key={gate.id} className="rounded-md border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-muted)] p-3">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-sm text-[var(--color-pib-text)]">{gate.label}</strong>
                <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">{statusLabel(gate.status)}</span>
              </div>
              <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">Owner: {gate.owner ?? 'Unassigned'}</p>
              {!hasEvidence ? <p className="mt-2 text-xs font-medium text-[var(--sc-ink-soft)]">Missing evidence</p> : null}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!canRequestApproval} className="btn-pib-primary btn-pib-sm font-label disabled:cursor-not-allowed disabled:opacity-50">
          Request approval for exact package version
        </button>
        <button type="button" disabled className="btn-pib-secondary btn-pib-sm font-label disabled:cursor-not-allowed disabled:opacity-50">
          External upload locked until release review passes
        </button>
      </div>
    </Surface>
  )
}

export function BookStudioAdminWorkspace({ orgId, orgName, orgSlug, projects = [], error }: BookStudioAdminWorkspaceProps) {
  const slug = orgSlug ?? slugFromName(orgName)
  const gates = projects.flatMap((project) => project.gates)
  const blockedCount = gates.filter((gate) => gate.status === 'blocked').length
  const missingEvidenceCount = gates.filter((gate) => gate.status === 'missing_evidence' || (gate.evidence?.length ?? 0) === 0).length

  return (
    <AppShell
      contentClassName="bg-[var(--color-pib-bg)]"
      header={
        <PageHeader
          accent="rose"
          eyebrow="Book Studio · Phase 1"
          title="Book Studio command center"
          description={`Plan books for ${orgName}, preserve approval gates, and keep manual publishing controls locked until evidence is complete.`}
          meta={<span>Org ID: {orgId}</span>}
          actions={
            <>
              <Link href={`/admin/org/${slug}/projects`} className="btn-pib-secondary btn-pib-sm font-label">Open Projects/Kanban</Link>
              <button type="button" disabled className="btn-pib-primary btn-pib-sm font-label disabled:cursor-not-allowed disabled:opacity-50">Create book project gated</button>
            </>
          }
          tabs={<PageTabs value="command-center" tabs={[{ label: 'Command center', value: 'command-center', icon: 'auto_stories' }, { label: 'Series', value: 'series', icon: 'view_list', disabled: true }, { label: 'Analytics', value: 'analytics', icon: 'query_stats', disabled: true }]} />}
        />
      }
    >
      <div className="space-y-6">
        {error ? (
          <Surface role="alert" className="border-red-200 bg-red-50 text-red-900">
            <strong>Book Studio load issue</strong>
            <p>{error}</p>
            <p className="text-sm">Safe actions remain disabled. Retry data loading before approving or exporting anything.</p>
          </Surface>
        ) : null}

        <section role="region" aria-label="Book Studio admin command center" className="space-y-6">
          <div className="grid gap-2 md:grid-cols-4">
            <StatCard accent="rose" icon="auto_stories" label="Active projects" value={projects.length} />
            <StatCard accent="rose" icon="block" label="Blocked gates" value={blockedCount} />
            <StatCard accent="rose" icon="folder_off" label="Missing evidence" value={missingEvidenceCount} />
            <StatCard accent="rose" icon="lock" label="Forbidden actions" value="Locked" />
          </div>

          <Surface header={<h2 className="text-lg">Stage rail</h2>}>
            <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {stages.map((stage, index) => (
                <li key={stage.id} className="rounded-[var(--radius-lg-card)] bg-[var(--color-pib-surface-muted)] p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--color-pib-rose-soft)] text-xs text-[var(--color-pib-rose)]">
                      {index + 1}
                    </span>
                    <h3 className="text-[var(--color-pib-text)]">{stage.label}</h3>
                  </div>
                  <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">{stage.description}</p>
                </li>
              ))}
            </ol>
          </Surface>

          {projects.length === 0 ? (
            <EmptyState
              icon="auto_stories"
              title="No active Book Studio projects yet"
              description="Create or link a gated Project/Kanban task before production work starts."
              action={<Link href={`/admin/org/${slug}/projects`} className="btn-secondary">Open Projects/Kanban</Link>}
            />
          ) : (
            <div className="space-y-4">
              {projects.map((project) => <ProjectCard key={project.id} project={project} />)}
            </div>
          )}

          <Surface header={<h2 className="text-lg">Bridge flows for durable evidence</h2>}>
            <div className="grid gap-3 md:grid-cols-2">
              {bridgeFlows.map((flow) => (
                <div key={flow.label} className="rounded-[6px] border border-[var(--color-pib-border)] p-4">
                  <strong>{flow.label}</strong>
                  <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{flow.description}</p>
                </div>
              ))}
            </div>
          </Surface>

          <Surface header={<h2 className="text-lg">Disabled external actions</h2>}>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50">Direct store publishing disabled</button>
              <button type="button" disabled className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50">Automated marketplace integrations disabled</button>
              <button type="button" disabled className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50">Ad spend and review outreach disabled</button>
            </div>
          </Surface>

          <Surface header={<h2 className="text-lg">Baseline gates for new work</h2>}>
            <div className="grid gap-3 md:grid-cols-2">
              {defaultGates.map((gate) => (
                <div key={gate.id} className="rounded-[6px] border border-[var(--color-pib-border)] p-4">
                  <strong>{gate.label}</strong>
                  <p className="text-sm text-[var(--color-pib-text-muted)]">{statusLabel(gate.status)} · Owner: {gate.owner}</p>
                </div>
              ))}
            </div>
          </Surface>
        </section>
      </div>
    </AppShell>
  )
}
