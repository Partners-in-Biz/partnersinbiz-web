'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import { newFinanceId, readFinanceJson, requestIdentity, todayISODate } from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'
import { HudChip } from '@/components/ui/HudChip'
import { Button } from '@/components/ui/Button'
import { InstallPrompt } from '@/components/pwa/InstallPrompt'
import { ESS_HARD_GATES } from '@/lib/payroll/ess'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'

type EssBundle = {
  surface: string
  linked: boolean
  employees: Array<{ id: string; employeeNumber: string; displayName: string; status: string }>
  leaveTypes: Array<{ id: string; code: string; name: string; unit: string; payEffect: string; hoursPerDay: number }>
  leaveBalances: Array<{ id: string; leaveTypeId: string; leaveTypeCode: string; unit: string; balanceQuantity: number; balanceHours: number; asOfDate: string }>
  leaveRecords: Array<{ id: string; leaveTypeCode: string; startDate: string; endDate: string; quantity: number; unit: string; hours: number; status: string; version: number; note?: string }>
  payslips: Array<{ id: string; payDate: string; periodStart: string; periodEnd: string; netPayMinor?: number; currency?: string; status: string }>
  pendingApprovals: Array<{ id: string; employeeLabel: string; leaveTypeCode: string; startDate: string; endDate: string; quantity: number; unit: string; status: string; version: number }>
  canApproveLeave: boolean
  a11y?: {
    payslipListLabel: string
    leaveBalanceListLabel: string
    leaveRequestFormLabel: string
    pendingApprovalsLabel: string
  }
  hardGates?: Record<string, boolean>
  pwa?: { startPath: string; installableShell: boolean }
}

function formatMoney(minor?: number, currency = 'ZAR') {
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return '-'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(minor / 100)
}

export default function FinanceEssPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<EssBundle | null>(null)
  const [leaveTypeId, setLeaveTypeId] = useState('')
  const [leaveStart, setLeaveStart] = useState(todayISODate())
  const [leaveEnd, setLeaveEnd] = useState(todayISODate())
  const [leaveQty, setLeaveQty] = useState('1')
  const [leaveNote, setLeaveNote] = useState('')

  const loadBundle = useCallback(async () => {
    if (!scope.scopeReady) {
      setBundle(null)
      return
    }
    try {
      const res = await fetch(scope.queryUrl('/api/v1/finance/payroll/queries', 'ess-bundle'), { credentials: 'include' })
      const body = await readFinanceJson(res)
      const next = (body?.data?.result ?? null) as EssBundle | null
      setBundle(next)
      if (next?.leaveTypes?.[0]?.id) {
        setLeaveTypeId((prev) => prev || next.leaveTypes[0].id)
      }
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load employee self-service')
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
      scope.setError(err instanceof Error ? err.message : 'ESS action failed')
    } finally {
      setBusy(false)
    }
  }

  const primaryEmployeeId = bundle?.employees?.[0]?.id || ''

  async function requestLeave() {
    await withBusy(async () => {
      if (!primaryEmployeeId) throw new Error('Your portal user is not linked to an employee record')
      if (!leaveTypeId) throw new Error('Select a leave type')
      const quantity = Number(leaveQty)
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be positive')
      const unit = bundle?.leaveTypes.find((t) => t.id === leaveTypeId)?.unit || 'days'
      await scope.runCommand('/api/v1/finance/payroll/commands', 'leave.request', {
        id: newFinanceId('lv'),
        employeeId: primaryEmployeeId,
        leaveTypeId,
        startDate: leaveStart,
        endDate: leaveEnd,
        unit,
        quantity,
        ...(leaveNote.trim() ? { note: leaveNote.trim() } : {}),
        expectedVersion: 0,
        ...requestIdentity('ess-leave'),
      })
      setLeaveNote('')
      scope.setMessage('Leave request submitted for approval')
    })
  }

  async function decideLeave(leaveRecordId: string, version: number, decision: 'approve' | 'reject') {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/payroll/commands', 'leave.decide', {
        leaveRecordId,
        decision,
        expectedVersion: version,
        ...requestIdentity(`ess-leave-${decision}`),
      })
      scope.setMessage(decision === 'approve' ? 'Leave approved' : 'Leave rejected')
    })
  }

  async function downloadPayslipPack(payslipId: string) {
    await withBusy(async () => {
      const result = await scope.runCommand('/api/v1/finance/payroll/commands', 'payslip.pack', {
        id: newFinanceId('psp'),
        payslipId,
        expectedVersion: 0,
        ...requestIdentity('ess-pack'),
      }) as { id?: string; files?: Array<{ name?: string; content?: string; contentType?: string }>; externalEgressAllowed?: boolean; autoSent?: boolean }
      for (const file of result?.files || []) {
        const blob = new Blob([file.content || ''], { type: file.contentType || 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name || 'payslip-pack.txt'
        a.click()
        URL.revokeObjectURL(url)
      }
      if (result?.id) {
        await scope.runCommand('/api/v1/finance/payroll/commands', 'payslip.pack.mark-downloaded', {
          packId: result.id,
          ...requestIdentity('ess-pack-dl'),
        })
      }
      scope.setMessage('Payslip pack downloaded on this device (no email)')
    })
  }

  const hardGates = bundle?.hardGates || ESS_HARD_GATES
  const a11y = bundle?.a11y
  const employeeLabel = useMemo(() => {
    const e = bundle?.employees?.[0]
    return e ? `${e.displayName} · ${e.employeeNumber}` : 'Not linked'
  }, [bundle])

  return (
    <FinanceModuleFrame
      active="ess"
      orgScope={scope.orgScope}
      title="Employee self-service"
      description="Mobile-first payslips and leave. Least privilege - no admin payroll controls. Installable via the platform PWA shell."
      error={scope.error}
      message={scope.message}
      loading={scope.loading}
      meta={
        <div className="flex flex-wrap items-center gap-1.5" data-testid="ess-hard-gates">
          <HudChip tone="accent">ESS only</HudChip>
          <HudChip>No mass email</HudChip>
          <HudChip>Download only</HudChip>
          <HudChip>No SARS submit</HudChip>
        </div>
      }
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={scopedPortalPath('/portal/finance/payroll', scope.orgScope)} className="pib-btn-ghost btn-pib-sm">
            Payroll admin
          </Link>
          <Button type="button" variant="secondary" size="sm" disabled={busy || !scope.scopeReady} onClick={() => void loadBundle()}>
            Refresh
          </Button>
        </div>
      }
    >
      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
        <main className="space-y-4" data-testid="ess-main" aria-label="Employee self-service">
          <FinanceScopeBar scope={scope} />

          <section className="pib-card space-y-2 p-4" aria-labelledby="ess-profile-heading">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 id="ess-profile-heading" className="text-base">Your profile</h2>
                <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{employeeLabel}</p>
              </div>
              <HudChip tone={bundle?.linked ? 'success' : 'warning'}>{bundle?.linked ? 'Linked' : 'Not linked'}</HudChip>
            </div>
            {!bundle?.linked ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]" role="status">
                Ask payroll to link your portal user to an employee master record. You can still open this installable ESS shell while waiting.
              </p>
            ) : null}
            <p className="text-[11px] text-[var(--color-pib-text-muted)]">
              hardGates · massEmail={String(hardGates.massEmailAllowed ?? false)} · egress={String(hardGates.externalEgressAllowed ?? false)} · adminControls={String(hardGates.adminPayrollControls ?? false)} · pwa={bundle?.pwa?.startPath || '/portal/finance/ess'}
            </p>
          </section>

          <section className="grid gap-3 sm:grid-cols-3" aria-label="ESS summary">
            <div className="pib-stat-card">
              <p className="pib-label">Payslips</p>
              <p className="mt-3 text-2xl">{bundle?.payslips?.length ?? 0}</p>
            </div>
            <div className="pib-stat-card">
              <p className="pib-label">Leave balances</p>
              <p className="mt-3 text-2xl">{bundle?.leaveBalances?.length ?? 0}</p>
            </div>
            <div className="pib-stat-card">
              <p className="pib-label">Pending approvals</p>
              <p className="mt-3 text-2xl">{bundle?.pendingApprovals?.length ?? 0}</p>
            </div>
          </section>

          <section className="pib-card space-y-3 p-4" aria-labelledby="ess-payslips-heading">
            <h2 id="ess-payslips-heading" className="text-base">
              {a11y?.payslipListLabel || 'Your payslips'}
            </h2>
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              User-initiated download only. Packs never auto-email and never start SARS or bank payout.
            </p>
            {(bundle?.payslips?.length ?? 0) === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]" role="status">No generated payslips yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-pib-line)]" aria-label={a11y?.payslipListLabel || 'Your payslips'}>
                {bundle!.payslips.map((p) => (
                  <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{p.payDate}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)]">
                        {p.periodStart} → {p.periodEnd} · {formatMoney(p.netPayMinor, p.currency || 'ZAR')}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      aria-label={`Download payslip pack for ${p.payDate}`}
                      onClick={() => void downloadPayslipPack(p.id)}
                    >
                      Download pack
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="pib-card space-y-3 p-4" aria-labelledby="ess-balances-heading">
              <h2 id="ess-balances-heading" className="text-base">
                {a11y?.leaveBalanceListLabel || 'Your leave balances'}
              </h2>
              {(bundle?.leaveBalances?.length ?? 0) === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]" role="status">No leave balances on file.</p>
              ) : (
                <ul className="space-y-2" aria-label={a11y?.leaveBalanceListLabel || 'Your leave balances'}>
                  {bundle!.leaveBalances.map((b) => (
                    <li key={b.id} className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2">
                      <p className="font-medium">{b.leaveTypeCode}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)]">
                        {b.balanceQuantity} {b.unit} · {b.balanceHours}h · as of {b.asOfDate}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <h3 className="pt-2 text-sm">Recent leave</h3>
              <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
                {(bundle?.leaveRecords || []).map((r) => (
                  <li key={r.id} className="border-b border-[var(--color-pib-line)] pb-2">
                    <p className="font-medium">{r.leaveTypeCode} · {r.status}</p>
                    <p className="text-xs text-[var(--color-pib-text-muted)]">
                      {r.startDate} → {r.endDate} · {r.quantity} {r.unit}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pib-card space-y-3 p-4" aria-labelledby="ess-request-heading">
              <h2 id="ess-request-heading" className="text-base">
                {a11y?.leaveRequestFormLabel || 'Request leave'}
              </h2>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                Employee requests route as pending into the existing leave model for payroll approval.
              </p>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  void requestLeave()
                }}
                aria-label={a11y?.leaveRequestFormLabel || 'Request leave'}
              >
                <label className="block text-sm">
                  Leave type
                  <select
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={leaveTypeId}
                    onChange={(e) => setLeaveTypeId(e.target.value)}
                    required
                    disabled={!bundle?.linked || busy}
                  >
                    <option value="">Select…</option>
                    {(bundle?.leaveTypes || []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.code} - {t.name} ({t.unit})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="block text-sm">
                    Start
                    <input
                      type="date"
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                      value={leaveStart}
                      onChange={(e) => setLeaveStart(e.target.value)}
                      required
                      disabled={!bundle?.linked || busy}
                    />
                  </label>
                  <label className="block text-sm">
                    End
                    <input
                      type="date"
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                      value={leaveEnd}
                      onChange={(e) => setLeaveEnd(e.target.value)}
                      required
                      disabled={!bundle?.linked || busy}
                    />
                  </label>
                  <label className="block text-sm">
                    Quantity
                    <input
                      inputMode="decimal"
                      className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                      value={leaveQty}
                      onChange={(e) => setLeaveQty(e.target.value)}
                      required
                      disabled={!bundle?.linked || busy}
                    />
                  </label>
                </div>
                <label className="block text-sm">
                  Note (optional)
                  <textarea
                    className="mt-1 min-h-[72px] w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={leaveNote}
                    onChange={(e) => setLeaveNote(e.target.value)}
                    disabled={!bundle?.linked || busy}
                  />
                </label>
                <Button type="submit" disabled={busy || !bundle?.linked} className="w-full sm:w-auto">
                  Submit leave request
                </Button>
              </form>
            </div>
          </section>

          {bundle?.canApproveLeave ? (
            <section className="pib-card space-y-3 p-4" aria-labelledby="ess-approvals-heading">
              <h2 id="ess-approvals-heading" className="text-base">
                {a11y?.pendingApprovalsLabel || 'Leave awaiting your approval'}
              </h2>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                Uses existing leave.decide - no separate approval stack. ESS still hides admin payroll run controls.
              </p>
              {(bundle.pendingApprovals?.length ?? 0) === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]" role="status">No pending leave requests.</p>
              ) : (
                <ul className="space-y-3" aria-label={a11y?.pendingApprovalsLabel || 'Leave awaiting your approval'}>
                  {bundle.pendingApprovals.map((row) => (
                    <li key={row.id} className="rounded-lg border border-[var(--color-pib-line)] p-3">
                      <p className="font-medium">{row.employeeLabel}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)]">
                        {row.leaveTypeCode} · {row.startDate} → {row.endDate} · {row.quantity} {row.unit}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button type="button" size="sm" disabled={busy} onClick={() => void decideLeave(row.id, row.version, 'approve')}>
                          Approve
                        </Button>
                        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void decideLeave(row.id, row.version, 'reject')}>
                          Reject
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {/* Explicit absence of admin controls for least-privilege UI proof */}
          <section className="rounded-lg border border-dashed border-[var(--color-pib-line)] p-3 text-xs text-[var(--color-pib-text-muted)]" data-testid="ess-no-admin-controls">
            This ESS surface intentionally omits pay-run create/lock, bulk payslip ZIP, salary structures, EMP/IRP packs, employee master create, and leave-type configuration.
          </section>
        </main>
      ) : null}
      <InstallPrompt />
    </FinanceModuleFrame>
  )
}
