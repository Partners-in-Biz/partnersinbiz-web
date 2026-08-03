'use client'

import { useCallback, useEffect, useState } from 'react'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import { newFinanceId, readFinanceJson, requestIdentity, todayISODate } from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'

type AnyRec = Record<string, any>
type PayrollBundle = {
  employees: AnyRec[]; calendars: AnyRec[]; periods: AnyRec[]; calendarProjection?: AnyRec[]
  leaveTypes?: AnyRec[]; leaveBalances?: AnyRec[]; leaveRecords?: AnyRec[]
  payRuns: AnyRec[]; calculations: AnyRec[]; payslipCount?: number
  irp5Count?: number; emp201Count?: number; emp501Count?: number
  externalPaymentInitiated?: boolean; sarsSubmissionInitiated?: boolean; autoSent?: boolean
}

export default function FinancePayrollPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<PayrollBundle | null>(null)
  const [myPayslips, setMyPayslips] = useState<AnyRec[]>([])
  const [empCode, setEmpCode] = useState('E001')
  const [empName, setEmpName] = useState('Employee One')
  const [linkUserId, setLinkUserId] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [calCode, setCalCode] = useState('MTH')
  const [selectedCalendarId, setSelectedCalendarId] = useState('')
  const [periodLabel, setPeriodLabel] = useState('2026-08')
  const [periodStart, setPeriodStart] = useState('2026-08-01')
  const [periodEnd, setPeriodEnd] = useState('2026-08-31')
  const [payDate, setPayDate] = useState('2026-08-25')
  const [cutOffAt, setCutOffAt] = useState('2026-08-20T12:00:00.000Z')
  const [leaveCode, setLeaveCode] = useState('ANNUAL')
  const [leavePayEffect, setLeavePayEffect] = useState<'paid' | 'unpaid' | 'none'>('paid')
  const [selectedLeaveTypeId, setSelectedLeaveTypeId] = useState('')
  const [leaveBalanceQty, setLeaveBalanceQty] = useState('15')
  const [leaveStart, setLeaveStart] = useState('2026-08-10')
  const [leaveEnd, setLeaveEnd] = useState('2026-08-12')
  const [leaveQty, setLeaveQty] = useState('3')
  const [selectedPayslipId, setSelectedPayslipId] = useState('')
  const [packPreview, setPackPreview] = useState<AnyRec | null>(null)

  const loadBundle = useCallback(async () => {
    if (!scope.scopeReady) { setBundle(null); return }
    try {
      const res = await fetch(scope.queryUrl('/api/v1/finance/payroll/queries', 'bundle'), { credentials: 'include' })
      const body = await readFinanceJson(res)
      const next = (body?.data?.result ?? null) as PayrollBundle | null
      setBundle(next)
      if (next?.employees?.[0]?.id) setSelectedEmployeeId((p) => p || next.employees[0].id)
      if (next?.calendars?.[0]?.id) setSelectedCalendarId((p) => p || next.calendars[0].id)
      if (next?.leaveTypes?.[0]?.id) setSelectedLeaveTypeId((p) => p || next.leaveTypes![0].id)
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load payroll bundle')
    }
  }, [scope])

  const loadMyPayslips = useCallback(async () => {
    if (!scope.scopeReady) { setMyPayslips([]); return }
    try {
      const res = await fetch(scope.queryUrl('/api/v1/finance/payroll/queries', 'my-payslips'), { credentials: 'include' })
      const body = await readFinanceJson(res)
      setMyPayslips(Array.isArray(body?.data?.result) ? body.data.result : [])
    } catch { setMyPayslips([]) }
  }, [scope])

  useEffect(() => { void loadBundle(); void loadMyPayslips() }, [scope.selectedBookId, scope.selectedEntityId, scope.scopeReady]) // eslint-disable-line react-hooks/exhaustive-deps

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true); scope.setError(null); scope.setMessage(null)
    try { await fn(); await loadBundle(); await loadMyPayslips() }
    catch (err) { scope.setError(err instanceof Error ? err.message : 'Payroll command failed') }
    finally { setBusy(false) }
  }

  async function createEmployee() {
    await withBusy(async () => {
      const id = newFinanceId('emp')
      await scope.runCommand('/api/v1/finance/payroll/commands', 'employee.create', {
        id, employeeNumber: empCode, displayName: empName, taxResidency: 'za_resident', startDate: todayISODate(),
        ...(linkUserId.trim() ? { linkedUserId: linkUserId.trim() } : {}), expectedVersion: 0, ...requestIdentity('emp'),
      })
      setSelectedEmployeeId(id); scope.setMessage(`Employee ${empCode} created`)
    })
  }
  async function linkSelectedEmployee() {
    await withBusy(async () => {
      if (!selectedEmployeeId) throw new Error('Select an employee')
      const emp = (bundle?.employees || []).find((e) => e.id === selectedEmployeeId)
      await scope.runCommand('/api/v1/finance/payroll/commands', 'employee.link-user', {
        employeeId: selectedEmployeeId, linkedUserId: linkUserId.trim() || null, expectedVersion: emp?.version ?? 1, ...requestIdentity('link'),
      })
      scope.setMessage('Employee ESS link updated')
    })
  }
  async function createCalendar() {
    await withBusy(async () => {
      const id = newFinanceId('cal')
      await scope.runCommand('/api/v1/finance/payroll/commands', 'calendar.create', {
        id, code: calCode, name: 'Monthly', frequency: 'monthly', expectedVersion: 0, ...requestIdentity('cal'),
      })
      setSelectedCalendarId(id); scope.setMessage('Calendar created')
    })
  }
  async function createPeriod() {
    await withBusy(async () => {
      if (!selectedCalendarId) throw new Error('Select calendar')
      await scope.runCommand('/api/v1/finance/payroll/commands', 'period.create', {
        id: newFinanceId('per'), calendarId: selectedCalendarId, label: periodLabel, periodStart, periodEnd, payDate, cutOffAt,
        taxYearLabel: '2025/26', expectedVersion: 0, ...requestIdentity('per'),
      })
      scope.setMessage('Pay period created with cut-off')
    })
  }
  async function createLeaveType() {
    await withBusy(async () => {
      const id = newFinanceId('lt')
      await scope.runCommand('/api/v1/finance/payroll/commands', 'leave-type.create', {
        id, code: leaveCode, name: leaveCode, unit: 'days', payEffect: leavePayEffect, hoursPerDay: 8, accrues: true, expectedVersion: 0, ...requestIdentity('lt'),
      })
      setSelectedLeaveTypeId(id); scope.setMessage('Leave type created')
    })
  }
  async function setBalance() {
    await withBusy(async () => {
      if (!selectedEmployeeId || !selectedLeaveTypeId) throw new Error('Select employee + leave type')
      await scope.runCommand('/api/v1/finance/payroll/commands', 'leave-balance.set', {
        id: newFinanceId('lb'), employeeId: selectedEmployeeId, leaveTypeId: selectedLeaveTypeId,
        balanceQuantity: Number(leaveBalanceQty), asOfDate: todayISODate(), expectedVersion: 0, ...requestIdentity('lb'),
      })
      scope.setMessage('Leave balance set')
    })
  }
  async function requestLeave() {
    await withBusy(async () => {
      if (!selectedEmployeeId || !selectedLeaveTypeId) throw new Error('Select employee + leave type')
      await scope.runCommand('/api/v1/finance/payroll/commands', 'leave.request', {
        id: newFinanceId('lv'), employeeId: selectedEmployeeId, leaveTypeId: selectedLeaveTypeId,
        startDate: leaveStart, endDate: leaveEnd, unit: 'days', quantity: Number(leaveQty), expectedVersion: 0, ...requestIdentity('lv'),
      })
      scope.setMessage('Leave recorded')
    })
  }
  async function downloadPayslipPack(payslipId: string) {
    await withBusy(async () => {
      const result = await scope.runCommand('/api/v1/finance/payroll/commands', 'payslip.pack', {
        id: newFinanceId('psp'), payslipId, expectedVersion: 0, ...requestIdentity('psp'),
      }) as AnyRec
      setPackPreview(result)
      for (const file of result?.files || []) {
        const blob = new Blob([file.content || ''], { type: file.contentType || 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = file.name || 'payslip-pack.txt'; a.click(); URL.revokeObjectURL(url)
      }
      if (result?.id) {
        await scope.runCommand('/api/v1/finance/payroll/commands', 'payslip.pack.mark-downloaded', { packId: result.id, ...requestIdentity('psp-dl') })
      }
      scope.setMessage('Payslip pack downloaded (no email / no SARS / no payment)')
    })
  }

  return (
    <FinanceModuleFrame active="payroll" orgScope={scope.orgScope} title="Payroll"
      description="Pay calendar, leave, employee master, ESS payslip view, and download packs only. No bank payout or SARS submit."
      error={scope.error} message={scope.message} loading={scope.loading}>
      {!scope.loading && !scope.scopeReady ? <FinanceEmptyScope orgScope={scope.orgScope} /> : !scope.loading ? (
        <>
          <FinanceScopeBar scope={scope} />
          <section className="grid gap-4 md:grid-cols-4">
            {[['Employees', bundle?.employees?.length ?? 0],['Pay periods', bundle?.periods?.length ?? 0],['Leave records', bundle?.leaveRecords?.length ?? 0],['Payslips', bundle?.payslipCount ?? 0]].map(([label,n]) => (
              <div key={String(label)} className="pib-stat-card"><p className="pib-label">{label}</p><p className="mt-3 text-2xl font-semibold">{n}</p></div>
            ))}
          </section>
          <section className="pib-card p-4 text-xs text-[var(--color-pib-text-muted)]">
            externalPaymentInitiated: <strong className="text-[var(--color-pib-text)]">{String(bundle?.externalPaymentInitiated ?? false)}</strong>
            {' · '}sarsSubmissionInitiated: <strong className="text-[var(--color-pib-text)]">{String(bundle?.sarsSubmissionInitiated ?? false)}</strong>
            {' · '}autoSent: <strong className="text-[var(--color-pib-text)]">{String(bundle?.autoSent ?? false)}</strong>
            <button type="button" className="pib-btn-ghost ml-3" disabled={busy} onClick={() => { void loadBundle(); void loadMyPayslips() }}>Refresh</button>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base font-semibold">Pay-run calendar</h2>
              <label className="block text-sm">Code<input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={calCode} onChange={(e) => setCalCode(e.target.value)} /></label>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void createCalendar()}>Create monthly calendar</button>
              <label className="block text-sm">Calendar
                <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={selectedCalendarId} onChange={(e) => setSelectedCalendarId(e.target.value)}>
                  <option value="">Select…</option>
                  {(bundle?.calendars || []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                </select>
              </label>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="block text-sm">Label<input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} /></label>
                <label className="block text-sm">Pay date<input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></label>
                <label className="block text-sm">Start<input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></label>
                <label className="block text-sm">End<input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></label>
              </div>
              <label className="block text-sm">Cut-off ISO<input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={cutOffAt} onChange={(e) => setCutOffAt(e.target.value)} /></label>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void createPeriod()}>Add pay period</button>
              <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
                {(bundle?.calendarProjection || []).map((p) => (
                  <li key={p.periodId} className="border-b border-[var(--color-pib-line)] pb-2">
                    <p className="font-medium">{p.label} · {p.cutoffStatus}</p>
                    <p className="text-xs text-[var(--color-pib-text-muted)]">{p.periodStart}→{p.periodEnd} · cut-off {p.cutOffAt}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base font-semibold">Employee master</h2>
              <label className="block text-sm">Number<input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={empCode} onChange={(e) => setEmpCode(e.target.value)} /></label>
              <label className="block text-sm">Name<input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={empName} onChange={(e) => setEmpName(e.target.value)} /></label>
              <label className="block text-sm">Linked portal user id<input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={linkUserId} onChange={(e) => setLinkUserId(e.target.value)} /></label>
              <div className="flex gap-2">
                <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void createEmployee()}>Create</button>
                <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void linkSelectedEmployee()}>Link ESS</button>
              </div>
              <label className="block text-sm">Selected
                <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={selectedEmployeeId} onChange={(e) => setSelectedEmployeeId(e.target.value)}>
                  <option value="">Select…</option>
                  {(bundle?.employees || []).map((e) => <option key={e.id} value={e.id}>{e.employeeNumber} — {e.displayName}</option>)}
                </select>
              </label>
              <ul className="max-h-40 space-y-2 overflow-y-auto text-sm">
                {(bundle?.employees || []).map((e) => (
                  <li key={e.id} className="border-b border-[var(--color-pib-line)] pb-2">
                    <p className="font-medium">{e.employeeNumber} · {e.displayName}</p>
                    <p className="text-xs text-[var(--color-pib-text-muted)]">{e.status}{e.linkedUserId ? ' · ESS linked' : ''}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base font-semibold">Leave</h2>
              <label className="block text-sm">Code<input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={leaveCode} onChange={(e) => setLeaveCode(e.target.value)} /></label>
              <label className="block text-sm">Pay effect
                <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={leavePayEffect} onChange={(e) => setLeavePayEffect(e.target.value as any)}>
                  <option value="paid">paid</option><option value="unpaid">unpaid</option><option value="none">none</option>
                </select>
              </label>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void createLeaveType()}>Create leave type</button>
              <label className="block text-sm">Type
                <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={selectedLeaveTypeId} onChange={(e) => setSelectedLeaveTypeId(e.target.value)}>
                  <option value="">Select…</option>
                  {(bundle?.leaveTypes || []).map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}
                </select>
              </label>
              <label className="block text-sm">Balance days<input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={leaveBalanceQty} onChange={(e) => setLeaveBalanceQty(e.target.value)} /></label>
              <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void setBalance()}>Set balance</button>
              <div className="grid gap-2 md:grid-cols-3">
                <label className="block text-sm">Start<input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} /></label>
                <label className="block text-sm">End<input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} /></label>
                <label className="block text-sm">Days<input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={leaveQty} onChange={(e) => setLeaveQty(e.target.value)} /></label>
              </div>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void requestLeave()}>Record leave</button>
              <ul className="max-h-40 space-y-2 overflow-y-auto text-sm">
                {(bundle?.leaveRecords || []).map((r) => (
                  <li key={r.id} className="border-b border-[var(--color-pib-line)] pb-2">
                    <p className="font-medium">{r.leaveTypeCode} · {r.status}</p>
                    <p className="text-xs text-[var(--color-pib-text-muted)]">{r.startDate}→{r.endDate} · {r.hours}h · {r.payEffect}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base font-semibold">Self-serve payslips & PDF pack download</h2>
              <p className="text-xs text-[var(--color-pib-text-muted)]">Linked employees only see their own payslips. Packs download locally — never mass-emailed.</p>
              {myPayslips.length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No self-serve payslips for this user/book.</p>
              ) : (
                <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
                  {myPayslips.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 border-b border-[var(--color-pib-line)] pb-2">
                      <span>{p.payDate} · {p.id}</span>
                      <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void downloadPayslipPack(p.id)}>Download pack</button>
                    </li>
                  ))}
                </ul>
              )}
              <label className="block text-sm">Payslip id
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={selectedPayslipId} onChange={(e) => setSelectedPayslipId(e.target.value)} />
              </label>
              <button type="button" className="pib-btn-ghost" disabled={busy || !selectedPayslipId} onClick={() => void downloadPayslipPack(selectedPayslipId)}>Download pack by id</button>
              {packPreview ? <pre className="max-h-32 overflow-auto rounded-lg bg-black/20 p-3 text-xs">{JSON.stringify({ id: packPreview.id, files: (packPreview.files||[]).map((f:AnyRec)=>f.name), externalEgressAllowed: packPreview.externalEgressAllowed, autoSent: packPreview.autoSent }, null, 2)}</pre> : null}
              <ul className="max-h-32 space-y-2 overflow-y-auto text-sm">
                {(bundle?.payRuns || []).map((run) => (
                  <li key={run.id} className="border-b border-[var(--color-pib-line)] pb-2">{run.label || run.id} · {run.status}</li>
                ))}
              </ul>
            </div>
          </section>
        </>
      ) : null}
    </FinanceModuleFrame>
  )
}
