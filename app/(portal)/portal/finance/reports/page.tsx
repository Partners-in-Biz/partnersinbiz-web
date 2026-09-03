'use client'

import Link from 'next/link'
import { useState } from 'react'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'
import { formatMinor, readFinanceJson, todayISODate } from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'

type ReportRow = Record<string, any>

export default function FinanceReportsPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [asOf, setAsOf] = useState(todayISODate())
  const [fromDate, setFromDate] = useState(todayISODate().slice(0, 8) + '01')
  const [toDate, setToDate] = useState(todayISODate())
  const [basis, setBasis] = useState<'accrual' | 'cash'>('accrual')
  const [trialBalance, setTrialBalance] = useState<ReportRow | null>(null)
  const [incomeStatement, setIncomeStatement] = useState<ReportRow | null>(null)
  const [balanceSheet, setBalanceSheet] = useState<ReportRow | null>(null)

  async function runReport(resource: 'trial-balance' | 'income-statement' | 'balance-sheet') {
    if (!scope.scopeReady) return
    setBusy(true)
    scope.setError(null)
    try {
      const extra: Record<string, string> = {
        accountingBasis: basis || scope.selectedBook?.accountingBasis || 'accrual',
      }
      if (resource === 'income-statement') {
        extra.fromDate = fromDate
        extra.toDate = toDate
      } else {
        extra.asOfDate = asOf
      }
      const res = await fetch(scope.queryUrl('/api/v1/finance/reports/queries', resource, extra), {
        credentials: 'include',
      })
      const body = await readFinanceJson(res)
      const result = body?.data?.result ?? null
      if (resource === 'trial-balance') setTrialBalance(result)
      if (resource === 'income-statement') setIncomeStatement(result)
      if (resource === 'balance-sheet') setBalanceSheet(result)
      scope.setMessage(`${resource} generated`)
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Report failed')
    } finally {
      setBusy(false)
    }
  }

  const currency = scope.selectedBook?.functionalCurrency || 'ZAR'
  const tbRows: ReportRow[] = trialBalance?.lines || trialBalance?.accounts || trialBalance?.rows || []
  const isRows: ReportRow[] = incomeStatement?.lines || incomeStatement?.accounts || incomeStatement?.rows || []
  const bsRows: ReportRow[] = balanceSheet?.lines || balanceSheet?.accounts || balanceSheet?.rows || []

  return (
    <FinanceModuleFrame
      active="reports"
      orgScope={scope.orgScope}
      title="Financial reports"
      description="Trial balance, income statement, and balance sheet from posted journal lines only."
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
            <label className="text-sm">Basis
              <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={basis} onChange={(e) => setBasis(e.target.value as 'cash' | 'accrual')}>
                <option value="accrual">Accrual</option>
                <option value="cash">Cash</option>
              </select>
            </label>
            <label className="text-sm">As-of date
              <input type="date" className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </label>
            <label className="text-sm">IS from
              <input type="date" className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </label>
            <label className="text-sm">IS to
              <input type="date" className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </label>
            <div className="flex flex-wrap items-end gap-2 md:col-span-4">
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void runReport('trial-balance')}>Trial balance</button>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void runReport('income-statement')}>Income statement</button>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void runReport('balance-sheet')}>Balance sheet</button>
            </div>
          </section>

          <ReportTable title="Trial balance" rows={tbRows} currency={currency} meta={trialBalance} />
          <ReportTable title="Income statement" rows={isRows} currency={currency} meta={incomeStatement} />
          <ReportTable title="Balance sheet" rows={bsRows} currency={currency} meta={balanceSheet} />
        </>
      ) : null}
    </FinanceModuleFrame>
  )
}

function ReportTable({ title, rows, currency, meta }: { title: string; rows: ReportRow[]; currency: string; meta: ReportRow | null }) {
  return (
    <section className="pib-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base">{title}</h2>
        {meta ? (
          <span className="text-xs text-[var(--color-pib-text-muted)]">
            balanced={String(meta.balanced ?? meta.isBalanced ?? '-')}
            {typeof meta.debit === 'number' ? ` · dr ${formatMinor(meta.debit, currency)}` : ''}
            {typeof meta.credit === 'number' ? ` · cr ${formatMinor(meta.credit, currency)}` : ''}
            {typeof meta.netMinor === 'number' ? ` · net ${formatMinor(meta.netMinor, currency)}` : ''}
            {typeof meta.incomeStatementNetMinor === 'number' ? ` · net ${formatMinor(meta.incomeStatementNetMinor, currency)}` : ''}
          </span>
        ) : null}
      </div>
      {!meta ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Run the report to load posted balances.</p>
      ) : rows.length === 0 ? (
        <pre className="max-h-72 overflow-auto rounded-lg bg-black/20 p-3 text-xs">{JSON.stringify(meta, null, 2)}</pre>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--color-pib-text-muted)]">
                <th className="py-2 pr-3">Account</th>
                <th className="py-2 pr-3">Debit</th>
                <th className="py-2 pr-3">Credit</th>
                <th className="py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.accountId || row.id || idx} className="border-t border-[var(--color-pib-line)]">
                  <td className="py-2 pr-3">{row.accountCode || row.code || ''} {row.accountName || row.name || row.description || row.accountId || '-'}</td>
                  <td className="py-2 pr-3">{formatMinor(row.debitMinor ?? row.debit, currency)}</td>
                  <td className="py-2 pr-3">{formatMinor(row.creditMinor ?? row.credit, currency)}</td>
                  <td className="py-2">{formatMinor(row.amountMinor ?? row.balanceMinor ?? row.netMinor, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
