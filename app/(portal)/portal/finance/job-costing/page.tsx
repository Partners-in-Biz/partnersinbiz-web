'use client'

import { useState } from 'react'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import {
  formatMinor,
  newFinanceId,
  readFinanceJson,
  requestIdentity,
  todayISODate,
} from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'

type AnyRec = Record<string, any>

export default function FinanceJobCostingPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [projectId, setProjectId] = useState('proj_demo')
  const [fromDate, setFromDate] = useState(todayISODate().slice(0, 8) + '01')
  const [toDate, setToDate] = useState(todayISODate())
  const [asOf, setAsOf] = useState(todayISODate())
  const [basis, setBasis] = useState<'accrual' | 'cash'>('accrual')
  const [timeEntryId, setTimeEntryId] = useState('te_demo_1')
  const [durationMinutes, setDurationMinutes] = useState('60')
  const [costRateMinor, setCostRateMinor] = useState('85000')
  const [laborExpenseAccountId, setLaborExpenseAccountId] = useState('acc_labor')
  const [wipAssetAccountId, setWipAssetAccountId] = useState('acc_wip_clearing')
  const [pnl, setPnl] = useState<AnyRec | null>(null)
  const [wip, setWip] = useState<AnyRec | null>(null)
  const [applications, setApplications] = useState<AnyRec[]>([])
  const [lastApplication, setLastApplication] = useState<AnyRec | null>(null)

  async function loadBundle() {
    if (!scope.scopeReady) return
    setBusy(true)
    scope.setError(null)
    try {
      const res = await fetch(
        scope.queryUrl('/api/v1/finance/job-costing/queries', 'bundle', {
          projectId,
        }),
        { credentials: 'include' },
      )
      const body = await readFinanceJson(res)
      setApplications(body?.data?.result?.applications || [])
      scope.setMessage('Job costing bundle loaded')
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Bundle load failed')
    } finally {
      setBusy(false)
    }
  }

  async function runPnL() {
    if (!scope.scopeReady) return
    setBusy(true)
    scope.setError(null)
    try {
      const res = await fetch(
        scope.queryUrl('/api/v1/finance/job-costing/queries', 'project-pnl', {
          projectId,
          fromDate,
          toDate,
          accountingBasis: basis,
        }),
        { credentials: 'include' },
      )
      const body = await readFinanceJson(res)
      setPnl(body?.data?.result ?? null)
      scope.setMessage('Project P&L generated')
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Project P&L failed')
    } finally {
      setBusy(false)
    }
  }

  async function runWip() {
    if (!scope.scopeReady) return
    setBusy(true)
    scope.setError(null)
    try {
      const res = await fetch(
        scope.queryUrl('/api/v1/finance/job-costing/queries', 'project-wip', {
          projectId,
          asOfDate: asOf,
          accountingBasis: basis,
          fromDate,
        }),
        { credentials: 'include' },
      )
      const body = await readFinanceJson(res)
      setWip(body?.data?.result ?? null)
      scope.setMessage('Project WIP generated')
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Project WIP failed')
    } finally {
      setBusy(false)
    }
  }

  async function applyTimeCost() {
    if (!scope.scopeReady || !scope.selectedBook) return
    setBusy(true)
    scope.setError(null)
    try {
      const identity = requestIdentity('jobcost')
      const result = await scope.runCommand('/api/v1/finance/job-costing/commands', 'job_costing.time_cost.apply', {
        id: newFinanceId('tca'),
        purpose: 'wip_cost',
        currency: scope.selectedBook.functionalCurrency || 'ZAR',
        laborExpenseAccountId,
        wipAssetAccountId,
        expectedVersion: 0,
        requestId: identity.requestId,
        idempotencyKey: identity.idempotencyKey,
        entries: [
          {
            timeEntryId,
            orgId: scope.orgId,
            projectId,
            billable: true,
            durationMinutes: Number(durationMinutes),
            costRateMinorPerHour: Number(costRateMinor),
            currency: scope.selectedBook.functionalCurrency || 'ZAR',
            endAt: new Date().toISOString(),
            description: `Labor on ${projectId}`,
          },
        ],
      })
      setLastApplication(result ?? null)
      scope.setMessage('Time cost applied (proposal only — no payment / no SARS)')
      await loadBundle()
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Time cost apply failed')
    } finally {
      setBusy(false)
    }
  }

  const currency = scope.selectedBook?.functionalCurrency || 'ZAR'

  return (
    <FinanceModuleFrame
      active="job-costing"
      orgScope={scope.orgScope}
      title="Job costing"
      description="Project dimensions on finance lines, project P&L / WIP, and optional time costing without double-billing. No external payment or SARS submit."
      error={scope.error}
      message={scope.message}
      loading={scope.loading}
    >
      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
        <>
          <FinanceScopeBar scope={scope} />

          <section className="pib-card grid gap-3 p-4 md:grid-cols-4">
            <label className="text-sm">Project id
              <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={projectId} onChange={(e) => setProjectId(e.target.value)} />
            </label>
            <label className="text-sm">Basis
              <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={basis} onChange={(e) => setBasis(e.target.value as 'cash' | 'accrual')}>
                <option value="accrual">Accrual</option>
                <option value="cash">Cash</option>
              </select>
            </label>
            <label className="text-sm">From
              <input type="date" className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </label>
            <label className="text-sm">To / as-of
              <input type="date" className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={toDate} onChange={(e) => { setToDate(e.target.value); setAsOf(e.target.value) }} />
            </label>
            <div className="flex flex-wrap items-end gap-2 md:col-span-4">
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void loadBundle()}>Load applications</button>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void runPnL()}>Project P&amp;L</button>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void runWip()}>Project WIP</button>
            </div>
          </section>

          <section className="pib-card grid gap-3 p-4 md:grid-cols-3">
            <h2 className="md:col-span-3 text-base font-semibold">Optional time costing (WIP proposal)</h2>
            <label className="text-sm">Time entry id
              <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={timeEntryId} onChange={(e) => setTimeEntryId(e.target.value)} />
            </label>
            <label className="text-sm">Duration minutes
              <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
            </label>
            <label className="text-sm">Cost rate minor / hour
              <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={costRateMinor} onChange={(e) => setCostRateMinor(e.target.value)} />
            </label>
            <label className="text-sm">Labor expense account
              <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={laborExpenseAccountId} onChange={(e) => setLaborExpenseAccountId(e.target.value)} />
            </label>
            <label className="text-sm">WIP / clearing account
              <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={wipAssetAccountId} onChange={(e) => setWipAssetAccountId(e.target.value)} />
            </label>
            <div className="flex items-end">
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void applyTimeCost()}>Apply time cost</button>
            </div>
            <p className="md:col-span-3 text-xs text-[var(--color-pib-muted)]">
              Creates a durable application with proposed journal lines only. Re-applying the same time entry for the same purpose is rejected (no double-billing / double-costing). Does not initiate payment or SARS submit.
            </p>
          </section>

          {lastApplication ? (
            <section className="pib-card p-4">
              <h2 className="text-base font-semibold">Last application</h2>
              <p className="mt-1 text-sm">Total cost: {formatMinor(lastApplication.totalCostMinor || 0, currency)}</p>
              <p className="text-sm">Entries: {(lastApplication.timeEntryIds || []).join(', ')}</p>
              <p className="text-sm">Proposed journal lines: {(lastApplication.proposedJournalLines || []).length}</p>
            </section>
          ) : null}

          {pnl ? (
            <section className="pib-card p-4">
              <h2 className="text-base font-semibold">Project P&amp;L — {pnl.projectId}</h2>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                <div className="rounded-lg border border-[var(--color-pib-line)] p-3">
                  <div className="text-xs uppercase tracking-wide text-[var(--color-pib-muted)]">Revenue</div>
                  <div className="text-lg font-semibold">{formatMinor(pnl.totalRevenueMinor || 0, currency)}</div>
                </div>
                <div className="rounded-lg border border-[var(--color-pib-line)] p-3">
                  <div className="text-xs uppercase tracking-wide text-[var(--color-pib-muted)]">Cost</div>
                  <div className="text-lg font-semibold">{formatMinor(pnl.totalCostMinor || 0, currency)}</div>
                </div>
                <div className="rounded-lg border border-[var(--color-pib-line)] p-3">
                  <div className="text-xs uppercase tracking-wide text-[var(--color-pib-muted)]">Gross margin</div>
                  <div className="text-lg font-semibold">{formatMinor(pnl.grossMarginMinor || 0, currency)}</div>
                </div>
              </div>
            </section>
          ) : null}

          {wip ? (
            <section className="pib-card p-4">
              <h2 className="text-base font-semibold">Project WIP — {wip.projectId}</h2>
              <p className="mt-1 text-sm">Unbilled labor cost: {formatMinor(wip.unbilledLaborCostMinor || 0, currency)}</p>
              <p className="text-sm">WIP total: {formatMinor(wip.wipMinor || 0, currency)}</p>
              <p className="text-sm">Open applications: {(wip.openTimeCostApplicationIds || []).length}</p>
            </section>
          ) : null}

          <section className="pib-card p-4">
            <h2 className="text-base font-semibold">Time cost applications ({applications.length})</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {applications.map((app) => (
                <li key={app.id} className="rounded-lg border border-[var(--color-pib-line)] p-3">
                  <div className="font-medium">{app.id} · {app.purpose} · {app.status}</div>
                  <div>{formatMinor(app.totalCostMinor || 0, app.currency || currency)} · projects {(app.projectIds || []).join(', ')}</div>
                </li>
              ))}
              {applications.length === 0 ? <li className="text-[var(--color-pib-muted)]">No applications in scope yet.</li> : null}
            </ul>
          </section>
        </>
      ) : null}
    </FinanceModuleFrame>
  )
}
