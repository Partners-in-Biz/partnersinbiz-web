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

type Bundle = {
  schedules: Array<Record<string, any>>
  recognitionRuns: Array<Record<string, any>>
  auditEvents: Array<Record<string, any>>
  hardGates?: Record<string, boolean>
}

export default function FinanceRevenueRecognitionPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [deferred, setDeferred] = useState<Record<string, any> | null>(null)
  const [recognized, setRecognized] = useState<Record<string, any> | null>(null)

  const [scheduleNumber, setScheduleNumber] = useState('RR-0001')
  const [name, setName] = useState('Agency retainer')
  const [contractRef, setContractRef] = useState('MSA-2026-01')
  const [arInvoiceId, setArInvoiceId] = useState('')
  const [total, setTotal] = useState('120000.00')
  const [months, setMonths] = useState('12')
  const [method, setMethod] = useState<'straight_line' | 'milestone'>('straight_line')
  const [periodKey, setPeriodKey] = useState(todayISODate().slice(0, 7))
  const [selectedScheduleId, setSelectedScheduleId] = useState('')
  const [selectedRunId, setSelectedRunId] = useState('')

  const loadBundle = useCallback(async () => {
    if (!scope.scopeReady) {
      setBundle(null)
      setDeferred(null)
      setRecognized(null)
      return
    }
    try {
      const res = await fetch(scope.queryUrl('/api/v1/finance/revenue-recognition/queries', 'bundle'), {
        credentials: 'include',
      })
      const body = await readFinanceJson(res)
      const next = (body?.data?.result ?? null) as Bundle | null
      setBundle(next)
      if (next?.schedules?.[0]?.id) setSelectedScheduleId((prev) => prev || next.schedules[0].id)
      if (next?.recognitionRuns?.[0]?.id) setSelectedRunId((prev) => prev || next.recognitionRuns[0].id)

      const dRes = await fetch(
        scope.queryUrl('/api/v1/finance/revenue-recognition/queries', 'deferred-revenue') +
          `&asOfPeriodKey=${encodeURIComponent(periodKey)}`,
        { credentials: 'include' },
      )
      const dBody = await readFinanceJson(dRes)
      setDeferred((dBody?.data?.result ?? null) as Record<string, any> | null)

      const rRes = await fetch(
        scope.queryUrl('/api/v1/finance/revenue-recognition/queries', 'recognized-vs-billed') +
          `&asOfPeriodKey=${encodeURIComponent(periodKey)}`,
        { credentials: 'include' },
      )
      const rBody = await readFinanceJson(rRes)
      setRecognized((rBody?.data?.result ?? null) as Record<string, any> | null)
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load revenue recognition bundle')
    }
  }, [scope, periodKey])

  useEffect(() => {
    void loadBundle()
  }, [scope.selectedBookId, scope.selectedEntityId, scope.scopeReady, periodKey]) // eslint-disable-line react-hooks/exhaustive-deps

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true)
    scope.setError(null)
    scope.setMessage(null)
    try {
      await fn()
      await loadBundle()
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Revenue recognition command failed')
    } finally {
      setBusy(false)
    }
  }

  async function createAndActivate() {
    await withBusy(async () => {
      const id = newFinanceId('rrsch')
      const payload: Record<string, unknown> = {
        id,
        scheduleNumber,
        name,
        contractRef: contractRef || undefined,
        arInvoiceId: arInvoiceId || undefined,
        currency: scope.selectedBook?.functionalCurrency || 'ZAR',
        method,
        totalContractMinor: parseRandsToMinor(total),
        startDate: `${periodKey}-01`,
        deferredRevenueAccountId: 'acc_deferred_rev',
        revenueAccountId: 'acc_revenue',
        expectedVersion: 0,
        ...requestIdentity('rr-schedule'),
      }
      if (method === 'straight_line') {
        payload.months = Number(months)
      } else {
        const half = Math.floor(parseRandsToMinor(total) / 2)
        const rest = parseRandsToMinor(total) - half
        payload.milestones = [
          { code: 'M1', name: 'Kickoff', amountMinor: half, periodKey },
          { code: 'M2', name: 'Delivery', amountMinor: rest },
        ]
      }
      await scope.runCommand('/api/v1/finance/revenue-recognition/commands', 'schedule.create', payload)
      await scope.runCommand('/api/v1/finance/revenue-recognition/commands', 'schedule.activate', {
        id,
        expectedVersion: 1,
        ...requestIdentity('rr-activate'),
      })
      scope.setMessage(`Schedule ${scheduleNumber} created and activated`)
      setSelectedScheduleId(id)
    })
  }

  async function runPeriod() {
    await withBusy(async () => {
      const id = newFinanceId('rrrun')
      const created = await scope.runCommand('/api/v1/finance/revenue-recognition/commands', 'recognition-run.create', {
        id,
        periodKey,
        postingDate: `${periodKey}-28`,
        expectedVersion: 0,
        ...requestIdentity('rr-run'),
      })
      const version = (created as any)?.version ?? 1
      const calculated = await scope.runCommand('/api/v1/finance/revenue-recognition/commands', 'recognition-run.calculate', {
        id,
        expectedVersion: version,
        ...requestIdentity('rr-calc'),
      })
      const calcVersion = (calculated as any)?.version ?? version + 1
      await scope.runCommand('/api/v1/finance/revenue-recognition/commands', 'recognition-run.post', {
        id,
        approvalId: newFinanceId('appr'),
        reason: 'Period revenue recognition',
        expectedVersion: calcVersion,
        ...requestIdentity('rr-post'),
      })
      scope.setMessage(`Recognition run posted for ${periodKey}`)
      setSelectedRunId(id)
    })
  }

  async function reverseSelectedRun() {
    await withBusy(async () => {
      if (!selectedRunId) throw new Error('Select a recognition run')
      const run = bundle?.recognitionRuns?.find((r) => r.id === selectedRunId)
      if (!run) throw new Error('Run not found in bundle')
      await scope.runCommand('/api/v1/finance/revenue-recognition/commands', 'recognition-run.reverse', {
        id: selectedRunId,
        approvalId: newFinanceId('appr'),
        reason: 'Operator reverse/adjust',
        expectedVersion: run.version,
        ...requestIdentity('rr-reverse'),
      })
      scope.setMessage(`Reversed run ${selectedRunId}`)
    })
  }

  return (
    <FinanceModuleFrame
      active="revenue-recognition"
      orgScope={scope.orgScope}
      title="Revenue recognition"
      description="Lite deferred revenue for SA agency retainers and SaaS-ish contracts - straight-line or milestone. No ASC-606 engine."
      loading={scope.loading || busy}
      message={scope.message}
      error={scope.error}
    >
      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
      <>
      <FinanceScopeBar scope={scope} />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="border border-[var(--portal-border)] bg-[var(--portal-card)] p-4">
          <div className="text-xs uppercase tracking-wide opacity-70">Deferred balance</div>
          <div className="mt-1 text-2xl">
            {formatMinor(deferred?.totalDeferredMinor ?? 0, deferred?.currency || 'ZAR')}
          </div>
        </div>
        <div className="border border-[var(--portal-border)] bg-[var(--portal-card)] p-4">
          <div className="text-xs uppercase tracking-wide opacity-70">Recognized</div>
          <div className="mt-1 text-2xl">
            {formatMinor(recognized?.totalRecognizedMinor ?? 0, recognized?.currency || 'ZAR')}
          </div>
        </div>
        <div className="border border-[var(--portal-border)] bg-[var(--portal-card)] p-4">
          <div className="text-xs uppercase tracking-wide opacity-70">Recognized vs billed</div>
          <div className="mt-1 text-2xl">
            {((recognized?.recognizedBps ?? 0) / 100).toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="border border-[var(--portal-border)] bg-[var(--portal-card)] p-4 space-y-3">
          <h2 className="text-lg">New schedule (linked AR / contract)</h2>
          <label className="block text-sm">Schedule number
            <input className="mt-1 w-full rounded border px-2 py-1" value={scheduleNumber} onChange={(e) => setScheduleNumber(e.target.value)} />
          </label>
          <label className="block text-sm">Name
            <input className="mt-1 w-full rounded border px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm">Contract ref
            <input className="mt-1 w-full rounded border px-2 py-1" value={contractRef} onChange={(e) => setContractRef(e.target.value)} />
          </label>
          <label className="block text-sm">AR invoice id (optional)
            <input className="mt-1 w-full rounded border px-2 py-1" value={arInvoiceId} onChange={(e) => setArInvoiceId(e.target.value)} />
          </label>
          <label className="block text-sm">Total (ZAR)
            <input className="mt-1 w-full rounded border px-2 py-1" value={total} onChange={(e) => setTotal(e.target.value)} />
          </label>
          <label className="block text-sm">Method
            <select className="mt-1 w-full rounded border px-2 py-1" value={method} onChange={(e) => setMethod(e.target.value as any)}>
              <option value="straight_line">Straight-line</option>
              <option value="milestone">Milestone</option>
            </select>
          </label>
          {method === 'straight_line' && (
            <label className="block text-sm">Months
              <input className="mt-1 w-full rounded border px-2 py-1" value={months} onChange={(e) => setMonths(e.target.value)} />
            </label>
          )}
          <button
            type="button"
            className="rounded bg-[var(--portal-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!scope.scopeReady || busy}
            onClick={() => void createAndActivate()}
          >
            Create + activate
          </button>
        </section>

        <section className="border border-[var(--portal-border)] bg-[var(--portal-card)] p-4 space-y-3">
          <h2 className="text-lg">Period recognition run</h2>
          <label className="block text-sm">Period (YYYY-MM)
            <input className="mt-1 w-full rounded border px-2 py-1" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} />
          </label>
          <button
            type="button"
            className="rounded bg-[var(--portal-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!scope.scopeReady || busy}
            onClick={() => void runPeriod()}
          >
            Calculate + post period
          </button>
          <label className="block text-sm">Reverse run
            <select className="mt-1 w-full rounded border px-2 py-1" value={selectedRunId} onChange={(e) => setSelectedRunId(e.target.value)}>
              <option value="">Select run</option>
              {(bundle?.recognitionRuns || []).map((r) => (
                <option key={r.id} value={r.id}>{r.periodKey} · {r.status} · {r.id}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded border border-[var(--portal-border)] px-3 py-2 text-sm disabled:opacity-50"
            disabled={!scope.scopeReady || busy || !selectedRunId}
            onClick={() => void reverseSelectedRun()}
          >
            Reverse selected run (audit)
          </button>
          <p className="text-xs opacity-70">
            Hard gates: no SARS submit, no external payment initiate, journals balanced Dr deferred / Cr revenue.
          </p>
        </section>
      </div>

      <section className="mt-6 border border-[var(--portal-border)] bg-[var(--portal-card)] p-4 overflow-x-auto">
        <h2 className="text-lg mb-3">Schedules</h2>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left opacity-70">
              <th className="py-1 pr-3">Number</th>
              <th className="py-1 pr-3">Name</th>
              <th className="py-1 pr-3">Method</th>
              <th className="py-1 pr-3">Status</th>
              <th className="py-1 pr-3">Billed</th>
              <th className="py-1 pr-3">Recognized</th>
              <th className="py-1 pr-3">Deferred</th>
              <th className="py-1 pr-3">AR / Contract</th>
            </tr>
          </thead>
          <tbody>
            {(bundle?.schedules || []).map((s) => (
              <tr key={s.id} className="border-t border-[var(--portal-border)]">
                <td className="py-1 pr-3">{s.scheduleNumber}</td>
                <td className="py-1 pr-3">{s.name}</td>
                <td className="py-1 pr-3">{s.method}</td>
                <td className="py-1 pr-3">{s.status}</td>
                <td className="py-1 pr-3">{formatMinor(s.billedMinor, s.currency)}</td>
                <td className="py-1 pr-3">{formatMinor(s.recognizedMinor, s.currency)}</td>
                <td className="py-1 pr-3">{formatMinor(s.deferredBalanceMinor, s.currency)}</td>
                <td className="py-1 pr-3">{s.arInvoiceId || s.contractRef || '-'}</td>
              </tr>
            ))}
            {!bundle?.schedules?.length && (
              <tr><td className="py-3 opacity-70" colSpan={8}>No schedules in this book yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="mt-6 border border-[var(--portal-border)] bg-[var(--portal-card)] p-4 overflow-x-auto">
        <h2 className="text-lg mb-3">Recognition runs</h2>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left opacity-70">
              <th className="py-1 pr-3">Period</th>
              <th className="py-1 pr-3">Status</th>
              <th className="py-1 pr-3">Items</th>
              <th className="py-1 pr-3">Total</th>
              <th className="py-1 pr-3">Journal</th>
              <th className="py-1 pr-3">Reversal</th>
            </tr>
          </thead>
          <tbody>
            {(bundle?.recognitionRuns || []).map((r) => (
              <tr key={r.id} className="border-t border-[var(--portal-border)]">
                <td className="py-1 pr-3">{r.periodKey}</td>
                <td className="py-1 pr-3">{r.status}</td>
                <td className="py-1 pr-3">{r.itemCount}</td>
                <td className="py-1 pr-3">{formatMinor(r.totalRecognizedMinor, 'ZAR')}</td>
                <td className="py-1 pr-3">{r.journalEntryId || '-'}</td>
                <td className="py-1 pr-3">{r.reversalJournalEntryId || '-'}</td>
              </tr>
            ))}
            {!bundle?.recognitionRuns?.length && (
              <tr><td className="py-3 opacity-70" colSpan={6}>No recognition runs yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
      </>
      ) : null}
    </FinanceModuleFrame>
  )
}
