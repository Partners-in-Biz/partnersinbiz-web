'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import { FinanceResponsiveTable } from '@/components/finance/FinanceResponsiveTable'
import {
  FinanceOperatorTableChrome,
  useFinanceTableDensity,
} from '@/components/finance/FinanceOperatorTableChrome'
import {
  formatMinor,
  newFinanceId,
  parseRandsToMinor,
  requestIdentity,
  todayISODate,
} from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'
import { readFinanceJson } from '@/components/finance/financeWorkbench'

type DocumentsBundle = {
  invoices: Array<Record<string, any>>
  bills: Array<Record<string, any>>
  creditNotes?: Array<Record<string, any>>
  debitNotes?: Array<Record<string, any>>
  recurringSchedules?: Array<Record<string, any>>
  statementDrafts?: Array<Record<string, any>>
  attachments?: Array<Record<string, any>>
  openItems: Array<Record<string, any>>
  payments: Array<Record<string, any>>
  bankAccounts: Array<Record<string, any>>
  bankTransactions: Array<Record<string, any>>
  reconciliations: Array<Record<string, any>>
  aging?: { ar?: any; ap?: any }
  externalPaymentInitiated?: boolean
  massEmailAllowed?: boolean
}

export default function FinanceDocumentsPage() {
  const scope = useFinanceBookScope()
  const { density, setDensity } = useFinanceTableDensity()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<DocumentsBundle | null>(null)

  const [accounts, setAccounts] = useState<Array<Record<string, any>>>([])
  const [taxCodes, setTaxCodes] = useState<Array<Record<string, any>>>([])

  const [invCustomerId, setInvCustomerId] = useState('')
  const [invCustomerName, setInvCustomerName] = useState('')
  const [invAmount, setInvAmount] = useState('1000.00')
  const [invDesc, setInvDesc] = useState('Professional services')
  const [invTaxCodeId, setInvTaxCodeId] = useState('')
  const [invRevenueAccountId, setInvRevenueAccountId] = useState('')

  const [bankCode, setBankCode] = useState('FNB')
  const [bankName, setBankName] = useState('Primary operating account')
  const [bankLedgerId, setBankLedgerId] = useState('')
  const [bankOpening, setBankOpening] = useState('0.00')

  const [txnBankId, setTxnBankId] = useState('')
  const [txnAmount, setTxnAmount] = useState('1150.00')
  const [txnDesc, setTxnDesc] = useState('Customer deposit')

  const [payAmount, setPayAmount] = useState('1150.00')
  const [payDirection, setPayDirection] = useState<'receipt' | 'disbursement'>('receipt')
  const [payMethod, setPayMethod] = useState<'eft' | 'cash' | 'card' | 'other'>('eft')
  const [payBankId, setPayBankId] = useState('')

  const [reconBankId, setReconBankId] = useState('')
  const [reconOpen, setReconOpen] = useState('0.00')
  const [reconClose, setReconClose] = useState('1150.00')

  const loadBundle = useCallback(async () => {
    if (!scope.scopeReady) {
      setBundle(null)
      return
    }
    try {
      const [docsRes, accountsRes, taxRes] = await Promise.all([
        fetch(scope.queryUrl('/api/v1/finance/documents/queries', 'bundle'), { credentials: 'include' }),
        fetch(scope.queryUrl('/api/v1/finance/foundation/queries', 'accounts'), { credentials: 'include' }),
        fetch(scope.queryUrl('/api/v1/finance/tax/queries', 'bundle'), { credentials: 'include' }),
      ])
      const docsBody = await readFinanceJson(docsRes)
      const accountsBody = await readFinanceJson(accountsRes)
      const taxBody = await readFinanceJson(taxRes)
      const next = (docsBody?.data?.result ?? null) as DocumentsBundle | null
      const nextAccounts = (accountsBody?.data?.result ?? []) as Array<Record<string, any>>
      const nextTaxCodes = ((taxBody?.data?.result?.taxCodes) ?? []) as Array<Record<string, any>>
      setBundle(next)
      setAccounts(nextAccounts)
      setTaxCodes(nextTaxCodes)
      if (next?.bankAccounts?.[0]?.id) {
        setTxnBankId((prev) => prev || next.bankAccounts[0].id)
        setPayBankId((prev) => prev || next.bankAccounts[0].id)
        setReconBankId((prev) => prev || next.bankAccounts[0].id)
      }
      const income = nextAccounts.find((a) => a.accountType === 'income')
      const bank = nextAccounts.find((a) => a.controlAccountRole === 'bank' || a.accountType === 'asset')
      if (income?.id) setInvRevenueAccountId((prev) => prev || income.id)
      if (bank?.id) setBankLedgerId((prev) => prev || bank.id)
      if (nextTaxCodes[0]?.id) setInvTaxCodeId((prev) => prev || nextTaxCodes[0].id)
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load documents bundle')
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
      scope.setError(err instanceof Error ? err.message : 'Command failed')
    } finally {
      setBusy(false)
    }
  }

  async function createInvoice() {
    await withBusy(async () => {
      if (!invTaxCodeId) throw new Error('Create a tax code on Tax first, then pick it here')
      if (!invRevenueAccountId) throw new Error('Select a revenue account from the chart of accounts')
      const id = newFinanceId('inv')
      const companyId = invCustomerId || `crm_${newFinanceId('co')}`
      const net = parseRandsToMinor(invAmount)
      await scope.runCommand('/api/v1/finance/documents/commands', 'invoice.create', {
        id,
        customerCompanyId: companyId,
        customerSnapshot: {
          companyId,
          legalName: invCustomerName || 'Customer',
        },
        issueDate: todayISODate(),
        dueDate: todayISODate(),
        currency: scope.selectedBook?.functionalCurrency || 'ZAR',
        accountingBasis: scope.selectedBook?.accountingBasis || 'accrual',
        lines: [
          {
            id: newFinanceId('line'),
            description: invDesc,
            quantityMilli: 1000,
            unitPriceMinor: net,
            taxCodeId: invTaxCodeId,
            taxIncluded: false,
            revenueOrExpenseAccountId: invRevenueAccountId,
          },
        ],
        expectedVersion: 0,
        ...requestIdentity('inv'),
      })
      scope.setMessage(`Draft invoice ${id} created`)
    })
  }

  async function issueInvoice(invoice: Record<string, any>) {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/documents/commands', 'invoice.issue', {
        invoiceId: invoice.id,
        expectedVersion: invoice.version ?? 1,
        controlAccountId: invoice.controlAccountId || invoice.receivableAccountId || 'recv',
        ...requestIdentity('inv-issue'),
      })
      scope.setMessage(`Invoice ${invoice.documentNumber || invoice.id} issued`)
    })
  }

  async function createBankAccount() {
    await withBusy(async () => {
      const id = newFinanceId('ba')
      await scope.runCommand('/api/v1/finance/documents/commands', 'bank-account.create', {
        id,
        code: bankCode,
        name: bankName,
        currency: scope.selectedBook?.functionalCurrency || 'ZAR',
        ledgerAccountId: bankLedgerId || `bank_ledger_${id}`,
        expectedVersion: 0,
        ...requestIdentity('ba'),
      })
      scope.setMessage(`Bank account ${bankCode} created (opening tracked via reconciliation)`)
      setTxnBankId(id)
      setPayBankId(id)
      setReconBankId(id)
    })
  }

  async function importTxn() {
    await withBusy(async () => {
      if (!txnBankId) throw new Error('Select a bank account')
      const id = newFinanceId('bt')
      const amountMinor = parseRandsToMinor(txnAmount)
      await scope.runCommand('/api/v1/finance/documents/commands', 'bank-transaction.import', {
        id,
        bankAccountId: txnBankId,
        statementDate: todayISODate(),
        effectiveDate: todayISODate(),
        amountMinor,
        description: txnDesc,
        sourceFingerprint: `fp_${id}`,
        expectedVersion: 0,
        ...requestIdentity('bt'),
      })
      scope.setMessage('Bank transaction imported (observed only - no payment initiated)')
    })
  }

  async function observePayment() {
    await withBusy(async () => {
      const id = newFinanceId('pay')
      await scope.runCommand('/api/v1/finance/documents/commands', 'payment.observe', {
        id,
        direction: payDirection,
        amountMinor: parseRandsToMinor(payAmount),
        currency: scope.selectedBook?.functionalCurrency || 'ZAR',
        observedDate: todayISODate(),
        effectiveDate: todayISODate(),
        method: payMethod,
        sourceEventKey: `evt_${id}`,
        bankAccountId: payBankId || undefined,
        autoVerify: false,
        expectedVersion: 0,
        ...requestIdentity('pay'),
      })
      scope.setMessage(`External payment ${id} observed (not initiated by PiB)`)
    })
  }

  async function verifyPayment(payment: Record<string, any>) {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/documents/commands', 'payment.verify', {
        paymentId: payment.id,
        expectedVersion: payment.version ?? 1,
        ...requestIdentity('pay-v'),
      })
      scope.setMessage(`Payment ${payment.id} verified`)
    })
  }

  async function createRecon() {
    await withBusy(async () => {
      if (!reconBankId) throw new Error('Select a bank account')
      const id = newFinanceId('recon')
      await scope.runCommand('/api/v1/finance/documents/commands', 'reconciliation.create', {
        id,
        bankAccountId: reconBankId,
        statementStartsAt: todayISODate(),
        statementEndsAt: todayISODate(),
        openingBalanceMinor: parseRandsToMinor(reconOpen || bankOpening),
        closingBalanceMinor: parseRandsToMinor(reconClose),
        expectedVersion: 0,
        ...requestIdentity('recon'),
      })
      scope.setMessage(`Reconciliation ${id} opened`)
    })
  }

  async function submitRecon(recon: Record<string, any>) {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/documents/commands', 'reconciliation.submit', {
        reconciliationId: recon.id,
        expectedVersion: recon.version ?? 1,
        ...requestIdentity('recon-sub'),
      })
      scope.setMessage(`Reconciliation ${recon.id} submitted for approval`)
    })
  }

  const currency = scope.selectedBook?.functionalCurrency || 'ZAR'

  return (
    <FinanceModuleFrame
      active="documents"
      orgScope={scope.orgScope}
      title="Documents & reconciliation"
      description="AR/AP depth: invoices, bills, credit/debit notes, recurring schedules, statement export drafts, bulk ops, aging, attachments - record only; no external payment initiate or mass email."
      error={scope.error}
      message={scope.message}
      loading={scope.loading}
    >

      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
        <>
          <FinanceScopeBar scope={scope} />
          <section className="pib-card grid gap-3 p-4 md:grid-cols-[1fr_auto] items-center">
            <div className="rounded-lg border border-[var(--color-pib-line)] p-3 text-xs text-[var(--color-pib-text-muted)]">
              <p>externalPaymentInitiated: <strong className="text-[var(--color-pib-text)]">{String(bundle?.externalPaymentInitiated ?? false)}</strong></p>
              <p className="mt-1">Currency: {currency} · Basis: {scope.selectedBook?.accountingBasis}</p>
            </div>
            <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void loadBundle()}>Refresh</button>
          </section>

          <section className="grid gap-4 md:grid-cols-4">
            {[
              ['Invoices', bundle?.invoices?.length ?? 0],
              ['Bills', bundle?.bills?.length ?? 0],
              ['Payments', bundle?.payments?.length ?? 0],
              ['Credit notes', bundle?.creditNotes?.length ?? 0],
              ['Debit notes', bundle?.debitNotes?.length ?? 0],
              ['Recurring', bundle?.recurringSchedules?.length ?? 0],
              ['Statements', bundle?.statementDrafts?.length ?? 0],
              ['Bank txns', bundle?.bankTransactions?.length ?? 0],
            ].map(([label, n]) => (
              <div key={String(label)} className="pib-stat-card">
                <p className="pib-label">{label}</p>
                <p className="mt-3 text-2xl">{n}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="pib-card p-4">
              <h2 className="mb-2 text-base">AR aging</h2>
              <p className="text-xs text-[var(--color-pib-text-muted)] mb-3">Total {formatMinor(bundle?.aging?.ar?.totalOutstandingMinor ?? 0, currency)}</p>
              <div className="grid grid-cols-5 gap-2 text-center text-xs">
                {(bundle?.aging?.ar?.buckets || []).map((b: any) => (
                  <div key={b.key} className="rounded-lg border border-[var(--color-pib-line)] p-2">
                    <p className="text-[var(--color-pib-text-muted)]">{b.label}</p>
                    <p className="mt-1">{formatMinor(b.amountMinor ?? 0, currency)}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="pib-card p-4">
              <h2 className="mb-2 text-base">AP aging</h2>
              <p className="text-xs text-[var(--color-pib-text-muted)] mb-3">Total {formatMinor(bundle?.aging?.ap?.totalOutstandingMinor ?? 0, currency)}</p>
              <div className="grid grid-cols-5 gap-2 text-center text-xs">
                {(bundle?.aging?.ap?.buckets || []).map((b: any) => (
                  <div key={b.key} className="rounded-lg border border-[var(--color-pib-line)] p-2">
                    <p className="text-[var(--color-pib-text-muted)]">{b.label}</p>
                    <p className="mt-1">{formatMinor(b.amountMinor ?? 0, currency)}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="pib-card p-4 text-sm text-[var(--color-pib-text-muted)]">
            Credit notes, debit notes, recurring schedules, counterparty statement drafts (export only), bulk issue/void/allocate, attachments, and portal filters are available via documents commands/queries. massEmailAllowed=false · no SARS submit · no external payment initiate.
            Credit notes: {bundle?.creditNotes?.length ?? 0} · Debit notes: {bundle?.debitNotes?.length ?? 0} · Recurring: {bundle?.recurringSchedules?.length ?? 0} · Statement drafts: {bundle?.statementDrafts?.length ?? 0} · Attachments: {bundle?.attachments?.length ?? 0}.
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base">Create customer invoice (draft)</h2>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="text-sm">Customer company id
                  <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={invCustomerId} onChange={(e) => setInvCustomerId(e.target.value)} placeholder="CRM company id" />
                </label>
                <label className="text-sm">Customer name
                  <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={invCustomerName} onChange={(e) => setInvCustomerName(e.target.value)} />
                </label>
                <label className="text-sm">Line amount (rands, exclusive)
                  <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={invAmount} onChange={(e) => setInvAmount(e.target.value)} />
                </label>
                <label className="text-sm">Description
                  <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={invDesc} onChange={(e) => setInvDesc(e.target.value)} />
                </label>
                <label className="text-sm">Tax code
                  <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={invTaxCodeId} onChange={(e) => setInvTaxCodeId(e.target.value)}>
                    <option value="">Select…</option>
                    {taxCodes.map((t) => <option key={t.id} value={t.id}>{t.code} - {t.name}</option>)}
                  </select>
                </label>
                <label className="text-sm">Revenue account
                  <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={invRevenueAccountId} onChange={(e) => setInvRevenueAccountId(e.target.value)}>
                    <option value="">Select…</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                  </select>
                </label>
              </div>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void createInvoice()}>{busy ? 'Working…' : 'Create draft invoice'}</button>
            </div>

            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base">Bank account</h2>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="text-sm">Code
                  <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={bankCode} onChange={(e) => setBankCode(e.target.value)} />
                </label>
                <label className="text-sm">Name
                  <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={bankName} onChange={(e) => setBankName(e.target.value)} />
                </label>
                <label className="text-sm">Ledger account id
                  <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={bankLedgerId} onChange={(e) => setBankLedgerId(e.target.value)} placeholder="Bank control account id" />
                </label>
                <label className="text-sm">Opening (for recon)
                  <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={bankOpening} onChange={(e) => setBankOpening(e.target.value)} />
                </label>
              </div>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void createBankAccount()}>Create bank account</button>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base">Import bank transaction</h2>
              <label className="block text-sm">Bank account
                <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={txnBankId} onChange={(e) => setTxnBankId(e.target.value)}>
                  <option value="">Select…</option>
                  {(bundle?.bankAccounts || []).map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                </select>
              </label>
              <label className="block text-sm">Amount (rands, signed)
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={txnAmount} onChange={(e) => setTxnAmount(e.target.value)} />
              </label>
              <label className="block text-sm">Description
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={txnDesc} onChange={(e) => setTxnDesc(e.target.value)} />
              </label>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void importTxn()}>Import line</button>
            </div>

            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base">Observe external payment</h2>
              <label className="block text-sm">Direction
                <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={payDirection} onChange={(e) => setPayDirection(e.target.value as 'receipt' | 'disbursement')}>
                  <option value="receipt">Receipt (money in)</option>
                  <option value="disbursement">Disbursement (money out)</option>
                </select>
              </label>
              <label className="block text-sm">Amount (rands)
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              </label>
              <label className="block text-sm">Method
                <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}>
                  <option value="eft">EFT</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="block text-sm">Bank account (optional)
                <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={payBankId} onChange={(e) => setPayBankId(e.target.value)}>
                  <option value="">None</option>
                  {(bundle?.bankAccounts || []).map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
                </select>
              </label>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void observePayment()}>Observe payment</button>
            </div>

            <div className="pib-card space-y-3 p-4">
              <h2 className="text-base">Start reconciliation</h2>
              <label className="block text-sm">Bank account
                <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={reconBankId} onChange={(e) => setReconBankId(e.target.value)}>
                  <option value="">Select…</option>
                  {(bundle?.bankAccounts || []).map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
                </select>
              </label>
              <label className="block text-sm">Opening balance
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={reconOpen} onChange={(e) => setReconOpen(e.target.value)} />
              </label>
              <label className="block text-sm">Closing balance
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={reconClose} onChange={(e) => setReconClose(e.target.value)} />
              </label>
              <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void createRecon()}>Create recon</button>
            </div>
          </section>

          <section className="pib-card space-y-3 p-4">
            <FinanceOperatorTableChrome
              surface="documents"
              density={density}
              onDensityChange={setDensity}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="pib-card p-4">
              <h2 className="mb-3 text-base">Invoices</h2>
              <FinanceResponsiveTable
                ariaLabel="Customer invoices"
                density={density}
                onDensityChange={setDensity}
                rows={(bundle?.invoices || []) as Array<Record<string, any> & { id: string }>}
                getRowLabel={(inv) => String(inv.documentNumber || inv.id)}
                emptyTitle="No customer invoices yet"
                emptyDescription="Create a draft invoice above, then issue when ready. No external payment initiate."
                columns={[
                  {
                    key: 'doc',
                    header: 'Document',
                    render: (inv) => (
                      <span className="font-medium">{inv.documentNumber || inv.id} · {inv.status}</span>
                    ),
                  },
                  {
                    key: 'meta',
                    header: 'Date / amount',
                    render: (inv) => (
                      <span className="text-[var(--color-pib-text-muted)]">
                        {inv.issueDate} · {formatMinor(inv.totalMinor ?? inv.grossMinor, inv.currency || currency)}
                      </span>
                    ),
                  },
                  {
                    key: 'actions',
                    header: 'Actions',
                    render: (inv) =>
                      inv.status === 'draft' ? (
                        <button
                          type="button"
                          className="pib-btn-ghost"
                          disabled={busy}
                          onClick={() => void issueInvoice(inv)}
                        >
                          Issue
                        </button>
                      ) : (
                        '-'
                      ),
                  },
                ]}
              />
            </div>

            <div className="pib-card p-4">
              <h2 className="mb-3 text-base">Payments</h2>
              <FinanceResponsiveTable
                ariaLabel="Observed payments"
                density={density}
                onDensityChange={setDensity}
                rows={(bundle?.payments || []) as Array<Record<string, any> & { id: string }>}
                getRowLabel={(pay) => `${pay.direction} ${pay.id}`}
                emptyTitle="No observed payments yet"
                emptyDescription="Observe an external payment above. Verification never initiates payout."
                columns={[
                  {
                    key: 'dir',
                    header: 'Direction',
                    render: (pay) => (
                      <span className="font-medium">
                        {pay.direction} · {pay.status}
                      </span>
                    ),
                  },
                  {
                    key: 'meta',
                    header: 'Date / amount',
                    render: (pay) => (
                      <span className="text-[var(--color-pib-text-muted)]">
                        {pay.observedDate} · {formatMinor(pay.amountMinor, pay.currency || currency)}
                      </span>
                    ),
                  },
                  {
                    key: 'actions',
                    header: 'Actions',
                    render: (pay) =>
                      pay.status === 'observed' ? (
                        <button
                          type="button"
                          className="pib-btn-ghost"
                          disabled={busy}
                          onClick={() => void verifyPayment(pay)}
                        >
                          Verify
                        </button>
                      ) : (
                        '-'
                      ),
                  },
                ]}
              />
            </div>

            <div className="pib-card p-4">
              <h2 className="mb-3 text-base">Bank transactions</h2>
              <FinanceResponsiveTable
                ariaLabel="Bank transactions"
                density={density}
                onDensityChange={setDensity}
                rows={(bundle?.bankTransactions || []) as Array<Record<string, any> & { id: string }>}
                getRowLabel={(txn) => String(txn.description || txn.id)}
                emptyTitle="No bank transactions yet"
                emptyDescription="Import statement lines to start matching."
                columns={[
                  {
                    key: 'desc',
                    header: 'Description',
                    render: (txn) => <span className="font-medium">{txn.description}</span>,
                  },
                  {
                    key: 'meta',
                    header: 'Date / amount / state',
                    render: (txn) => (
                      <span className="text-[var(--color-pib-text-muted)]">
                        {txn.statementDate} · {formatMinor(txn.amountMinor, currency)} ·{' '}
                        {txn.reconciliationState || 'unmatched'}
                      </span>
                    ),
                  },
                ]}
              />
            </div>

            <div className="pib-card p-4">
              <h2 className="mb-3 text-base">Reconciliations</h2>
              <FinanceResponsiveTable
                ariaLabel="Bank reconciliations"
                density={density}
                onDensityChange={setDensity}
                rows={(bundle?.reconciliations || []) as Array<Record<string, any> & { id: string }>}
                getRowLabel={(recon) => `${recon.status} ${recon.id}`}
                emptyTitle="No reconciliations yet"
                emptyDescription="Start a reconciliation above, then match and submit with SOD approval."
                columns={[
                  {
                    key: 'status',
                    header: 'Status',
                    render: (recon) => (
                      <span className="font-medium">
                        {recon.status} · diff {formatMinor(recon.differenceMinor, currency)}
                      </span>
                    ),
                  },
                  {
                    key: 'window',
                    header: 'Statement window',
                    render: (recon) => (
                      <span className="text-[var(--color-pib-text-muted)]">
                        {recon.statementStartsAt} → {recon.statementEndsAt}
                      </span>
                    ),
                  },
                  {
                    key: 'actions',
                    header: 'Actions',
                    render: (recon) =>
                      recon.status === 'open' || recon.status === 'in_progress' ? (
                        <button
                          type="button"
                          className="pib-btn-ghost"
                          disabled={busy}
                          onClick={() => void submitRecon(recon)}
                        >
                          Submit
                        </button>
                      ) : (
                        '-'
                      ),
                  },
                ]}
              />
            </div>
                    </section>

          <section className="pib-card p-4 text-sm text-[var(--color-pib-text-muted)]">
            Open items: {(bundle?.openItems || []).length}. Match bank lines to payments via API operation <code>reconciliation.match</code>, then submit and approve with foundation approval evidence (SOD). Approval never auto-sends money.
          </section>
        </>
      ) : null}
    </FinanceModuleFrame>
  )
}
