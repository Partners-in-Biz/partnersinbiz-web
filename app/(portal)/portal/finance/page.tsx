'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

type LegalEntity = {
  id: string
  code: string
  legalName: string
  status: string
  jurisdictionCode: string
  functionalCurrency: string
}

type AccountingBook = {
  id: string
  code: string
  name: string
  status: string
  bookType: string
  accountingBasis: string
  functionalCurrency: string
  cutoverAt?: string
}

type AccountingPeriod = {
  id: string
  fiscalYear: number
  periodNumber: number
  startsAt: string
  endsAt: string
  status: string
}

type LedgerAccount = {
  id: string
  code: string
  name: string
  accountType: string
  normalBalance: string
}

type PostedJournal = {
  id: string
  entryNumber?: number
  description: string
  status: string
  postingDate: string
  totalDebitMinor?: number
  totalCreditMinor?: number
  currency?: string
}

type RoleAssignment = {
  id: string
  legalEntityId: string
  bookId?: string
  role: string
  scopeMode: string
  status: string
}

function newId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
  }
  return `${prefix}_${Date.now().toString(36)}`
}

function formatMinor(amount: number | undefined, currency = 'ZAR') {
  if (typeof amount !== 'number') return '—'
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100)
}

async function readJson(res: Response) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`
    throw new Error(message)
  }
  return body
}

export default function FinanceWorkbenchPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const orgId = orgScope.orgId || ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<RoleAssignment[]>([])
  const [entities, setEntities] = useState<LegalEntity[]>([])
  const [books, setBooks] = useState<AccountingBook[]>([])
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [accounts, setAccounts] = useState<LedgerAccount[]>([])
  const [journals, setJournals] = useState<PostedJournal[]>([])
  const [selectedEntityId, setSelectedEntityId] = useState('')
  const [selectedBookId, setSelectedBookId] = useState('')
  const [busy, setBusy] = useState(false)

  const [setupCode, setSetupCode] = useState('MAIN')
  const [setupName, setSetupName] = useState('Primary legal entity')
  const [setupCurrency, setSetupCurrency] = useState('ZAR')
  const [setupJurisdiction, setSetupJurisdiction] = useState('ZA')
  const [setupBasis, setSetupBasis] = useState<'accrual' | 'cash'>('accrual')

  const queryPath = useCallback((resource: string, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ resource, ...extra })
    if (orgId) params.set('orgId', orgId)
    return scopedApiPath(`/api/v1/finance/foundation/queries?${params.toString()}`, orgScope)
  }, [orgId, orgScope])

  const commandPath = useMemo(
    () => scopedApiPath('/api/v1/finance/foundation/commands', orgScope),
    [orgScope],
  )

  const refreshCore = useCallback(async () => {
    if (!orgId) {
      setError('Select an organisation workspace before opening Finance.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [assignRes, entityRes] = await Promise.all([
        fetch(queryPath('assignments.me'), { credentials: 'include' }),
        fetch(queryPath('legal-entities'), { credentials: 'include' }),
      ])
      const assignBody = await readJson(assignRes)
      const entityBody = await readJson(entityRes)
      const nextAssignments = (assignBody?.data?.result ?? []) as RoleAssignment[]
      const nextEntities = (entityBody?.data?.result ?? []) as LegalEntity[]
      setAssignments(nextAssignments)
      setEntities(nextEntities)
      const preferredEntity = selectedEntityId && nextEntities.some((e) => e.id === selectedEntityId)
        ? selectedEntityId
        : nextEntities[0]?.id || nextAssignments[0]?.legalEntityId || ''
      setSelectedEntityId(preferredEntity)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load finance workbench')
    } finally {
      setLoading(false)
    }
  }, [orgId, queryPath, selectedEntityId])

  const refreshScope = useCallback(async (entityId: string, bookId?: string) => {
    if (!orgId || !entityId) {
      setBooks([])
      setPeriods([])
      setAccounts([])
      setJournals([])
      return
    }
    try {
      const booksRes = await fetch(queryPath('books', { legalEntityId: entityId }), { credentials: 'include' })
      const booksBody = await readJson(booksRes)
      const nextBooks = (booksBody?.data?.result ?? []) as AccountingBook[]
      setBooks(nextBooks)
      const preferredBook = bookId && nextBooks.some((b) => b.id === bookId)
        ? bookId
        : selectedBookId && nextBooks.some((b) => b.id === selectedBookId)
          ? selectedBookId
          : nextBooks[0]?.id || ''
      setSelectedBookId(preferredBook)
      if (!preferredBook) {
        setPeriods([])
        setAccounts([])
        setJournals([])
        return
      }
      const [periodsRes, accountsRes, journalsRes] = await Promise.all([
        fetch(queryPath('periods', { legalEntityId: entityId, bookId: preferredBook }), { credentials: 'include' }),
        fetch(queryPath('accounts', { legalEntityId: entityId, bookId: preferredBook }), { credentials: 'include' }),
        fetch(queryPath('journals', { legalEntityId: entityId, bookId: preferredBook, limit: '25' }), { credentials: 'include' }),
      ])
      const periodsBody = await readJson(periodsRes)
      const accountsBody = await readJson(accountsRes)
      const journalsBody = await readJson(journalsRes)
      setPeriods((periodsBody?.data?.result ?? []) as AccountingPeriod[])
      setAccounts((accountsBody?.data?.result ?? []) as LedgerAccount[])
      setJournals((journalsBody?.data?.result ?? []) as PostedJournal[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load book scope')
    }
  }, [orgId, queryPath, selectedBookId])

  useEffect(() => {
    void refreshCore()
  }, [refreshCore])

  useEffect(() => {
    if (selectedEntityId) void refreshScope(selectedEntityId)
  }, [selectedEntityId, refreshScope])

  async function runCommand(operation: string, command: Record<string, unknown>) {
    const res = await fetch(commandPath, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(orgId ? { 'X-Org-Id': orgId } : {}),
      },
      body: JSON.stringify({ operation, command: { ...command, orgId } }),
    })
    const body = await readJson(res)
    return body?.data?.result
  }

  async function bootstrapEntity() {
    if (!orgId) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const entityId = newId('le')
      const assignmentId = newId('fra')
      const bookId = newId('book')
      const requestBase = newId('req')
      await runCommand('role-assignment.bootstrap', {
        id: assignmentId,
        legalEntityId: entityId,
        role: 'finance_admin',
        scopeMode: 'entity',
        requestId: `${requestBase}_assign`,
        idempotencyKey: `${requestBase}_assign`,
      })
      await runCommand('legal-entity.create', {
        id: entityId,
        code: setupCode,
        legalName: setupName,
        jurisdictionCode: setupJurisdiction,
        functionalCurrency: setupCurrency,
        defaultAccountingBasis: setupBasis,
        fiscalYearStartMonth: 3,
        timezone: 'Africa/Johannesburg',
        status: 'active',
        expectedVersion: 0,
        requestId: `${requestBase}_entity`,
        idempotencyKey: `${requestBase}_entity`,
      })
      await runCommand('book.create', {
        id: bookId,
        legalEntityId: entityId,
        code: 'PRIMARY',
        name: 'Primary book',
        bookType: 'primary',
        functionalCurrency: setupCurrency,
        accountingBasis: setupBasis,
        jurisdictionCode: setupJurisdiction,
        taxPointPolicyId: 'za-default-v1',
        defaultControlAccountIds: {},
        status: 'active',
        expectedVersion: 0,
        requestId: `${requestBase}_book`,
        idempotencyKey: `${requestBase}_book`,
      })
      setMessage('Legal entity and primary book created. Add chart accounts, periods, and journals next.')
      setSelectedEntityId(entityId)
      setSelectedBookId(bookId)
      await refreshCore()
      await refreshScope(entityId, bookId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bootstrap failed')
    } finally {
      setBusy(false)
    }
  }

  const selectedEntity = entities.find((entity) => entity.id === selectedEntityId)
  const selectedBook = books.find((book) => book.id === selectedBookId)

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Finance module"
        title="Finance workbench"
        description="Multi-entity books, double-entry ledger foundation, periods, and audit-ready journal postings. Operational billing remains under Invoicing and Payments."
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link href={scopedPortalPath('/portal/invoicing', orgScope)} className="pib-btn-ghost">Invoicing</Link>
            <Link href={scopedPortalPath('/portal/payments', orgScope)} className="pib-btn-ghost">Payments</Link>
            <Link href={scopedPortalPath('/portal/billing', orgScope)} className="pib-btn-ghost">Billing hub</Link>
          </div>
        )}
      />

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{message}</div>
      ) : null}

      {loading ? (
        <div className="pib-card p-6 text-sm text-[var(--color-pib-text-muted)]">Loading finance foundation…</div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <div className="pib-stat-card">
              <p className="pib-label">Legal entities</p>
              <p className="mt-3 text-2xl font-semibold">{entities.length}</p>
            </div>
            <div className="pib-stat-card">
              <p className="pib-label">Books</p>
              <p className="mt-3 text-2xl font-semibold">{books.length}</p>
            </div>
            <div className="pib-stat-card">
              <p className="pib-label">Open periods</p>
              <p className="mt-3 text-2xl font-semibold">{periods.filter((p) => p.status === 'open').length}</p>
            </div>
            <div className="pib-stat-card">
              <p className="pib-label">Chart accounts</p>
              <p className="mt-3 text-2xl font-semibold">{accounts.length}</p>
            </div>
          </section>

          {entities.length === 0 ? (
            <section className="pib-card space-y-4 p-6">
              <div>
                <h2 className="text-lg font-semibold">Bootstrap your first legal entity</h2>
                <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
                  Owner/admin bootstrap creates your finance_admin assignment, legal entity, and primary book.
                  No payments, SARS submissions, or production cutover happen from this screen.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                  Entity code
                  <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} />
                </label>
                <label className="text-sm">
                  Legal name
                  <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={setupName} onChange={(e) => setSetupName(e.target.value)} />
                </label>
                <label className="text-sm">
                  Currency
                  <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={setupCurrency} onChange={(e) => setSetupCurrency(e.target.value.toUpperCase())} />
                </label>
                <label className="text-sm">
                  Jurisdiction
                  <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={setupJurisdiction} onChange={(e) => setSetupJurisdiction(e.target.value.toUpperCase())} />
                </label>
                <label className="text-sm">
                  Accounting basis
                  <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={setupBasis} onChange={(e) => setSetupBasis(e.target.value as 'accrual' | 'cash')}>
                    <option value="accrual">Accrual</option>
                    <option value="cash">Cash</option>
                  </select>
                </label>
              </div>
              <button type="button" className="pib-btn-primary" disabled={busy || !orgId} onClick={() => void bootstrapEntity()}>
                {busy ? 'Creating…' : 'Create legal entity + primary book'}
              </button>
            </section>
          ) : (
            <section className="grid gap-4 lg:grid-cols-[240px_1fr]">
              <div className="pib-card space-y-3 p-4">
                <p className="pib-label">Scope</p>
                <label className="block text-sm">
                  Legal entity
                  <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={selectedEntityId} onChange={(e) => setSelectedEntityId(e.target.value)}>
                    {entities.map((entity) => (
                      <option key={entity.id} value={entity.id}>{entity.code} — {entity.legalName}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Book
                  <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={selectedBookId} onChange={(e) => { setSelectedBookId(e.target.value); if (selectedEntityId) void refreshScope(selectedEntityId, e.target.value) }}>
                    {books.map((book) => (
                      <option key={book.id} value={book.id}>{book.code} — {book.name}</option>
                    ))}
                  </select>
                </label>
                <div className="rounded-lg border border-[var(--color-pib-line)] p-3 text-xs text-[var(--color-pib-text-muted)]">
                  <p><span className="font-medium text-[var(--color-pib-text)]">Entity:</span> {selectedEntity?.status ?? '—'}</p>
                  <p className="mt-1"><span className="font-medium text-[var(--color-pib-text)]">Book:</span> {selectedBook?.status ?? '—'} · {selectedBook?.accountingBasis ?? '—'}</p>
                  <p className="mt-1"><span className="font-medium text-[var(--color-pib-text)]">Assignments:</span> {assignments.length}</p>
                </div>
                <div className="space-y-2 pt-2">
                  <Link href={scopedPortalPath('/portal/finance/ledger', orgScope)} className="pib-btn-ghost w-full justify-center">Ledger detail</Link>
                  <Link href={scopedPortalPath('/portal/finance/setup', orgScope)} className="pib-btn-ghost w-full justify-center">Setup guide</Link>
                  <Link href={scopedPortalPath('/portal/finance/reports', orgScope)} className="pib-btn-ghost w-full justify-center">Financial reports</Link>
                  <Link href={scopedPortalPath('/portal/finance/tax', orgScope)} className="pib-btn-ghost w-full justify-center">Tax</Link>
                  <Link href={scopedPortalPath('/portal/finance/documents', orgScope)} className="pib-btn-ghost w-full justify-center">Documents & recon</Link>
                  <Link href={scopedPortalPath('/portal/finance/intercompany', orgScope)} className="pib-btn-ghost w-full justify-center">Intercompany</Link>
                  <Link href={scopedPortalPath('/portal/finance/payroll', orgScope)} className="pib-btn-ghost w-full justify-center">Payroll</Link>
                  <Link href={scopedPortalPath('/portal/finance/personal', orgScope)} className="pib-btn-ghost w-full justify-center">Personal books</Link>
                </div>
              </div>

              <div className="space-y-4">
                <div className="pib-card p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold">Accounting periods</h2>
                    <span className="text-xs text-[var(--color-pib-text-muted)]">{periods.length} total</span>
                  </div>
                  {periods.length === 0 ? (
                    <p className="text-sm text-[var(--color-pib-text-muted)]">No periods yet. Create periods through the foundation commands API or follow Setup.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-left text-[var(--color-pib-text-muted)]">
                            <th className="py-2 pr-3">FY</th>
                            <th className="py-2 pr-3">Period</th>
                            <th className="py-2 pr-3">Start</th>
                            <th className="py-2 pr-3">End</th>
                            <th className="py-2">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {periods.map((period) => (
                            <tr key={period.id} className="border-t border-[var(--color-pib-line)]">
                              <td className="py-2 pr-3">{period.fiscalYear}</td>
                              <td className="py-2 pr-3">{period.periodNumber}</td>
                              <td className="py-2 pr-3">{period.startsAt.slice(0, 10)}</td>
                              <td className="py-2 pr-3">{period.endsAt.slice(0, 10)}</td>
                              <td className="py-2"><span className="pib-pill">{period.status}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="pib-card p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h2 className="text-base font-semibold">Chart of accounts</h2>
                      <span className="text-xs text-[var(--color-pib-text-muted)]">{accounts.length}</span>
                    </div>
                    {accounts.length === 0 ? (
                      <p className="text-sm text-[var(--color-pib-text-muted)]">No accounts in this book yet.</p>
                    ) : (
                      <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
                        {accounts.map((account) => (
                          <li key={account.id} className="flex items-start justify-between gap-3 border-b border-[var(--color-pib-line)] pb-2">
                            <div>
                              <p className="font-medium">{account.code} · {account.name}</p>
                              <p className="text-xs text-[var(--color-pib-text-muted)]">{account.accountType} · {account.normalBalance}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="pib-card p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h2 className="text-base font-semibold">Recent journals</h2>
                      <span className="text-xs text-[var(--color-pib-text-muted)]">{journals.length}</span>
                    </div>
                    {journals.length === 0 ? (
                      <p className="text-sm text-[var(--color-pib-text-muted)]">No posted journals yet. Posting remains approval-gated and append-only.</p>
                    ) : (
                      <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
                        {journals.map((journal) => (
                          <li key={journal.id} className="border-b border-[var(--color-pib-line)] pb-2">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium">#{journal.entryNumber ?? '—'} · {journal.description}</p>
                                <p className="text-xs text-[var(--color-pib-text-muted)]">{journal.postingDate?.slice(0, 10)} · {journal.status}</p>
                              </div>
                              <p className="text-xs font-medium">{formatMinor(journal.totalDebitMinor, journal.currency)}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="pib-card p-4">
                  <h2 className="text-base font-semibold">Module status</h2>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {[
                      { title: 'Foundation ledger', status: 'Live UI', body: 'Legal entities, books, periods, accounts, journals, reversals, audit.' },
                      { title: 'Ledger reports', status: 'Live UI', body: 'Run trial balance, income statement, and balance sheet over posted journals.' },
                      { title: 'VAT / tax returns', status: 'Live UI', body: 'Tax codes, periods, calculate, and return prepare/approve with no SARS egress.' },
                      { title: 'AR/AP + reconciliation', status: 'Live UI', body: 'Invoices, payments, bank import, and reconciliation actions on /portal/finance/documents.' },
                      { title: 'Intercompany', status: 'Live UI', body: 'Pairs, propose/receive confirm, eliminations, and consolidation visibility.' },
                      { title: 'ZA payroll + statutory', status: 'Live UI', body: 'Employees, calcs, pay runs, payslip-by-id; no bank pay or SARS submit.' },
                      { title: 'Operational billing', status: 'Live', body: 'Existing invoicing and payments stay at their current portal routes.' },
                    ].map((item) => (
                      <div key={item.title} className="rounded-xl border border-[var(--color-pib-line)] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{item.title}</p>
                          <span className="pib-pill pib-pill-cyan">{item.status}</span>
                        </div>
                        <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">{item.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
