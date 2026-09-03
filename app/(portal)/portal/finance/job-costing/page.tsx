'use client'

import Link from 'next/link'
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
import { HudChip } from '@/components/ui/HudChip'
import { StatCard } from '@/components/ui/StatCard'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'

type AnyRec = Record<string, any>

const LOOP_STEP_ORDER = ['quote_project', 'time_cost', 'wip', 'invoice', 'cash'] as const

function stepTone(status: string): 'accent' | 'warning' | undefined {
  if (status === 'done') return 'accent'
  if (status === 'open' || status === 'blocked') return 'warning'
  return undefined
}

export default function FinanceJobCostingPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [projectId, setProjectId] = useState('proj_demo')
  const [quoteId, setQuoteId] = useState('')
  const [fromDate, setFromDate] = useState(todayISODate().slice(0, 8) + '01')
  const [toDate, setToDate] = useState(todayISODate())
  const [asOf, setAsOf] = useState(todayISODate())
  const [basis, setBasis] = useState<'accrual' | 'cash'>('accrual')
  const [purpose, setPurpose] = useState<'wip_cost' | 'draft_invoice_lines'>('wip_cost')
  const [timeEntryId, setTimeEntryId] = useState('te_demo_1')
  const [durationMinutes, setDurationMinutes] = useState('60')
  const [costRateMinor, setCostRateMinor] = useState('85000')
  const [laborExpenseAccountId, setLaborExpenseAccountId] = useState('acc_labor')
  const [wipAssetAccountId, setWipAssetAccountId] = useState('acc_wip_clearing')
  const [revenueAccountId, setRevenueAccountId] = useState('acc_rev')
  const [taxCodeId, setTaxCodeId] = useState('za_std_15')
  const [pnl, setPnl] = useState<AnyRec | null>(null)
  const [wip, setWip] = useState<AnyRec | null>(null)
  const [trace, setTrace] = useState<AnyRec | null>(null)
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
      scope.setMessage('Job costing applications loaded')
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Bundle load failed')
    } finally {
      setBusy(false)
    }
  }

  async function runClosedLoop() {
    if (!scope.scopeReady) return
    setBusy(true)
    scope.setError(null)
    try {
      const res = await fetch(
        scope.queryUrl('/api/v1/finance/job-costing/queries', 'closed-loop', {
          projectId,
          asOfDate: asOf,
          accountingBasis: basis,
          fromDate,
          ...(quoteId.trim() ? { quoteId: quoteId.trim() } : {}),
        }),
        { credentials: 'include' },
      )
      const body = await readFinanceJson(res)
      const result = body?.data?.result ?? null
      setTrace(result?.trace ?? null)
      setPnl(result?.pnl ?? null)
      setWip(result?.wip ?? null)
      scope.setMessage('Closed-loop trace + P&L + WIP aging loaded')
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Closed-loop load failed')
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
      scope.setMessage('Project WIP + aging generated')
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
      const payload: AnyRec = {
        id: newFinanceId('tca'),
        purpose,
        currency: scope.selectedBook.functionalCurrency || 'ZAR',
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
      }
      if (purpose === 'wip_cost') {
        payload.laborExpenseAccountId = laborExpenseAccountId
        payload.wipAssetAccountId = wipAssetAccountId
      } else {
        payload.revenueAccountId = revenueAccountId
        payload.taxCodeId = taxCodeId
      }
      const result = await scope.runCommand(
        '/api/v1/finance/job-costing/commands',
        'job_costing.time_cost.apply',
        payload,
      )
      setLastApplication(result ?? null)
      scope.setMessage(
        purpose === 'wip_cost'
          ? 'WIP time cost applied (journal proposal only - no payment / no SARS)'
          : 'Draft invoice lines proposed (not auto-issued - finish on Documents)',
      )
      await loadBundle()
      await runClosedLoop()
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Time cost apply failed')
    } finally {
      setBusy(false)
    }
  }

  const currency = scope.selectedBook?.functionalCurrency || 'ZAR'
  const docsHref = scope.orgScope
    ? scopedPortalPath('/portal/finance/documents', scope.orgScope)
    : '/portal/finance/documents'
  const runbooksHref = scope.orgScope
    ? scopedPortalPath('/portal/finance/runbooks', scope.orgScope)
    : '/portal/finance/runbooks'
  const steps: AnyRec[] = Array.isArray(trace?.steps) ? trace.steps : []
  const orderedSteps = LOOP_STEP_ORDER.map(
    (id) => steps.find((s) => s.id === id) || { id, label: id, status: 'pending', detail: '', refs: [] },
  )
  const aging: AnyRec[] = Array.isArray(wip?.aging) ? wip.aging : []

  return (
    <FinanceModuleFrame
      active="job-costing"
      orgScope={scope.orgScope}
      title="Job costing"
      description="Closed loop: quote/project → time cost → WIP → invoice → cash application. Same portal design system. No external payment or SARS submit."
      error={scope.error}
      message={scope.message}
      loading={scope.loading}
    >
      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
        <>
          <FinanceScopeBar scope={scope} />

          <section className="flex flex-wrap items-center gap-2" data-testid="job-costing-hard-gates">
            <HudChip tone="accent">Closed loop</HudChip>
            <HudChip>No double-bill</HudChip>
            <HudChip>No double-cost</HudChip>
            <HudChip>No SARS / no payout</HudChip>
            <Link href={runbooksHref} className="text-xs text-[var(--color-pib-muted)] underline">
              Operator runbook P6-C6
            </Link>
          </section>

          <section className="pib-card grid gap-3 p-4 md:grid-cols-4" data-testid="job-costing-filters">
            <label className="text-sm">
              Project id
              <input
                className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Quote id (optional)
              <input
                className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                value={quoteId}
                onChange={(e) => setQuoteId(e.target.value)}
                placeholder="quo_…"
              />
            </label>
            <label className="text-sm">
              Basis
              <select
                className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                value={basis}
                onChange={(e) => setBasis(e.target.value as 'cash' | 'accrual')}
              >
                <option value="accrual">Accrual</option>
                <option value="cash">Cash</option>
              </select>
            </label>
            <label className="text-sm">
              From
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </label>
            <label className="text-sm">
              To
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </label>
            <label className="text-sm">
              As-of (WIP / loop)
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-end gap-2 md:col-span-2">
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void runClosedLoop()}>
                Load closed loop
              </button>
              <button type="button" className="pib-btn-secondary" disabled={busy} onClick={() => void loadBundle()}>
                Applications
              </button>
              <button type="button" className="pib-btn-secondary" disabled={busy} onClick={() => void runPnL()}>
                P&amp;L only
              </button>
              <button type="button" className="pib-btn-secondary" disabled={busy} onClick={() => void runWip()}>
                WIP only
              </button>
            </div>
          </section>

          <section className="pib-card space-y-3 p-4" data-testid="job-costing-closed-loop">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base">Traceability · quote → cash</h2>
              <HudChip>Observe cash on Documents</HudChip>
            </div>
            <ol className="grid gap-2 md:grid-cols-5">
              {orderedSteps.map((step, index) => (
                <li
                  key={step.id}
                  className="rounded-lg border border-[var(--color-pib-line)] p-3"
                  data-testid={`job-cost-step-${step.id}`}
                  data-status={step.status}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-[var(--color-pib-muted)]">{index + 1}</span>
                    <HudChip tone={stepTone(String(step.status))}>{String(step.status)}</HudChip>
                  </div>
                  <p className="mt-1 text-sm font-medium">{step.label}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-pib-muted)]">{step.detail}</p>
                </li>
              ))}
            </ol>
            {!trace ? (
              <p className="text-sm text-[var(--color-pib-muted)]">
                Load closed loop to see live step status for this project.
              </p>
            ) : null}
          </section>

          {(pnl || wip) && (
            <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="job-costing-stats">
              <StatCard
                label="Revenue"
                value={formatMinor(pnl?.totalRevenueMinor || 0, currency)}
                detail="Project-tagged"
                icon="payments"
              />
              <StatCard
                label="Cost"
                value={formatMinor(pnl?.totalCostMinor || 0, currency)}
                detail="Journals + bills"
                icon="request_quote"
              />
              <StatCard
                label="Gross margin"
                value={formatMinor(pnl?.grossMarginMinor || 0, currency)}
                detail="Revenue − cost"
                icon="monitoring"
              />
              <StatCard
                label="Open WIP"
                value={formatMinor(wip?.wipMinor || wip?.unbilledLaborCostMinor || 0, currency)}
                detail="Unbilled labor"
                icon="hourglass_top"
              />
              <StatCard
                label="Cash applied"
                value={formatMinor(pnl?.cashAppliedMinor || 0, currency)}
                detail="Pro-rata invoices"
                icon="account_balance"
              />
              <StatCard
                label="Open AR"
                value={formatMinor(pnl?.outstandingArMinor || 0, currency)}
                detail="Project share"
                icon="receipt_long"
              />
            </section>
          )}

          <section className="pib-card grid gap-3 p-4 md:grid-cols-3" data-testid="job-costing-apply">
            <h2 className="md:col-span-3 text-base">Time cost application</h2>
            <label className="text-sm">
              Purpose
              <select
                className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as 'wip_cost' | 'draft_invoice_lines')}
              >
                <option value="wip_cost">WIP labor cost</option>
                <option value="draft_invoice_lines">Draft invoice lines</option>
              </select>
            </label>
            <label className="text-sm">
              Time entry id
              <input
                className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                value={timeEntryId}
                onChange={(e) => setTimeEntryId(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Duration minutes
              <input
                className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Cost rate minor / hour
              <input
                className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                value={costRateMinor}
                onChange={(e) => setCostRateMinor(e.target.value)}
              />
            </label>
            {purpose === 'wip_cost' ? (
              <>
                <label className="text-sm">
                  Labor expense account
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={laborExpenseAccountId}
                    onChange={(e) => setLaborExpenseAccountId(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  WIP / clearing account
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={wipAssetAccountId}
                    onChange={(e) => setWipAssetAccountId(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="text-sm">
                  Revenue account
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={revenueAccountId}
                    onChange={(e) => setRevenueAccountId(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Tax code
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={taxCodeId}
                    onChange={(e) => setTaxCodeId(e.target.value)}
                  />
                </label>
              </>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void applyTimeCost()}>
                Apply time cost
              </button>
              <Link href={docsHref} className="pib-btn-secondary btn-pib-sm">
                Open Documents (invoice / cash)
              </Link>
            </div>
            <p className="md:col-span-3 text-xs text-[var(--color-pib-muted)]">
              Same time entry cannot be applied twice for the same purpose. Draft invoice refuses already-invoiced
              source entries. Draft invoice on a time entry releases matching open WIP (no double-cost). Cash
              application stays on Documents payment allocate - job costing never initiates bank payout or SARS
              submit.
            </p>
          </section>

          {lastApplication ? (
            <section className="pib-card p-4" data-testid="job-costing-last-application">
              <h2 className="text-base">Last application</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                <HudChip tone="accent">{lastApplication.purpose}</HudChip>
                <HudChip>{lastApplication.status}</HudChip>
                <HudChip>No egress</HudChip>
              </div>
              <p className="mt-2 text-sm">Total cost: {formatMinor(lastApplication.totalCostMinor || 0, currency)}</p>
              <p className="text-sm">Entries: {(lastApplication.timeEntryIds || []).join(', ')}</p>
              <p className="text-sm">
                Proposed journal lines: {(lastApplication.proposedJournalLines || []).length} · Proposed invoice
                lines: {(lastApplication.proposedInvoiceLines || []).length}
              </p>
            </section>
          ) : null}

          {pnl ? (
            <section className="pib-card p-4" data-testid="job-costing-pnl">
              <h2 className="text-base">Job P&amp;L - {pnl.projectId}</h2>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="text-sm font-medium">Revenue lines</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {(pnl.revenueLines || []).map((line: AnyRec) => (
                      <li key={`${line.source}:${line.accountId}`} className="flex justify-between gap-2">
                        <span>
                          {line.accountCode} {line.accountName}
                          <span className="text-[var(--color-pib-muted)]"> · {line.source}</span>
                        </span>
                        <span>{formatMinor(line.amountMinor || 0, currency)}</span>
                      </li>
                    ))}
                    {(pnl.revenueLines || []).length === 0 ? (
                      <li className="text-[var(--color-pib-muted)]">No project revenue in range.</li>
                    ) : null}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-medium">Cost lines</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {(pnl.costLines || []).map((line: AnyRec) => (
                      <li key={`${line.source}:${line.accountId}`} className="flex justify-between gap-2">
                        <span>
                          {line.accountCode} {line.accountName}
                          <span className="text-[var(--color-pib-muted)]"> · {line.source}</span>
                        </span>
                        <span>{formatMinor(line.amountMinor || 0, currency)}</span>
                      </li>
                    ))}
                    {(pnl.costLines || []).length === 0 ? (
                      <li className="text-[var(--color-pib-muted)]">No project cost in range.</li>
                    ) : null}
                  </ul>
                </div>
              </div>
              {(pnl.invoiceCashSlices || []).length > 0 ? (
                <div className="mt-4">
                  <h3 className="text-sm font-medium">Invoice cash slices</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {pnl.invoiceCashSlices.map((slice: AnyRec) => (
                      <li key={slice.invoiceId} className="rounded-lg border border-[var(--color-pib-line)] p-2">
                        {slice.invoiceId}: cash {formatMinor(slice.cashAppliedMinor || 0, currency)} · open{' '}
                        {formatMinor(slice.outstandingMinor || 0, currency)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {wip ? (
            <section className="pib-card p-4" data-testid="job-costing-wip">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base">WIP aging - {wip.projectId}</h2>
                <HudChip>
                  Released {formatMinor(wip.releasedLaborCostMinor || 0, currency)}
                </HudChip>
              </div>
              <p className="mt-1 text-sm">
                Open WIP: {formatMinor(wip.unbilledLaborCostMinor || 0, currency)} · applications{' '}
                {(wip.openTimeCostApplicationIds || []).length}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {aging.map((bucket) => (
                  <div
                    key={bucket.key}
                    className="rounded-lg border border-[var(--color-pib-line)] p-3"
                    data-testid={`job-cost-wip-bucket-${bucket.key}`}
                  >
                    <div className="text-xs uppercase tracking-wide text-[var(--color-pib-muted)]">{bucket.label}</div>
                    <div className="text-lg">{formatMinor(bucket.amountMinor || 0, currency)}</div>
                    <div className="text-xs text-[var(--color-pib-muted)]">{bucket.count || 0} app(s)</div>
                  </div>
                ))}
                {aging.length === 0 ? (
                  <p className="text-sm text-[var(--color-pib-muted)] sm:col-span-2 lg:col-span-5">
                    No aging buckets yet - load WIP or closed loop.
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="pib-card p-4" data-testid="job-costing-applications">
            <h2 className="text-base">Time cost applications ({applications.length})</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {applications.map((app) => (
                <li key={app.id} className="rounded-lg border border-[var(--color-pib-line)] p-3">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    <span>{app.id}</span>
                    <HudChip>{app.purpose}</HudChip>
                    <HudChip tone={app.status === 'applied' ? 'accent' : undefined}>{app.status}</HudChip>
                  </div>
                  <div>
                    {formatMinor(app.totalCostMinor || 0, app.currency || currency)} · projects{' '}
                    {(app.projectIds || []).join(', ')}
                  </div>
                </li>
              ))}
              {applications.length === 0 ? (
                <li className="text-[var(--color-pib-muted)]">No applications in scope yet.</li>
              ) : null}
            </ul>
          </section>
        </>
      ) : null}
    </FinanceModuleFrame>
  )
}
