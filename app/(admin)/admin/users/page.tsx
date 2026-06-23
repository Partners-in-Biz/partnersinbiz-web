'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { copyToClipboard } from '@/lib/utils/clipboard'
import { DialogDrawer, StatusPill } from '@/components/ui/AppFoundation'

interface AdminUserView {
  uid: string
  email: string
  displayName: string
  role: string
  orgId: string | null
  createdAt: string | null
  lastSignInTime: string | null
  disabled: boolean
  emailVerified: boolean
}

type StatusFilter = 'all' | 'active' | 'disabled' | 'unverified'
type RoleFilter = 'all' | 'admin' | 'client' | 'unknown'

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function Avatar({ name, email }: { name: string; email: string }) {
  const label = name || email || '?'
  const initials = label
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-on-surface flex-shrink-0"
      style={{ backgroundColor: 'var(--color-accent-v2)' }}
    >
      {initials || '?'}
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  const colours: Record<string, string> = {
    admin: '#2563eb',
    client: '#16a34a',
    unknown: '#6b7280',
  }
  const colour = colours[role] ?? '#6b7280'
  return (
    <span
      className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ background: `${colour}20`, color: colour }}
    >
      {role}
    </span>
  )
}

function userStatus(u: AdminUserView): { label: string; tone: 'success' | 'danger' | 'warn' } {
  if (u.disabled) return { label: 'Disabled', tone: 'danger' }
  if (!u.emailVerified) return { label: 'Unverified', tone: 'warn' }
  return { label: 'Active', tone: 'success' }
}

function StatusBadge({ u }: { u: AdminUserView }) {
  const s = userStatus(u)
  return <StatusPill tone={s.tone} dot>{s.label}</StatusPill>
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  const sec = Math.round(diff / 1000)
  if (sec < 60) return 'Just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  const mo = Math.round(day / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.round(mo / 12)}y ago`
}

type ConfirmState =
  | null
  | {
      kind: 'reset' | 'suspend' | 'unsuspend' | 'delete'
      user: AdminUserView
    }
  | {
      kind: 'bulk-suspend' | 'bulk-unsuspend' | 'bulk-delete'
      uids: string[]
    }

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailUser, setDetailUser] = useState<AdminUserView | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/users')
      const body = (await res.json()) as {
        success?: boolean
        data?: { users?: AdminUserView[] }
        error?: string
      }
      if (!res.ok) {
        setError(body.error ?? 'Failed to load users')
        setUsers([])
      } else {
        setUsers(body.data?.users ?? [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (q && ![u.displayName, u.email, u.uid, u.role, u.orgId ?? ''].join(' ').toLowerCase().includes(q)) {
        return false
      }
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (statusFilter !== 'all') {
        if (statusFilter === 'disabled' && !u.disabled) return false
        if (statusFilter === 'active' && (u.disabled || !u.emailVerified)) return false
        if (statusFilter === 'unverified' && (u.disabled || u.emailVerified)) return false
      }
      return true
    })
  }, [users, search, roleFilter, statusFilter])

  // Prune selection to the currently visible (filtered) set so bulk actions
  // never operate on hidden rows.
  const visibleUids = useMemo(() => new Set(filtered.map((u) => u.uid)), [filtered])
  const selectedVisible = useMemo(
    () => filtered.filter((u) => selected.has(u.uid)),
    [filtered, selected],
  )
  const allVisibleSelected = filtered.length > 0 && filtered.every((u) => selected.has(u.uid))

  function toggleSelect(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev)
        for (const uid of visibleUids) next.delete(uid)
        return next
      }
      const next = new Set(prev)
      for (const uid of visibleUids) next.add(uid)
      return next
    })
  }

  async function impersonate(user: AdminUserView) {
    setBusyUid(user.uid)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/users/${user.uid}/impersonate`, { method: 'POST' })
      const body = (await res.json()) as {
        success?: boolean
        data?: { customToken?: string; targetEmail?: string | null }
        error?: string
      }
      if (!res.ok) {
        setError(body.error ?? 'Failed to generate impersonation token')
        return
      }
      const customToken = body.data?.customToken
      if (!customToken) {
        setError('No token returned')
        return
      }
      const params = new URLSearchParams({
        token: customToken,
        email: body.data?.targetEmail ?? user.email ?? '',
        uid: user.uid,
      })
      window.open(`/admin/impersonate?${params.toString()}`, '_blank')
      setNotice(`Impersonation token generated for ${user.email || user.uid}. Check the new tab.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to impersonate')
    } finally {
      setBusyUid(null)
    }
  }

  async function copyUid(uid: string) {
    await copyToClipboard(uid)
    setNotice(`UID copied: ${uid}`)
  }

  // ---- single-user action callers ------------------------------------------

  async function callReset(uid: string): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(`/api/v1/admin/users/${uid}/reset`, { method: 'POST' })
    const body = (await res.json()) as {
      success?: boolean
      data?: { email?: string; emailed?: boolean; link?: string }
      error?: string
    }
    if (!res.ok) return { ok: false, message: body.error ?? 'Reset failed' }
    const emailed = body.data?.emailed
    return {
      ok: true,
      message: emailed
        ? `Reset email sent to ${body.data?.email}`
        : `Reset link generated for ${body.data?.email} (email not sent — copy from audit/log)`,
    }
  }

  async function callSuspend(uid: string, disabled: boolean): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(`/api/v1/admin/users/${uid}/suspend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled }),
    })
    const body = (await res.json()) as { success?: boolean; error?: string }
    if (!res.ok) return { ok: false, message: body.error ?? 'Action failed' }
    return { ok: true, message: disabled ? 'User suspended' : 'User unsuspended' }
  }

  async function callDelete(uid: string): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(`/api/v1/admin/users/${uid}/delete`, { method: 'DELETE' })
    const body = (await res.json()) as { success?: boolean; error?: string }
    if (!res.ok) return { ok: false, message: body.error ?? 'Delete failed' }
    return { ok: true, message: 'User deleted' }
  }

  // ---- confirm runner ------------------------------------------------------

  async function runConfirm() {
    if (!confirm) return
    setConfirmBusy(true)
    setError(null)
    setNotice(null)
    try {
      if ('user' in confirm) {
        const { kind, user } = confirm
        let result: { ok: boolean; message: string }
        if (kind === 'reset') result = await callReset(user.uid)
        else if (kind === 'suspend') result = await callSuspend(user.uid, true)
        else if (kind === 'unsuspend') result = await callSuspend(user.uid, false)
        else result = await callDelete(user.uid)

        if (result.ok) {
          setNotice(result.message)
          if (kind !== 'reset') await load()
          if (detailUser?.uid === user.uid) setDetailUser(null)
        } else {
          setError(result.message)
        }
      } else {
        const { kind, uids } = confirm
        const run =
          kind === 'bulk-suspend'
            ? (uid: string) => callSuspend(uid, true)
            : kind === 'bulk-unsuspend'
            ? (uid: string) => callSuspend(uid, false)
            : (uid: string) => callDelete(uid)

        const results = await Promise.allSettled(uids.map((uid) => run(uid)))
        let ok = 0
        const failures: string[] = []
        results.forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value.ok) ok += 1
          else {
            const reason =
              r.status === 'fulfilled' ? r.value.message : (r.reason?.message ?? 'error')
            failures.push(`${uids[i].slice(0, 8)}…: ${reason}`)
          }
        })
        setNotice(`${ok}/${uids.length} succeeded.`)
        if (failures.length) setError(`Failures: ${failures.join('; ')}`)
        setSelected(new Set())
        await load()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setConfirmBusy(false)
      setConfirm(null)
    }
  }

  const confirmCopy = useMemo(() => {
    if (!confirm) return null
    if ('user' in confirm) {
      const label = confirm.user.email || confirm.user.uid
      switch (confirm.kind) {
        case 'reset':
          return { title: 'Reset password', body: `Generate a password reset link for ${label}? If email is configured they will be emailed the link.`, cta: 'Generate link', danger: false }
        case 'suspend':
          return { title: 'Suspend user', body: `Suspend (disable) ${label}? They will be unable to sign in until unsuspended.`, cta: 'Suspend', danger: true }
        case 'unsuspend':
          return { title: 'Unsuspend user', body: `Unsuspend (re-enable) ${label}? They will be able to sign in again.`, cta: 'Unsuspend', danger: false }
        case 'delete':
          return { title: 'Delete user', body: `Permanently delete ${label} from Firebase Auth? This cannot be undone.`, cta: 'Delete', danger: true }
      }
    }
    const n = confirm.uids.length
    switch (confirm.kind) {
      case 'bulk-suspend':
        return { title: 'Bulk suspend', body: `Suspend ${n} selected user${n === 1 ? '' : 's'}? Super admins in the selection will be skipped server-side.`, cta: `Suspend ${n}`, danger: true }
      case 'bulk-unsuspend':
        return { title: 'Bulk unsuspend', body: `Unsuspend ${n} selected user${n === 1 ? '' : 's'}?`, cta: `Unsuspend ${n}`, danger: false }
      case 'bulk-delete':
        return { title: 'Bulk delete', body: `Permanently delete ${n} selected user${n === 1 ? '' : 's'}? This cannot be undone. Super admins will be skipped server-side.`, cta: `Delete ${n}`, danger: true }
    }
    return null
  }, [confirm])

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Admin / Users
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">All Users</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Browse every Firebase Auth user, manage their access, and impersonate them for debugging.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start md:self-auto">
          <Link href="/admin/platform-members" className="pib-btn-ghost text-sm font-label">
            Client portal logins
          </Link>
          <Link href="/admin/platform-users" className="pib-btn-ghost text-sm font-label">
            Admin users
          </Link>
        </div>
      </div>

      {error && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {notice && (
        <div className="pib-card border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-400">
          {notice}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="pib-card p-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Total users</p>
          <p className="text-2xl font-headline font-bold text-on-surface mt-1">{users.length}</p>
        </div>
        <div className="pib-card p-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Admins</p>
          <p className="text-2xl font-headline font-bold text-on-surface mt-1">
            {users.filter((u) => u.role === 'admin').length}
          </p>
        </div>
        <div className="pib-card p-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Clients</p>
          <p className="text-2xl font-headline font-bold text-on-surface mt-1">
            {users.filter((u) => u.role === 'client').length}
          </p>
        </div>
        <div className="pib-card p-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Disabled</p>
          <p className="text-2xl font-headline font-bold text-on-surface mt-1">
            {users.filter((u) => u.disabled).length}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <input
          type="text"
          placeholder="Search by name, email, uid, role, or org id..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pib-input w-full md:flex-1"
        />
        <div className="flex gap-3">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
            className="pib-input"
            aria-label="Filter by role"
          >
            <option value="all">All roles</option>
            <option value="admin">Admin</option>
            <option value="client">Client</option>
            <option value="unknown">Unknown</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="pib-input"
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="unverified">Unverified</option>
          </select>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedVisible.length > 0 && (
        <div className="pib-card flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-sm font-medium text-on-surface">
            {selectedVisible.length} selected
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setConfirm({ kind: 'bulk-suspend', uids: selectedVisible.map((u) => u.uid) })}
              className="pib-btn-ghost text-xs font-label"
            >
              Suspend
            </button>
            <button
              type="button"
              onClick={() => setConfirm({ kind: 'bulk-unsuspend', uids: selectedVisible.map((u) => u.uid) })}
              className="pib-btn-ghost text-xs font-label"
            >
              Unsuspend
            </button>
            <button
              type="button"
              onClick={() => setConfirm({ kind: 'bulk-delete', uids: selectedVisible.map((u) => u.uid) })}
              className="pib-btn-ghost text-xs font-label"
              style={{ color: '#dc2626' }}
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="pib-btn-ghost text-xs font-label"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="pib-card p-6 text-center text-sm text-on-surface-variant">
          {users.length === 0 ? 'No users found.' : 'No matches.'}
        </div>
      ) : (
        <div className="pib-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-on-surface/10">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all visible"
                  />
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                  User
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant hidden sm:table-cell">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant hidden md:table-cell">
                  Role
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant hidden lg:table-cell">
                  Last login
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant hidden lg:table-cell">
                  Organisation
                </th>
                <th className="text-right px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const busy = busyUid === u.uid
                const isSelected = selected.has(u.uid)
                return (
                  <tr
                    key={u.uid}
                    className="border-b border-on-surface/5 last:border-0 hover:bg-on-surface/5 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(u.uid)}
                        aria-label={`Select ${u.email || u.uid}`}
                      />
                    </td>

                    {/* Avatar + Name + Email */}
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setDetailUser(u)}
                        className="flex items-center gap-3 min-w-0 text-left w-full"
                        title="View details"
                      >
                        <Avatar name={u.displayName} email={u.email} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-on-surface truncate">
                              {u.displayName || '(no name)'}
                            </span>
                            <span className="sm:hidden">
                              <StatusBadge u={u} />
                            </span>
                            <span className="md:hidden">
                              <RoleBadge role={u.role} />
                            </span>
                          </div>
                          <p className="text-xs text-on-surface-variant truncate">{u.email}</p>
                          <span className="text-[11px] text-on-surface-variant/60 font-mono truncate block">
                            {u.uid}
                          </span>
                        </div>
                      </button>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <StatusBadge u={u} />
                    </td>

                    {/* Role */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <RoleBadge role={u.role} />
                    </td>

                    {/* Last login */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-on-surface-variant" title={u.lastSignInTime ?? undefined}>
                        {relativeTime(u.lastSignInTime)}
                      </span>
                    </td>

                    {/* Org */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {u.orgId ? (
                        <Link
                          href={`/admin/organizations/${u.orgId}`}
                          className="text-xs text-on-surface-variant font-mono underline hover:text-on-surface"
                        >
                          {u.orgId}
                        </Link>
                      ) : (
                        <span className="text-xs text-on-surface-variant/40">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setDetailUser(u)}
                          className="pib-btn-ghost text-xs font-label"
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          onClick={() => impersonate(u)}
                          disabled={busy}
                          className="pib-btn-ghost text-xs font-label"
                        >
                          {busy ? 'Working...' : 'Impersonate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-on-surface-variant text-center">
        Showing {filtered.length} of {users.length} users (capped at 1 000 from Firebase Auth)
      </p>

      {/* Detail drawer */}
      <DialogDrawer
        open={!!detailUser}
        title={detailUser?.displayName || detailUser?.email || 'User detail'}
        description={detailUser?.email}
        onClose={() => setDetailUser(null)}
        footer={
          detailUser ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => impersonate(detailUser)}
                className="pib-btn-ghost text-xs font-label"
              >
                Impersonate
              </button>
              <button
                type="button"
                onClick={() => setConfirm({ kind: 'reset', user: detailUser })}
                className="pib-btn-ghost text-xs font-label"
              >
                Reset password
              </button>
              {detailUser.disabled ? (
                <button
                  type="button"
                  onClick={() => setConfirm({ kind: 'unsuspend', user: detailUser })}
                  className="pib-btn-ghost text-xs font-label"
                >
                  Unsuspend
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirm({ kind: 'suspend', user: detailUser })}
                  className="pib-btn-ghost text-xs font-label"
                >
                  Suspend
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirm({ kind: 'delete', user: detailUser })}
                className="pib-btn-ghost text-xs font-label"
                style={{ color: '#dc2626' }}
              >
                Delete
              </button>
            </div>
          ) : null
        }
      >
        {detailUser && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={detailUser.displayName} email={detailUser.email} />
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge u={detailUser} />
                <RoleBadge role={detailUser.role} />
                {detailUser.emailVerified ? (
                  <StatusPill tone="info">Email verified</StatusPill>
                ) : (
                  <StatusPill tone="warn">Email unverified</StatusPill>
                )}
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-3 text-sm">
              <DetailRow label="Display name" value={detailUser.displayName || '(none)'} />
              <DetailRow label="Email" value={detailUser.email || '(none)'} />
              <DetailRow
                label="UID"
                value={
                  <button
                    type="button"
                    onClick={() => copyUid(detailUser.uid)}
                    className="font-mono text-xs underline text-on-surface-variant hover:text-on-surface text-left"
                    title="Copy UID"
                  >
                    {detailUser.uid}
                  </button>
                }
              />
              <DetailRow label="Role" value={detailUser.role} />
              <DetailRow
                label="Organisation"
                value={
                  detailUser.orgId ? (
                    <Link
                      href={`/admin/organizations/${detailUser.orgId}`}
                      className="font-mono text-xs underline text-on-surface-variant hover:text-on-surface"
                    >
                      {detailUser.orgId}
                    </Link>
                  ) : (
                    '—'
                  )
                }
              />
              <DetailRow
                label="Created"
                value={detailUser.createdAt ? new Date(detailUser.createdAt).toLocaleString() : '—'}
              />
              <DetailRow
                label="Last login"
                value={
                  detailUser.lastSignInTime
                    ? `${new Date(detailUser.lastSignInTime).toLocaleString()} (${relativeTime(detailUser.lastSignInTime)})`
                    : 'Never'
                }
              />
              <DetailRow label="Status" value={userStatus(detailUser).label} />
            </dl>
          </div>
        )}
      </DialogDrawer>

      {/* Confirm dialog */}
      <DialogDrawer
        open={!!confirm && !!confirmCopy}
        title={confirmCopy?.title ?? ''}
        onClose={confirmBusy ? undefined : () => setConfirm(null)}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirm(null)}
              disabled={confirmBusy}
              className="pib-btn-ghost text-sm font-label"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={runConfirm}
              disabled={confirmBusy}
              className={confirmCopy?.danger ? 'pib-btn-ghost text-sm font-label' : 'pib-btn-primary text-sm font-label'}
              style={confirmCopy?.danger ? { color: '#fff', background: '#dc2626' } : undefined}
            >
              {confirmBusy ? 'Working...' : confirmCopy?.cta}
            </button>
          </div>
        }
      >
        <p className="text-sm text-on-surface-variant">{confirmCopy?.body}</p>
      </DialogDrawer>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</dt>
      <dd className="text-sm text-on-surface break-words">{value}</dd>
    </div>
  )
}
