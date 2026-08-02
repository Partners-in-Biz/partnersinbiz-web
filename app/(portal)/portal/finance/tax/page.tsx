'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/AppFoundation'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'
import {
  formatMinor,
  newFinanceId,
  parseRandsToMinor,
  readFinanceJson,
  requestIdentity,
  todayISODate,
} from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'

type TaxBundle = {
  taxCodes: Array<Record<string, any>>
  taxRules: Array<Record<string, any>>
  taxPeriods: Array<Record<string, any>>
  taxReturns: Array<Record<string, any>>
}

export default function FinanceTaxPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<TaxBundle | null>(null)
  const [code, setCode] = useState('ZA-STD')
  const [codeName, setCodeName] = useState('Standard VAT')
  const [calcAmount, setCalcAmount] = useState('1000.00')
  const [calcTaxCodeId, setCalcTaxCodeId] = useState('')
  const [calcResult, setCalcResult] = useState<Record<string, any> | null>(null)
  const [periodLabel, setPeriodLabel] = useState('2026-07')
  const [periodStart, setPeriodStart] = useState('2026-07-01')
  const [periodEnd, setPeriodEnd] = useState('2026-07-31')

  const loadBundle = useCallback(async () => {
    if (!scope.scopeReady) {
      setBundle(null)
      return
    }
    try {
      const res = await fetch(scope.queryUrl('/api/v1/finance/tax/queries', 'bundle'), { credentials: 'include' })
      const body = await readFinanceJson(res)
      const next = (body?.data?.result ?? null) as TaxBundle | null
      setBundle(next)
      if (next?.taxCodes?.[0]?.id) setCalcTaxCodeId((prev) => prev || next.taxCodes[0].id)
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load tax bundle')
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
      scope.setError(err instanceof Error ? err.message : 'Tax command failed')
    } finally {
      setBusy(false)
    }
  }

  async function createTaxCode() {
    await withBusy(async () => {
      const id = newFinanceId('tax')
      await scope.runCommand('/api/v1/finance/tax/commands', 'tax-code.create', {
        id,
        code,
        name: codeName,
        jurisdictionCode: scope.selectedEntity?.jurisdictionCode || 'ZA',
        category: 'output_vat',
        recoverability: 'full',
        active: true,
        expectedVersion: 0,
        ...requestIdentity('tax-code'),
      })
      scope.setMessage(`Tax code ${code} created`)
      setCalcTaxCodeId(id)
    })
  }

  async function createPeriod() {
    await withBusy(async () => {
      const id = newFinanceId('tp')
      await scope.runCommand('/api/v1/finance/tax/commands', 'tax-period.create', {
        id,
        jurisdictionCode: scope.selectedEntity?.jurisdictionCode || 'ZA',
        label: periodLabel,
        startsAt: periodStart,
        endsAt: periodEnd,
        status: 'open',
        expectedVersion: 0,
        ...requestIdentity('tax-period'),
      })
      scope.setMessage(`Tax period ${periodLabel} opened`)
    })
  }

  async function calculateTax() {
    await withBusy(async () => {
      if (!calcTaxCodeId) throw new Error('Select a tax code')
      const result = await scope.runCommand('/api/v1/finance/tax/commands', 'tax.calculate', {
        taxCodeId: calcTaxCodeId,
        documentDate: todayISODate(),
        taxableMinorExclusive: parseRandsToMinor(calcAmount),
        taxIncluded: false,
        ...requestIdentity('tax-calc'),
      })
      setCalcResult(result as Record<string, any>)
      scope.setMessage('Tax calculated (no SARS submission)')
    })
  }

  async function prepareReturn(period: Record<string, any>) {
    await withBusy(async () => {
      const id = newFinanceId('ret')
      await scope.runCommand('/api/v1/finance/tax/commands', 'tax-return.prepare', {
        id,
        taxPeriodId: period.id,
        sourceCutoffAt: `${period.endsAt}T23:59:59.000Z`,
        accountingBasis: scope.selectedBook?.accountingBasis || 'accrual',
        expectedVersion: 0,
        ...requestIdentity('tax-ret'),
      })
      scope.setMessage(`Tax return prepared for ${period.label || period.id}`)
    })
  }

  const currency = scope.selectedBook?.functionalCurrency || 'ZAR'

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="VAT & tax"
        description="Tax codes, periods, calculations, and return prepare/approve. Direct SARS eFiling remains disabled."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={scopedPortalPath('/portal/finance', scope.orgScope)} className="pib-btn-ghost">Workbench</Link>
            <Link href={scopedPortalPath('/portal/finance/reports', scope.orgScope)} className="pib-btn-ghost">Reports</Link>
          </div>
        }
      />

      {scope.error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{scope.error}</div> : null}
      {scope.message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{scope.message}</div> : null}

      {scope.loading ? (
        <div className="pib-card p-6 text-sm text-[var(--color-pib-text-muted)]">Loading…</div>
      ) : !scope.scopeReady ? (
        <div className="pib-card p-6 text-sm text-[var(--color-pib-text-muted)]">Bootstrap a book on the Finance workbench first.</div>
      ) : (
        <>
          <section className="pib-card grid gap-3 p-4 md:grid-cols-3">
            <label className="text-sm">Legal entity
              <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={scope.selectedEntityId} onChange={(e) => scope.setSelectedEntityId(e.target.value)}>
                {scope.entities.map((e) => <option key={e.id} value={e.id}>{e.code} — {e.legalName}</option>)}
              </select>
            </label>
            <label className="text-sm">Book
              <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={scope.selectedBookId} onChange={(e) => scope.setSelectedBookId(e.target.value)}>
                {scope.books.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </label>
            <div className="flex items-end">
              <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void loadBundle()}>Refresh</button>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-4">
            {[
              ['Tax codes', bundle?.taxCodes?.length ?? 0],
              ['Rules', bundle?.taxRules?.length ?? 0],
              ['Periods', bundle?.taxPeriods?.length ?? 0],
              ['Returns', bundle?.taxReturns?.length ?? 0],
            ].map(([label, n]) => (
              <div key={String(label)} className="pib-stat-card">
                <p className="pib-label">{label}</p>
                <p className="mt-3 text-2xl font-semibold">{n}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base font-semibold">Create tax code</h2>
              <label className="block text-sm">Code
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
              <label className="block text-sm">Name
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={codeName} onChange={(e) => setCodeName(e.target.value)} />
              </label>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void createTaxCode()}>Create code</button>
              <p className="text-xs text-[var(--color-pib-text-muted)]">Approved rate rules still need tax-rule.create + approval evidence before invoice lines can tax correctly.</p>
            </div>

            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base font-semibold">Open tax period</h2>
              <label className="block text-sm">Label
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} />
              </label>
              <label className="block text-sm">Starts
                <input type="date" className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </label>
              <label className="block text-sm">Ends
                <input type="date" className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </label>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void createPeriod()}>Create period</button>
            </div>

            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base font-semibold">Calculate tax</h2>
              <label className="block text-sm">Tax code
                <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={calcTaxCodeId} onChange={(e) => setCalcTaxCodeId(e.target.value)}>
                  <option value="">Select…</option>
                  {(bundle?.taxCodes || []).map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
                </select>
              </label>
              <label className="block text-sm">Exclusive amount (rands)
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={calcAmount} onChange={(e) => setCalcAmount(e.target.value)} />
              </label>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void calculateTax()}>Calculate</button>
              {calcResult ? (
                <div className="rounded-lg border border-[var(--color-pib-line)] p-3 text-xs">
                  <p>Taxable: {formatMinor(calcResult.taxableMinor, currency)}</p>
                  <p>Tax: {formatMinor(calcResult.taxMinor, currency)}</p>
                  <p>Gross: {formatMinor(calcResult.grossMinor, currency)}</p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="pib-card p-4">
              <h2 className="mb-3 text-base font-semibold">Tax codes</h2>
              {(bundle?.taxCodes || []).length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No tax codes yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {bundle!.taxCodes.map((t) => (
                    <li key={t.id} className="border-b border-[var(--color-pib-line)] pb-2">
                      <p className="font-medium">{t.code} · {t.name}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)]">{t.category} · {t.active ? 'active' : 'inactive'}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="pib-card p-4">
              <h2 className="mb-3 text-base font-semibold">Tax periods & returns</h2>
              {(bundle?.taxPeriods || []).length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No tax periods yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {bundle!.taxPeriods.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-3 border-b border-[var(--color-pib-line)] pb-2">
                      <div>
                        <p className="font-medium">{p.label || p.id} · {p.status}</p>
                        <p className="text-xs text-[var(--color-pib-text-muted)]">{p.startsAt} → {p.endsAt}</p>
                      </div>
                      {p.status === 'open' ? (
                        <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void prepareReturn(p)}>Prepare return</button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4">
                <p className="mb-2 text-sm font-medium">Prepared returns</p>
                {(bundle?.taxReturns || []).length === 0 ? (
                  <p className="text-sm text-[var(--color-pib-text-muted)]">None yet. Approve uses foundation approval evidence; no SARS egress.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {bundle!.taxReturns.map((r) => (
                      <li key={r.id} className="border-b border-[var(--color-pib-line)] pb-2">
                        <p className="font-medium">{r.id} · {r.status}</p>
                        <p className="text-xs text-[var(--color-pib-text-muted)]">net {formatMinor(r.netMinor ?? r.taxNetMinor, currency)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
