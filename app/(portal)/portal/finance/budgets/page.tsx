'use client'

import { useCallback, useEffect, useState } from 'react'
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

type Bundle = {
  budgets: Array<Record<string, any>>
  forecasts: Array<Record<string, any>>
  cashflowPlans: Array<Record<string, any>>
}

export default function FinanceBudgetsPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<Bundle | null>(null)
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

  async function saveBudget() {
    await withBusy(async () => {
      const id = selectedBudgetId || newFinanceId('bud')
      await scope.runCommand('/api/v1/finance/budgets/commands', 'budget.upsert', {
        id,
        name: budgetName,
        fiscalYear: Number(periodKey.slice(0, 4)),
        currency: 'ZAR',
        status: 'active',
        lines: [
          {
            id: 'ln_income',
            accountId: 'acc_income',
            accountCode: '4000',
            accountName: 'Service income',
            periodKey,
            amountMinor: parseRandsToMinor(incomeAmount),
          },
          {
            id: 'ln_expense',
            accountId: 'acc_opex',
            accountCode: '6000',
            accountName: 'Operating expense',
            periodKey,
            amountMinor: parseRandsToMinor(expenseAmount),
          },
        ],
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
      scope.setMessage('Cashflow plan ready — planning only, no payment initiation')
    })
  }

  const latestPlan = bundle?.cashflowPlans?.[0]

  return (
    <FinanceModuleFrame
      title="Budgets & cashflow"
      description="Operating budgets, forecast scenarios, and cashflow planner. Planning surface only — does not initiate bank payments or SARS submits."
      busy={busy}
      error={scope.error}
      message={scope.message}
      testId="finance-budgets-page"
    >
      <FinanceScopeBar scope={scope} />
      {!scope.scopeReady ? (
        <FinanceEmptyScope />
      ) : (
        <div className="space-y-6">
          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm font-semibold">Budget</h2>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-xs">Name<input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={budgetName} onChange={(e) => setBudgetName(e.target.value)} /></label>
              <label className="text-xs">Period (YYYY-MM)<input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} /></label>
              <label className="text-xs">Income (R)<input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={incomeAmount} onChange={(e) => setIncomeAmount(e.target.value)} /></label>
              <label className="text-xs">Expense (R)<input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} /></label>
            </div>
            <button type="button" disabled={busy} className="mt-3 rounded bg-[var(--color-pib-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50" onClick={() => void saveBudget()}>Save budget</button>
          </section>

          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm font-semibold">Forecast scenario (bps, 10000=100%)</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs">Revenue bps<input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={revBps} onChange={(e) => setRevBps(e.target.value)} /></label>
              <label className="text-xs">Expense bps<input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={expBps} onChange={(e) => setExpBps(e.target.value)} /></label>
            </div>
            <button type="button" disabled={busy} className="mt-3 rounded border px-3 py-1.5 text-sm disabled:opacity-50" onClick={() => void saveForecast()}>Save forecast</button>
          </section>

          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm font-semibold">Cashflow planner</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs">Opening cash (R)<input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} /></label>
              <label className="text-xs">Horizon months<input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={horizon} onChange={(e) => setHorizon(e.target.value)} /></label>
            </div>
            <button type="button" disabled={busy} className="mt-3 rounded border px-3 py-1.5 text-sm disabled:opacity-50" onClick={() => void buildPlan()}>Build plan</button>
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

          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4 text-sm">
            <div>Budgets: {bundle?.budgets?.length ?? 0}</div>
            <div>Forecasts: {bundle?.forecasts?.length ?? 0}</div>
            <div>Cashflow plans: {bundle?.cashflowPlans?.length ?? 0}</div>
          </section>
        </div>
      )}
    </FinanceModuleFrame>
  )
}
