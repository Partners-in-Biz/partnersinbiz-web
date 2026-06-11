import Link from 'next/link'
import type { Metadata } from 'next'
import { LOOP_REGISTRY, loopsByStatus } from '@/lib/loop-engine/registry'
import { evaluateLoopRun } from '@/lib/loop-engine/executor'
import { explainTaskLoopReadiness } from '@/lib/loop-engine/readiness'

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
  orgId: 'pib-platform-owner',
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

export default function AdminLoopEnginePage() {
  const activeLoops = loopsByStatus('active')
  const guardedLoops = loopsByStatus('guarded')
  const plannedLoops = loopsByStatus('planned')
  const readiness = explainTaskLoopReadiness(DEMO_TASK, { now: new Date('2026-06-07T00:00:00.000Z') })

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="pib-card border-[var(--color-pib-accent)]/35 bg-[var(--color-pib-accent-soft)]/10 p-6 md:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="pib-label mb-3">Internal operating layer</p>
            <h1 className="pib-page-title">Loop Engine</h1>
            <p className="pib-page-sub mt-3">
              Design loops that prompt agents: loop contracts, eligibility rules, no-progress detection, evidence requirements, review routing, and approval gates in one visible operator surface.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/portal/projects" className="pib-btn-secondary text-sm">Open Projects</Link>
            <Link href="/portal/briefings" className="pib-btn-primary text-sm">Open Briefings</Link>
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="pib-card p-5">
          <p className="pib-label">Active loops</p>
          <p className="mt-2 text-3xl font-semibold text-[var(--color-pib-text)]">{activeLoops.length}</p>
          <p className="mt-2 text-sm text-[var(--color-pib-muted)]">Already backed by current Projects/Kanban or briefing behavior.</p>
        </div>
        <div className="pib-card p-5">
          <p className="pib-label">Guarded loops</p>
          <p className="mt-2 text-3xl font-semibold text-[var(--color-pib-text)]">{guardedLoops.length}</p>
          <p className="mt-2 text-sm text-[var(--color-pib-muted)]">Can prepare or release work only inside approval-safe boundaries.</p>
        </div>
        <div className="pib-card p-5">
          <p className="pib-label">Planned commercial loops</p>
          <p className="mt-2 text-3xl font-semibold text-[var(--color-pib-text)]">{plannedLoops.length}</p>
          <p className="mt-2 text-sm text-[var(--color-pib-muted)]">SEO-to-CRM and lead-response loops queued after visibility/governance hardening.</p>
        </div>
      </section>

      <section className="pib-card p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="pib-label">Run records and API</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--color-pib-text)]">Full-loop execution layer</h2>
            <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-muted)]">
              The engine now evaluates candidates into durable run records with proposed actions, approval gates, evidence, owner/reviewer routing, and a dry-run-first API before any internal action is executed.
            </p>
          </div>
          <span className="rounded-full bg-sky-500/10 px-3 py-1 text-sm font-medium text-sky-700">{DEMO_RUN.status}</span>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-[var(--color-pib-border)] bg-white/70 p-4">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Run decision</p>
            <p className="mt-2 text-sm text-[var(--color-pib-muted)]">{DEMO_RUN.decision}</p>
          </div>
          <div className="rounded-2xl border border-[var(--color-pib-border)] bg-white/70 p-4">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Progress signal</p>
            <p className="mt-2 text-sm text-[var(--color-pib-muted)]">{DEMO_RUN.observability.progressSignal} · no-op streak {DEMO_RUN.observability.noOpStreak}</p>
          </div>
          <div className="rounded-2xl border border-[var(--color-pib-border)] bg-white/70 p-4">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Needs human judgment</p>
            <p className="mt-2 text-sm text-[var(--color-pib-muted)]">{DEMO_RUN.observability.needsHumanJudgment ? 'Yes — approval or reviewer evidence required' : 'No — safe internal action only'}</p>
          </div>
          <div className="rounded-2xl border border-[var(--color-pib-border)] bg-white/70 p-4">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Candidate summary</p>
            <p className="mt-2 text-sm text-[var(--color-pib-muted)]">{DEMO_RUN.candidateSummary}</p>
          </div>
          <div className="rounded-2xl border border-[var(--color-pib-border)] bg-white/70 p-4">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Last meaningful action</p>
            <p className="mt-2 text-sm text-[var(--color-pib-muted)]">{DEMO_RUN.observability.lastMeaningfulAction}</p>
          </div>
          <div className="rounded-2xl border border-[var(--color-pib-border)] bg-white/70 p-4">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Approval gates</p>
            <p className="mt-2 text-sm text-[var(--color-pib-muted)]">{DEMO_RUN.approvalGates.join(', ') || 'None'}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {DEMO_RUN.proposedActions.map((action) => (
            <div key={action.id} className="rounded-xl border border-[var(--color-pib-border)] bg-white p-3">
              <p className="text-sm font-semibold text-[var(--color-pib-text)]">{action.label}</p>
              <p className="mt-1 text-sm text-[var(--color-pib-muted)]">{action.summary}</p>
              <p className="mt-2 text-xs uppercase tracking-wide text-[var(--color-pib-muted)]">{action.mode} · {action.kind}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-[var(--color-pib-muted)]">
          API surface: POST /api/v1/admin/loop-engine/evaluate can persist dry-run or guarded run records; GET /api/v1/admin/loop-engine/runs lists recent org-scoped run history.
        </p>
      </section>

      <section className="pib-card p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="pib-label">Why not running?</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--color-pib-text)]">Task eligibility explainer</h2>
            <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-muted)]">
              The engine evaluates agent tasks before dispatch so operators can see the exact reason a task is waiting instead of guessing from board columns.
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${readiness.eligible ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'}`}>
            {readiness.eligible ? 'Eligible' : 'Blocked'}
          </span>
        </div>
        <div className="mt-5 rounded-2xl border border-[var(--color-pib-border)] bg-white/70 p-4">
          <p className="font-medium text-[var(--color-pib-text)]">{readiness.summary}</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {readiness.reasons.map((reason) => (
              <div key={reason.code} className="rounded-xl border border-[var(--color-pib-border)] bg-white p-3">
                <p className="text-sm font-semibold text-[var(--color-pib-text)]">{reason.label}</p>
                <p className="mt-1 text-xs uppercase tracking-wide text-[var(--color-pib-muted)]">{reason.code}</p>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Required evidence for this risk level</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--color-pib-muted)]">
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
            <p className="mt-3 text-sm text-[var(--color-pib-muted)]">{loop.whyItMatters}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-[var(--color-pib-text)]">Trigger</dt>
                <dd className="mt-1 text-[var(--color-pib-muted)]">{loop.trigger.description}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-pib-text)]">Stop condition</dt>
                <dd className="mt-1 text-[var(--color-pib-muted)]">{loop.loopContract.stopCondition}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-pib-text)]">No-progress policy</dt>
                <dd className="mt-1 text-[var(--color-pib-muted)]">{loop.loopContract.noProgressPolicy}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-pib-text)]">Budget guardrail</dt>
                <dd className="mt-1 text-[var(--color-pib-muted)]">{loop.loopContract.budgetGuardrail}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-pib-text)]">Owner / reviewer</dt>
                <dd className="mt-1 text-[var(--color-pib-muted)]">{loop.ownerAgentId} → {loop.reviewerAgentId}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-pib-text)]">Allowed actions</dt>
                <dd className="mt-1 text-[var(--color-pib-muted)]">{loop.allowedActions.join(', ')}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-pib-text)]">Stale threshold</dt>
                <dd className="mt-1 text-[var(--color-pib-muted)]">{loop.staleThreshold}</dd>
              </div>
            </dl>
            <div className="mt-4 rounded-xl bg-[var(--color-pib-muted)]/5 p-3">
              <p className="text-sm font-semibold text-[var(--color-pib-text)]">Last decision</p>
              <p className="mt-1 text-sm text-[var(--color-pib-muted)]">{loop.lastDecision}</p>
            </div>
            <div className="mt-3 rounded-xl bg-emerald-500/5 p-3">
              <p className="text-sm font-semibold text-[var(--color-pib-text)]">Buyer-facing value</p>
              <p className="mt-1 text-sm text-[var(--color-pib-muted)]">{loop.positioning.buyerValue}</p>
            </div>
            {loop.approvalGates.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {loop.approvalGates.map((gate) => (
                  <span key={gate} className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700">{gate}</span>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  )
}
