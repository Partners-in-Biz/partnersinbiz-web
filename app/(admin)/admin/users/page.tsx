'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { copyToClipboard } from '@/lib/utils/clipboard'

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

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busyUid, setBusyUid] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/users')
      const body = await res.json() as { success?: boolean; data?: { users?: AdminUserView[] }; error?: string }
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
    if (!q) return users
    return users.filter((u) =>
      [u.displayName, u.email, u.uid, u.role, u.orgId ?? ''].join(' ').toLowerCase().includes(q),
    )
  }, [users, search])

  async function impersonate(user: AdminUserView) {
    setBusyUid(user.uid)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/users/${user.uid}/impersonate`, { method: 'POST' })
      const body = await res.json() as { success?: boolean; data?: { customToken?: string }; error?: string }
      if (!res.ok) {
        setError(body.error ?? 'Failed to generate impersonation token')
        return
      }
      const customToken = body.data?.customToken
      if (!customToken) {
        setError('No token returned')
        return
      }
      // Open the impersonate page in a new tab with the token
      window.open(`/admin/impersonate?token=${encodeURIComponent(customToken)}`, '_blank')
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

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Admin / Users
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">All Users</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Browse every Firebase Auth user, view their role and organisation, and impersonate
            them for debugging.
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

      <input
        type="text"
        placeholder="Search by name, email, uid, role, or org id..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="pib-input w-full"
      />

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
                <th className="text-left px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                  User
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant hidden md:table-cell">
                  Role
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant hidden lg:table-cell">
                  Organisation
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant hidden xl:table-cell">
                  Created
                </th>
                <th className="text-right px-4 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const busy = busyUid === u.uid
                return (
                  <tr
                    key={u.uid}
                    className="border-b border-on-surface/5 last:border-0 hover:bg-on-surface/5 transition-colors"
                  >
                    {/* Avatar + Name + Email */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={u.displayName} email={u.email} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-on-surface truncate">
                              {u.displayName || '(no name)'}
                            </span>
                            {u.disabled && (
                              <span className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">
                                Disabled
                              </span>
                            )}
                            <span className="md:hidden">
                              <RoleBadge role={u.role} />
                            </span>
                          </div>
                          <p className="text-xs text-on-surface-variant truncate">{u.email}</p>
                          <button
                            type="button"
                            onClick={() => copyUid(u.uid)}
                            className="text-[11px] text-on-surface-variant/60 hover:text-on-surface-variant font-mono truncate block text-left mt-0.5"
                            title="Copy UID"
                          >
                            {u.uid}
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Role */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <RoleBadge role={u.role} />
                    </td>

                    {/* Org */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {u.orgId ? (
                        <span className="text-xs text-on-surface-variant font-mono">{u.orgId}</span>
                      ) : (
                        <span className="text-xs text-on-surface-variant/40">—</span>
                      )}
                    </td>

                    {/* Created */}
                    <td className="px-4 py-3 hidden xl:table-cell">
                      <span className="text-xs text-on-surface-variant">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
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
    </div>
  )
}
