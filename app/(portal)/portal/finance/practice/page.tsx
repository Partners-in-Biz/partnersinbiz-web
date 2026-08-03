'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { FinanceModuleFrame } from '@/components/finance/FinanceModuleFrame'
import {
  newFinanceId,
  readFinanceJson,
  requestIdentity,
} from '@/components/finance/financeWorkbench'
import { Card } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { HudChip } from '@/components/ui/HudChip'
import { Button } from '@/components/ui/Button'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import type { FinanceRole } from '@/lib/finance/types'

type Bundle = {
  orgId: string
  matrix: Array<{ action: string; roles: string[]; approvalGated: boolean; audited: boolean }>
  assignments: Array<Record<string, any>>
  myAssignments: Array<Record<string, any>>
  notifications: Array<Record<string, any>>
  auditEvents: Array<Record<string, any>>
  practiceClients: Array<Record<string, any>>
  safety: { noSarsSubmit: true; noExternalPaymentInitiate: true; tenantScoped: true }
}

const ROLE_OPTIONS: FinanceRole[] = [
  'finance_viewer',
  'bookkeeper',
  'accountant',
  'finance_approver',
  'payroll_clerk',
  'payroll_approver',
  'finance_admin',
]

export default function FinancePracticePage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const orgId = orgScope.orgId || ''

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [bundle, setBundle] = useState<Bundle | null>(null)

  const [filterActor, setFilterActor] = useState('')
  const [filterEvent, setFilterEvent] = useState('')
  const [filterEntity, setFilterEntity] = useState('')

  const [assignUserId, setAssignUserId] = useState('')
  const [assignEntityId, setAssignEntityId] = useState('')
  const [assignBookId, setAssignBookId] = useState('')
  const [assignRole, setAssignRole] = useState<FinanceRole>('bookkeeper')
  const [scopeMode, setScopeMode] = useState<'entity' | 'book'>('entity')
  const [matrixQuery, setMatrixQuery] = useState('')

  const queryUrl = useCallback(() => {
    const q = new URLSearchParams()
    q.set('resource', 'bundle')
    if (orgId) q.set('orgId', orgId)
    if (filterActor.trim()) q.set('actorId', filterActor.trim())
    if (filterEvent.trim()) q.set('eventType', filterEvent.trim())
    if (filterEntity.trim()) q.set('legalEntityId', filterEntity.trim())
    q.set('limit', '50')
    return `/api/v1/finance/practice/queries?${q.toString()}`
  }, [orgId, filterActor, filterEvent, filterEntity])

  const load = useCallback(async () => {
    if (!orgId) {
      setBundle(null)
      return
    }
    const res = await fetch(queryUrl(), {
      credentials: 'include',
      headers: { 'X-Org-Id': orgId },
    })
    const body = await readFinanceJson(res)
    setBundle((body?.data?.result ?? null) as Bundle | null)
  }, [orgId, queryUrl])

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load practice workspace'))
  }, [load])

  async function runCommand(operation: string, command: Record<string, unknown>) {
    const res = await fetch('/api/v1/finance/practice/commands', {
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
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  async function assignRole() {
    await withBusy(async () => {
      const id = newFinanceId('asg')
      const ids = requestIdentity('asg')
      await runCommand('practice.role.assign', {
        id,
        userId: assignUserId,
        legalEntityId: assignEntityId,
        role: assignRole,
        scopeMode,
        bookId: scopeMode === 'book' ? assignBookId : undefined,
        ...ids,
      })
      setMessage(`Assigned ${assignRole} to ${assignUserId}`)
    })
  }

  async function revoke(id: string) {
    await withBusy(async () => {
      const ids = requestIdentity('rev')
      await runCommand('practice.role.revoke', { id, reason: 'Revoked from practice workspace', ...ids })
      setMessage(`Revoked assignment ${id}`)
    })
  }

  async function markNotification(id: string, status: 'read' | 'dismissed') {
    await withBusy(async () => {
      const ids = requestIdentity('ntf')
      await runCommand('practice.notification.mark', { id, status, ...ids })
      setMessage(`Notification ${status}`)
    })
  }

  async function emitSampleNotification(kind: 'payroll.run.submitted' | 'reconciliation.awaiting_approval' | 'cutover.ready') {
    await withBusy(async () => {
      const id = newFinanceId('ntf')
      const ids = requestIdentity('ntf')
      const entity = assignEntityId || filterEntity || bundle?.myAssignments?.[0]?.legalEntityId || 'entity'
      await runCommand('practice.notification.emit', {
        id,
        legalEntityId: entity,
        bookId: assignBookId || undefined,
        kind,
        title:
          kind === 'payroll.run.submitted'
            ? 'Pay run submitted for approval'
            : kind === 'reconciliation.awaiting_approval'
              ? 'Reconciliation awaiting approval'
              : 'Cutover package ready',
        body: `Operator notification (${kind}) — in-app only, no external send.`,
        href: '/portal/finance/practice',
        ...ids,
      })
      setMessage(`Emitted ${kind}`)
    })
  }

  const matrix = useMemo(() => {
    const rows = bundle?.matrix ?? []
    const q = matrixQuery.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => row.action.includes(q) || row.roles.some((r) => r.includes(q)))
  }, [bundle?.matrix, matrixQuery])

  const unreadCount = bundle?.notifications?.filter((n) => n.status === 'unread').length ?? 0
  const clientCount = bundle?.practiceClients?.length ?? 0
  const assignmentCount = bundle?.assignments?.length ?? 0
  const auditCount = bundle?.auditEvents?.length ?? 0

  return (
    <FinanceModuleFrame
      active="practice"
      orgScope={orgScope}
      title="Practice & roles"
      description="Role matrix, multi-client switcher, operator notifications, and audit explorer. Tenant-scoped — no SARS submit, no payment initiate."
      error={error}
      message={message}
      meta={
        <div className="flex flex-wrap items-center gap-1.5">
          <HudChip tone="accent">No SARS submit</HudChip>
          <HudChip>No external payment initiate</HudChip>
          <HudChip>Tenant scoped</HudChip>
          <HudChip>Practice switcher</HudChip>
        </div>
      }
    >
      {!orgId && (
        <Card className="p-4 text-sm text-[var(--color-pib-text-muted)]">
          Select an organisation scope to open the practice workspace.
        </Card>
      )}

      {orgId && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="practice-stats">
            <StatCard label="Practice clients" value={clientCount} detail="Memberships with finance module" icon="swap_horiz" />
            <StatCard label="Role assignments" value={assignmentCount} detail="Active + revoked in this org" icon="badge" />
            <StatCard label="Unread notices" value={unreadCount} detail="In-app operator inbox" icon="notifications" />
            <StatCard label="Audit rows" value={auditCount} detail="Filtered explorer page" icon="policy" />
          </div>

          <section className="grid gap-4 lg:grid-cols-2" data-testid="practice-switcher">
            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Practice multi-client switcher</h2>
                <HudChip>X-Org-Id scoped</HudChip>
              </div>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                Switch into another organisation you already belong to. Each link carries orgId so finance commands stay on the correct tenant.
              </p>
              {(bundle?.practiceClients ?? []).length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No finance-enabled memberships found for this user.</p>
              ) : (
                <ul className="space-y-2">
                  {(bundle?.practiceClients ?? []).map((client) => {
                    const href = scopedPortalPath('/portal/finance/practice', {
                      ...orgScope,
                      orgId: client.orgId,
                    })
                    return (
                      <li
                        key={client.orgId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-sm"
                        data-testid={`practice-client-${client.orgId}`}
                      >
                        <div className="min-w-0">
                          <div className="font-medium">{client.orgName}</div>
                          <div className="text-xs text-[var(--color-pib-text-muted)]">
                            {client.orgId} · {client.membershipRole} · {client.assignmentCount} assignment(s)
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(client.roles as string[] | undefined)?.map((role) => (
                              <HudChip key={role}>{role}</HudChip>
                            ))}
                          </div>
                        </div>
                        {client.isCurrent ? (
                          <HudChip tone="accent">Current</HudChip>
                        ) : (
                          <Link href={href} className="pib-btn-secondary btn-pib-sm">
                            Open books
                          </Link>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>

            <Card className="space-y-3 p-4" data-testid="practice-notifications">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Operator notifications</h2>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="ghost" disabled={busy || !orgId} onClick={() => void emitSampleNotification('payroll.run.submitted')}>
                    Pay run submitted
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy || !orgId} onClick={() => void emitSampleNotification('reconciliation.awaiting_approval')}>
                    Recon approval
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy || !orgId} onClick={() => void emitSampleNotification('cutover.ready')}>
                    Cutover ready
                  </Button>
                </div>
              </div>
              <p className="text-xs text-[var(--color-pib-text-muted)]">In-app only. No client-visible email blast.</p>
              {(bundle?.notifications ?? []).length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No notifications in this org.</p>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-auto">
                  {(bundle?.notifications ?? []).map((n) => (
                    <li key={n.id} className="rounded-lg border border-[var(--color-pib-line)] p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{n.title}</span>
                        <HudChip>{n.status}</HudChip>
                      </div>
                      <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{n.body}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {n.status === 'unread' && (
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void markNotification(n.id, 'read')}>
                            Mark read
                          </Button>
                        )}
                        {n.status !== 'dismissed' && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void markNotification(n.id, 'dismissed')}>
                            Dismiss
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-3 p-4" data-testid="practice-role-assign">
              <h2 className="text-base font-semibold">Assign finance role</h2>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                finance_admin only. Bookkeeper cannot approve pay runs — policy matrix enforced on every command.
              </p>
              <label className="block text-sm">
                User id
                <input
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                  value={assignUserId}
                  onChange={(e) => setAssignUserId(e.target.value)}
                  placeholder="uid_..."
                />
              </label>
              <label className="block text-sm">
                Legal entity id
                <input
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                  value={assignEntityId}
                  onChange={(e) => setAssignEntityId(e.target.value)}
                  placeholder="le_..."
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  Scope
                  <select
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={scopeMode}
                    onChange={(e) => setScopeMode(e.target.value as 'entity' | 'book')}
                    aria-label="Role scope mode"
                  >
                    <option value="entity">Entity</option>
                    <option value="book">Book</option>
                  </select>
                </label>
                <label className="block text-sm">
                  Role
                  <select
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={assignRole}
                    onChange={(e) => setAssignRole(e.target.value as FinanceRole)}
                    aria-label="Finance role"
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {scopeMode === 'book' && (
                <label className="block text-sm">
                  Book id
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={assignBookId}
                    onChange={(e) => setAssignBookId(e.target.value)}
                    placeholder="book_..."
                  />
                </label>
              )}
              <Button
                variant="primary"
                size="sm"
                disabled={busy || !orgId || !assignUserId || !assignEntityId}
                onClick={() => void assignRole()}
              >
                Assign role
              </Button>

              <div className="border-t border-[var(--color-pib-line)] pt-3">
                <h3 className="text-sm font-semibold">Org assignments</h3>
                {(bundle?.assignments ?? []).length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">No assignments in this org.</p>
                ) : (
                  <ul className="mt-2 max-h-64 space-y-2 overflow-auto">
                    {(bundle?.assignments ?? []).map((a) => (
                      <li key={a.id} className="rounded-lg border border-[var(--color-pib-line)] p-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            {a.userId} · {a.role} · {a.legalEntityId}
                            {a.bookId ? ` / ${a.bookId}` : ''}
                          </span>
                          <HudChip>{a.status}</HudChip>
                        </div>
                        {a.status === 'active' && (
                          <Button className="mt-2" size="sm" variant="ghost" disabled={busy} onClick={() => void revoke(a.id)}>
                            Revoke
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            <Card className="space-y-3 p-4" data-testid="practice-audit-explorer">
              <h2 className="text-base font-semibold">Audit explorer</h2>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                Filters finance_audit_events for the current org only. Cross-tenant rows never appear.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  className="rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
                  placeholder="Actor id"
                  value={filterActor}
                  onChange={(e) => setFilterActor(e.target.value)}
                />
                <input
                  className="rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
                  placeholder="Event type"
                  value={filterEvent}
                  onChange={(e) => setFilterEvent(e.target.value)}
                />
                <input
                  className="rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
                  placeholder="Legal entity id"
                  value={filterEntity}
                  onChange={(e) => setFilterEntity(e.target.value)}
                />
              </div>
              <Button size="sm" variant="secondary" disabled={busy || !orgId} onClick={() => void load()}>
                Refresh audit
              </Button>
              {(bundle?.auditEvents ?? []).length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No audit events match this filter.</p>
              ) : (
                <ul className="max-h-96 space-y-2 overflow-auto">
                  {(bundle?.auditEvents ?? []).map((event) => (
                    <li key={event.id} className="rounded-lg border border-[var(--color-pib-line)] p-2 text-xs">
                      <div className="font-medium">{event.eventType}</div>
                      <div className="text-[var(--color-pib-text-muted)]">
                        {event.occurredAt} · actor {event.actorId} · {event.legalEntityId}
                        {event.bookId ? ` / ${event.bookId}` : ''}
                      </div>
                      <div className="text-[var(--color-pib-text-muted)]">
                        {event.aggregateType}:{event.aggregateId}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <Card className="space-y-3 p-4" data-testid="practice-role-matrix">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Role matrix</h2>
              <input
                className="w-full max-w-xs rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm sm:w-64"
                placeholder="Filter action or role"
                value={matrixQuery}
                onChange={(e) => setMatrixQuery(e.target.value)}
              />
            </div>
            <div className="overflow-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="text-[var(--color-pib-text-muted)]">
                  <tr>
                    <th className="px-2 py-1 font-medium">Action</th>
                    <th className="px-2 py-1 font-medium">Roles</th>
                    <th className="px-2 py-1 font-medium">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row) => (
                    <tr key={row.action} className="border-t border-[var(--color-pib-line)]">
                      <td className="px-2 py-1 font-mono">{row.action}</td>
                      <td className="px-2 py-1">{row.roles.join(', ')}</td>
                      <td className="px-2 py-1">
                        <div className="flex flex-wrap gap-1">
                          {row.approvalGated ? <HudChip tone="accent">approval</HudChip> : null}
                          {row.audited ? <HudChip>audited</HudChip> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </FinanceModuleFrame>
  )
}
