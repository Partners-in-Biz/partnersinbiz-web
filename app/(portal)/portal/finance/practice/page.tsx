'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { scopedPortalPath } from '@/lib/portal/scoped-routing'
import { usePortalOrgScope } from '@/lib/portal/usePortalOrgScope'
import type { FinanceRole } from '@/lib/finance/types'
import {
  exportAuditEventsCsv,
  filterNotificationsForCentre,
  uniqueAuditActors,
  uniqueAuditEntities,
  uniqueAuditEventTypes,
} from '@/lib/finance/role-ux/catalog'
import type { FinanceOperatorNotification, PracticeAuditEventView } from '@/lib/finance/practice/types'

type Bundle = {
  orgId: string
  matrix: Array<{ action: string; roles: string[]; approvalGated: boolean; audited: boolean }>
  assignments: Array<Record<string, any>>
  myAssignments: Array<Record<string, any>>
  notifications: FinanceOperatorNotification[]
  auditEvents: PracticeAuditEventView[]
  practiceClients: Array<Record<string, any>>
  grants?: Array<Record<string, any>>
  myGrants?: Array<Record<string, any>>
  clientLinks?: Array<Record<string, any>>
  practiceQueue?: Array<Record<string, any>>
  grantAccessEvents?: Array<Record<string, any>>
  safety: {
    noSarsSubmit: true
    noExternalPaymentInitiate: true
    tenantScoped: true
    clientVisibleMessagesAllowed?: false
    externalEgressAllowed?: false
    practiceGrantsEnabled?: true
  }
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

const GRANT_ROLE_OPTIONS = ['prepare', 'review', 'file-export'] as const
type GrantRoleOption = (typeof GRANT_ROLE_OPTIONS)[number]

export default function FinancePracticePage() {
  const orgScope = usePortalOrgScope()
  const orgId = orgScope.orgId || ''

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [bundle, setBundle] = useState<Bundle | null>(null)

  const [filterActor, setFilterActor] = useState('')
  const [filterEvent, setFilterEvent] = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [noticeStatus, setNoticeStatus] = useState<'all' | 'unread' | 'read' | 'dismissed'>('all')
  const [noticeKind, setNoticeKind] = useState('')
  const [noticeQuery, setNoticeQuery] = useState('')

  const [assignUserId, setAssignUserId] = useState('')
  const [assignEntityId, setAssignEntityId] = useState('')
  const [assignBookId, setAssignBookId] = useState('')
  const [assignRole, setAssignRole] = useState<FinanceRole>('bookkeeper')
  const [scopeMode, setScopeMode] = useState<'entity' | 'book'>('entity')
  const [matrixQuery, setMatrixQuery] = useState('')

  const [linkClientOrgId, setLinkClientOrgId] = useState('')
  const [linkClientName, setLinkClientName] = useState('')
  const [linkOpenPeriods, setLinkOpenPeriods] = useState('0')
  const [linkCloseBlockers, setLinkCloseBlockers] = useState('0')
  const [linkReconBacklog, setLinkReconBacklog] = useState('0')
  const [grantClientOrgId, setGrantClientOrgId] = useState('')
  const [grantUserId, setGrantUserId] = useState('')
  const [grantRole, setGrantRole] = useState<GrantRoleOption>('prepare')

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

  async function submitRoleAssignment() {
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

  async function upsertClientLink() {
    await withBusy(async () => {
      const id = newFinanceId('plink')
      const ids = requestIdentity('plink')
      await runCommand('practice.client_link.upsert', {
        id,
        firmOrgId: orgId,
        clientOrgId: linkClientOrgId.trim(),
        clientName: linkClientName.trim() || linkClientOrgId.trim(),
        openPeriodCount: Number(linkOpenPeriods) || 0,
        closeBlockerCount: Number(linkCloseBlockers) || 0,
        reconBacklogCount: Number(linkReconBacklog) || 0,
        ...ids,
      })
      setMessage(`Linked client ${linkClientOrgId.trim()}`)
      setLinkClientOrgId('')
      setLinkClientName('')
    })
  }

  async function createPracticeGrant() {
    await withBusy(async () => {
      const id = newFinanceId('pgrant')
      const ids = requestIdentity('pgrant')
      await runCommand('practice.grant.create', {
        id,
        firmOrgId: orgId,
        clientOrgId: grantClientOrgId.trim(),
        granteeUserId: grantUserId.trim(),
        role: grantRole,
        ...ids,
      })
      setMessage(`Granted ${grantRole} on ${grantClientOrgId.trim()} to ${grantUserId.trim()}`)
      setGrantUserId('')
    })
  }

  async function revokePracticeGrant(id: string) {
    await withBusy(async () => {
      const ids = requestIdentity('pgrev')
      await runCommand('practice.grant.revoke', {
        id,
        firmOrgId: orgId,
        reason: 'Revoked from practice workspace',
        ...ids,
      })
      setMessage(`Revoked practice grant ${id}`)
    })
  }

  async function markNotification(id: string, status: 'read' | 'dismissed') {
    await withBusy(async () => {
      const ids = requestIdentity('ntf')
      await runCommand('practice.notification.mark', { id, status, ...ids })
      setMessage(`Notification ${status}`)
    })
  }

  async function markAllUnreadRead() {
    const unread = (bundle?.notifications ?? []).filter((n) => n.status === 'unread')
    if (unread.length === 0) {
      setMessage('No unread notifications')
      return
    }
    await withBusy(async () => {
      for (const n of unread) {
        const ids = requestIdentity('ntf')
        await runCommand('practice.notification.mark', { id: n.id, status: 'read', ...ids })
      }
      setMessage(`Marked ${unread.length} notification(s) read`)
    })
  }

  function downloadAuditCsv() {
    const events = (bundle?.auditEvents ?? []) as PracticeAuditEventView[]
    const csv = exportAuditEventsCsv(events)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `finance-audit-${orgId || 'org'}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setMessage(`Exported ${events.length} audit row(s) to CSV (current org only)`)
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
        body: `Operator notification (${kind}) - in-app only, no external send.`,
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
  const grantCount = (bundle?.grants ?? []).filter((g) => g.status === 'active').length
  const queueHigh = (bundle?.practiceQueue ?? []).filter((q) => q.severity === 'high').length

  const filteredNotifications = useMemo(
    () =>
      filterNotificationsForCentre(bundle?.notifications ?? [], {
        status: noticeStatus,
        kind: noticeKind || undefined,
        query: noticeQuery || undefined,
      }),
    [bundle?.notifications, noticeStatus, noticeKind, noticeQuery],
  )

  const auditEvents = (bundle?.auditEvents ?? []) as PracticeAuditEventView[]
  const actorOptions = useMemo(() => uniqueAuditActors(auditEvents), [auditEvents])
  const eventTypeOptions = useMemo(() => uniqueAuditEventTypes(auditEvents), [auditEvents])
  const entityOptions = useMemo(() => uniqueAuditEntities(auditEvents), [auditEvents])

  return (
    <FinanceModuleFrame
      active="practice"
      orgScope={orgScope}
      title="Practice & roles"
      description="Role matrix, multi-client switcher, firm→client grants (prepare/review/file-export), practice queue, polished notification centre, and dense audit explorer with CSV export. Tenant-scoped - no SARS submit, no payment initiate, no client mass email, packaging egress closed."
      error={error}
      message={message}
      meta={
        <div className="flex flex-wrap items-center gap-1.5">
          <HudChip tone="accent">No SARS submit</HudChip>
          <HudChip>No external payment initiate</HudChip>
          <HudChip>Tenant scoped</HudChip>
          <HudChip>Practice switcher</HudChip>
          <HudChip>Firm→client grants</HudChip>
          <HudChip>Audit CSV</HudChip>
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" data-testid="practice-stats">
            <StatCard label="Practice clients" value={clientCount} detail="Memberships with finance module" icon="swap_horiz" />
            <StatCard label="Active grants" value={grantCount} detail="Firm→client ACL" icon="key" />
            <StatCard label="Queue high" value={queueHigh} detail="Close blockers first" icon="priority_high" />
            <StatCard label="Role assignments" value={assignmentCount} detail="Active + revoked in this org" icon="badge" />
            <StatCard label="Unread notices" value={unreadCount} detail="In-app operator inbox" icon="notifications" />
            <StatCard label="Audit rows" value={auditCount} detail="Filtered explorer page" icon="policy" />
          </div>

          <section className="grid gap-4 lg:grid-cols-2" data-testid="practice-switcher">
            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base">Practice multi-client switcher</h2>
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

            <Card className="space-y-3 p-4" data-testid="practice-notifications" id="notifications">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base">Notification centre</h2>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" disabled={busy || !orgId || unreadCount === 0} onClick={() => void markAllUnreadRead()}>
                    Mark all read
                  </Button>
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
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                In-app operator inbox only. Filter by status, kind, and text. No client-visible email blast.
              </p>
              <div className="grid gap-2 sm:grid-cols-3" data-testid="practice-notification-filters">
                <select
                  className="rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
                  value={noticeStatus}
                  onChange={(e) => setNoticeStatus(e.target.value as typeof noticeStatus)}
                  aria-label="Notification status filter"
                >
                  <option value="all">All statuses</option>
                  <option value="unread">Unread</option>
                  <option value="read">Read</option>
                  <option value="dismissed">Dismissed</option>
                </select>
                <select
                  className="rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
                  value={noticeKind}
                  onChange={(e) => setNoticeKind(e.target.value)}
                  aria-label="Notification kind filter"
                >
                  <option value="">All kinds</option>
                  <option value="payroll.run.submitted">payroll.run.submitted</option>
                  <option value="reconciliation.awaiting_approval">reconciliation.awaiting_approval</option>
                  <option value="cutover.ready">cutover.ready</option>
                  <option value="role.assigned">role.assigned</option>
                  <option value="role.revoked">role.revoked</option>
                  <option value="practice.generic">practice.generic</option>
                </select>
                <input
                  className="rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
                  placeholder="Search title or body"
                  value={noticeQuery}
                  onChange={(e) => setNoticeQuery(e.target.value)}
                  aria-label="Notification text search"
                />
              </div>
              {filteredNotifications.length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No notifications match this filter.</p>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-auto">
                  {filteredNotifications.map((n) => (
                    <li key={n.id} className="rounded-lg border border-[var(--color-pib-line)] p-3 text-sm" data-testid={`practice-notification-${n.id}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{n.title}</span>
                        <div className="flex flex-wrap gap-1">
                          <HudChip>{n.status}</HudChip>
                          <HudChip>{n.kind}</HudChip>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{n.body}</p>
                      <div className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">
                        {n.createdAt} · {n.legalEntityId}
                        {n.bookId ? ` / ${n.bookId}` : ''}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {n.href ? (
                          <Link href={scopedPortalPath(String(n.href).replace(/#.*$/, ''), { ...orgScope, orgId })} className="pib-btn-secondary btn-pib-sm">
                            Open
                          </Link>
                        ) : null}
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

          <section className="grid gap-4 lg:grid-cols-2" data-testid="practice-grants" id="grants">
            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base">Firm→client grants</h2>
                <HudChip>Beyond membership</HudChip>
              </div>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                Grant firm staff prepare / review / file-export on client books without full client org membership.
                Access is audited; revoke is immediate. No client-visible messages; packaging egress stays closed.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-sm">
                  Client org id (link)
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={linkClientOrgId}
                    onChange={(e) => setLinkClientOrgId(e.target.value)}
                    placeholder="client_org_..."
                    aria-label="Practice client org id"
                  />
                </label>
                <label className="block text-sm">
                  Client name
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={linkClientName}
                    onChange={(e) => setLinkClientName(e.target.value)}
                    placeholder="Acme Books"
                    aria-label="Practice client name"
                  />
                </label>
                <label className="block text-sm">
                  Open periods
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={linkOpenPeriods}
                    onChange={(e) => setLinkOpenPeriods(e.target.value)}
                    aria-label="Open period count"
                  />
                </label>
                <label className="block text-sm">
                  Close blockers
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={linkCloseBlockers}
                    onChange={(e) => setLinkCloseBlockers(e.target.value)}
                    aria-label="Close blocker count"
                  />
                </label>
                <label className="block text-sm">
                  Recon backlog
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={linkReconBacklog}
                    onChange={(e) => setLinkReconBacklog(e.target.value)}
                    aria-label="Recon backlog count"
                  />
                </label>
              </div>
              <Button
                size="sm"
                disabled={busy || !orgId || !linkClientOrgId.trim()}
                onClick={() => void upsertClientLink()}
              >
                Upsert client link
              </Button>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="block text-sm sm:col-span-1">
                  Grant client org
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={grantClientOrgId}
                    onChange={(e) => setGrantClientOrgId(e.target.value)}
                    placeholder="client_org_..."
                    aria-label="Grant client org id"
                  />
                </label>
                <label className="block text-sm">
                  Grantee user id
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={grantUserId}
                    onChange={(e) => setGrantUserId(e.target.value)}
                    placeholder="uid_..."
                    aria-label="Grant grantee user id"
                  />
                </label>
                <label className="block text-sm">
                  Role
                  <select
                    className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                    value={grantRole}
                    onChange={(e) => setGrantRole(e.target.value as GrantRoleOption)}
                    aria-label="Practice grant role"
                  >
                    {GRANT_ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Button
                size="sm"
                disabled={busy || !orgId || !grantClientOrgId.trim() || !grantUserId.trim()}
                onClick={() => void createPracticeGrant()}
              >
                Create grant
              </Button>
              {(bundle?.grants ?? []).length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No firm→client grants yet.</p>
              ) : (
                <ul className="max-h-64 space-y-2 overflow-auto" data-testid="practice-grant-list">
                  {(bundle?.grants ?? []).map((g) => (
                    <li
                      key={g.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-sm"
                      data-testid={`practice-grant-${g.id}`}
                    >
                      <div className="min-w-0">
                        <div className="font-medium">
                          {g.role} → {g.granteeUserId}
                        </div>
                        <div className="text-xs text-[var(--color-pib-text-muted)]">
                          {g.clientOrgId} · {g.status}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <HudChip>{g.status}</HudChip>
                        {g.status === 'active' && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void revokePracticeGrant(g.id)}>
                            Revoke
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="space-y-3 p-4" data-testid="practice-queue">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base">Practice queue</h2>
                <HudChip>Attention first</HudChip>
              </div>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                Clients needing attention: close blockers, open periods, recon backlog. Preserves multi-entity and cross-org confirm models.
              </p>
              {(bundle?.practiceQueue ?? []).length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No linked clients in the firm queue.</p>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-auto">
                  {(bundle?.practiceQueue ?? []).map((item) => (
                    <li
                      key={item.clientOrgId}
                      className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-sm"
                      data-testid={`practice-queue-${item.clientOrgId}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{item.clientName}</span>
                        <div className="flex flex-wrap gap-1">
                          <HudChip tone={item.severity === 'high' ? 'warning' : undefined}>{item.severity}</HudChip>
                          <HudChip>{item.attention}</HudChip>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{item.summary}</p>
                      <div className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">
                        {item.clientOrgId} · grants {(item.grantIds as string[] | undefined)?.length ?? 0}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {(bundle?.grantAccessEvents ?? []).length > 0 && (
                <div className="border-t border-[var(--color-pib-line)] pt-3" data-testid="practice-grant-access">
                  <h3 className="text-sm">Recent grant access audit</h3>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-[var(--color-pib-text-muted)]">
                    {(bundle?.grantAccessEvents ?? []).slice(0, 12).map((e) => (
                      <li key={e.id}>
                        {e.occurredAt} · {e.action} · {e.clientOrgId}
                        {e.financeAction ? ` · ${e.financeAction}` : ''}
                        {e.reason ? ` · ${e.reason}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-3 p-4" data-testid="practice-role-assign">
              <h2 className="text-base">Assign finance role</h2>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                finance_admin only. Bookkeeper cannot approve pay runs - policy matrix enforced on every command.
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
                onClick={() => void submitRoleAssignment()}
              >
                Assign role
              </Button>

              <div className="border-t border-[var(--color-pib-line)] pt-3">
                <h3 className="text-sm">Org assignments</h3>
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

            <Card className="space-y-3 p-4" data-testid="practice-audit-explorer" id="audit">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base">Audit explorer</h2>
                <Button size="sm" variant="primary" disabled={!orgId || auditEvents.length === 0} onClick={downloadAuditCsv} data-testid="practice-audit-export-csv">
                  Export CSV
                </Button>
              </div>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                Density filters: actor, event type, legal entity. Rows are current-org only - cross-tenant never appears. CSV is a local download.
              </p>
              <div className="grid gap-2 sm:grid-cols-3" data-testid="practice-audit-filters">
                <input
                  className="rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
                  placeholder="Actor id"
                  list="practice-audit-actors"
                  value={filterActor}
                  onChange={(e) => setFilterActor(e.target.value)}
                  aria-label="Audit actor filter"
                />
                <input
                  className="rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
                  placeholder="Event type"
                  list="practice-audit-event-types"
                  value={filterEvent}
                  onChange={(e) => setFilterEvent(e.target.value)}
                  aria-label="Audit event type filter"
                />
                <input
                  className="rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
                  placeholder="Legal entity id"
                  list="practice-audit-entities"
                  value={filterEntity}
                  onChange={(e) => setFilterEntity(e.target.value)}
                  aria-label="Audit legal entity filter"
                />
              </div>
              <datalist id="practice-audit-actors">
                {actorOptions.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
              <datalist id="practice-audit-event-types">
                {eventTypeOptions.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
              <datalist id="practice-audit-entities">
                {entityOptions.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
              <Button size="sm" variant="secondary" disabled={busy || !orgId} onClick={() => void load()}>
                Refresh audit
              </Button>
              {auditEvents.length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No audit events match this filter.</p>
              ) : (
                <div className="max-h-96 overflow-auto" data-testid="practice-audit-table">
                  <table className="min-w-full text-left text-xs">
                    <thead className="sticky top-0 bg-[var(--color-surface,var(--color-pib-bg))] text-[var(--color-pib-text-muted)]">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">When</th>
                        <th className="px-2 py-1.5 font-medium">Event</th>
                        <th className="px-2 py-1.5 font-medium">Actor</th>
                        <th className="px-2 py-1.5 font-medium">Entity</th>
                        <th className="px-2 py-1.5 font-medium">Aggregate</th>
                        <th className="px-2 py-1.5 font-medium">Seq</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditEvents.map((event) => (
                        <tr key={event.id} className="border-t border-[var(--color-pib-line)]">
                          <td className="px-2 py-1.5 whitespace-nowrap">{String(event.occurredAt).slice(0, 19).replace('T', ' ')}</td>
                          <td className="px-2 py-1.5 font-mono">{event.eventType}</td>
                          <td className="px-2 py-1.5 font-mono">{event.actorId}</td>
                          <td className="px-2 py-1.5 font-mono">
                            {event.legalEntityId}
                            {event.bookId ? ` / ${event.bookId}` : ''}
                          </td>
                          <td className="px-2 py-1.5 font-mono">
                            {event.aggregateType}:{event.aggregateId}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">{event.sequence}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </section>

          <Card className="space-y-3 p-4" data-testid="practice-role-matrix">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base">Role matrix</h2>
              <input
                aria-label="Filter action or role"
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
