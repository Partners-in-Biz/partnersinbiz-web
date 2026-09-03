'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'
import { usePortalOrgScope } from '@/lib/portal/usePortalOrgScope'
import {
  newFinanceId,
  readFinanceJson,
  requestIdentity,
} from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'

type AnyRec = Record<string, any>

const KIND_OPTIONS = [
  { value: 'sars.emp201', label: 'SARS EMP201' },
  { value: 'sars.emp501', label: 'SARS EMP501' },
  { value: 'sars.irp5_it3a', label: 'SARS IRP5/IT3(a)' },
  { value: 'sars.vat_return', label: 'SARS VAT return' },
  { value: 'payment.eft_instructions', label: 'Payment EFT + SA bank formats (AP)' },
  { value: 'payment.payroll_net', label: 'Payroll net-pay + SA bank formats' },
  { value: 'payment.acb_ap', label: 'ACB-style AP batch (CSV/TXT)' },
  { value: 'payment.netcash_ap', label: 'NetCash-style AP batch (CSV/TXT)' },
  { value: 'payment.acb_payroll', label: 'ACB-style payroll batch (CSV/TXT)' },
  { value: 'payment.netcash_payroll', label: 'NetCash-style payroll batch (CSV/TXT)' },
  { value: 'accountant.trial_balance', label: 'Accountant trial balance' },
  { value: 'accountant.general_ledger', label: 'Accountant general ledger' },
  { value: 'accountant.open_items', label: 'Accountant open items' },
  { value: 'accountant.audit_extract', label: 'Accountant audit extract' },
  { value: 'accountant.cutover_evidence', label: 'Accountant cutover evidence' },
] as const

function samplePayload(kind: string): Record<string, unknown> {
  if (kind.startsWith('sars.emp201')) {
    return {
      rows: [
        {
          taxPeriod: '2026-07',
          payeMinor: 1200000,
          uifMinor: 45000,
          sdlMinor: 30000,
          totalMinor: 1275000,
          employeeCount: 12,
          reference: 'EMP201-2026-07',
        },
      ],
    }
  }
  if (kind.startsWith('sars.emp501')) {
    return {
      rows: [
        {
          taxYear: '2026',
          emp201TotalMinor: 15000000,
          certificateTotalMinor: 15000000,
          differenceMinor: 0,
          status: 'balanced',
          reference: 'EMP501-2026',
        },
      ],
    }
  }
  if (kind.startsWith('sars.irp5')) {
    return {
      rows: [
        {
          certificateKind: 'IRP5',
          employeeId: 'emp_1',
          taxYear: '2026',
          taxableIncomeMinor: 48000000,
          payeMinor: 9000000,
          uifMinor: 212000,
          certificateNumber: 'IRP5-0001',
        },
      ],
    }
  }
  if (kind.startsWith('sars.vat')) {
    return {
      rows: [],
      boxRows: [
        { boxCode: '1', label: 'Standard rated supplies', amountMinor: 10000000, currency: 'ZAR' },
        { boxCode: '4', label: 'Input tax', amountMinor: 1500000, currency: 'ZAR' },
        { boxCode: '14', label: 'VAT payable', amountMinor: 1500000, currency: 'ZAR' },
      ],
    }
  }
  if (kind.startsWith('payment.eft') || kind === 'payment.acb_ap' || kind === 'payment.netcash_ap') {
    return {
      actionDate: '2026-08-05',
      rows: [
        {
          beneficiaryName: 'Supplier Pty Ltd',
          bankName: 'FNB',
          accountNumber: '62800123456',
          branchCode: '250655',
          accountType: 1,
          amountMinor: 2500000,
          currency: 'ZAR',
          reference: 'BILL-1001',
          sourceDocumentId: 'bill_1001',
          actionDate: '2026-08-05',
        },
      ],
    }
  }
  if (kind.startsWith('payment.payroll') || kind === 'payment.acb_payroll' || kind === 'payment.netcash_payroll') {
    return {
      actionDate: '2026-08-05',
      rows: [
        {
          employeeId: 'emp_1',
          employeeName: 'A Employee',
          bankName: 'Standard Bank',
          accountNumber: '100200300',
          branchCode: '051001',
          accountType: 1,
          netPayMinor: 3200000,
          currency: 'ZAR',
          payRunId: 'pr_2026_07',
          reference: 'NET-emp_1-2026-07',
          actionDate: '2026-08-05',
        },
      ],
    }
  }
  if (kind.includes('trial_balance')) {
    return {
      rows: [
        { accountId: 'acc_cash', accountCode: '1000', accountName: 'Bank', debitMinor: 100000, creditMinor: 0, currency: 'ZAR' },
        { accountId: 'acc_eq', accountCode: '3000', accountName: 'Equity', debitMinor: 0, creditMinor: 100000, currency: 'ZAR' },
      ],
    }
  }
  if (kind.includes('general_ledger')) {
    return {
      rows: [
        {
          journalEntryId: 'jnl_1',
          postingDate: '2026-08-01',
          accountId: 'acc_cash',
          accountCode: '1000',
          debitMinor: 100000,
          creditMinor: 0,
          description: 'Opening cash',
          currency: 'ZAR',
        },
      ],
    }
  }
  if (kind.includes('open_items')) {
    return {
      rows: [
        {
          openItemId: 'oi_1',
          counterpartyRole: 'customer',
          counterpartyCompanyId: 'crm_1',
          originalMinor: 50000,
          openMinor: 50000,
          dueDate: '2026-08-15',
          currency: 'ZAR',
          sourceType: 'opening',
        },
      ],
    }
  }
  if (kind.includes('audit')) {
    return {
      rows: [
        {
          eventId: 'ae_1',
          occurredAt: '2026-08-02T10:00:00.000Z',
          action: 'journal.post',
          actorId: 'user_1',
          resourceType: 'journal_entry',
          resourceId: 'jnl_1',
          summary: 'Posted opening journal',
        },
      ],
    }
  }
  return {
    package: {
      id: 'cut_demo',
      status: 'activated',
      cutoverAt: '2026-08-01',
      sarsSubmissionInitiated: false,
      externalPaymentInitiated: false,
    },
  }
}

export default function PackagingWorkbenchPage() {
  const orgScope = usePortalOrgScope()
  const scope = useFinanceBookScope()
  const orgId = orgScope.orgId || scope.orgId || ''

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [packs, setPacks] = useState<AnyRec[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [kind, setKind] = useState<string>('sars.emp201')
  const [familyFilter, setFamilyFilter] = useState<string>('')
  const [periodFrom, setPeriodFrom] = useState('2026-07-01')
  const [periodTo, setPeriodTo] = useState('2026-07-31')
  const [title, setTitle] = useState('')

  const loadBundle = useCallback(async () => {
    if (!orgId) return
    try {
      const q = new URLSearchParams()
      q.set('resource', 'bundle')
      q.set('orgId', orgId)
      if (scope.bookId) q.set('bookId', scope.bookId)
      if (familyFilter) q.set('family', familyFilter)
      const res = await fetch(`/api/v1/finance/packaging/queries?${q.toString()}`, {
        credentials: 'include',
      })
      const body = await readFinanceJson(res)
      const list = body?.data?.result?.packs || []
      setPacks(list)
      if (!selectedId && list[0]?.id) setSelectedId(list[0].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load packaging packs')
    }
  }, [orgId, scope.bookId, familyFilter, selectedId])

  useEffect(() => {
    void loadBundle()
  }, [loadBundle])

  async function runCommand(operation: string, command: Record<string, unknown>) {
    const res = await fetch('/api/v1/finance/packaging/commands', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(orgId ? { 'X-Org-Id': orgId } : {}),
      },
      body: JSON.stringify({ operation, command: { ...command, orgId } }),
    })
    return readFinanceJson(res)
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await fn()
      await loadBundle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  const selected = packs.find((p) => p.id === selectedId) || null

  function downloadSelected() {
    if (!selected?.files?.length) return
    for (const file of selected.files) {
      const blob = new Blob([file.content || ''], { type: file.contentType || 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name || 'export.txt'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    }
    void withBusy(async () => {
      const ids = requestIdentity('pack_dl')
      await runCommand('packaging.pack.mark_downloaded', {
        id: selected.id,
        ...ids,
      })
      setMessage('Browser download started. Operator must upload bank files manually. Pack marked downloaded (no external submit/payment/auto-upload).')
    })
  }

  return (
    <FinanceModuleFrame
      active="packaging"
      orgScope={scope.orgScope}
      title="Packaging exports"
      description="SARS-ready, payment instruction, and accountant download packs. Export/download only - operators upload bank files manually. No payment initiate, no bank session, no auto-upload."
      error={error || scope.error}
      message={message || scope.message}
      loading={scope.loading}
    >

      {!orgId ? (
        <div className="rounded-lg border border-[var(--st-warning)] bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] p-4 text-sm">
          Select an organisation scope to manage packaging exports.
        </div>
      ) : null}

      <FinanceScopeBar scope={scope} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3 border border-[var(--color-border)] p-4">
          <h2 className="text-lg">Create export pack</h2>
          <div className="rounded-lg border border-[var(--st-warning)] bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] p-3 text-sm">
            <strong>Payment packs are download-only.</strong> Download ACB/NetCash/EFT files here, then upload them yourself in your banking channel (internet banking, ACB bulk, or NetCash). Partners in Biz never initiates payments, opens bank sessions, or auto-uploads to banks.
          </div>
          <p className="text-sm text-[var(--color-muted)]">
            Entity: {scope.legalEntityId || '-'} · Book: {scope.bookId || '-'}
          </p>
          <label className="block text-sm">
            Kind
            <select className="mt-1 w-full rounded border px-2 py-1" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KIND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Title (optional)
            <input className="mt-1 w-full rounded border px-2 py-1" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              Period from
              <input className="mt-1 w-full rounded border px-2 py-1" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
            </label>
            <label className="block text-sm">
              Period to
              <input className="mt-1 w-full rounded border px-2 py-1" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
            </label>
          </div>
          <button
            type="button"
            className="pib-btn-primary"
            disabled={busy || !orgId || !scope.legalEntityId || !scope.bookId}
            onClick={() =>
              void withBusy(async () => {
                const id = newFinanceId('pack')
                const ids = requestIdentity('pack_create')
                const body = await runCommand('packaging.pack.create', {
                  id,
                  legalEntityId: scope.legalEntityId,
                  bookId: scope.bookId,
                  kind,
                  title: title || undefined,
                  periodFrom,
                  periodTo,
                  currency: 'ZAR',
                  payload: samplePayload(kind),
                  sourceRefs: ['workbench-sample'],
                  ...ids,
                })
                const pack = body?.data?.result
                if (pack?.id) setSelectedId(pack.id)
                setMessage(`Created ${pack?.kind || kind} pack ${pack?.id || id}. Gates: no SARS submit, no payment initiate, no bank auto-upload.`)
              })
            }
          >
            {busy ? 'Working…' : 'Create download pack'}
          </button>
          <p className="text-xs text-[var(--color-muted)]">
            Sample payload is used for interactive demos. Production callers supply EMP/VAT/payable/ledger/payroll snapshots via API. Payment ACB/NetCash files are templates for manual bank upload only.
          </p>
        </section>

        <section className="space-y-3 border border-[var(--color-border)] p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg">Pack library</h2>
            <select
              aria-label="Pack family filter"
              className="rounded border px-2 py-1 text-sm"
              value={familyFilter}
              onChange={(e) => setFamilyFilter(e.target.value)}
            >
              <option value="">All families</option>
              <option value="sars">SARS</option>
              <option value="payment">Payment</option>
              <option value="accountant">Accountant</option>
            </select>
          </div>
          <div className="max-h-72 space-y-2 overflow-auto">
            {packs.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">No packs yet.</p>
            ) : (
              packs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`w-full rounded border px-3 py-2 text-left text-sm ${selectedId === p.id ? 'border-blue-500 bg-blue-50' : ''}`}
                  onClick={() => setSelectedId(p.id)}
                >
                  <div className="font-medium">{p.title || p.kind}</div>
                  <div className="text-xs text-[var(--color-muted)]">
                    {p.family} · {p.status} · {p.files?.length || 0} files · {p.id}
                  </div>
                </button>
              ))
            )}
          </div>
          {selected ? (
            <div className="space-y-2 rounded border bg-[var(--color-surface)] p-3 text-sm">
              <div><strong>Manifest digest:</strong> {selected.manifest?.contentDigest?.slice(0, 16)}…</div>
              <div><strong>Flags:</strong> sarsSubmit={String(selected.sarsSubmissionInitiated)} payInit={String(selected.externalPaymentInitiated)} egress={String(selected.externalEgressAllowed)}</div>
              <ul className="list-disc pl-5">
                {(selected.files || []).map((f: AnyRec) => (
                  <li key={f.name}>{f.name} · {f.byteLength} bytes · sha {String(f.sha256 || '').slice(0, 10)}…</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="pib-btn-primary" disabled={busy} onClick={downloadSelected}>
                  Download files
                </button>
                <button
                  type="button"
                  className="pib-btn-ghost"
                  disabled={busy || selected.status === 'archived'}
                  onClick={() =>
                    void withBusy(async () => {
                      const ids = requestIdentity('pack_arch')
                      await runCommand('packaging.pack.archive', { id: selected.id, ...ids })
                      setMessage('Pack archived')
                    })
                  }
                >
                  Archive
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </FinanceModuleFrame>
  )
}