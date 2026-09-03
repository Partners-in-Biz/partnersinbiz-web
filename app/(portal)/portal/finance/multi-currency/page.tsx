'use client'

import { useCallback, useEffect, useState } from 'react'
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

export default function FinanceMultiCurrencyPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<AnyRec | null>(null)

  const [functionalCurrency, setFunctionalCurrency] = useState('ZAR')
  const [realizedGain, setRealizedGain] = useState('acc_fx_realized_gain')
  const [realizedLoss, setRealizedLoss] = useState('acc_fx_realized_loss')
  const [unrealizedGain, setUnrealizedGain] = useState('acc_fx_unrealized_gain')
  const [unrealizedLoss, setUnrealizedLoss] = useState('acc_fx_unrealized_loss')
  const [clearing, setClearing] = useState('acc_fx_clearing')

  const [rateSetName, setRateSetName] = useState('USD/ZAR accounting')
  const [fromCurrency, setFromCurrency] = useState('USD')
  const [rateDate, setRateDate] = useState(todayISODate())
  const [rateScaled, setRateScaled] = useState('1850000000')
  const [selectedRateSetId, setSelectedRateSetId] = useState('')
  const [approvalReason, setApprovalReason] = useState('Approved accounting FX table')

  const [docCurrency, setDocCurrency] = useState('USD')
  const [txnTotalMinor, setTxnTotalMinor] = useState('100000')
  const [docDate, setDocDate] = useState(todayISODate())
  const [settleTxnMinor, setSettleTxnMinor] = useState('40000')
  const [settleDate, setSettleDate] = useState(todayISODate())
  const [periodId, setPeriodId] = useState('p1')
  const [asOfDate, setAsOfDate] = useState(todayISODate())
  const [selectedPositionId, setSelectedPositionId] = useState('')
  const [selectedRevalId, setSelectedRevalId] = useState('')

  const loadBundle = useCallback(async () => {
    if (!scope.scopeReady || !scope.orgId) return
    setBusy(true)
    scope.setError(null)
    try {
      const res = await fetch(scope.queryUrl('/api/v1/finance/multi-currency/queries', 'bundle'), {
        credentials: 'include',
        headers: {
          ...(scope.orgId ? { 'X-Org-Id': scope.orgId } : {}),
        },
      })
      const body = await readFinanceJson(res)
      const result = body?.data?.result || {}
      setBundle(result)
      if (!selectedRateSetId && result.rateSets?.[0]?.id) setSelectedRateSetId(result.rateSets[0].id)
      if (!selectedPositionId && result.positions?.[0]?.id) setSelectedPositionId(result.positions[0].id)
      if (!selectedRevalId && result.revaluations?.[0]?.id) setSelectedRevalId(result.revaluations[0].id)
      scope.setMessage('Multi-currency bundle loaded')
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load multi-currency bundle')
    } finally {
      setBusy(false)
    }
  }, [scope, selectedPositionId, selectedRateSetId, selectedRevalId])

  useEffect(() => {
    void loadBundle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.scopeReady, scope.orgId, scope.bookId])

  async function runCommand(operation: string, command: Record<string, unknown>) {
    if (!scope.orgId) throw new Error('Organization scope required')
    const res = await fetch('/api/v1/finance/multi-currency/commands', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Org-Id': scope.orgId,
      },
      body: JSON.stringify({ operation, command: { ...command, orgId: scope.orgId } }),
    })
    return readFinanceJson(res)
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true)
    scope.setError(null)
    scope.setMessage(null)
    try {
      await fn()
      await loadBundle()
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  async function onConfigurePolicy() {
    await withBusy(async () => {
      if (!scope.legalEntityId || !scope.bookId) throw new Error('Select legal entity and book first')
      const ids = requestIdentity('fx-policy')
      const body = await runCommand('fx.policy.configure', {
        id: newFinanceId('fxpol'),
        legalEntityId: scope.legalEntityId,
        bookId: scope.bookId,
        functionalCurrency,
        realizedFxGainAccountId: realizedGain,
        realizedFxLossAccountId: realizedLoss,
        unrealizedFxGainAccountId: unrealizedGain,
        unrealizedFxLossAccountId: unrealizedLoss,
        fxRevaluationClearingAccountId: clearing,
        ...ids,
      })
      scope.setMessage(`Configured FX policy ${body?.data?.result?.id || ''}`)
    })
  }

  async function onCreateRateSet() {
    await withBusy(async () => {
      if (!scope.legalEntityId || !scope.bookId) throw new Error('Select legal entity and book first')
      const id = newFinanceId('rs')
      const ids = requestIdentity('fx-rs')
      const body = await runCommand('fx.rate_set.create', {
        id,
        legalEntityId: scope.legalEntityId,
        bookId: scope.bookId,
        functionalCurrency,
        name: rateSetName,
        ...ids,
      })
      setSelectedRateSetId(body?.data?.result?.id || id)
      scope.setMessage(`Created draft rate set ${body?.data?.result?.id || id}`)
    })
  }

  async function onAddRate() {
    await withBusy(async () => {
      if (!selectedRateSetId) throw new Error('Select a rate set')
      const ids = requestIdentity('fx-rate')
      const body = await runCommand('fx.rate_set.add_rate', {
        rateSetId: selectedRateSetId,
        rateId: newFinanceId('rate'),
        fromCurrency,
        toCurrency: functionalCurrency,
        rateDate,
        rateScaled: Number(rateScaled),
        rateScale: 8,
        source: 'manual',
        ...ids,
      })
      scope.setMessage(`Added rate ${body?.data?.result?.id} @ ${rateScaled} (scale 8)`)
    })
  }

  async function onApproveRateSet() {
    await withBusy(async () => {
      if (!selectedRateSetId) throw new Error('Select a rate set')
      const ids = requestIdentity('fx-rs-appr')
      const body = await runCommand('fx.rate_set.approve', {
        rateSetId: selectedRateSetId,
        approvalId: newFinanceId('appr'),
        reason: approvalReason,
        ...ids,
      })
      scope.setMessage(`Approved rate set ${body?.data?.result?.id} (${body?.data?.result?.status})`)
    })
  }

  async function onRecordDocument() {
    await withBusy(async () => {
      if (!scope.legalEntityId || !scope.bookId) throw new Error('Select legal entity and book first')
      if (!selectedRateSetId) throw new Error('Select an approved rate set')
      const ids = requestIdentity('fx-doc')
      const body = await runCommand('fx.document.record', {
        id: newFinanceId('fxdoc'),
        legalEntityId: scope.legalEntityId,
        bookId: scope.bookId,
        documentType: 'customer_invoice',
        currency: docCurrency,
        txnTotalMinor: Number(txnTotalMinor),
        rateSetId: selectedRateSetId,
        rateDate: docDate,
        documentDate: docDate,
        ...ids,
      })
      const doc = body?.data?.result?.document
      const pos = body?.data?.result?.position
      if (pos?.id) setSelectedPositionId(pos.id)
      scope.setMessage(
        `Recorded FX doc ${doc?.id}: txn ${doc?.txnTotalMinor} → functional ${doc?.functionalTotalMinor}`,
      )
    })
  }

  async function onRecordSettlement() {
    await withBusy(async () => {
      if (!selectedPositionId) throw new Error('Select a position')
      if (!selectedRateSetId) throw new Error('Select a rate set')
      const ids = requestIdentity('fx-set')
      const body = await runCommand('fx.settlement.record', {
        id: newFinanceId('fxset'),
        positionId: selectedPositionId,
        settlementDate: settleDate,
        settledTxnMinor: Number(settleTxnMinor),
        rateSetId: selectedRateSetId,
        periodId,
        ...ids,
      })
      const set = body?.data?.result?.settlement
      scope.setMessage(
        `Settlement ${set?.id}: realized FX ${set?.realizedFxMinor} (externalPaymentInitiated=false)`,
      )
    })
  }

  async function onCreateReval() {
    await withBusy(async () => {
      if (!scope.legalEntityId || !scope.bookId) throw new Error('Select legal entity and book first')
      if (!selectedRateSetId) throw new Error('Select a rate set')
      const id = newFinanceId('fxrev')
      const ids = requestIdentity('fx-rev')
      const body = await runCommand('fx.revaluation.create', {
        id,
        legalEntityId: scope.legalEntityId,
        bookId: scope.bookId,
        periodId,
        asOfDate,
        rateSetId: selectedRateSetId,
        reverseNextPeriod: true,
        reversePeriodId: `${periodId}_next`,
        reversePostingDate: asOfDate,
        ...ids,
      })
      setSelectedRevalId(body?.data?.result?.id || id)
      scope.setMessage(
        `Revaluation ${body?.data?.result?.id}: net unrealized ${body?.data?.result?.netUnrealizedMinor}`,
      )
    })
  }

  async function onApproveReval() {
    await withBusy(async () => {
      if (!selectedRevalId) throw new Error('Select a revaluation')
      const ids = requestIdentity('fx-rev-appr')
      const body = await runCommand('fx.revaluation.approve', {
        id: selectedRevalId,
        approvalId: newFinanceId('appr'),
        reason: approvalReason,
        ...ids,
      })
      scope.setMessage(`Approved revaluation ${body?.data?.result?.id}`)
    })
  }

  async function onReport() {
    await withBusy(async () => {
      if (!scope.legalEntityId || !scope.bookId) throw new Error('Select legal entity and book first')
      if (!selectedRateSetId) throw new Error('Select a rate set')
      const ids = requestIdentity('fx-rep')
      const body = await runCommand('fx.report.generate', {
        id: newFinanceId('fxrep'),
        legalEntityId: scope.legalEntityId,
        bookId: scope.bookId,
        asOfDate,
        rateSetId: selectedRateSetId,
        ...ids,
      })
      const rep = body?.data?.result
      scope.setMessage(
        `Functional report ${rep?.id}: realized ${rep?.totalRealizedFxMinor} / unrealized ${rep?.totalUnrealizedFxMinor}`,
      )
    })
  }

  const policies = bundle?.policies || []
  const rateSets = bundle?.rateSets || []
  const rates = bundle?.rates || []
  const positions = bundle?.positions || []
  const settlements = bundle?.settlements || []
  const revaluations = bundle?.revaluations || []
  const currency = functionalCurrency || 'ZAR'

  return (
    <FinanceModuleFrame
      active="multi-currency"
      orgScope={scope.orgScope}
      title="Multi-currency"
      description="FX rate sets, revaluation journals, and functional currency reports. No external payment initiate."
      error={scope.error}
      message={scope.message}
      loading={scope.loading}
    >
      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
        <>
          <FinanceScopeBar scope={scope} />

          <div className="flex flex-wrap gap-2">
            <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void loadBundle()}>
              Refresh bundle
            </button>
            <span className="text-xs text-[var(--color-pib-text-muted)] self-center">
              Gates: noEgress · externalPaymentInitiated=false · SARS=false
            </span>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="pib-card space-y-3 p-4">
              <h2 className="text-base">Book FX policy</h2>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  Functional currency
                  <input
                    className="pib-input mt-1 w-full"
                    value={functionalCurrency}
                    onChange={(e) => setFunctionalCurrency(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Clearing account
                  <input className="pib-input mt-1 w-full" value={clearing} onChange={(e) => setClearing(e.target.value)} />
                </label>
                <label className="text-sm">
                  Realized gain
                  <input
                    className="pib-input mt-1 w-full"
                    value={realizedGain}
                    onChange={(e) => setRealizedGain(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Realized loss
                  <input
                    className="pib-input mt-1 w-full"
                    value={realizedLoss}
                    onChange={(e) => setRealizedLoss(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Unrealized gain
                  <input
                    className="pib-input mt-1 w-full"
                    value={unrealizedGain}
                    onChange={(e) => setUnrealizedGain(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Unrealized loss
                  <input
                    className="pib-input mt-1 w-full"
                    value={unrealizedLoss}
                    onChange={(e) => setUnrealizedLoss(e.target.value)}
                  />
                </label>
              </div>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void onConfigurePolicy()}>
                Configure policy
              </button>
              {policies[0] && (
                <p className="text-xs text-[var(--color-pib-text-muted)]">
                  Active policy {policies[0].id} · {policies[0].functionalCurrency}
                </p>
              )}
            </section>

            <section className="pib-card space-y-3 p-4">
              <h2 className="text-base">Accounting rate sets</h2>
              <label className="block text-sm">
                Name
                <input className="pib-input mt-1 w-full" value={rateSetName} onChange={(e) => setRateSetName(e.target.value)} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  From currency
                  <input
                    className="pib-input mt-1 w-full"
                    value={fromCurrency}
                    onChange={(e) => setFromCurrency(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Rate date
                  <input className="pib-input mt-1 w-full" value={rateDate} onChange={(e) => setRateDate(e.target.value)} />
                </label>
                <label className="text-sm col-span-2">
                  Rate scaled (scale 8; 18.5 → 1850000000)
                  <input
                    className="pib-input mt-1 w-full"
                    value={rateScaled}
                    onChange={(e) => setRateScaled(e.target.value)}
                  />
                </label>
              </div>
              <label className="block text-sm">
                Rate set
                <select
                  className="pib-input mt-1 w-full"
                  value={selectedRateSetId}
                  onChange={(e) => setSelectedRateSetId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {rateSets.map((rs: AnyRec) => (
                    <option key={rs.id} value={rs.id}>
                      {rs.id} - {rs.status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Approval reason
                <input
                  className="pib-input mt-1 w-full"
                  value={approvalReason}
                  onChange={(e) => setApprovalReason(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void onCreateRateSet()}>
                  Create draft
                </button>
                <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void onAddRate()}>
                  Add rate
                </button>
                <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void onApproveRateSet()}>
                  Approve lock
                </button>
              </div>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                Approved rate sets are immutable. Rates: {rates.length}
              </p>
            </section>

            <section className="pib-card space-y-3 p-4">
              <h2 className="text-base">Foreign documents & settlement</h2>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  Currency
                  <input
                    className="pib-input mt-1 w-full"
                    value={docCurrency}
                    onChange={(e) => setDocCurrency(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Txn total minor
                  <input
                    className="pib-input mt-1 w-full"
                    value={txnTotalMinor}
                    onChange={(e) => setTxnTotalMinor(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Document date
                  <input className="pib-input mt-1 w-full" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
                </label>
                <label className="text-sm">
                  Settle txn minor
                  <input
                    className="pib-input mt-1 w-full"
                    value={settleTxnMinor}
                    onChange={(e) => setSettleTxnMinor(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Settlement date
                  <input
                    className="pib-input mt-1 w-full"
                    value={settleDate}
                    onChange={(e) => setSettleDate(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Period id
                  <input className="pib-input mt-1 w-full" value={periodId} onChange={(e) => setPeriodId(e.target.value)} />
                </label>
              </div>
              <label className="block text-sm">
                Position
                <select
                  className="pib-input mt-1 w-full"
                  value={selectedPositionId}
                  onChange={(e) => setSelectedPositionId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {positions.map((p: AnyRec) => (
                    <option key={p.id} value={p.id}>
                      {p.id} · open {p.openTxnMinor} · {p.status}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void onRecordDocument()}>
                  Record FX invoice
                </button>
                <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void onRecordSettlement()}>
                  Record settlement
                </button>
              </div>
            </section>

            <section className="pib-card space-y-3 p-4">
              <h2 className="text-base">Period-end revaluation</h2>
              <label className="block text-sm">
                As-of date
                <input className="pib-input mt-1 w-full" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
              </label>
              <label className="block text-sm">
                Revaluation
                <select
                  className="pib-input mt-1 w-full"
                  value={selectedRevalId}
                  onChange={(e) => setSelectedRevalId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {revaluations.map((r: AnyRec) => (
                    <option key={r.id} value={r.id}>
                      {r.id} - {r.status} · net {r.netUnrealizedMinor}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void onCreateReval()}>
                  Create revaluation
                </button>
                <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void onApproveReval()}>
                  Approve revaluation
                </button>
                <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void onReport()}>
                  Functional report
                </button>
              </div>
            </section>
          </div>

          <section className="pib-card p-4">
            <h2 className="mb-3 text-base">Open FX positions</h2>
            {positions.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">No monetary positions yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--color-pib-text-muted)]">
                      <th className="py-2 pr-3">ID</th>
                      <th className="py-2 pr-3">CCY</th>
                      <th className="py-2 pr-3">Open txn</th>
                      <th className="py-2 pr-3">Realized FX</th>
                      <th className="py-2 pr-3">Unrealized FX</th>
                      <th className="py-2 pr-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p: AnyRec) => (
                      <tr key={p.id} className="border-t border-[var(--color-pib-line)]">
                        <td className="py-2 pr-3 font-mono text-xs">{p.id}</td>
                        <td className="py-2 pr-3">{p.currency}</td>
                        <td className="py-2 pr-3">{p.openTxnMinor}</td>
                        <td className="py-2 pr-3">{formatMinor(p.realizedFxMinor, currency)}</td>
                        <td className="py-2 pr-3">{formatMinor(p.unrealizedFxMinor, currency)}</td>
                        <td className="py-2 pr-3">{p.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="pib-card p-4">
            <h2 className="mb-3 text-base">Settlements</h2>
            {settlements.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">No settlements yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {settlements.map((s: AnyRec) => (
                  <li key={s.id} className="rounded border border-[var(--color-pib-line)] p-2">
                    <span className="font-mono text-xs">{s.id}</span> · realized {s.realizedFxMinor} · balanced=
                    {String(s.journalProposal?.balanced)} · payInit={String(s.externalPaymentInitiated)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </FinanceModuleFrame>
  )
}
