'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import {
  formatMinor,
  newFinanceId,
  parseRandsToMinor,
  readFinanceJson,
  requestIdentity,
} from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'
import { HudChip } from '@/components/ui/HudChip'
import { StatCard } from '@/components/ui/StatCard'

type Bundle = {
  budgets: Array<Record<string, any>>
  forecasts: Array<Record<string, any>>
  cashflowPlans: Array<Record<string, any>>
  cashScenarios?: Array<Record<string, any>>
  cashComparisons?: Array<Record<string, any>>
  cashSnapshots?: Array<Record<string, any>>
  analysisMode?: { temporaryAnalysis: true; permanentDashboard: false }
}

type Persona = 'owner' | 'bookkeeper'

export default function FinanceBudgetsPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [persona, setPersona] = useState<Persona>('owner')
  const [budgetName, setBudgetName] = useState('FY2026 operating')
  const [incomeAmount, setIncomeAmount] = useState('50000.00')
  const [expenseAmount, setExpenseAmount] = useState('32000.00')
  const [periodKey, setPeriodKey] = useState('2026-08')
  const [openingCash, setOpeningCash] = useState('100000.00')
  const [horizon, setHorizon] = useState('3')
  const [selectedBudgetId, setSelectedBudgetId] = useState('')
  const [selectedForecastId, setSelectedForecastId] = useState('')
  const [revBps, setRevBps] = useState('10000')
  const [expBps, setExpBps] = useState('9500')
  const [downInBps, setDownInBps] = useState('8500')
  const [downOutBps, setDownOutBps] = useState('11000')
  const [upInBps, setUpInBps] = useState('11500')
  const [upOutBps, setUpOutBps] = useState('9000')
  const [actualsTotal, setActualsTotal] = useState('100000.00')
  const [actualsAccounts, setActualsAccounts] = useState('cash_cheque,cash_savings')

  const loadBundle = useCallback(async () => {
    if (!scope.scopeReady) {
      setBundle(null)
      return
    }
    try {
      const res = await fetch(scope.queryUrl('/api/v1/finance/budgets/queries', 'bundle'), { credentials: 'include' })
      const body = await readFinanceJson(res)
      const next = (body?.data?.result ?? null) as Bundle | null
      setBundle(next)
      if (next?.budgets?.[0]?.id) setSelectedBudgetId((prev) => prev || next.budgets[0].id)
      if (next?.forecasts?.[0]?.id) setSelectedForecastId((prev) => prev || next.forecasts[0].id)
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load budgets')
    }
  }, [scope])

  useEffect(() => {
    void loadBundle()
  }, [scope.selectedBookId, scope.selectedEntityId, scope.scopeReady]) // eslint-disable-line react-hooks/exhaustive-deps

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true)
    scope.setError(null)
    scope.setMessage(null)
    try {
      await fn()
      await loadBundle()
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Budgets command failed')
    } finally {
      setBusy(false)
    }
  }

  function periodKeysForHorizon(): string[] {
    const months = Number(horizon) || 3
    const out: string[] = []
    const [y, m] = periodKey.split('-').map(Number)
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(y, m - 1 + i, 1))
      out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
    }
    return out
  }

  async function saveBudget() {
    await withBusy(async () => {
      const id = selectedBudgetId || newFinanceId('bud')
      const lines: Array<Record<string, unknown>> = []
      for (const pk of periodKeysForHorizon()) {
        lines.push({
          id: `ln_income_${pk}`,
          accountId: 'acc_income',
          accountCode: '4000',
          accountName: 'Service income',
          periodKey: pk,
          amountMinor: parseRandsToMinor(incomeAmount),
        })
        lines.push({
          id: `ln_expense_${pk}`,
          accountId: 'acc_opex',
          accountCode: '6000',
          accountName: 'Operating expense',
          periodKey: pk,
          amountMinor: parseRandsToMinor(expenseAmount),
        })
      }
      await scope.runCommand('/api/v1/finance/budgets/commands', 'budget.upsert', {
        id,
        name: budgetName,
        fiscalYear: Number(periodKey.slice(0, 4)),
        currency: 'ZAR',
        status: 'active',
        lines,
        ...requestIdentity('budget'),
      })
      setSelectedBudgetId(id)
      scope.setMessage(`Budget ${budgetName} saved`)
    })
  }

  async function saveForecast() {
    await withBusy(async () => {
      if (!selectedBudgetId) throw new Error('Save a budget first')
      const id = selectedForecastId || newFinanceId('fc')
      await scope.runCommand('/api/v1/finance/budgets/commands', 'forecast.upsert', {
        id,
        budgetId: selectedBudgetId,
        name: 'Base case',
        revenueBps: Number(revBps),
        expenseBps: Number(expBps),
        status: 'active',
        ...requestIdentity('forecast'),
      })
      setSelectedForecastId(id)
      scope.setMessage('Forecast scenario saved')
    })
  }

  async function buildPlan() {
    await withBusy(async () => {
      if (!selectedBudgetId) throw new Error('Save a budget first')
      const id = newFinanceId('cfp')
      await scope.runCommand('/api/v1/finance/budgets/commands', 'cashflow.plan.build', {
        id,
        budgetId: selectedBudgetId,
        forecastId: selectedForecastId || undefined,
        name: 'Cashflow plan',
        openingCashMinor: parseRandsToMinor(openingCash),
        startPeriodKey: periodKey,
        horizonMonths: Number(horizon),
        lineDirection: { acc_income: 'in', acc_opex: 'out' },
        arByPeriod: { [periodKey]: parseRandsToMinor('5000.00') },
        apByPeriod: { [periodKey]: parseRandsToMinor('2000.00') },
        ...requestIdentity('cashflow'),
      })
      scope.setMessage('Cashflow plan ready - planning only, no payment initiation')
    })
  }

  async function buildNamedScenarios() {
    await withBusy(async () => {
      if (!selectedBudgetId) throw new Error('Save a budget first')
      const openingCashMinor = parseRandsToMinor(openingCash)
      const horizonMonths = Number(horizon)
      const common = {
        budgetId: selectedBudgetId,
        openingCashMinor,
        startPeriodKey: periodKey,
        horizonMonths,
        lineDirection: { acc_income: 'in', acc_opex: 'out' },
        arByPeriod: { [periodKey]: parseRandsToMinor('5000.00') },
        apByPeriod: { [periodKey]: parseRandsToMinor('2000.00') },
        status: 'ready',
      }
      const baseId = newFinanceId('scn_base')
      const downId = newFinanceId('scn_down')
      const upId = newFinanceId('scn_up')
      await scope.runCommand('/api/v1/finance/budgets/commands', 'cashflow.scenario.upsert', {
        id: baseId,
        name: 'Base',
        kind: 'base',
        inflowBps: 10000,
        outflowBps: 10000,
        adjustments: [],
        ...common,
        ...requestIdentity('scn-base'),
      })
      await scope.runCommand('/api/v1/finance/budgets/commands', 'cashflow.scenario.upsert', {
        id: downId,
        name: 'Downside',
        kind: 'downside',
        inflowBps: Number(downInBps),
        outflowBps: Number(downOutBps),
        adjustments: [{ periodKey, inflowDeltaMinor: -parseRandsToMinor('2000.00'), note: 'Delayed collections' }],
        ...common,
        ...requestIdentity('scn-down'),
      })
      await scope.runCommand('/api/v1/finance/budgets/commands', 'cashflow.scenario.upsert', {
        id: upId,
        name: 'Upside',
        kind: 'upside',
        inflowBps: Number(upInBps),
        outflowBps: Number(upOutBps),
        adjustments: [{ periodKey, inflowDeltaMinor: parseRandsToMinor('3000.00'), note: 'Faster collections' }],
        ...common,
        ...requestIdentity('scn-up'),
      })
      await scope.runCommand('/api/v1/finance/budgets/commands', 'cashflow.scenario.compare', {
        id: newFinanceId('cmp'),
        name: 'Base vs Down vs Up',
        scenarioIds: [baseId, downId, upId],
        ...requestIdentity('scn-cmp'),
      })
      scope.setMessage('Named scenarios built + compared - temporary analysis only, no bank movement')
    })
  }

  async function attachActualsToBase() {
    await withBusy(async () => {
      const base = (bundle?.cashScenarios || []).find((s) => s.kind === 'base') || bundle?.cashScenarios?.[0]
      if (!base?.id) throw new Error('Build named scenarios first')
      const accountIds = actualsAccounts
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      await scope.runCommand('/api/v1/finance/budgets/commands', 'cashflow.actuals.attach', {
        scenarioId: base.id,
        actuals: {
          source: 'reconciled_cash_accounts',
          asOf: new Date().toISOString(),
          accountIds,
          totalCashMinor: parseRandsToMinor(actualsTotal),
          note: 'Read-only reconciled cash snapshot',
          readOnly: true,
          bankMovementInitiated: false,
        },
        applyAsOpening: true,
        ...requestIdentity('scn-actuals'),
      })
      scope.setMessage('Reconciled cash actuals attached (read-only) - no bank movement')
    })
  }

  async function snapshotScenarios() {
    await withBusy(async () => {
      const ids = (bundle?.cashScenarios || []).slice(0, 3).map((s) => s.id)
      if (ids.length < 1) throw new Error('Build named scenarios first')
      await scope.runCommand('/api/v1/finance/budgets/commands', 'cashflow.scenario.snapshot', {
        id: newFinanceId('snap'),
        name: `Snapshot ${new Date().toISOString().slice(0, 10)}`,
        scenarioIds: ids,
        includeComparison: ids.length >= 2,
        ...requestIdentity('scn-snap'),
      })
      scope.setMessage('Scenario snapshot frozen - temporary analysis artifact only')
    })
  }

  const latestPlan = bundle?.cashflowPlans?.[0]
  const scenarios = bundle?.cashScenarios || []
  const latestCompare = bundle?.cashComparisons?.[0]
  const latestSnap = bundle?.cashSnapshots?.[0]

  const endingByKind = useMemo(() => {
    const map: Record<string, number | undefined> = {}
    for (const s of scenarios) {
      const last = s.months?.[s.months.length - 1]
      if (last) map[s.kind] = last.closingCashMinor
    }
    return map
  }, [scenarios])

  const ownerDense = persona === 'owner'
  const bookkeeperDense = persona === 'bookkeeper'

  return (
    <FinanceModuleFrame
      active="budgets"
      orgScope={scope.orgScope}
      title="Budgets & cash scenarios"
      description="Operating budgets, forecast multipliers, cashflow planner, and named base/downside/upside scenarios. Temporary analysis only - never a permanent CEO dashboard. Does not initiate bank payments or SARS submits."
      error={scope.error}
      message={scope.message}
      loading={scope.loading || busy}
      meta={
        <div className="flex flex-wrap items-center gap-1.5">
          <HudChip tone="accent">Temporary analysis</HudChip>
          <HudChip>No permanent CEO dashboard</HudChip>
          <HudChip>No bank movement</HudChip>
          <HudChip>No SARS submit</HudChip>
        </div>
      }
    >
      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
        <div className="space-y-6" data-testid="finance-budgets-scenarios">
          <FinanceScopeBar scope={scope} />

          <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm">Role lens (UX density)</h2>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className={`rounded px-2 py-1 text-xs ${persona === 'owner' ? 'bg-[var(--color-pib-accent)] text-white' : 'border'}`}
                  onClick={() => setPersona('owner')}
                >
                  Owner
                </button>
                <button
                  type="button"
                  className={`rounded px-2 py-1 text-xs ${persona === 'bookkeeper' ? 'bg-[var(--color-pib-accent)] text-white' : 'border'}`}
                  onClick={() => setPersona('bookkeeper')}
                >
                  Bookkeeper
                </button>
              </div>
            </div>
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              Persona is a density lens only - authorization still uses finance roles. Owner sees decision spread; bookkeeper sees actuals + entry detail.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <StatCard label="Base close" value={formatMinor(endingByKind.base ?? 0)} detail="Named base scenario" />
              <StatCard label="Downside close" value={formatMinor(endingByKind.downside ?? 0)} detail="Stress case" />
              <StatCard label="Upside close" value={formatMinor(endingByKind.upside ?? 0)} detail="Optimistic case" />
              <StatCard
                label="Compare spread"
                value={formatMinor(latestCompare?.rows?.[latestCompare.rows.length - 1]?.spreadClosingMinor ?? 0)}
                detail="Max−min ending cash"
              />
            </div>
          </section>

          {(ownerDense || bookkeeperDense) && (
            <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
              <h2 className="mb-3 text-sm">Budget</h2>
              <div className="grid gap-3 md:grid-cols-4">
                <label className="text-xs">
                  Name
                  <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={budgetName} onChange={(e) => setBudgetName(e.target.value)} />
                </label>
                <label className="text-xs">
                  Period (YYYY-MM)
                  <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} />
                </label>
                <label className="text-xs">
                  Income (R)
                  <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={incomeAmount} onChange={(e) => setIncomeAmount(e.target.value)} />
                </label>
                <label className="text-xs">
                  Expense (R)
                  <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} />
                </label>
              </div>
              <button type="button" disabled={busy} className="mt-3 rounded bg-[var(--color-pib-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50" onClick={() => void saveBudget()}>
                Save budget
              </button>
            </section>
          )}

          {bookkeeperDense && (
            <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
              <h2 className="mb-3 text-sm">Forecast multipliers (bps, 10000=100%)</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs">
                  Revenue bps
                  <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={revBps} onChange={(e) => setRevBps(e.target.value)} />
                </label>
                <label className="text-xs">
                  Expense bps
                  <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={expBps} onChange={(e) => setExpBps(e.target.value)} />
                </label>
              </div>
              <button type="button" disabled={busy} className="mt-3 rounded border px-3 py-1.5 text-sm disabled:opacity-50" onClick={() => void saveForecast()}>
                Save forecast
              </button>
            </section>
          )}

          <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm">Cashflow planner + opening</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs">
                Opening cash (R)
                <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} />
              </label>
              <label className="text-xs">
                Horizon months
                <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={horizon} onChange={(e) => setHorizon(e.target.value)} />
              </label>
            </div>
            <button type="button" disabled={busy} className="mt-3 rounded border px-3 py-1.5 text-sm disabled:opacity-50" onClick={() => void buildPlan()}>
              Build single plan
            </button>
            {latestPlan ? (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--color-pib-text-muted)]">
                      <th className="py-1 pr-3">Period</th>
                      <th className="py-1 pr-3">Opening</th>
                      <th className="py-1 pr-3">In</th>
                      <th className="py-1 pr-3">Out</th>
                      <th className="py-1">Closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(latestPlan.months || []).map((m: any) => (
                      <tr key={m.periodKey} className="border-t border-[var(--color-pib-line)]">
                        <td className="py-1 pr-3">{m.periodKey}</td>
                        <td className="py-1 pr-3 tabular-nums">{formatMinor(m.openingCashMinor)}</td>
                        <td className="py-1 pr-3 tabular-nums">{formatMinor(m.inflowsMinor)}</td>
                        <td className="py-1 pr-3 tabular-nums">{formatMinor(m.outflowsMinor)}</td>
                        <td className="py-1 tabular-nums">{formatMinor(m.closingCashMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4" data-testid="cash-scenarios-panel">
            <h2 className="mb-1 text-sm">Named cash scenarios</h2>
            <p className="mb-3 text-xs text-[var(--color-pib-text-muted)]">
              Base / downside / upside with adjustable inflow/outflow bps and period deltas. Compare + snapshot. No auto bank movement.
            </p>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-xs">
                Downside inflow bps
                <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={downInBps} onChange={(e) => setDownInBps(e.target.value)} />
              </label>
              <label className="text-xs">
                Downside outflow bps
                <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={downOutBps} onChange={(e) => setDownOutBps(e.target.value)} />
              </label>
              <label className="text-xs">
                Upside inflow bps
                <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={upInBps} onChange={(e) => setUpInBps(e.target.value)} />
              </label>
              <label className="text-xs">
                Upside outflow bps
                <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={upOutBps} onChange={(e) => setUpOutBps(e.target.value)} />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy} className="rounded bg-[var(--color-pib-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50" onClick={() => void buildNamedScenarios()}>
                Build base / down / up + compare
              </button>
              <button type="button" disabled={busy} className="rounded border px-3 py-1.5 text-sm disabled:opacity-50" onClick={() => void snapshotScenarios()}>
                Snapshot scenarios
              </button>
            </div>

            {ownerDense && latestCompare ? (
              <div className="mt-4 overflow-x-auto">
                <h3 className="mb-2 text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Owner compare</h3>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--color-pib-text-muted)]">
                      <th className="py-1 pr-3">Period</th>
                      {(latestCompare.rows?.[0]?.cells || []).map((c: any) => (
                        <th key={c.scenarioId} className="py-1 pr-3">
                          {c.name} close
                        </th>
                      ))}
                      <th className="py-1">Spread</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(latestCompare.rows || []).map((row: any) => (
                      <tr key={row.periodKey} className="border-t border-[var(--color-pib-line)]">
                        <td className="py-1 pr-3">{row.periodKey}</td>
                        {(row.cells || []).map((c: any) => (
                          <td key={c.scenarioId} className="py-1 pr-3 tabular-nums">
                            {formatMinor(c.closingCashMinor)}
                          </td>
                        ))}
                        <td className="py-1 tabular-nums">{formatMinor(row.spreadClosingMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {bookkeeperDense ? (
              <div className="mt-4 space-y-3 rounded-lg border border-dashed border-[var(--color-pib-line)] p-3">
                <h3 className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Bookkeeper actuals (read-only)</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-xs">
                    Reconciled cash total (R)
                    <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={actualsTotal} onChange={(e) => setActualsTotal(e.target.value)} />
                  </label>
                  <label className="text-xs">
                    Account ids (comma)
                    <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={actualsAccounts} onChange={(e) => setActualsAccounts(e.target.value)} />
                  </label>
                </div>
                <button type="button" disabled={busy} className="rounded border px-3 py-1.5 text-sm disabled:opacity-50" onClick={() => void attachActualsToBase()}>
                  Attach actuals to base (opening only)
                </button>
                <p className="text-xs text-[var(--color-pib-text-muted)]">Uses reconciled cash account totals as a snapshot. Never initiates bank movement.</p>
              </div>
            ) : null}

            {scenarios.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--color-pib-text-muted)]">
                      <th className="py-1 pr-3">Scenario</th>
                      <th className="py-1 pr-3">Kind</th>
                      <th className="py-1 pr-3">In bps</th>
                      <th className="py-1 pr-3">Out bps</th>
                      <th className="py-1 pr-3">Opening</th>
                      <th className="py-1">Ending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarios.map((s) => {
                      const last = s.months?.[s.months.length - 1]
                      return (
                        <tr key={s.id} className="border-t border-[var(--color-pib-line)]">
                          <td className="py-1 pr-3">{s.name}</td>
                          <td className="py-1 pr-3">{s.kind}</td>
                          <td className="py-1 pr-3 tabular-nums">{s.inflowBps}</td>
                          <td className="py-1 pr-3 tabular-nums">{s.outflowBps}</td>
                          <td className="py-1 pr-3 tabular-nums">{formatMinor(s.openingCashMinor)}</td>
                          <td className="py-1 tabular-nums">{formatMinor(last?.closingCashMinor ?? 0)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4 text-sm">
            <div>Budgets: {bundle?.budgets?.length ?? 0}</div>
            <div>Forecasts: {bundle?.forecasts?.length ?? 0}</div>
            <div>Cashflow plans: {bundle?.cashflowPlans?.length ?? 0}</div>
            <div>Cash scenarios: {scenarios.length}</div>
            <div>Comparisons: {bundle?.cashComparisons?.length ?? 0}</div>
            <div>Snapshots: {bundle?.cashSnapshots?.length ?? 0}{latestSnap ? ` (latest ${latestSnap.name})` : ''}</div>
            <div className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              analysisMode temporaryAnalysis={String(bundle?.analysisMode?.temporaryAnalysis ?? true)} permanentDashboard=
              {String(bundle?.analysisMode?.permanentDashboard ?? false)}
            </div>
          </section>
        </div>
      ) : null}
    </FinanceModuleFrame>
  )
}
