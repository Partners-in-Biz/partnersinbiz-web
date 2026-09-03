'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import {
  newFinanceId,
  readFinanceJson,
  requestIdentity,
} from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'

type Bundle = {
  claims: Array<Record<string, any>>
  receipts: Array<Record<string, any>>
  ocrAssists: Array<Record<string, any>>
  auditEvents: Array<Record<string, any>>
  counts?: Record<string, number>
  hardGates?: Record<string, boolean>
}

export default function FinanceExpenseClaimsPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [payeeName, setPayeeName] = useState('Staff member')
  const [employeeId, setEmployeeId] = useState('emp_demo')
  const [vendor, setVendor] = useState('Engen Sandton')
  const [policyNotes, setPolicyNotes] = useState('Travel fuel - within company policy R2000/month')
  const [netRands, setNetRands] = useState('850.00')
  const [taxRate, setTaxRate] = useState('za_std_15')
  const [expenseAccountId, setExpenseAccountId] = useState('acc_travel')
  const [creditAccountId, setCreditAccountId] = useState('acc_claims_payable')
  const [vatControlAccountId, setVatControlAccountId] = useState('acc_vat_input')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [receiptFileName, setReceiptFileName] = useState('engen-fuel-receipt.pdf')

  const loadBundle = useCallback(async () => {
    if (!scope.scopeReady) {
      setBundle(null)
      return
    }
    try {
      const qs = new URLSearchParams()
      if (statusFilter) qs.set('status', statusFilter)
      if (vendorFilter.trim()) qs.set('vendorContains', vendorFilter.trim())
      const base = scope.queryUrl('/api/v1/finance/expense-claims/queries', 'bundle')
      const url = qs.toString() ? `${base}&${qs.toString()}` : base
      const res = await fetch(url, { credentials: 'include' })
      const body = await readFinanceJson(res)
      setBundle((body?.data?.result ?? null) as Bundle | null)
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load expense claims')
    }
  }, [scope, statusFilter, vendorFilter])

  useEffect(() => {
    void loadBundle()
  }, [scope.selectedBookId, scope.selectedEntityId, scope.scopeReady, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true)
    scope.setError(null)
    scope.setMessage(null)
    try {
      await fn()
      await loadBundle()
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Expense claim command failed')
    } finally {
      setBusy(false)
    }
  }

  function parseNetMinor(): number {
    const n = Number(netRands.replace(/,/g, ''))
    if (!Number.isFinite(n) || n <= 0) throw new Error('Net amount must be a positive number')
    return Math.round(n * 100)
  }

  async function createDraft() {
    await withBusy(async () => {
      const id = newFinanceId('exc')
      const netMinor = parseNetMinor()
      await scope.runCommand('/api/v1/finance/expense-claims/commands', 'expense-claim.create', {
        id,
        payeeName,
        employeeId,
        claimDate: new Date().toISOString().slice(0, 10),
        vendor,
        policyNotes,
        currency: 'ZAR',
        lines: [
          {
            id: `${id}_l1`,
            description: vendor || 'Expense line',
            expenseAccountId,
            netMinor,
            taxRateCode: taxRate,
          },
        ],
        ...requestIdentity('expense-claim-create'),
      })
      scope.setMessage(`Draft claim ${id} created (VAT-aware lines; no payment initiate)`)
    })
  }

  async function submit(id: string) {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/expense-claims/commands', 'expense-claim.submit', {
        id,
        ...requestIdentity('expense-claim-submit'),
      })
      scope.setMessage(`Submitted ${id}`)
    })
  }

  async function approve(id: string) {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/expense-claims/commands', 'expense-claim.approve', {
        id,
        note: 'Manager approved',
        ...requestIdentity('expense-claim-approve'),
      })
      scope.setMessage(`Approved ${id}`)
    })
  }

  async function reject(id: string) {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/expense-claims/commands', 'expense-claim.reject', {
        id,
        note: 'Policy or receipt issue - revise',
        ...requestIdentity('expense-claim-reject'),
      })
      scope.setMessage(`Rejected ${id}`)
    })
  }

  async function bulkApprove() {
    const claimIds = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k)
    if (!claimIds.length) {
      scope.setError('Select submitted claims to bulk approve')
      return
    }
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/expense-claims/commands', 'expense-claim.bulk-approve', {
        claimIds,
        note: 'Bulk manager approve',
        ...requestIdentity('expense-claim-bulk'),
      })
      setSelected({})
      scope.setMessage(`Bulk approved ${claimIds.length} claims`)
    })
  }

  async function post(id: string) {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/expense-claims/commands', 'expense-claim.post', {
        id,
        postTarget: 'payable',
        creditAccountId,
        vatControlAccountId,
        ...requestIdentity('expense-claim-post'),
      })
      scope.setMessage(`Posted ${id} to payable (journal proposal balanced; no bank payout)`)
    })
  }

  async function attachReceipt(claimId: string) {
    await withBusy(async () => {
      const id = newFinanceId('exr')
      await scope.runCommand('/api/v1/finance/expense-claims/commands', 'expense-claim.receipt.attach', {
        id,
        claimId,
        fileName: receiptFileName,
        contentType: receiptFileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
        storageRefId: `storage_${id}`,
        ...requestIdentity('expense-claim-receipt'),
      })
      scope.setMessage(`Receipt attached on ${claimId}`)
    })
  }

  async function ocrAssist(claimId: string, receiptId: string) {
    await withBusy(async () => {
      const id = newFinanceId('exo')
      await scope.runCommand('/api/v1/finance/expense-claims/commands', 'expense-claim.ocr.assist', {
        id,
        claimId,
        receiptId,
        textSnippet: 'Engen fuel R977.50',
        ...requestIdentity('expense-claim-ocr'),
      })
      scope.setMessage(`OCR assist suggested on ${claimId} - human confirm required (never auto-post)`)
    })
  }

  async function confirmOcr(ocrId: string) {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/expense-claims/commands', 'expense-claim.ocr.confirm', {
        id: ocrId,
        applyLines: true,
        defaultExpenseAccountId: expenseAccountId,
        ...requestIdentity('expense-claim-ocr-confirm'),
      })
      scope.setMessage(`OCR confirmed and lines applied by human on ${ocrId}`)
    })
  }

  async function exportPayInstruction(claimId: string) {
    await withBusy(async () => {
      const id = newFinanceId('expay')
      await scope.runCommand(
        '/api/v1/finance/expense-claims/commands',
        'expense-claim.payment-instruction.export',
        {
          id,
          claimId,
          format: 'eft_csv',
          ...requestIdentity('expense-claim-pay-export'),
        },
      )
      scope.setMessage(`Observe-only payment instruction exported for ${claimId} (externalPaymentInitiated=false)`)
    })
  }

  const fmtZar = (minor: number) =>
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format((minor || 0) / 100)

  const submittedSelected = useMemo(() => {
    const ids = new Set(
      (bundle?.claims || []).filter((c) => c.status === 'submitted').map((c) => c.id as string),
    )
    return Object.entries(selected).filter(([id, on]) => on && ids.has(id)).map(([id]) => id)
  }, [bundle, selected])

  return (
    <FinanceModuleFrame
      active="expense-claims"
      orgScope={scope.orgScope}
      title="Expense claims"
      description="SA bookkeeper expense claims: draft → submit → approve/reject → post to books/payable with audit. Receipts + optional OCR assist (never auto-posts). VAT-aware lines, employee/payee link, policy notes, filters and bulk approve. No payment initiation - observe-only payment instruction export only."
      error={scope.error}
      message={scope.message}
      loading={scope.loading || busy}
    >
      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
        <div className="space-y-6">
          <FinanceScopeBar scope={scope} />

          <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-2 text-sm">Hard gates</h2>
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              externalPaymentInitiated={String(bundle?.hardGates?.externalPaymentInitiated ?? false)} ·
              autoPosted={String(bundle?.hardGates?.autoPosted ?? false)} · ocrAutoApplied=
              {String(bundle?.hardGates?.ocrAutoApplied ?? false)} · SARS submit=false · egress=false
            </p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">
              Counts - draft {bundle?.counts?.draft ?? 0} · submitted {bundle?.counts?.submitted ?? 0} · approved{' '}
              {bundle?.counts?.approved ?? 0} · rejected {bundle?.counts?.rejected ?? 0} · posted{' '}
              {bundle?.counts?.posted ?? 0}
            </p>
          </section>

          <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm">New draft claim</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs">
                Payee
                <input
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  value={payeeName}
                  onChange={(e) => setPayeeName(e.target.value)}
                />
              </label>
              <label className="text-xs">
                Employee id
                <input
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                />
              </label>
              <label className="text-xs">
                Vendor
                <input
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                />
              </label>
              <label className="text-xs">
                Net amount (ZAR)
                <input
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  value={netRands}
                  onChange={(e) => setNetRands(e.target.value)}
                />
              </label>
              <label className="text-xs">
                VAT rate
                <select
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  aria-label="VAT rate"
                >
                  <option value="za_std_15">ZA standard 15%</option>
                  <option value="za_zero">ZA zero</option>
                  <option value="za_exempt">ZA exempt</option>
                  <option value="out_of_scope">Out of scope</option>
                </select>
              </label>
              <label className="text-xs">
                Expense account id
                <input
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  value={expenseAccountId}
                  onChange={(e) => setExpenseAccountId(e.target.value)}
                />
              </label>
              <label className="text-xs md:col-span-2">
                Policy notes
                <input
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  value={policyNotes}
                  onChange={(e) => setPolicyNotes(e.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={busy}
              className="mt-3 rounded bg-[var(--color-pib-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
              onClick={() => void createDraft()}
            >
              Create draft
            </button>
          </section>

          <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm">Filters</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-xs">
                Status
                <select
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Status filter"
                >
                  <option value="">All</option>
                  <option value="draft">draft</option>
                  <option value="submitted">submitted</option>
                  <option value="approved">approved</option>
                  <option value="rejected">rejected</option>
                  <option value="posted">posted</option>
                  <option value="payment_instruction_exported">payment_instruction_exported</option>
                </select>
              </label>
              <label className="text-xs">
                Vendor contains
                <input
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  value={vendorFilter}
                  onChange={(e) => setVendorFilter(e.target.value)}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={busy}
                  className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
                  onClick={() => void loadBundle()}
                >
                  Apply filters
                </button>
              </div>
            </div>
          </section>

          <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm">Claims ({bundle?.claims?.length ?? 0})</h2>
              <div className="flex flex-wrap gap-2">
                <label className="text-xs">
                  Payable credit a/c
                  <input
                    className="ml-1 rounded border px-2 py-1 text-xs"
                    value={creditAccountId}
                    onChange={(e) => setCreditAccountId(e.target.value)}
                  />
                </label>
                <label className="text-xs">
                  VAT control
                  <input
                    className="ml-1 rounded border px-2 py-1 text-xs"
                    value={vatControlAccountId}
                    onChange={(e) => setVatControlAccountId(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || submittedSelected.length === 0}
                  className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                  onClick={() => void bulkApprove()}
                >
                  Bulk approve selected ({submittedSelected.length})
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)]">
                    <th className="py-1 pr-2">Sel</th>
                    <th className="py-1 pr-2">Date</th>
                    <th className="py-1 pr-2">Payee / vendor</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pr-2">Gross</th>
                    <th className="py-1 pr-2">VAT</th>
                    <th className="py-1 pr-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(bundle?.claims || []).map((c) => (
                    <tr key={c.id} className="border-b border-[var(--color-pib-line)]/60 align-top">
                      <td className="py-1 pr-2">
                        {c.status === 'submitted' ? (
                          <input
                            type="checkbox"
                            checked={!!selected[c.id]}
                            onChange={(e) => setSelected((s) => ({ ...s, [c.id]: e.target.checked }))}
                            aria-label={`Select ${c.id}`}
                          />
                        ) : null}
                      </td>
                      <td className="py-1 pr-2 whitespace-nowrap">{c.claimDate}</td>
                      <td className="py-1 pr-2">
                        <div className="font-medium">{c.payeeName}</div>
                        <div className="text-[var(--color-pib-text-muted)]">
                          {c.vendor || '-'} · emp={c.employeeId || '-'}
                        </div>
                        {c.policyNotes ? (
                          <div className="text-[var(--color-pib-text-muted)]">Policy: {c.policyNotes}</div>
                        ) : null}
                        <div className="text-[var(--color-pib-text-muted)]">
                          receipts={(c.receiptIds || []).length} · id={c.id}
                        </div>
                      </td>
                      <td className="py-1 pr-2">{c.status}</td>
                      <td className="py-1 pr-2 whitespace-nowrap">{fmtZar(c.grossTotalMinor)}</td>
                      <td className="py-1 pr-2 whitespace-nowrap">{fmtZar(c.vatTotalMinor)}</td>
                      <td className="py-1 pr-2">
                        <div className="flex flex-wrap gap-1">
                          {c.status === 'draft' || c.status === 'rejected' ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                className="rounded border px-2 py-0.5 disabled:opacity-50"
                                onClick={() => void submit(c.id)}
                              >
                                Submit
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                className="rounded border px-2 py-0.5 disabled:opacity-50"
                                onClick={() => void attachReceipt(c.id)}
                              >
                                Attach receipt
                              </button>
                            </>
                          ) : null}
                          {c.status === 'submitted' ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                className="rounded border px-2 py-0.5 disabled:opacity-50"
                                onClick={() => void approve(c.id)}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                className="rounded border px-2 py-0.5 disabled:opacity-50"
                                onClick={() => void reject(c.id)}
                              >
                                Reject
                              </button>
                            </>
                          ) : null}
                          {c.status === 'approved' ? (
                            <button
                              type="button"
                              disabled={busy}
                              className="rounded border px-2 py-0.5 disabled:opacity-50"
                              onClick={() => void post(c.id)}
                            >
                              Post payable
                            </button>
                          ) : null}
                          {c.status === 'posted' || c.status === 'approved' || c.status === 'payment_instruction_exported' ? (
                            <button
                              type="button"
                              disabled={busy}
                              className="rounded border px-2 py-0.5 disabled:opacity-50"
                              onClick={() => void exportPayInstruction(c.id)}
                            >
                              Export pay instr. (observe)
                            </button>
                          ) : null}
                          {(c.receiptIds || []).map((rid: string) => (
                            <button
                              key={rid}
                              type="button"
                              disabled={busy}
                              className="rounded border px-2 py-0.5 disabled:opacity-50"
                              onClick={() => void ocrAssist(c.id, rid)}
                            >
                              OCR {rid.slice(0, 8)}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!bundle?.claims?.length ? (
                <p className="text-[var(--color-pib-text-muted)]">No claims yet - create a draft above.</p>
              ) : null}
            </div>
            <div className="mt-3 text-xs text-[var(--color-pib-text-muted)]">
              Receipt filename for attach:{' '}
              <input
                aria-label="Receipt filename for attach"
                className="rounded border px-2 py-0.5"
                value={receiptFileName}
                onChange={(e) => setReceiptFileName(e.target.value)}
              />
            </div>
          </section>

          <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm">OCR assists ({bundle?.ocrAssists?.length ?? 0})</h2>
            <ul className="space-y-2 text-sm">
              {(bundle?.ocrAssists || []).map((o) => (
                <li key={o.id} className="rounded border border-[var(--color-pib-line)] px-3 py-2">
                  <div className="font-medium">
                    {o.status} · conf {Math.round((o.confidence || 0) * 100)}% · autoApplied=
                    {String(o.autoApplied)}
                  </div>
                  <div className="text-xs text-[var(--color-pib-text-muted)]">
                    vendor={o.vendorGuess || '-'} · gross guess=
                    {o.totalGrossMinorGuess != null ? fmtZar(o.totalGrossMinorGuess) : '-'}
                  </div>
                  {o.status === 'suggested' ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="mt-2 rounded border px-2 py-1 text-xs disabled:opacity-50"
                      onClick={() => void confirmOcr(o.id)}
                    >
                      Confirm + apply lines
                    </button>
                  ) : null}
                </li>
              ))}
              {!bundle?.ocrAssists?.length ? (
                <li className="text-[var(--color-pib-text-muted)]">No OCR assists yet.</li>
              ) : null}
            </ul>
          </section>

          <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm">Audit ({bundle?.auditEvents?.length ?? 0})</h2>
            <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
              {(bundle?.auditEvents || []).map((a) => (
                <li key={a.id} className="border-b border-[var(--color-pib-line)]/50 py-1">
                  <span className="text-[var(--color-pib-text-muted)]">{a.at}</span> · {a.eventType} · {a.detail}
                </li>
              ))}
              {!bundle?.auditEvents?.length ? (
                <li className="text-[var(--color-pib-text-muted)]">No audit events yet.</li>
              ) : null}
            </ul>
          </section>
        </div>
      ) : null}
    </FinanceModuleFrame>
  )
}
