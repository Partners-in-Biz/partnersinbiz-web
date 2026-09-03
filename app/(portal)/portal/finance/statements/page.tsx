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

export default function StatementImportPage() {
  const orgScope = usePortalOrgScope()
  const scope = useFinanceBookScope()
  const orgId = orgScope.orgId || scope.orgId || ''

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [batches, setBatches] = useState<AnyRec[]>([])
  const [lines, setLines] = useState<AnyRec[]>([])
  const [suggestions, setSuggestions] = useState<AnyRec[]>([])
  const [totals, setTotals] = useState({ batches: 0, lines: 0, suggestions: 0 })
  const [lineOffset, setLineOffset] = useState(0)
  const [suggestionOffset, setSuggestionOffset] = useState(0)
  const [lineHasMore, setLineHasMore] = useState(false)
  const [suggestionHasMore, setSuggestionHasMore] = useState(false)
  const [bankAccounts, setBankAccounts] = useState<AnyRec[]>([])
  const [payments, setPayments] = useState<AnyRec[]>([])
  const [bankTxns, setBankTxns] = useState<AnyRec[]>([])

  const LINE_PAGE = 100
  const SUGGESTION_PAGE = 100

  const [bankAccountId, setBankAccountId] = useState('')
  const [format, setFormat] = useState<'auto' | 'csv' | 'ofx' | 'mt940'>('auto')
  const [fileName, setFileName] = useState('statement.csv')
  const [contentText, setContentText] = useState(
    'date,amount,description,reference\n2026-08-01,-250.00,Office rent,RENT-AUG\n2026-08-02,1500.00,Client receipt,INV-100\n',
  )
  const [lastBatchId, setLastBatchId] = useState('')

  const loadBundle = useCallback(async () => {
    if (!orgId) return
    try {
      const q = new URLSearchParams()
      q.set('resource', 'bundle')
      q.set('orgId', orgId)
      if (bankAccountId) q.set('bankAccountId', bankAccountId)
      q.set('lineLimit', String(LINE_PAGE))
      q.set('lineOffset', String(lineOffset))
      q.set('suggestionLimit', String(SUGGESTION_PAGE))
      q.set('suggestionOffset', String(suggestionOffset))
      q.set('batchLimit', '50')
      const res = await fetch(`/api/v1/finance/statements/queries?${q.toString()}`, {
        credentials: 'include',
      })
      const body = await readFinanceJson(res)
      const result = body?.data?.result || {}
      setBatches(result.batches || [])
      setLines(result.lines || [])
      setSuggestions(result.suggestions || [])
      setTotals(result.totals || { batches: 0, lines: 0, suggestions: 0 })
      setLineHasMore(Boolean(result.linePage?.hasMore))
      setSuggestionHasMore(Boolean(result.suggestionPage?.hasMore))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load statement bundle')
    }
  }, [orgId, bankAccountId, lineOffset, suggestionOffset])

  const loadDocuments = useCallback(async () => {
    if (!orgId || !scope.legalEntityId || !scope.bookId) return
    try {
      const q = new URLSearchParams()
      q.set('resource', 'bundle')
      q.set('orgId', orgId)
      q.set('legalEntityId', scope.legalEntityId)
      q.set('bookId', scope.bookId)
      const res = await fetch(`/api/v1/finance/documents/queries?${q.toString()}`, {
        credentials: 'include',
      })
      const body = await readFinanceJson(res)
      const result = body?.data?.result || {}
      const accounts = result.bankAccounts || []
      setBankAccounts(accounts)
      setPayments(result.payments || [])
      setBankTxns(result.bankTransactions || [])
      if (!bankAccountId && accounts[0]?.id) setBankAccountId(accounts[0].id)
    } catch {
      // documents scope may be empty until setup
    }
  }, [orgId, scope.legalEntityId, scope.bookId, bankAccountId])

  useEffect(() => {
    void loadBundle()
    void loadDocuments()
  }, [loadBundle, loadDocuments])

  async function runCommand(operation: string, command: Record<string, unknown>) {
    const res = await fetch('/api/v1/finance/statements/commands', {
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
      await loadDocuments()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  async function onFile(file: File | null) {
    if (!file) return
    setFileName(file.name)
    const text = await file.text()
    setContentText(text)
  }

  async function parseOnly() {
    await withBusy(async () => {
      if (!bankAccountId) throw new Error('Select a bank account')
      if (!scope.legalEntityId || !scope.bookId) throw new Error('Select legal entity and book')
      const id = newFinanceId('sib')
      const ids = requestIdentity('stmt')
      const body = await runCommand('statement.import.parse', {
        id,
        legalEntityId: scope.legalEntityId,
        bookId: scope.bookId,
        bankAccountId,
        fileName,
        contentText,
        format,
        ...ids,
      })
      const batch = body?.data?.result?.batch
      setLastBatchId(batch?.id || id)
      setMessage(`Parsed ${batch?.lineCount ?? 0} lines (${batch?.format}) - not yet imported`)
    })
  }

  async function parseAndApply() {
    await withBusy(async () => {
      if (!bankAccountId) throw new Error('Select a bank account')
      if (!scope.legalEntityId || !scope.bookId) throw new Error('Select legal entity and book')
      const id = newFinanceId('sib')
      const parseIds = requestIdentity('stmt_parse')
      await runCommand('statement.import.parse', {
        id,
        legalEntityId: scope.legalEntityId,
        bookId: scope.bookId,
        bankAccountId,
        fileName,
        contentText,
        format,
        ...parseIds,
      })
      const applyIds = requestIdentity('stmt_apply')
      const body = await runCommand('statement.import.apply', {
        id,
        ...applyIds,
      })
      const batch = body?.data?.result?.batch
      setLastBatchId(id)
      setMessage(
        `Applied batch ${id}: imported ${batch?.importedCount ?? 0}, duplicates ${batch?.skippedDuplicateCount ?? 0}, errors ${batch?.errorCount ?? 0}`,
      )
    })
  }

  async function applyExisting() {
    await withBusy(async () => {
      const id = lastBatchId || batches[0]?.id
      if (!id) throw new Error('No batch to apply')
      const ids = requestIdentity('stmt')
      const body = await runCommand('statement.import.apply', { id, ...ids })
      const batch = body?.data?.result?.batch
      setMessage(
        `Applied batch ${id}: imported ${batch?.importedCount ?? 0}, duplicates ${batch?.skippedDuplicateCount ?? 0}`,
      )
    })
  }

  async function generateSuggestions() {
    await withBusy(async () => {
      if (!bankAccountId) throw new Error('Select a bank account')
      if (!scope.legalEntityId || !scope.bookId) throw new Error('Select legal entity and book')
      const ids = requestIdentity('stmt')
      const body = await runCommand('recon.suggestion.generate', {
        idPrefix: newFinanceId('rsg'),
        legalEntityId: scope.legalEntityId,
        bookId: scope.bookId,
        bankAccountId,
        bankTransactions: bankTxns,
        payments,
        ...ids,
      })
      const count = body?.data?.result?.suggestions?.length ?? 0
      setMessage(`Generated ${count} suggestion(s). Nothing auto-posted.`)
    })
  }

  async function resolveSuggestion(id: string, op: 'recon.suggestion.accept' | 'recon.suggestion.dismiss') {
    await withBusy(async () => {
      const ids = requestIdentity('stmt')
      await runCommand(op, {
        id,
        resolutionNote: op.endsWith('accept') ? 'Human accepted suggestion' : 'Human dismissed suggestion',
        ...ids,
      })
      setMessage(`${op.includes('accept') ? 'Accepted' : 'Dismissed'} ${id} (still no auto-post)`)
    })
  }

  return (
    <FinanceModuleFrame
      active="statements"
      orgScope={scope.orgScope}
      title="Statement import"
      description="Bank statement import and human-gated reconciliation suggestions."
      error={error || scope.error}
      message={message || scope.message}
      loading={scope.loading}
    >
      <FinanceScopeBar scope={scope} />

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={scopedPortalPath('/portal/finance', orgScope)} className="pib-btn-ghost">
          Finance hub
        </Link>
        <Link href={scopedPortalPath('/portal/finance/documents', orgScope)} className="pib-btn-ghost">
          Documents & recon
        </Link>
      </div>

      {error && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {message && (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</div>
      )}

      <section className="grid gap-4 border border-zinc-200 bg-white p-4 shadow-sm md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="">Import statement file</h2>
          <label className="block text-sm">
            Bank account
            <select
              className="mt-1 w-full rounded border px-2 py-1"
              value={bankAccountId}
              onChange={(e) => {
                setBankAccountId(e.target.value)
                setLineOffset(0)
                setSuggestionOffset(0)
              }}
            >
              <option value="">Select…</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code || a.id} - {a.name || 'account'}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Format
            <select
              className="mt-1 w-full rounded border px-2 py-1"
              value={format}
              onChange={(e) => setFormat(e.target.value as typeof format)}
            >
              <option value="auto">Auto-detect</option>
              <option value="csv">CSV</option>
              <option value="ofx">OFX</option>
              <option value="mt940">MT940</option>
            </select>
          </label>
          <label className="block text-sm">
            File
            <input
              type="file"
              accept=".csv,.ofx,.qfx,.txt,.sta,.mt940,*"
              className="mt-1 block w-full text-sm"
              onChange={(e) => void onFile(e.target.files?.[0] || null)}
            />
          </label>
          <label className="block text-sm">
            Content
            <textarea
              className="mt-1 h-40 w-full rounded border px-2 py-1 font-mono text-xs"
              value={contentText}
              onChange={(e) => setContentText(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="pib-btn" disabled={busy} onClick={() => void parseOnly()}>
              Parse only
            </button>
            <button type="button" className="pib-btn" disabled={busy} onClick={() => void parseAndApply()}>
              Parse + import lines
            </button>
            <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void applyExisting()}>
              Apply last batch
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            Import writes immutable bank_transaction observations only. externalPaymentInitiated stays false.
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="">Agent recon suggestions</h2>
          <p className="text-sm text-zinc-600">
            Suggestions never auto-match or auto-post. Accept/dismiss records human intent only.
          </p>
          <button type="button" className="pib-btn" disabled={busy} onClick={() => void generateSuggestions()}>
            Generate suggestions for unmatched lines
          </button>
          <div className="max-h-80 space-y-2 overflow-auto">
            {suggestions.length === 0 && <p className="text-sm text-zinc-500">No suggestions yet.</p>}
            {suggestions.map((s) => (
              <div key={s.id} className="rounded border border-zinc-200 p-2 text-sm">
                <div className="font-medium">
                  {s.kind} · {s.status} · conf {(Number(s.confidence) * 100).toFixed(0)}%
                </div>
                <div className="text-zinc-600">{s.reason}</div>
                <div className="text-xs text-zinc-500">
                  txn {s.bankTransactionId}
                  {s.suggestedPaymentId ? ` → payment ${s.suggestedPaymentId}` : ''}
                  {s.proposedExpenseAmountMinor != null
                    ? ` · expense ${formatMinor(s.proposedExpenseAmountMinor)}`
                    : ''}
                </div>
                {s.status === 'pending' && (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="pib-btn-ghost text-xs"
                      disabled={busy}
                      onClick={() => void resolveSuggestion(s.id, 'recon.suggestion.accept')}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="pib-btn-ghost text-xs"
                      disabled={busy}
                      onClick={() => void resolveSuggestion(s.id, 'recon.suggestion.dismiss')}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>
              Showing {suggestions.length} of {totals.suggestions} suggestions
            </span>
            <button
              type="button"
              className="pib-btn-ghost text-xs"
              disabled={busy || suggestionOffset === 0}
              onClick={() => setSuggestionOffset((o) => Math.max(0, o - SUGGESTION_PAGE))}
            >
              Prev
            </button>
            <button
              type="button"
              className="pib-btn-ghost text-xs"
              disabled={busy || !suggestionHasMore}
              onClick={() => setSuggestionOffset((o) => o + SUGGESTION_PAGE)}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="border border-zinc-200 bg-white p-4">
          <h3 className="mb-2">Batches</h3>
          <ul className="space-y-2 text-sm">
            {batches.map((b) => (
              <li key={b.id} className="rounded border px-2 py-1">
                <div className="font-medium">
                  {b.fileName} · {b.status} · {b.format}
                </div>
                <div className="text-xs text-zinc-500">
                  {b.id} · lines {b.lineCount} · imported {b.importedCount} · dup {b.skippedDuplicateCount}
                </div>
              </li>
            ))}
            {batches.length === 0 && <li className="text-zinc-500">No batches yet.</li>}
          </ul>
        </div>
        <div className="border border-zinc-200 bg-white p-4">
          <h3 className="mb-2">Parsed / imported lines</h3>
          <p className="mb-2 text-xs text-zinc-500">
            Showing {lines.length} of {totals.lines} (paged server-side - large imports do not dump 10k rows into the DOM)
          </p>
          <ul className="max-h-72 space-y-1 overflow-auto text-xs">
            {lines.map((l) => (
              <li key={l.id} className="border-b border-zinc-100 py-1">
                #{l.lineIndex} {l.statementDate} {formatMinor(l.amountMinor)} {l.description} · {l.importStatus}
              </li>
            ))}
            {lines.length === 0 && <li className="text-zinc-500">No lines yet.</li>}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="pib-btn-ghost text-xs"
              disabled={busy || lineOffset === 0}
              onClick={() => setLineOffset((o) => Math.max(0, o - LINE_PAGE))}
            >
              Prev page
            </button>
            <button
              type="button"
              className="pib-btn-ghost text-xs"
              disabled={busy || !lineHasMore}
              onClick={() => setLineOffset((o) => o + LINE_PAGE)}
            >
              Next page
            </button>
          </div>
        </div>
      </section>
    </FinanceModuleFrame>
  )
}