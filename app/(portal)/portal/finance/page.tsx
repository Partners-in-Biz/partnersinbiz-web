'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/studio'
import { Surface } from '@/components/ui/AppFoundation'
import { StatCard } from '@/components/ui/StatCard'
import { HudChip } from '@/components/ui/HudChip'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ThemedSelect } from '@/components/ui/ThemedSelect'
import { scopedApiPath, scopedPortalPath } from '@/lib/portal/scoped-routing'
import { usePortalOrgScope } from '@/lib/portal/usePortalOrgScope'
import {
  formatMinor,
  newFinanceId,
  readFinanceJson,
  type AccountingBook,
  type LegalEntity,
} from '@/components/finance/financeWorkbench'
import { FinanceModuleFrame } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import { FinanceHubCommandRail } from '@/components/finance/FinanceHubCommandRail'
import { FinanceRoleHubModules } from '@/components/finance/FinanceRoleHubModules'
import { FinanceGuidedWorkflowStepper } from '@/components/finance/FinanceGuidedWorkflowStepper'
import {
  buildFinanceHubSnapshot,
  formatHubMoney,
  type AgingBucket,
  type FinanceHubSnapshot,
} from '@/components/finance/financeHubMetrics'
import { FINANCE_NAV } from '@/components/finance/financeRoutes'
import {
  buildRoleHubModules,
  resolveFinancePersona,
} from '@/lib/finance/role-ux/catalog'
import type { FinancePersona, FinanceRoleUxContext } from '@/lib/finance/role-ux/types'
import type { FinanceRole } from '@/lib/finance/types'

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

function AgingTable({
  title,
  buckets,
  currency,
  totalMinor,
}: {
  title: string
  buckets: AgingBucket[]
  currency: string
  totalMinor: number
}) {
  return (
    <Card className="p-4" data-testid={`finance-aging-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm text-[var(--color-pib-text)]">{title}</h2>
        <HudChip tone="accent">{formatHubMoney(totalMinor, currency)}</HudChip>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--color-pib-text-muted)]">
              <th className="py-1.5 pr-3 font-medium">Bucket</th>
              <th className="py-1.5 pr-3 font-medium">Count</th>
              <th className="py-1.5 font-medium">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.key} className="border-t border-[var(--color-pib-line)]">
                <td className="py-1.5 pr-3">{bucket.label}</td>
                <td className="py-1.5 pr-3 tabular-nums">{bucket.count}</td>
                <td className="py-1.5 tabular-nums">{formatHubMoney(bucket.amountMinor, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export default function FinanceCommandCentrePage() {
  const orgScope = usePortalOrgScope()
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
  const [snapshot, setSnapshot] = useState<FinanceHubSnapshot>(() => buildFinanceHubSnapshot({}))
  const [personaOverride, setPersonaOverride] = useState<FinancePersona | null>(null)

  const [setupCode, setSetupCode] = useState('MAIN')
  const [setupName, setSetupName] = useState('Primary legal entity')
  const [setupCurrency, setSetupCurrency] = useState('ZAR')
  const [setupJurisdiction, setSetupJurisdiction] = useState('ZA')
  const [setupBasis, setSetupBasis] = useState<'accrual' | 'cash'>('accrual')

  const queryPath = useCallback(
    (resource: string, extra: Record<string, string> = {}) => {
      const params = new URLSearchParams({ resource, ...extra })
      if (orgId) params.set('orgId', orgId)
      return scopedApiPath(`/api/v1/finance/foundation/queries?${params.toString()}`, orgScope)
    },
    [orgId, orgScope],
  )

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
      const assignBody = await readFinanceJson(assignRes)
      const entityBody = await readFinanceJson(entityRes)
      const nextAssignments = (assignBody?.data?.result ?? []) as RoleAssignment[]
      const nextEntities = (entityBody?.data?.result ?? []) as LegalEntity[]
      setAssignments(nextAssignments)
      setEntities(nextEntities)
      const preferredEntity =
        selectedEntityId && nextEntities.some((e) => e.id === selectedEntityId)
          ? selectedEntityId
          : nextEntities[0]?.id || nextAssignments[0]?.legalEntityId || ''
      setSelectedEntityId(preferredEntity)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load finance command centre')
    } finally {
      setLoading(false)
    }
  }, [orgId, queryPath, selectedEntityId])

  const refreshScope = useCallback(
    async (entityId: string, bookId?: string) => {
      if (!orgId || !entityId) {
        setBooks([])
        setPeriods([])
        setAccounts([])
        setJournals([])
        setSnapshot(buildFinanceHubSnapshot({}))
        return
      }
      try {
        const booksRes = await fetch(queryPath('books', { legalEntityId: entityId }), {
          credentials: 'include',
        })
        const booksBody = await readFinanceJson(booksRes)
        const nextBooks = (booksBody?.data?.result ?? []) as AccountingBook[]
        setBooks(nextBooks)
        const preferredBook =
          bookId && nextBooks.some((b) => b.id === bookId)
            ? bookId
            : selectedBookId && nextBooks.some((b) => b.id === selectedBookId)
              ? selectedBookId
              : nextBooks[0]?.id || ''
        setSelectedBookId(preferredBook)
        if (!preferredBook) {
          setPeriods([])
          setAccounts([])
          setJournals([])
          setSnapshot(buildFinanceHubSnapshot({ currency: nextBooks[0]?.functionalCurrency || 'ZAR' }))
          return
        }

        const [periodsRes, accountsRes, journalsRes, docsRes, payrollRes, taxRes, packRes] =
          await Promise.all([
            fetch(queryPath('periods', { legalEntityId: entityId, bookId: preferredBook }), {
              credentials: 'include',
            }),
            fetch(queryPath('accounts', { legalEntityId: entityId, bookId: preferredBook }), {
              credentials: 'include',
            }),
            fetch(
              queryPath('journals', { legalEntityId: entityId, bookId: preferredBook, limit: '25' }),
              { credentials: 'include' },
            ),
            fetch(
              scopedApiPath(
                `/api/v1/finance/documents/queries?${new URLSearchParams({
                  resource: 'bundle',
                  orgId,
                  legalEntityId: entityId,
                  bookId: preferredBook,
                }).toString()}`,
                orgScope,
              ),
              { credentials: 'include' },
            ),
            fetch(
              scopedApiPath(
                `/api/v1/finance/payroll/queries?${new URLSearchParams({
                  resource: 'bundle',
                  orgId,
                  legalEntityId: entityId,
                  bookId: preferredBook,
                }).toString()}`,
                orgScope,
              ),
              { credentials: 'include' },
            ),
            fetch(
              scopedApiPath(
                `/api/v1/finance/tax/queries?${new URLSearchParams({
                  resource: 'bundle',
                  orgId,
                  legalEntityId: entityId,
                  bookId: preferredBook,
                }).toString()}`,
                orgScope,
              ),
              { credentials: 'include' },
            ),
            fetch(
              scopedApiPath(
                `/api/v1/finance/packaging/queries?${new URLSearchParams({
                  resource: 'bundle',
                  orgId,
                  legalEntityId: entityId,
                  bookId: preferredBook,
                }).toString()}`,
                orgScope,
              ),
              { credentials: 'include' },
            ),
          ])

        const periodsBody = await readFinanceJson(periodsRes)
        const accountsBody = await readFinanceJson(accountsRes)
        const journalsBody = await readFinanceJson(journalsRes)
        const nextPeriods = (periodsBody?.data?.result ?? []) as AccountingPeriod[]
        setPeriods(nextPeriods)
        setAccounts((accountsBody?.data?.result ?? []) as LedgerAccount[])
        setJournals((journalsBody?.data?.result ?? []) as PostedJournal[])

        const currency =
          nextBooks.find((book) => book.id === preferredBook)?.functionalCurrency || 'ZAR'

        let openItems: unknown[] = []
        let bankAccounts: unknown[] = []
        let payRuns: unknown[] = []
        let taxReturns: unknown[] = []
        let packagingPacks: unknown[] = []

        if (docsRes.ok) {
          const docsBody = await docsRes.json().catch(() => ({}))
          const bundle = docsBody?.data?.result ?? {}
          openItems = bundle.openItems ?? []
          bankAccounts = bundle.bankAccounts ?? []
        }
        if (payrollRes.ok) {
          const payrollBody = await payrollRes.json().catch(() => ({}))
          payRuns = payrollBody?.data?.result?.payRuns ?? []
        }
        if (taxRes.ok) {
          const taxBody = await taxRes.json().catch(() => ({}))
          taxReturns = taxBody?.data?.result?.taxReturns ?? []
        }
        if (packRes.ok) {
          const packBody = await packRes.json().catch(() => ({}))
          const packResult = packBody?.data?.result
          packagingPacks =
            packResult?.packs ??
            packResult?.items ??
            (Array.isArray(packResult) ? packResult : [])
        }

        setSnapshot(
          buildFinanceHubSnapshot({
            openItems: openItems as any,
            bankAccounts: bankAccounts as any,
            periods: nextPeriods,
            payRuns: payRuns as any,
            taxReturns: taxReturns as any,
            packagingPacks: packagingPacks as any,
            currency,
          }),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load book scope')
      }
    },
    [orgId, orgScope, queryPath, selectedBookId],
  )

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
    const body = await readFinanceJson(res)
    return body?.data?.result
  }

  async function bootstrapEntity() {
    if (!orgId) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const entityId = newFinanceId('le')
      const assignmentId = newFinanceId('fra')
      const bookId = newFinanceId('book')
      const requestBase = newFinanceId('req')
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
  const scopeModel = {
    entities,
    books,
    selectedEntityId,
    setSelectedEntityId,
    selectedBookId,
    setSelectedBookId: (id: string) => {
      setSelectedBookId(id)
      if (selectedEntityId) void refreshScope(selectedEntityId, id)
    },
    selectedEntity,
    selectedBook,
    orgId,
  }

  const moduleLinks = FINANCE_NAV.filter((item) => item.key !== 'hub')

  const roleUxContext = useMemo<FinanceRoleUxContext>(() => {
    const roles = [
      ...new Set(
        assignments
          .filter((a) => a.status === 'active')
          .map((a) => a.role as FinanceRole)
          .filter(Boolean),
      ),
    ]
    // Owner/admin bootstrap often lands finance_admin; treat missing roles as viewer-safe.
    return {
      membershipRole: roles.includes('finance_admin') ? 'admin' : roles.length ? 'member' : 'member',
      roles: roles.length ? roles : (['finance_viewer'] as FinanceRole[]),
      practiceClientCount: 1,
    }
  }, [assignments])

  const resolvedPersona = personaOverride ?? resolveFinancePersona(roleUxContext)
  const roleModules = useMemo(
    () => buildRoleHubModules(roleUxContext, { persona: resolvedPersona }),
    [roleUxContext, resolvedPersona],
  )

  return (
    <FinanceModuleFrame
      active="hub"
      orgScope={orgScope}
      title="Finance command centre"
      description="Role-dense cash, AR/AP, periods, payroll, tax, and packaging hub. Guided first close / pay run / bank recon. Operational billing stays on Invoicing and Payments."
      error={error}
      message={message}
      loading={loading}
      meta={
        <div className="flex flex-wrap items-center gap-1.5">
          <HudChip live={!loading}>{loading ? 'Syncing' : 'Live books'}</HudChip>
          <HudChip>Entities <strong>{entities.length}</strong></HudChip>
          <HudChip>Books <strong>{books.length}</strong></HudChip>
          <HudChip>Assignments <strong>{assignments.length}</strong></HudChip>
          <HudChip tone="accent">Role: {resolvedPersona}</HudChip>
          <HudChip tone="accent">No SARS / no payout</HudChip>
        </div>
      }
    >
      {entities.length === 0 ? (
        <Card className="space-y-4 p-6" data-testid="finance-bootstrap-panel">
          <div>
            <h2 className="text-lg">Bootstrap your first legal entity</h2>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
              Owner/admin bootstrap creates your finance_admin assignment, legal entity, and primary book.
              No payments, SARS submissions, or production cutover happen from this screen.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              Entity code
              <input
                className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Legal name
              <input
                className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Currency
              <input
                className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                value={setupCurrency}
                onChange={(e) => setSetupCurrency(e.target.value.toUpperCase())}
              />
            </label>
            <label className="text-sm">
              Jurisdiction
              <input
                className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                value={setupJurisdiction}
                onChange={(e) => setSetupJurisdiction(e.target.value.toUpperCase())}
              />
            </label>
            <label className="text-sm">
              Accounting basis
              <div className="mt-1">
                <ThemedSelect
                  ariaLabel="Accounting basis"
                  value={setupBasis}
                  options={[
                    { value: 'accrual', label: 'Accrual' },
                    { value: 'cash', label: 'Cash' },
                  ]}
                  onValueChange={(value) => setSetupBasis(value as 'accrual' | 'cash')}
                  className="w-full"
                  buttonClassName="w-full justify-between"
                />
              </div>
            </label>
          </div>
          <Button
            type="button"
            variant="primary"
            loading={busy}
            disabled={busy || !orgId}
            onClick={() => void bootstrapEntity()}
          >
            {busy ? 'Creating…' : 'Create legal entity + primary book'}
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          <FinanceScopeBar scope={scopeModel} />

          <FinanceRoleHubModules
            persona={resolvedPersona}
            modules={roleModules}
            orgScope={orgScope}
            onPersonaChange={(next) => setPersonaOverride(next)}
          />

          <FinanceGuidedWorkflowStepper
            persona={resolvedPersona}
            ctx={roleUxContext}
            orgScope={orgScope}
          />

          <section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" data-testid="finance-hub-stats">
            <StatCard
              accent="amber"
              icon="account_balance_wallet"
              label="Cash"
              value={formatHubMoney(snapshot.cashMinor, snapshot.currency)}
              detail={`${snapshot.cashAccountCount} bank accounts`}
            />
            <StatCard
              accent="amber"
              icon="south_west"
              label="AR outstanding"
              value={formatHubMoney(snapshot.arOutstandingMinor, snapshot.currency)}
              detail="Customer open items"
            />
            <StatCard
              accent="amber"
              icon="north_east"
              label="AP outstanding"
              value={formatHubMoney(snapshot.apOutstandingMinor, snapshot.currency)}
              detail="Supplier open items"
            />
            <StatCard
              accent="amber"
              icon="calendar_month"
              label="Open periods"
              value={String(snapshot.openPeriodCount)}
              detail={`${snapshot.periodCount} total periods`}
            />
            <StatCard
              accent="amber"
              icon="groups"
              label="Payroll"
              value={`${snapshot.payrollRunsInReview}/${snapshot.payrollRunsLocked}`}
              detail="In review / locked"
            />
            <StatCard
              accent="amber"
              icon="inventory_2"
              label="Tax + packs"
              value={`${snapshot.taxReturnsReady}/${snapshot.packagingReady}`}
              detail="Tax ready / packs ready"
            />
          </section>

          <FinanceHubCommandRail snapshot={snapshot} orgScope={orgScope} />

          <section className="grid gap-4 lg:grid-cols-2">
            <AgingTable
              title="AR aging"
              buckets={snapshot.arAging}
              currency={snapshot.currency}
              totalMinor={snapshot.arOutstandingMinor}
            />
            <AgingTable
              title="AP aging"
              buckets={snapshot.apAging}
              currency={snapshot.currency}
              totalMinor={snapshot.apOutstandingMinor}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm">Accounting periods</h2>
                <span className="text-xs text-[var(--color-pib-text-muted)]">{periods.length} total</span>
              </div>
              {periods.length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">
                  No periods yet. Create periods from Ledger or Setup.
                </p>
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
                      {periods.slice(0, 12).map((period) => (
                        <tr key={period.id} className="border-t border-[var(--color-pib-line)]">
                          <td className="py-2 pr-3">{period.fiscalYear}</td>
                          <td className="py-2 pr-3">{period.periodNumber}</td>
                          <td className="py-2 pr-3">{period.startsAt.slice(0, 10)}</td>
                          <td className="py-2 pr-3">{period.endsAt.slice(0, 10)}</td>
                          <td className="py-2">
                            <span className="pib-pill">{period.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm">Recent journals</h2>
                <span className="text-xs text-[var(--color-pib-text-muted)]">{journals.length}</span>
              </div>
              {journals.length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">
                  No posted journals yet. Posting remains approval-gated and append-only.
                </p>
              ) : (
                <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
                  {journals.map((journal) => (
                    <li key={journal.id} className="border-b border-[var(--color-pib-line)] pb-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            #{journal.entryNumber ?? '-'} · {journal.description}
                          </p>
                          <p className="text-xs text-[var(--color-pib-text-muted)]">
                            {journal.postingDate?.slice(0, 10)} · {journal.status}
                          </p>
                        </div>
                        <p className="text-xs font-medium">
                          {formatMinor(journal.totalDebitMinor, journal.currency || snapshot.currency)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm">Chart of accounts</h2>
                <span className="text-xs text-[var(--color-pib-text-muted)]">{accounts.length}</span>
              </div>
              {accounts.length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No accounts in this book yet.</p>
              ) : (
                <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
                  {accounts.slice(0, 40).map((account) => (
                    <li
                      key={account.id}
                      className="flex items-start justify-between gap-3 border-b border-[var(--color-pib-line)] pb-2"
                    >
                      <div>
                        <p className="font-medium">
                          {account.code} · {account.name}
                        </p>
                        <p className="text-xs text-[var(--color-pib-text-muted)]">
                          {account.accountType} · {account.normalBalance}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 text-sm">Module lanes</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {moduleLinks.map((item) => (
                  <Link
                    key={item.key}
                    href={scopedPortalPath(item.href, orgScope)}
                    className="rounded-lg border border-[var(--color-pib-line)] p-3 transition-colors hover:bg-[var(--color-row-hover)]"
                  >
                    <div className="flex items-start gap-2">
                      <Icon name={item.icon} />
                      <span className="min-w-0">
                        <p className="text-sm font-medium text-[var(--color-pib-text)]">{item.label}</p>
                        <p className="mt-0.5 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
                          {item.description}
                        </p>
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          </section>

          <Surface className="p-4 text-xs text-[var(--color-pib-text-muted)]" data-testid="finance-safety-readback">
            Safety readback: development/staging finance UI only. No SARS e-file submit, no external payment
            initiation, no mass payslip/statement email, and no production promote from this surface.
          </Surface>
        </div>
      )}
    </FinanceModuleFrame>
  )
}
