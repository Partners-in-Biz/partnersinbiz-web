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
  todayISODate,
} from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'

type AssetsBundle = {
  assetClasses: Array<Record<string, any>>
  assets: Array<Record<string, any>>
  depreciationRuns: Array<Record<string, any>>
  disposals: Array<Record<string, any>>
}

export default function FinanceAssetsPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<AssetsBundle | null>(null)
  const [register, setRegister] = useState<Record<string, any> | null>(null)

  const [classCode, setClassCode] = useState('COMP')
  const [className, setClassName] = useState('Computer equipment')
  const [classLife, setClassLife] = useState('36')
  const [assetNumber, setAssetNumber] = useState('FA-0001')
  const [assetName, setAssetName] = useState('MacBook Pro')
  const [assetCost, setAssetCost] = useState('36000.00')
  const [assetClassId, setAssetClassId] = useState('')
  const [periodKey, setPeriodKey] = useState(todayISODate().slice(0, 7))
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [proceeds, setProceeds] = useState('10000.00')

  const loadBundle = useCallback(async () => {
    if (!scope.scopeReady) {
      setBundle(null)
      setRegister(null)
      return
    }
    try {
      const res = await fetch(scope.queryUrl('/api/v1/finance/assets/queries', 'bundle'), { credentials: 'include' })
      const body = await readFinanceJson(res)
      const next = (body?.data?.result ?? null) as AssetsBundle | null
      setBundle(next)
      if (next?.assetClasses?.[0]?.id) setAssetClassId((prev) => prev || next.assetClasses[0].id)
      if (next?.assets?.[0]?.id) setSelectedAssetId((prev) => prev || next.assets[0].id)

      const regRes = await fetch(
        scope.queryUrl('/api/v1/finance/assets/queries', 'register') + `&asOfDate=${encodeURIComponent(todayISODate())}`,
        { credentials: 'include' },
      )
      const regBody = await readFinanceJson(regRes)
      setRegister((regBody?.data?.result ?? null) as Record<string, any> | null)
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load assets bundle')
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
      scope.setError(err instanceof Error ? err.message : 'Assets command failed')
    } finally {
      setBusy(false)
    }
  }

  async function createClass() {
    await withBusy(async () => {
      const id = newFinanceId('aclass')
      await scope.runCommand('/api/v1/finance/assets/commands', 'asset-class.create', {
        id,
        code: classCode,
        name: className,
        usefulLifeMonths: Number(classLife),
        defaultResidualMinor: 0,
        assetAccountId: 'acc_fa_cost',
        accumulatedDepAccountId: 'acc_fa_accum',
        expenseAccountId: 'acc_fa_exp',
        active: true,
        expectedVersion: 0,
        ...requestIdentity('asset-class'),
      })
      scope.setMessage(`Asset class ${classCode} created`)
      setAssetClassId(id)
    })
  }

  async function createAsset() {
    await withBusy(async () => {
      if (!assetClassId) throw new Error('Select or create an asset class first')
      const id = newFinanceId('fa')
      await scope.runCommand('/api/v1/finance/assets/commands', 'asset.create', {
        id,
        assetNumber,
        name: assetName,
        assetClassId,
        currency: scope.selectedBook?.functionalCurrency || 'ZAR',
        costMinor: parseRandsToMinor(assetCost),
        acquisitionDate: todayISODate(),
        inServiceDate: `${periodKey}-01`,
        expectedVersion: 0,
        ...requestIdentity('asset-create'),
      })
      await scope.runCommand('/api/v1/finance/assets/commands', 'asset.activate', {
        id,
        expectedVersion: 1,
        ...requestIdentity('asset-activate'),
      })
      scope.setMessage(`Asset ${assetNumber} created and activated`)
      setSelectedAssetId(id)
    })
  }

  async function runDepreciation() {
    await withBusy(async () => {
      const id = newFinanceId('depr')
      const created = await scope.runCommand('/api/v1/finance/assets/commands', 'depreciation-run.create', {
        id,
        periodKey,
        postingDate: `${periodKey}-28`,
        description: `Monthly depreciation ${periodKey}`,
        expectedVersion: 0,
        ...requestIdentity('depr-create'),
      }) as Record<string, any>
      const calculated = await scope.runCommand('/api/v1/finance/assets/commands', 'depreciation-run.calculate', {
        id: created.id || id,
        expectedVersion: created.version || 1,
        ...requestIdentity('depr-calc'),
      }) as Record<string, any>
      await scope.runCommand('/api/v1/finance/assets/commands', 'depreciation-run.post', {
        id: calculated.id || id,
        approvalId: newFinanceId('appr'),
        reason: 'Monthly depreciation approved',
        expectedVersion: calculated.version || 2,
        ...requestIdentity('depr-post'),
      })
      scope.setMessage(`Depreciation ${periodKey} calculated and posted (book journal only)`)
    })
  }

  async function disposeSelected() {
    await withBusy(async () => {
      if (!selectedAssetId) throw new Error('Select an asset')
      await scope.runCommand('/api/v1/finance/assets/commands', 'asset.dispose', {
        id: newFinanceId('disp'),
        assetId: selectedAssetId,
        disposedAt: todayISODate(),
        proceedsMinor: parseRandsToMinor(proceeds),
        proceedsAccountId: 'acc_bank',
        gainLossAccountId: 'acc_gain_loss',
        approvalId: newFinanceId('appr'),
        reason: 'Asset disposal approved',
        expectedVersion: 0,
        ...requestIdentity('asset-dispose'),
      })
      scope.setMessage('Asset disposed (no external payment initiated)')
    })
  }

  const currency = scope.selectedBook?.functionalCurrency || register?.currency || 'ZAR'

  return (
    <FinanceModuleFrame
      active="assets"
      orgScope={scope.orgScope}
      title="Fixed assets"
      description="Asset register, straight-line depreciation runs, disposal, and NBV reports. No external payment initiate."
      error={scope.error}
      message={scope.message}
      loading={scope.loading}
    >
      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
        <>
          <FinanceScopeBar scope={scope} />

          <section className="grid gap-4 md:grid-cols-4">
            {[
              ['Classes', bundle?.assetClasses?.length ?? 0],
              ['Assets', bundle?.assets?.length ?? 0],
              ['Depreciation runs', bundle?.depreciationRuns?.length ?? 0],
              ['Disposals', bundle?.disposals?.length ?? 0],
            ].map(([label, n]) => (
              <div key={String(label)} className="pib-stat-card">
                <p className="pib-label">{label}</p>
                <p className="mt-3 text-2xl">{n}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base">Asset class</h2>
              <label className="block text-sm">Code
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={classCode} onChange={(e) => setClassCode(e.target.value)} />
              </label>
              <label className="block text-sm">Name
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={className} onChange={(e) => setClassName(e.target.value)} />
              </label>
              <label className="block text-sm">Useful life (months)
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={classLife} onChange={(e) => setClassLife(e.target.value)} />
              </label>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void createClass()}>Create class</button>
            </div>

            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base">Register asset</h2>
              <label className="block text-sm">Number
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={assetNumber} onChange={(e) => setAssetNumber(e.target.value)} />
              </label>
              <label className="block text-sm">Name
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={assetName} onChange={(e) => setAssetName(e.target.value)} />
              </label>
              <label className="block text-sm">Cost ({currency})
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={assetCost} onChange={(e) => setAssetCost(e.target.value)} />
              </label>
              <label className="block text-sm">Class id
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={assetClassId} onChange={(e) => setAssetClassId(e.target.value)} />
              </label>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void createAsset()}>Create + activate</button>
            </div>

            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base">Monthly depreciation</h2>
              <label className="block text-sm">Period (YYYY-MM)
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} />
              </label>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void runDepreciation()}>Create, calculate, post</button>
              <p className="text-xs text-[var(--color-pib-text-muted)]">Straight-line only. Posts book journal evidence; no bank payout.</p>

              <h2 className="pt-2 text-base">Dispose asset</h2>
              <label className="block text-sm">Asset id
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={selectedAssetId} onChange={(e) => setSelectedAssetId(e.target.value)} />
              </label>
              <label className="block text-sm">Proceeds ({currency})
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={proceeds} onChange={(e) => setProceeds(e.target.value)} />
              </label>
              <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void disposeSelected()}>Post disposal</button>
            </div>
          </section>

          <section className="pib-card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base">Register report</h2>
              <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void loadBundle()}>Refresh</button>
            </div>
            {register ? (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="pib-stat-card">
                  <p className="pib-label">Total cost</p>
                  <p className="mt-2 text-xl">{formatMinor(register.totalCostMinor || 0, currency)}</p>
                </div>
                <div className="pib-stat-card">
                  <p className="pib-label">Accumulated dep</p>
                  <p className="mt-2 text-xl">{formatMinor(register.totalAccumulatedMinor || 0, currency)}</p>
                </div>
                <div className="pib-stat-card">
                  <p className="pib-label">Net book value</p>
                  <p className="mt-2 text-xl">{formatMinor(register.totalNbvMinor || 0, currency)}</p>
                </div>
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-[var(--color-pib-text-muted)]">
                  <tr>
                    <th className="py-2 pr-3">Number</th>
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Cost</th>
                    <th className="py-2 pr-3">Accum</th>
                    <th className="py-2 pr-3">NBV</th>
                  </tr>
                </thead>
                <tbody>
                  {(register?.lines || bundle?.assets || []).map((row: Record<string, any>) => (
                    <tr key={row.assetId || row.id} className="border-t border-[var(--color-pib-line)]">
                      <td className="py-2 pr-3 font-medium">{row.assetNumber}</td>
                      <td className="py-2 pr-3">{row.name}</td>
                      <td className="py-2 pr-3">{row.status}</td>
                      <td className="py-2 pr-3">{formatMinor(row.costMinor || 0, currency)}</td>
                      <td className="py-2 pr-3">{formatMinor(row.accumulatedDepreciationMinor || 0, currency)}</td>
                      <td className="py-2 pr-3">{formatMinor(row.netBookValueMinor || 0, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(register?.lines || bundle?.assets || []).length === 0 ? (
                <p className="py-6 text-sm text-[var(--color-pib-text-muted)]">No fixed assets in this book yet.</p>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </FinanceModuleFrame>
  )
}
