'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { FinanceModuleFrame } from '@/components/finance/FinanceModuleFrame'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'
import { usePortalOrgScope } from '@/lib/portal/usePortalOrgScope'
import {
  formatMinor,
  newFinanceId,
  parseRandsToMinor,
  readFinanceJson,
  requestIdentity,
  todayISODate,
} from '@/components/finance/financeWorkbench'

type Bundle = {
  books: Array<Record<string, any>>
  accounts: Array<Record<string, any>>
  entries: Array<Record<string, any>>
  transfers: Array<Record<string, any>>
  externalPaymentInitiated?: boolean
}

export default function PersonalFinancePage() {
  const orgScope = usePortalOrgScope()
  const orgId = orgScope.orgId || ''

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [bundle, setBundle] = useState<Bundle | null>(null)

  const [bookName, setBookName] = useState('Personal')
  const [accountCode, setAccountCode] = useState('1000')
  const [accountName, setAccountName] = useState('Cash')
  const [accountType, setAccountType] = useState<'asset' | 'income' | 'expense'>('asset')
  const [opening, setOpening] = useState('0.00')

  const [debitAccountId, setDebitAccountId] = useState('')
  const [creditAccountId, setCreditAccountId] = useState('')
  const [entryAmount, setEntryAmount] = useState('100.00')
  const [entryDesc, setEntryDesc] = useState('Personal expense')

  const [selectedBookId, setSelectedBookId] = useState('')
  const [incomeAccountId, setIncomeAccountId] = useState('')
  const [assetAccountId, setAssetAccountId] = useState('')

  const queryUrl = useCallback(() => {
    const q = new URLSearchParams()
    q.set('resource', 'bundle')
    if (orgId) q.set('orgId', orgId)
    return `/api/v1/finance/personal/queries?${q.toString()}`
  }, [orgId])

  const loadBundle = useCallback(async () => {
    if (!orgId) {
      setBundle(null)
      return
    }
    try {
      const res = await fetch(queryUrl(), { credentials: 'include' })
      const body = await readFinanceJson(res)
      const next = (body?.data?.result ?? null) as Bundle | null
      setBundle(next)
      if (next?.books?.[0]?.id) setSelectedBookId((prev) => prev || next.books[0].id)
      const asset = next?.accounts?.find((a) => a.accountType === 'asset')
      const income = next?.accounts?.find((a) => a.accountType === 'income')
      if (asset?.id) {
        setAssetAccountId((prev) => prev || asset.id)
        setDebitAccountId((prev) => prev || asset.id)
      }
      if (income?.id) {
        setIncomeAccountId((prev) => prev || income.id)
        setCreditAccountId((prev) => prev || income.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load personal books')
    }
  }, [orgId, queryUrl])

  useEffect(() => {
    void loadBundle()
  }, [loadBundle])

  async function runCommand(operation: string, command: Record<string, unknown>) {
    const res = await fetch('/api/v1/finance/personal/commands', {
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

  const currency = bundle?.books?.[0]?.currency || 'ZAR'
  const bookAccounts = (bundle?.accounts || []).filter((a) => !selectedBookId || a.bookId === selectedBookId)

  return (
    <FinanceModuleFrame
      active="personal"
      orgScope={orgScope}
      title="Personal books"
      description="Owner-private personal books workspace with strict privacy boundaries."
      error={error}
      message={message}
    >

      {(error || message) && (
        <div className={`pib-card p-4 text-sm ${error ? 'text-red-300' : 'text-emerald-300'}`}>
          {error || message}
        </div>
      )}

      <section className="pib-card p-5 space-y-3">
        <h2 className="text-base">Create personal book</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs block">
            Name
            <input className="pib-input mt-1 block" value={bookName} onChange={(e) => setBookName(e.target.value)} />
          </label>
          <button
            type="button"
            className="pib-btn-primary"
            disabled={busy || !orgId}
            onClick={() =>
              void withBusy(async () => {
                const id = newFinanceId('pbook')
                await runCommand('personal.book.create', {
                  id,
                  name: bookName,
                  currency: 'ZAR',
                  ...requestIdentity('pbook'),
                })
                setSelectedBookId(id)
                setMessage(`Created personal book ${bookName}`)
              })
            }
          >
            Create book
          </button>
        </div>
      </section>

      <section className="pib-card p-5 space-y-3">
        <h2 className="text-base">Accounts</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs block">
            Book
            <select
              className="pib-input mt-1 block"
              value={selectedBookId}
              onChange={(e) => setSelectedBookId(e.target.value)}
            >
              <option value="">Select…</option>
              {(bundle?.books || []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs block">
            Code
            <input className="pib-input mt-1 block" value={accountCode} onChange={(e) => setAccountCode(e.target.value)} />
          </label>
          <label className="text-xs block">
            Name
            <input className="pib-input mt-1 block" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
          </label>
          <label className="text-xs block">
            Type
            <select
              className="pib-input mt-1 block"
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as typeof accountType)}
            >
              <option value="asset">asset</option>
              <option value="income">income</option>
              <option value="expense">expense</option>
            </select>
          </label>
          <label className="text-xs block">
            Opening
            <input className="pib-input mt-1 block" value={opening} onChange={(e) => setOpening(e.target.value)} />
          </label>
          <button
            type="button"
            className="pib-btn-primary"
            disabled={busy || !selectedBookId}
            onClick={() =>
              void withBusy(async () => {
                await runCommand('personal.account.create', {
                  id: newFinanceId('pacc'),
                  bookId: selectedBookId,
                  code: accountCode,
                  name: accountName,
                  accountType,
                  openingBalanceMinor: parseRandsToMinor(opening),
                  ...requestIdentity('pacc'),
                })
                setMessage(`Account ${accountCode} created`)
              })
            }
          >
            Add account
          </button>
        </div>
        <ul className="text-sm space-y-1 text-[var(--color-pib-text-muted)]">
          {bookAccounts.map((a) => (
            <li key={a.id}>
              {a.code} · {a.name} · {a.accountType} · {formatMinor(a.balanceMinor, currency)}
            </li>
          ))}
          {!bookAccounts.length && <li>No accounts yet.</li>}
        </ul>
      </section>

      <section className="pib-card p-5 space-y-3">
        <h2 className="text-base">Post income / expense</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs block">
            Debit account
            <select className="pib-input mt-1 block" value={debitAccountId} onChange={(e) => setDebitAccountId(e.target.value)}>
              <option value="">Select…</option>
              {bookAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs block">
            Credit account
            <select className="pib-input mt-1 block" value={creditAccountId} onChange={(e) => setCreditAccountId(e.target.value)}>
              <option value="">Select…</option>
              {bookAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs block">
            Amount
            <input className="pib-input mt-1 block" value={entryAmount} onChange={(e) => setEntryAmount(e.target.value)} />
          </label>
          <label className="text-xs block">
            Description
            <input className="pib-input mt-1 block" value={entryDesc} onChange={(e) => setEntryDesc(e.target.value)} />
          </label>
          <button
            type="button"
            className="pib-btn-primary"
            disabled={busy || !selectedBookId || !debitAccountId || !creditAccountId}
            onClick={() =>
              void withBusy(async () => {
                const amount = parseRandsToMinor(entryAmount)
                await runCommand('personal.entry.post', {
                  id: newFinanceId('pentry'),
                  bookId: selectedBookId,
                  entryDate: todayISODate(),
                  description: entryDesc,
                  lines: [
                    { accountId: debitAccountId, debitMinor: amount, creditMinor: 0 },
                    { accountId: creditAccountId, debitMinor: 0, creditMinor: amount },
                  ],
                  ...requestIdentity('pentry'),
                })
                setMessage('Entry posted')
              })
            }
          >
            Post entry
          </button>
        </div>
      </section>

      <section className="pib-card p-5 space-y-3">
        <h2 className="text-base">Org → you transfer inbox</h2>
        <p className="text-xs text-[var(--color-pib-text-muted)]">
          Record-only. Accept posts a balanced personal entry. Reject discards. externalPaymentInitiated is always false.
        </p>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs block">
            Income account
            <select className="pib-input mt-1 block" value={incomeAccountId} onChange={(e) => setIncomeAccountId(e.target.value)}>
              <option value="">Select…</option>
              {bookAccounts.filter((a) => a.accountType === 'income').map((a) => (
                <option key={a.id} value={a.id}>{a.code} {a.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs block">
            Asset account
            <select className="pib-input mt-1 block" value={assetAccountId} onChange={(e) => setAssetAccountId(e.target.value)}>
              <option value="">Select…</option>
              {bookAccounts.filter((a) => a.accountType === 'asset').map((a) => (
                <option key={a.id} value={a.id}>{a.code} {a.name}</option>
              ))}
            </select>
          </label>
        </div>
        <ul className="space-y-2 text-sm">
          {(bundle?.transfers || []).map((t) => (
            <li key={t.id} className="rounded border border-white/10 p-3 flex flex-wrap gap-2 items-center justify-between">
              <div>
                <div className="font-medium">{t.description}</div>
                <div className="text-[var(--color-pib-text-muted)]">
                  {formatMinor(t.amountMinor, t.currency || currency)} · {t.status}
                  {t.externalPaymentInitiated ? ' · PAY INITIATED (invalid)' : ' · observe-only'}
                </div>
              </div>
              {t.status === 'proposed' && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="pib-btn-primary"
                    disabled={busy || !selectedBookId || !incomeAccountId || !assetAccountId}
                    onClick={() =>
                      void withBusy(async () => {
                        await runCommand('personal.transfer.accept', {
                          id: t.id,
                          bookId: selectedBookId,
                          incomeAccountId,
                          assetAccountId,
                          ...requestIdentity('ptacc'),
                        })
                        setMessage('Transfer accepted into personal book')
                      })
                    }
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="pib-btn-ghost"
                    disabled={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        await runCommand('personal.transfer.reject', {
                          id: t.id,
                          ...requestIdentity('ptrej'),
                        })
                        setMessage('Transfer rejected')
                      })
                    }
                  >
                    Reject
                  </button>
                </div>
              )}
            </li>
          ))}
          {!bundle?.transfers?.length && <li className="text-[var(--color-pib-text-muted)]">No transfer observations.</li>}
        </ul>
      </section>

      <section className="pib-card p-5">
        <h2 className="text-base mb-2">Recent entries</h2>
        <ul className="text-sm space-y-1 text-[var(--color-pib-text-muted)]">
          {(bundle?.entries || []).slice().reverse().slice(0, 20).map((e) => (
            <li key={e.id}>
              {e.entryDate} · {e.description} · {e.source?.kind}
            </li>
          ))}
          {!bundle?.entries?.length && <li>No entries yet.</li>}
        </ul>
      </section>
    </FinanceModuleFrame>
  )
}