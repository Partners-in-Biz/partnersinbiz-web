'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'
import { usePortalOrgScope } from '@/lib/portal/usePortalOrgScope'
import {
  formatMinor,
  newFinanceId,
  readFinanceJson,
  requestIdentity,
} from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'

type AnyRec = Record<string, any>

export default function CutoverWizardPage() {
  const orgScope = usePortalOrgScope()
  const scope = useFinanceBookScope()
  const orgId = orgScope.orgId || scope.orgId || ''

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [packages, setPackages] = useState<AnyRec[]>([])
  const [selectedId, setSelectedId] = useState('')

  const [periodId, setPeriodId] = useState('period-open')
  const [currency, setCurrency] = useState('ZAR')
  const [cutoverAt, setCutoverAt] = useState('2026-08-01')
  const [description, setDescription] = useState('Opening trial balance cutover')
  const [arAccountId, setArAccountId] = useState('acc_ar')
  const [apAccountId, setApAccountId] = useState('acc_ap')
  const [equityAccountId, setEquityAccountId] = useState('acc_equity')
  const [cashAccountId, setCashAccountId] = useState('acc_cash')
  const [arOpenMinor, setArOpenMinor] = useState('150000')
  const [apOpenMinor, setApOpenMinor] = useState('50000')
  const [cashMinor, setCashMinor] = useState('100000')
  const [customerCompanyId, setCustomerCompanyId] = useState('crm_customer_1')
  const [supplierCompanyId, setSupplierCompanyId] = useState('crm_supplier_1')
  const [approvalReason, setApprovalReason] = useState('Opening balances reconciled and approved for cutover')

  const loadBundle = useCallback(async () => {
    if (!orgId) return
    try {
      const q = new URLSearchParams()
      q.set('resource', 'bundle')
      q.set('orgId', orgId)
      if (scope.bookId) q.set('bookId', scope.bookId)
      const res = await fetch(`/api/v1/finance/cutover/queries?${q.toString()}`, {
        credentials: 'include',
      })
      const body = await readFinanceJson(res)
      const result = body?.data?.result || {}
      const list = result.packages || []
      setPackages(list)
      if (!selectedId && list[0]?.id) setSelectedId(list[0].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cutover packages')
    }
  }, [orgId, scope.bookId, selectedId])

  useEffect(() => {
    void loadBundle()
  }, [loadBundle])

  async function runCommand(operation: string, command: Record<string, unknown>) {
    const res = await fetch('/api/v1/finance/cutover/commands', {
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

  function buildLinesAndItems() {
    const ar = Number(arOpenMinor)
    const ap = Number(apOpenMinor)
    const cash = Number(cashMinor)
    const equity = cash + ar - ap
    if (![ar, ap, cash, equity].every((n) => Number.isSafeInteger(n))) {
      throw new Error('Amounts must be safe integers in minor units')
    }
    if (equity < 0) throw new Error('Derived equity credit is negative - adjust opening amounts')
    const trialBalanceLines = [
      { accountId: cashAccountId, accountCode: '1000', accountName: 'Cash', debitMinor: cash, creditMinor: 0, controlAccountRole: 'bank' as const },
      { accountId: arAccountId, accountCode: '1100', accountName: 'Trade receivables', debitMinor: ar, creditMinor: 0, controlAccountRole: 'receivables' as const },
      { accountId: apAccountId, accountCode: '2000', accountName: 'Trade payables', debitMinor: 0, creditMinor: ap, controlAccountRole: 'payables' as const },
      { accountId: equityAccountId, accountCode: '3000', accountName: 'Opening equity', debitMinor: 0, creditMinor: equity, controlAccountRole: 'retained_earnings' as const },
    ]
    const openingOpenItems = [
      ...(ar > 0
        ? [{
            id: newFinanceId('oi_ar'),
            counterpartyCompanyId: customerCompanyId,
            counterpartyRole: 'customer' as const,
            currency,
            originalMinor: ar,
            dueDate: cutoverAt,
            taxDate: cutoverAt,
            controlAccountId: arAccountId,
            legacySourceRef: `legacy-ar-${customerCompanyId}`,
            description: 'Opening AR from legacy system',
          }]
        : []),
      ...(ap > 0
        ? [{
            id: newFinanceId('oi_ap'),
            counterpartyCompanyId: supplierCompanyId,
            counterpartyRole: 'supplier' as const,
            currency,
            originalMinor: ap,
            dueDate: cutoverAt,
            taxDate: cutoverAt,
            controlAccountId: apAccountId,
            legacySourceRef: `legacy-ap-${supplierCompanyId}`,
            description: 'Opening AP from legacy system',
          }]
        : []),
    ]
    return { trialBalanceLines, openingOpenItems }
  }

  async function onCreate() {
    await withBusy(async () => {
      if (!scope.legalEntityId || !scope.bookId) throw new Error('Select legal entity and book first')
      const { trialBalanceLines, openingOpenItems } = buildLinesAndItems()
      const id = newFinanceId('cut')
      const ids = requestIdentity('cutover-create')
      const body = await runCommand('cutover.package.create', {
        id,
        legalEntityId: scope.legalEntityId,
        bookId: scope.bookId,
        periodId,
        currency,
        cutoverAt,
        description,
        trialBalanceLines,
        openingOpenItems,
        payrollYtdOpenings: [],
        taxStateSnapshots: [],
        ...ids,
      })
      const pkg = body?.data?.result
      setSelectedId(pkg?.id || id)
      setMessage(`Created cutover package ${pkg?.id || id} (${pkg?.status})`)
    })
  }

  async function onValidate() {
    await withBusy(async () => {
      if (!selectedId) throw new Error('Select a package')
      const ids = requestIdentity('cutover-validate')
      const body = await runCommand('cutover.package.validate', { id: selectedId, ...ids })
      const pkg = body?.data?.result
      if (pkg?.status === 'failed') {
        throw new Error((pkg.validationErrors || []).join('; ') || 'Validation failed')
      }
      setMessage(`Validated ${pkg?.id} - balanced TB and open-item control recon`)
    })
  }

  async function onApprove() {
    await withBusy(async () => {
      if (!selectedId) throw new Error('Select a package')
      const ids = requestIdentity('cutover-approve')
      const body = await runCommand('cutover.package.approve', {
        id: selectedId,
        approvalId: newFinanceId('appr'),
        reason: approvalReason,
        ...ids,
      })
      const pkg = body?.data?.result
      setMessage(`Approved ${pkg?.id} by ${pkg?.approvalActorId}`)
    })
  }

  async function onActivate() {
    await withBusy(async () => {
      if (!selectedId) throw new Error('Select a package')
      const ids = requestIdentity('cutover-activate')
      const body = await runCommand('cutover.package.activate', { id: selectedId, ...ids })
      const pkg = body?.data?.result
      setMessage(
        `Activated ${pkg?.id}: book.cutoverAt=${pkg?.cutoverAt}, journal=${pkg?.openingJournalEntryId}, openItems=${(pkg?.materializedOpenItemIds || []).length}. No SARS submit / no payment initiate.`,
      )
    })
  }

  const selected = packages.find((p) => p.id === selectedId)

  return (
    <FinanceModuleFrame
      active="cutover"
      orgScope={scope.orgScope}
      title="Opening balances / cutover"
      description="Opening trial balance, open-item recon, and cutover activation controls."
      error={error || scope.error}
      message={message || scope.message}
      loading={scope.loading}
    >
      <FinanceScopeBar scope={scope} />

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={scopedPortalPath('/portal/finance', orgScope)} className="pib-btn-ghost">Finance hub</Link>
        <Link href={scopedPortalPath('/portal/finance/ledger', orgScope)} className="pib-btn-ghost">Ledger</Link>
        <Link href={scopedPortalPath('/portal/finance/setup', orgScope)} className="pib-btn-ghost">Setup</Link>
        <Link href={scopedPortalPath('/portal/finance/documents', orgScope)} className="pib-btn-ghost">Documents</Link>
      </div>

      {(error || message) && (
        <div className={`rounded-lg border p-3 text-sm ${error ? 'border-red-300 bg-red-50 text-red-800' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
          {error || message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="pib-card space-y-3 p-4">
          <h2 className="text-base">New cutover package</h2>
          <p className="text-xs text-[var(--color-pib-text-muted)]">
            Scope: entity {scope.legalEntityId || '-'} · book {scope.bookId || '-'} · org {orgId || '-'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Period id<input className="pib-input mt-1 w-full" value={periodId} onChange={(e) => setPeriodId(e.target.value)} /></label>
            <label className="text-sm">Currency<input className="pib-input mt-1 w-full" value={currency} onChange={(e) => setCurrency(e.target.value)} /></label>
            <label className="text-sm">Cutover date<input className="pib-input mt-1 w-full" value={cutoverAt} onChange={(e) => setCutoverAt(e.target.value)} /></label>
            <label className="text-sm">Description<input className="pib-input mt-1 w-full" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            <label className="text-sm">Cash account<input className="pib-input mt-1 w-full" value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)} /></label>
            <label className="text-sm">Cash minor<input className="pib-input mt-1 w-full" value={cashMinor} onChange={(e) => setCashMinor(e.target.value)} /></label>
            <label className="text-sm">AR account<input className="pib-input mt-1 w-full" value={arAccountId} onChange={(e) => setArAccountId(e.target.value)} /></label>
            <label className="text-sm">AR open minor<input className="pib-input mt-1 w-full" value={arOpenMinor} onChange={(e) => setArOpenMinor(e.target.value)} /></label>
            <label className="text-sm">AP account<input className="pib-input mt-1 w-full" value={apAccountId} onChange={(e) => setApAccountId(e.target.value)} /></label>
            <label className="text-sm">AP open minor<input className="pib-input mt-1 w-full" value={apOpenMinor} onChange={(e) => setApOpenMinor(e.target.value)} /></label>
            <label className="text-sm">Equity account<input className="pib-input mt-1 w-full" value={equityAccountId} onChange={(e) => setEquityAccountId(e.target.value)} /></label>
            <label className="text-sm">Customer company<input className="pib-input mt-1 w-full" value={customerCompanyId} onChange={(e) => setCustomerCompanyId(e.target.value)} /></label>
            <label className="text-sm col-span-2">Supplier company<input className="pib-input mt-1 w-full" value={supplierCompanyId} onChange={(e) => setSupplierCompanyId(e.target.value)} /></label>
          </div>
          <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void onCreate()}>
            Create draft package
          </button>
        </section>

        <section className="pib-card space-y-3 p-4">
          <h2 className="text-base">Approve & activate</h2>
          <label className="block text-sm">
            Package
            <select className="pib-input mt-1 w-full" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              <option value="">Select…</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>{p.id} - {p.status}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Approval reason
            <input className="pib-input mt-1 w-full" value={approvalReason} onChange={(e) => setApprovalReason(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="pib-btn-ghost" disabled={busy || !selectedId} onClick={() => void onValidate()}>Validate</button>
            <button type="button" className="pib-btn-ghost" disabled={busy || !selectedId} onClick={() => void onApprove()}>Approve</button>
            <button type="button" className="pib-btn-primary" disabled={busy || !selectedId} onClick={() => void onActivate()}>Activate cutover</button>
          </div>
          {selected && (
            <div className="rounded-lg border border-[var(--color-pib-line)] p-3 text-sm space-y-1">
              <p><span className="font-medium">Status:</span> {selected.status}</p>
              <p><span className="font-medium">Cutover:</span> {selected.cutoverAt}</p>
              <p><span className="font-medium">TB:</span> Dr {formatMinor(selected.totalDebitMinor, selected.currency)} / Cr {formatMinor(selected.totalCreditMinor, selected.currency)}</p>
              <p><span className="font-medium">AR control vs open items:</span> {selected.receivablesControlTotalMinor} vs {selected.openItemCustomerTotalMinor}</p>
              <p><span className="font-medium">AP control vs open items:</span> {selected.payablesControlTotalMinor} vs {selected.openItemSupplierTotalMinor}</p>
              <p><span className="font-medium">Journal:</span> {selected.openingJournalEntryId || '-'}</p>
              <p><span className="font-medium">Gates:</span> SARS={String(selected.sarsSubmissionInitiated)} · PayInit={String(selected.externalPaymentInitiated)}</p>
              {selected.validationErrors?.length > 0 && (
                <ul className="list-disc pl-5 text-red-700">
                  {selected.validationErrors.map((e: string) => <li key={e}>{e}</li>)}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="pib-card p-4">
        <h2 className="mb-3 text-base">Packages</h2>
        {packages.length === 0 ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">No cutover packages yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--color-pib-text-muted)]">
                  <th className="py-2 pr-3">ID</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Cutover</th>
                  <th className="py-2 pr-3">Debits</th>
                  <th className="py-2 pr-3">Credits</th>
                  <th className="py-2 pr-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id} className="border-t border-[var(--color-pib-line)]">
                    <td className="py-2 pr-3 font-mono text-xs">{p.id}</td>
                    <td className="py-2 pr-3">{p.status}</td>
                    <td className="py-2 pr-3">{p.cutoverAt}</td>
                    <td className="py-2 pr-3">{p.totalDebitMinor}</td>
                    <td className="py-2 pr-3">{p.totalCreditMinor}</td>
                    <td className="py-2 pr-3">{p.updatedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </FinanceModuleFrame>
  )
}