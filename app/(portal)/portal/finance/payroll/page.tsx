'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
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

type PayrollBundle = {
  employees: Array<Record<string, any>>
  employments: Array<Record<string, any>>
  calculations: Array<Record<string, any>>
  payRuns: Array<Record<string, any>>
  periods: Array<Record<string, any>>
  ruleVersions: Array<Record<string, any>>
  taxYears: Array<Record<string, any>>
  payslipCount?: number
  irp5Count?: number
  emp201Count?: number
  emp501Count?: number
  externalPaymentInitiated?: boolean
  sarsSubmissionInitiated?: boolean
}

export default function FinancePayrollPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<PayrollBundle | null>(null)
  const [empCode, setEmpCode] = useState('E001')
  const [empName, setEmpName] = useState('Employee One')
  const [gross, setGross] = useState('45000.00')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [payslipId, setPayslipId] = useState('')
  const [payslip, setPayslip] = useState<Record<string, any> | null>(null)

  const loadBundle = useCallback(async () => {
    if (!scope.scopeReady) {
      setBundle(null)
      return
    }
    try {
      const res = await fetch(scope.queryUrl('/api/v1/finance/payroll/queries', 'bundle'), { credentials: 'include' })
      const body = await readFinanceJson(res)
      const next = (body?.data?.result ?? null) as PayrollBundle | null
      setBundle(next)
      if (next?.employees?.[0]?.id) setSelectedEmployeeId((prev) => prev || next.employees[0].id)
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load payroll bundle')
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
      scope.setError(err instanceof Error ? err.message : 'Payroll command failed')
    } finally {
      setBusy(false)
    }
  }

  async function createEmployee() {
    await withBusy(async () => {
      const id = newFinanceId('emp')
      await scope.runCommand('/api/v1/finance/payroll/commands', 'employee.create', {
        id,
        employeeNumber: empCode,
        displayName: empName,
        taxResidency: 'za_resident',
        startDate: todayISODate(),
        expectedVersion: 0,
        ...requestIdentity('emp'),
      })
      scope.setMessage(`Employee ${empCode} created`)
      setSelectedEmployeeId(id)
    })
  }

  async function calculateEmployee() {
    await withBusy(async () => {
      if (!selectedEmployeeId) throw new Error('Select an employee')
      throw new Error(
        'Full payroll calculate needs employment + term version + pay period + approved rule version. Create those via payroll commands first, then calculate with those ids. Gross-only shortcut is intentionally blocked so PAYE/UIF/SDL stay audit-correct.',
      )
    })
  }

  async function loadPayslip() {
    if (!scope.scopeReady || !payslipId) return
    setBusy(true)
    scope.setError(null)
    try {
      const res = await fetch(scope.queryUrl('/api/v1/finance/payroll/queries', 'payslip', { id: payslipId }), {
        credentials: 'include',
      })
      const body = await readFinanceJson(res)
      setPayslip(body?.data?.result ?? null)
      scope.setMessage('Payslip loaded (authorised non-enumerating read)')
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Payslip read failed')
      setPayslip(null)
    } finally {
      setBusy(false)
    }
  }

  const currency = scope.selectedBook?.functionalCurrency || 'ZAR'

  return (
    <FinanceModuleFrame
      active="payroll"
      orgScope={scope.orgScope}
      title="Payroll"
      description="ZA payroll calculations, pay runs, and payslips. No bank payout or SARS submit."
      error={scope.error}
      message={scope.message}
      loading={scope.loading}
    >

      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
        <>
          <FinanceScopeBar scope={scope} />
          <section className="pib-card grid gap-3 p-4 md:grid-cols-3">
            <div className="rounded-lg border border-[var(--color-pib-line)] p-3 text-xs text-[var(--color-pib-text-muted)]">
              <p>externalPaymentInitiated: <strong className="text-[var(--color-pib-text)]">{String(bundle?.externalPaymentInitiated ?? false)}</strong></p>
              <p>sarsSubmissionInitiated: <strong className="text-[var(--color-pib-text)]">{String(bundle?.sarsSubmissionInitiated ?? false)}</strong></p>
              <button type="button" className="pib-btn-ghost mt-2" disabled={busy} onClick={() => void loadBundle()}>Refresh</button>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-4">
            {[
              ['Employees', bundle?.employees?.length ?? 0],
              ['Calculations', bundle?.calculations?.length ?? 0],
              ['Pay runs', bundle?.payRuns?.length ?? 0],
              ['Payslips', bundle?.payslipCount ?? 0],
            ].map(([label, n]) => (
              <div key={String(label)} className="pib-stat-card">
                <p className="pib-label">{label}</p>
                <p className="mt-3 text-2xl font-semibold">{n}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base font-semibold">Add employee</h2>
              <label className="block text-sm">Employee number
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={empCode} onChange={(e) => setEmpCode(e.target.value)} />
              </label>
              <label className="block text-sm">Legal name
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={empName} onChange={(e) => setEmpName(e.target.value)} />
              </label>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void createEmployee()}>Create employee</button>
              <p className="text-xs text-[var(--color-pib-text-muted)]">Full employment terms, tax tables, and pay-run lifecycle remain available via payroll commands after employee create.</p>
            </div>

            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base font-semibold">Payroll calculations</h2>
              <label className="block text-sm">Employee
                <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={selectedEmployeeId} onChange={(e) => setSelectedEmployeeId(e.target.value)}>
                  <option value="">Select…</option>
                  {(bundle?.employees || []).map((e) => <option key={e.id} value={e.id}>{e.employeeNumber || e.code || e.id} — {e.displayName || e.legalName || e.name}</option>)}
                </select>
              </label>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                PAYE/UIF/SDL calculate requires employment, term version, pay period, and approved tax-table rule version (not a gross-only shortcut). Use payroll command ops after those records exist. Target gross reference: R {gross}.
              </p>
              <label className="block text-sm">Gross reference (rands)
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={gross} onChange={(e) => setGross(e.target.value)} />
              </label>
              <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void calculateEmployee()}>Show calculate requirements</button>
            </div>

            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base font-semibold">Open payslip by id</h2>
              <label className="block text-sm">Payslip id
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={payslipId} onChange={(e) => setPayslipId(e.target.value)} placeholder="ps_…" />
              </label>
              <button type="button" className="pib-btn-primary" disabled={busy || !payslipId} onClick={() => void loadPayslip()}>Load payslip</button>
              {payslip ? (
                <pre className="max-h-48 overflow-auto rounded-lg bg-black/20 p-3 text-xs">{JSON.stringify(payslip, null, 2)}</pre>
              ) : null}
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="pib-card p-4">
              <h2 className="mb-3 text-base font-semibold">Employees</h2>
              {(bundle?.employees || []).length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No employees yet.</p>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
                  {bundle!.employees.map((e) => (
                    <li key={e.id} className="border-b border-[var(--color-pib-line)] pb-2">
                      <p className="font-medium">{e.employeeNumber || e.code || e.id} · {e.legalName || e.name}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)]">{e.status}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="pib-card p-4">
              <h2 className="mb-3 text-base font-semibold">Pay runs & calculations</h2>
              <p className="mb-2 text-xs text-[var(--color-pib-text-muted)]">
                Statutory counts — IRP5 {bundle?.irp5Count ?? 0} · EMP201 {bundle?.emp201Count ?? 0} · EMP501 {bundle?.emp501Count ?? 0}
              </p>
              {(bundle?.payRuns || []).length === 0 && (bundle?.calculations || []).length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No pay runs or calculations yet. Approved runs lock; corrections use reverse/correct paths.</p>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
                  {(bundle?.payRuns || []).map((run) => (
                    <li key={run.id} className="border-b border-[var(--color-pib-line)] pb-2">
                      <p className="font-medium">Run {run.id} · {run.status}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)]">{run.periodId || ''} {typeof run.totalNetMinor === 'number' ? `· net ${formatMinor(run.totalNetMinor, currency)}` : ''}</p>
                    </li>
                  ))}
                  {(bundle?.calculations || []).slice(0, 20).map((c) => (
                    <li key={c.id} className="border-b border-[var(--color-pib-line)] pb-2">
                      <p className="font-medium">Calc {c.id}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)]">
                        gross {formatMinor(c.grossEarningsMinor ?? c.grossMinor, currency)}
                        {typeof c.netPayMinor === 'number' ? ` · net ${formatMinor(c.netPayMinor, currency)}` : ''}
                        {typeof c.payeMinor === 'number' ? ` · PAYE ${formatMinor(c.payeMinor, currency)}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </FinanceModuleFrame>
  )
}
