import Link from 'next/link'
import type { Metadata } from 'next'
import { LOOP_REGISTRY, loopsByStatus } from '@/lib/loop-engine/registry'
import { LOOP_TEMPLATE_LIBRARY, LOOP_TEMPLATE_SOURCE } from '@/lib/loop-engine/template-library'
import { evaluateLoopRun } from '@/lib/loop-engine/executor'
import { explainTaskLoopReadiness } from '@/lib/loop-engine/readiness'
import { adminDb } from '@/lib/firebase/admin'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

const DEMO_TASK = {
  id: 'example-agent-task',
  title: 'Example gated agent task',
  columnId: 'blocked',
  status: 'todo',
  assigneeAgentId: 'theo',
  agentStatus: 'awaiting-input',
  agentInput: { spec: 'Build the approved internal loop-engine slice.' },
  dependsOn: ['approval-gate-task'],
  resolvedDependencyIds: [],
  riskLevel: 'high',
  requiredCapability: 'engineering',
  approvalGateTaskId: 'approval-gate-task',
  approvalGateStatus: 'pending',
}

const DEMO_RUN = evaluateLoopRun({
  loopId: 'lead-response',
  orgId: PIB_PLATFORM_ORG_ID,
  dryRun: true,
  now: new Date('2026-06-07T00:00:00.000Z'),
  idempotencyKey: 'admin-page-demo',
  trigger: { kind: 'event', ref: 'demo-lead', source: 'admin-demo' },
  candidates: [{
    id: 'demo-lead',
    type: 'lead',
    title: 'High-intent form submission from a tracked source',
    riskLevel: 'critical',
    requiredCapability: 'message_client',
    approvalGateStatus: 'missing',
    context: { source: 'form', speedToLeadMinutes: 0 },
  }],
})

type LiveRun = {
  id: string
  loopName: string
  loopId: string
  status: string
  dryRun: boolean
  ownerAgentId: string
  reviewerAgentId: string
  triggerSource: string
  candidateSummary: string
  lastMeaningfulAction: string
  needsHumanJudgment: boolean
  updatedAt: string | null
}

function isoFromTimestamp(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try { return (value as { toDate: () => Date }).toDate().toISOString() } catch { return null }
  }
  return null
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'unknown time'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'unknown time'
  return date.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
}

const RUN_STATUS_PILL: Record<string, string> = {
  executed: 'bg-emerald-500/10 text-emerald-300',
  proposed: 'bg-sky-500/10 text-sky-300',
  awaiting_approval: 'bg-amber-500/10 text-amber-300',
  evaluated: 'bg-white/5 text-[var(--color-pib-text-muted)]',
  blocked: 'bg-red-500/10 text-red-300',
  failed: 'bg-red-500/10 text-red-300',
  cancelled: 'bg-white/5 text-[var(--color-pib-text-muted)]',
}

function statusPill(status: string): string {
  return RUN_STATUS_PILL[status] ?? 'bg-white/5 text-[var(--color-pib-text-muted)]'
}

async function loadLiveRuns(): Promise<{ runs: LiveRun[]; error: string | null }> {
  try {
    const snap = await adminDb
      .collection('loop_engine_runs')
      .where('orgId', '==', PIB_PLATFORM_ORG_ID)
      .orderBy('updatedAt', 'desc')
      .limit(8)
      .get()
    const runs = snap.docs.map((doc): LiveRun => {
      const data = doc.data() as Record<string, unknown>
      const observability = (data.observability ?? {}) as Record<string, unknown>
      const trigger = (data.trigger ?? {}) as Record<string, unknown>
      return {
        id: doc.id,
        loopName: typeof data.loopName === 'string' ? data.loopName : (typeof data.loopId === 'string' ? data.loopId : 'Loop run'),
        loopId: typeof data.loopId === 'string' ? data.loopId : '',
        status: typeof data.status === 'string' ? data.status : 'evaluated',
        dryRun: data.dryRun === true,
        ownerAgentId: typeof data.ownerAgentId === 'string' ? data.ownerAgentId : '—',
        reviewerAgentId: typeof data.reviewerAgentId === 'string' ? data.reviewerAgentId : '—',
        triggerSource: typeof trigger.source === 'string' ? trigger.source : (typeof trigger.kind === 'string' ? trigger.kind : 'manual'),
        candidateSummary: typeof data.candidateSummary === 'string' ? data.candidateSummary : '',
        lastMeaningfulAction: typeof observability.lastMeaningfulAction === 'string' ? observability.lastMeaningfulAction : '',
        needsHumanJudgment: observability.needsHumanJudgment === true,
        updatedAt: isoFromTimestamp(data.updatedAt) ?? isoFromTimestamp(data.createdAt),
      }
    })
    return { runs, error: null }
  } catch (err) {
    return { runs: [], error: err instanceof Error ? err.message : 'Failed to load run history.' }
  }
}

export default async function AdminLoopEnginePage() {
  const activeLoops = loopsByStatus('active')
  const guardedLoops = loopsByStatus('guarded')
  const plannedLoops = loopsByStatus('planned')
  const readiness = explainTaskLoopReadiness(DEMO_TASK, { now: new Date('2026-06-07T00:00:00.000Z') })
  const { runs: liveRuns, error: liveRunsError } = await loadLiveRuns()

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="pib-card border-[var(--color-pib-accent)]/35 bg-[var(--color-pib-accent-soft)] p-6 md:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="pib-label mb-3">Internal operating layer</p>
            <h1 className="pib-page-title">Loop Engine</h1>
            <p className="pib-page-sub mt-3">
              Design loops that prompt agents: loop contracts, eligibility rules, no-progress detection, evidence requirements, review routing, and approval gates in one visible operator surface.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/projects" className="pib-btn-secondary text-sm">Open admin Projects</Link>
            <Link href="/admin/briefings" className="pib-btn-primary text-sm">Open admin Briefings</Link>
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="pib-card p-5">
          <p className="pib-label">Active loops</p>
          <p className="mt-2 text-3xl font-semibold text-[var(--color-pib-text)]">{activeLoops.length}</p>
          <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">Already backed by current Projects/Kanban or briefing behavior.</p>
        </div>
        <div className="pib-card p-5">
          <p className="pib-label">Guarded loops</p>
          <p className="mt-2 text-3xl font-semibold text-[var(--color-pib-text)]">{guardedLoops.length}</p>
          <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">Can prepare or release work only inside approval-safe boundaries.</p>
        </div>
        <div className="pib-card p-5">
          <p className="pib-label">Planned commercial loops</p>
          <p className="mt-2 text-3xl font-semibold text-[var(--color-pib-text)]">{plannedLoops.length}</p>
          <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">SEO-to-CRM and lead-response loops queued after visibility/governance hardening.</p>
        </div>
      </section>

      <section className="pib-card p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="pib-label">Live activity</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--color-pib-text)]">Recent loop runs</h2>
            <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
              Run records persisted by the VPS agent watcher, the loop-review cron, and the evaluate API for the platform owner workspace. This is the real activity feed — it stays empty until the watcher and cron start writing runs.
            </p>
          </div>
          <span className="rounded-full bg-white/5 px-3 py-1 text-sm font-medium text-[var(--color-pib-text-muted)]">{liveRuns.length} shown</span>
        </div>

        {liveRunsError ? (
          <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            Could not load run history: {liveRunsError}
          </div>
        ) : liveRuns.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4 text-sm text-[var(--color-pib-text-muted)]">
            No runs recorded yet. Once the VPS agent watcher is running and the loop-review cron is scheduled, dispatched tasks and review sweeps will appear here automatically.
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {liveRuns.map((run) => (
              <div key={run.id} className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-pib-text)]">{run.loopName}</p>
                    <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                      {run.triggerSource} · {run.ownerAgentId} → {run.reviewerAgentId} · {formatWhen(run.updatedAt)}{run.dryRun ? ' · dry-run' : ''}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusPill(run.status)}`}>
                    {run.status.replace(/_/g, ' ')}
                  </span>
                </div>
                {run.candidateSummary ? (
                  <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">{run.candidateSummary}</p>
                ) : null}
                {run.lastMeaningfulAction ? (
                  <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Last action: {run.lastMeaningfulAction}</p>
                ) : null}
                {run.needsHumanJudgment ? (
                  <span className="mt-3 inline-flex rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">Needs human judgment</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="pib-card p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="pib-label">Run records and API</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--color-pib-text)]">Full-loop execution layer</h2>
            <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
              The engine evaluates candidates into durable run records with proposed actions, approval gates, evidence, owner/reviewer routing, and a dry-run-first API before any internal action is executed. The example below is a dry-run evaluation.
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusPill(DEMO_RUN.status)}`}>{DEMO_RUN.status.replace(/_/g, ' ')}</span>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Run decision</p>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{DEMO_RUN.decision}</p>
          </div>
          <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Progress signal</p>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{DEMO_RUN.observability.progressSignal} · no-op streak {DEMO_RUN.observability.noOpStreak}</p>
          </div>
          <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Needs human judgment</p>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{DEMO_RUN.observability.needsHumanJudgment ? 'Yes — approval or reviewer evidence required' : 'No — safe internal action only'}</p>
          </div>
          <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Candidate summary</p>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{DEMO_RUN.candidateSummary}</p>
          </div>
          <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Last meaningful action</p>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{DEMO_RUN.observability.lastMeaningfulAction}</p>
          </div>
          <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Approval gates</p>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{DEMO_RUN.approvalGates.join(', ') || 'None'}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {DEMO_RUN.proposedActions.map((action) => (
            <div key={action.id} className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3">
              <p className="text-sm font-semibold text-[var(--color-pib-text)]">{action.label}</p>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{action.summary}</p>
              <p className="mt-2 text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">{action.mode} · {action.kind}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-[var(--color-pib-text-muted)]">
          API surface: POST /api/v1/admin/loop-engine/evaluate can persist dry-run or guarded run records; GET /api/v1/admin/loop-engine/runs lists recent org-scoped run history.
        </p>
      </section>

      <section className="pib-card p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="pib-label">Template library</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--color-pib-text)]">Loop templates from the community pattern library</h2>
            <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
              Copy-ready starter contracts adapted from {LOOP_TEMPLATE_SOURCE.name} for PiB-safe loops. Each template keeps the same operating spine — trigger, action, proof, and stop condition — then adds PiB owner/reviewer routing and approval guardrails.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4 text-sm text-[var(--color-pib-text-muted)] md:min-w-72">
            <p className="font-semibold text-[var(--color-pib-text)]">Source monitor</p>
            <p className="mt-1">{LOOP_TEMPLATE_SOURCE.repo} · {LOOP_TEMPLATE_SOURCE.upstreamTemplateCount} templates checked</p>
            <p className="mt-1">Last checked {LOOP_TEMPLATE_SOURCE.checkedAt}; upstream pushed {LOOP_TEMPLATE_SOURCE.upstreamPushedAt.slice(0, 10)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={LOOP_TEMPLATE_SOURCE.url} className="pib-btn-secondary text-xs">Open GitHub source</Link>
              <Link href={LOOP_TEMPLATE_SOURCE.siteUrl} className="pib-btn-secondary text-xs">Open Loop Library</Link>
            </div>
          </div>
        </div>
        <p className="mt-4 text-xs text-[var(--color-pib-text-muted)]">{LOOP_TEMPLATE_SOURCE.note}</p>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {LOOP_TEMPLATE_LIBRARY.map((template) => (
            <article key={template.id} className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="pib-label">{template.category} · {template.recommendedOwnerAgentId} → {template.recommendedReviewerAgentId}</p>
                  <h3 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">{template.name}</h3>
                </div>
                <Link href={`${LOOP_TEMPLATE_SOURCE.siteUrl}loops/${template.sourceSlug}/`} className="rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-[var(--color-pib-text-muted)]">source</Link>
              </div>
              <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">{template.summary}</p>
              <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">PiB fit: {template.pibFit}</p>
              <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="font-semibold text-[var(--color-pib-text)]">Trigger</dt>
                  <dd className="mt-1 text-[var(--color-pib-text-muted)]">{template.trigger}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-[var(--color-pib-text)]">Action</dt>
                  <dd className="mt-1 text-[var(--color-pib-text-muted)]">{template.action}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-[var(--color-pib-text)]">Proof</dt>
                  <dd className="mt-1 text-[var(--color-pib-text-muted)]">{template.proof}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-[var(--color-pib-text)]">Stop condition</dt>
                  <dd className="mt-1 text-[var(--color-pib-text-muted)]">{template.stopCondition}</dd>
                </div>
              </dl>
              <div className="mt-4 rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3">
                <p className="text-sm font-semibold text-[var(--color-pib-text)]">Starter prompt</p>
                <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{template.starterPrompt}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {template.guardrails.map((guardrail) => (
                  <span key={guardrail} className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">{guardrail}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="pib-card p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="pib-label">Why not running?</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--color-pib-text)]">Task eligibility explainer</h2>
            <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
              The engine evaluates agent tasks before dispatch so operators can see the exact reason a task is waiting instead of guessing from board columns.
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${readiness.eligible ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
            {readiness.eligible ? 'Eligible' : 'Blocked'}
          </span>
        </div>
        <div className="mt-5 rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4">
          <p className="font-medium text-[var(--color-pib-text)]">{readiness.summary}</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {readiness.reasons.map((reason) => (
              <div key={reason.code} className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3">
                <p className="text-sm font-semibold text-[var(--color-pib-text)]">{reason.label}</p>
                <p className="mt-1 text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">{reason.code}</p>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Required evidence for this risk level</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--color-pib-text-muted)]">
              {readiness.requiredEvidence.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {LOOP_REGISTRY.map((loop) => (
          <article key={loop.id} className="pib-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="pib-label">{loop.status} · {loop.riskLevel} risk</p>
                <h2 className="mt-2 text-xl font-semibold text-[var(--color-pib-text)]">{loop.name}</h2>
              </div>
              <span className="material-symbols-outlined text-[var(--color-pib-accent)]" aria-hidden>all_inclusive</span>
            </div>
            <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">{loop.whyItMatters}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-[var(--color-pib-text)]">Trigger</dt>
                <dd className="mt-1 text-[var(--color-pib-text-muted)]">{loop.trigger.description}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-pib-text)]">Stop condition</dt>
                <dd className="mt-1 text-[var(--color-pib-text-muted)]">{loop.loopContract.stopCondition}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-pib-text)]">No-progress policy</dt>
                <dd className="mt-1 text-[var(--color-pib-text-muted)]">{loop.loopContract.noProgressPolicy}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-pib-text)]">Budget guardrail</dt>
                <dd className="mt-1 text-[var(--color-pib-text-muted)]">{loop.loopContract.budgetGuardrail}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-pib-text)]">Owner / reviewer</dt>
                <dd className="mt-1 text-[var(--color-pib-text-muted)]">{loop.ownerAgentId} → {loop.reviewerAgentId}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-pib-text)]">Allowed actions</dt>
                <dd className="mt-1 text-[var(--color-pib-text-muted)]">{loop.allowedActions.join(', ')}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-pib-text)]">Stale threshold</dt>
                <dd className="mt-1 text-[var(--color-pib-text-muted)]">{loop.staleThreshold}</dd>
              </div>
            </dl>
            <div className="mt-4 rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-3">
              <p className="text-sm font-semibold text-[var(--color-pib-text)]">Last decision</p>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{loop.lastDecision}</p>
            </div>
            <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <p className="text-sm font-semibold text-[var(--color-pib-text)]">Operator-facing value</p>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{loop.positioning.buyerValue}</p>
            </div>
            {loop.approvalGates.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {loop.approvalGates.map((gate) => (
                  <span key={gate} className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">{gate}</span>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  )
}
