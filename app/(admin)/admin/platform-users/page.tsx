'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { resetPassword } from '@/lib/firebase/auth'
import { copyToClipboard } from '@/lib/utils/clipboard'

interface PlatformUser {
  uid: string
  email: string
  displayName: string
  role: 'admin'
  orgId?: string
  allowedOrgIds: string[]
  isSuperAdmin: boolean
  createdAt?: { _seconds?: number }
  lastSignInTime?: string | null
}

interface OrgOption {
  id: string
  name: string
  slug: string
  type?: string
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function Avatar({ name }: { name: string }) {
  const initials = (name || '?')
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

function ScopeBadge({ user }: { user: PlatformUser }) {
  if (user.isSuperAdmin) {
    return (
      <span
        className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
        style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--color-accent-v2)' }}
      >
        Super admin
      </span>
    )
  }
  return (
    <span
      className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ background: 'rgba(37, 99, 235, 0.15)', color: '#2563eb' }}
    >
      {user.allowedOrgIds.length} org{user.allowedOrgIds.length === 1 ? '' : 's'}
    </span>
  )
}

export default function PlatformUsersPage() {
  const [users, setUsers] = useState<PlatformUser[]>([])
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [loading, setLoading] = useState(true)
  const [topError, setTopError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [setupLinkByUid, setSetupLinkByUid] = useState<Record<string, string>>({})
  const [passwordUid, setPasswordUid] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // Create form
  const [creating, setCreating] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createSuper, setCreateSuper] = useState(false)
  const [createAllowed, setCreateAllowed] = useState<Set<string>>(new Set())
  const [createError, setCreateError] = useState<string | null>(null)
  const [setupLink, setSetupLink] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  // Edit dialog
  const [editingUid, setEditingUid] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSuper, setEditSuper] = useState(false)
  const [editAllowed, setEditAllowed] = useState<Set<string>>(new Set())
  const [editError, setEditError] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  // Delete
  const [deletingUid, setDeletingUid] = useState<string | null>(null)

  // Filter
  const [search, setSearch] = useState('')

  const orgsById = useMemo(() => {
    const m = new Map<string, OrgOption>()
    for (const o of orgs) m.set(o.id, o)
    return m
  }, [orgs])

  // Hide the platform_owner org from selectable client list — it's the
  // implicit "home" org of every staff account, not a client they manage.
  const clientOrgs = useMemo(
    () => orgs.filter((o) => o.type !== 'platform_owner'),
    [orgs],
  )

  async function load() {
    setLoading(true)
    try {
      const [uRes, oRes] = await Promise.all([
        fetch('/api/v1/admin/platform-users'),
        fetch('/api/v1/organizations'),
      ])
      const uBody = await uRes.json()
      const oBody = await oRes.json()
      if (!uRes.ok) {
        setTopError(uBody?.error ?? 'Failed to load users')
      } else {
        setUsers(uBody.data ?? [])
      }
      if (oRes.ok) setOrgs(oBody.data ?? [])
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return users
    const q = search.trim().toLowerCase()
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q),
    )
  }, [users, search])

  function toggleSet(set: Set<string>, id: string): Set<string> {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setSetupLink(null)
    if (!createName.trim() || !createEmail.trim()) {
      setCreateError('Name and email are required')
      return
    }
    if (!createSuper && createAllowed.size === 0) {
      setCreateError('Pick at least one organisation, or mark this user as a super admin.')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/v1/admin/platform-users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          email: createEmail.trim(),
          allowedOrgIds: createSuper ? [] : Array.from(createAllowed),
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setCreateError(body?.error ?? 'Failed to create user')
      } else {
        setSetupLink(body.data?.setupLink ?? null)
        setCreateName('')
        setCreateEmail('')
        setCreateSuper(false)
        setCreateAllowed(new Set())
        await load()
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setCreating(false)
    }
  }

  function startEdit(u: PlatformUser) {
    setEditingUid(u.uid)
    setEditName(u.displayName)
    setEditSuper(u.isSuperAdmin)
    setEditAllowed(new Set(u.allowedOrgIds))
    setEditError(null)
  }

  async function saveEdit() {
    if (!editingUid) return
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch(`/api/v1/admin/platform-users/${editingUid}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          allowedOrgIds: editSuper ? [] : Array.from(editAllowed),
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setEditError(body?.error ?? 'Failed to save')
      } else {
        setEditingUid(null)
        await load()
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setEditSaving(false)
    }
  }

  async function deleteUser(uid: string) {
    if (!confirm('Remove this platform admin? Their Firebase Auth account will also be deleted.')) return
    setDeletingUid(uid)
    try {
      const res = await fetch(`/api/v1/admin/platform-users/${uid}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) alert(body?.error ?? 'Failed to delete')
      else await load()
    } finally {
      setDeletingUid(null)
    }
  }

  async function sendFirebaseReset(u: PlatformUser) {
    setBusyUid(u.uid)
    setNotice(null)
    setTopError(null)
    try {
      await resetPassword(u.email)
      setNotice(`Firebase reset email sent to ${u.email}.`)
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to send Firebase reset email')
    } finally {
      setBusyUid(null)
    }
  }

  async function createSetupLink(u: PlatformUser) {
    setBusyUid(u.uid)
    setNotice(null)
    setTopError(null)
    try {
      const res = await fetch(`/api/v1/admin/platform-users/${u.uid}/reset`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to create setup link')
      const link = body.data?.setupLink
      if (link) {
        setSetupLinkByUid((prev) => ({ ...prev, [u.uid]: link }))
        await copyToClipboard(link)
        setNotice(`Setup link copied for ${u.email}.`)
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to create setup link')
    } finally {
      setBusyUid(null)
    }
  }

  async function savePassword(u: PlatformUser) {
    setBusyUid(u.uid)
    setPasswordError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/platform-users/${u.uid}/password`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to set password')
      setNotice(`Password updated for ${u.email}.`)
      setPasswordUid(null)
      setNewPassword('')
      await load()
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to set password')
    } finally {
      setBusyUid(null)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Platform Users</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Internal Partners in Biz staff. Each user can be granted access to specific client organisations.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="pib-btn-primary text-sm font-label"
        >
          {showCreate ? 'Cancel' : '+ Add platform user'}
        </button>
      </div>

      {topError && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {topError}
        </div>
      )}

      {notice && (
        <div className="pib-card border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-400">
          {notice}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="pib-card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Name
              </span>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Jane Doe"
                className="pib-input w-full mt-1"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Email
              </span>
              <input
                type="email"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                placeholder="jane@partnersinbiz.online"
                className="pib-input w-full mt-1"
                required
              />
            </label>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={createSuper}
              onChange={(e) => setCreateSuper(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm text-on-surface">
              <strong>Super admin</strong> — full access to every organisation
            </span>
          </label>

          {!createSuper && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                  Organisations they can manage
                </span>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    className="pib-btn-ghost text-xs"
                    onClick={() => setCreateAllowed(new Set(clientOrgs.map((o) => o.id)))}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="pib-btn-ghost text-xs"
                    onClick={() => setCreateAllowed(new Set())}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pib-card p-3">
                {clientOrgs.length === 0 && (
                  <p className="text-xs text-on-surface-variant col-span-2">No client organisations yet.</p>
                )}
                {clientOrgs.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm cursor-pointer p-1 rounded hover:bg-on-surface/5">
                    <input
                      type="checkbox"
                      checked={createAllowed.has(o.id)}
                      onChange={() => setCreateAllowed((s) => toggleSet(s, o.id))}
                      className="w-4 h-4"
                    />
                    <span className="truncate">{o.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {createError && (
            <p className="text-sm text-red-400">{createError}</p>
          )}

          {setupLink && (
            <div className="pib-card border border-green-500/30 bg-green-500/5 p-3 text-xs">
              <p className="text-green-400 font-label uppercase tracking-wide mb-1">User created</p>
              <p className="text-on-surface-variant">A welcome email with a password setup link has been sent. You can also share this link directly:</p>
              <code className="block mt-2 break-all bg-black/20 p-2 rounded text-[11px]">{setupLink}</code>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="pib-btn-ghost text-sm font-label"
              disabled={creating}
            >
              Cancel
            </button>
            <button type="submit" className="pib-btn-primary text-sm font-label" disabled={creating}>
              {creating ? 'Creating...' : 'Create platform user'}
            </button>
          </div>
        </form>
      )}

      {/* Search */}
      <input
        type="text"
        placeholder="Search by name or email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="pib-input w-full"
      />

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="pib-card p-6 text-center text-sm text-on-surface-variant">
          {users.length === 0 ? 'No platform users yet. Add one above.' : 'No matches.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((u) => {
            const isEditing = editingUid === u.uid
            const showPassword = passwordUid === u.uid
            const busy = busyUid === u.uid
            return (
              <li key={u.uid} className="pib-card p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Avatar name={u.displayName || u.email} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-on-surface truncate">
                          {u.displayName || '(no name)'}
                        </span>
                        <ScopeBadge user={u} />
                      </div>
                      <p className="text-xs text-on-surface-variant truncate">{u.email}</p>
                      {u.lastSignInTime ? (
                        <p className="text-[11px] text-on-surface-variant/60 mt-0.5">
                          Last login: {new Date(u.lastSignInTime).toLocaleString()}
                        </p>
                      ) : (
                        <p className="text-[11px] text-on-surface-variant/40 mt-0.5">Never signed in</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    {!isEditing && (
                      <>
                        <button
                          onClick={() => sendFirebaseReset(u)}
                          disabled={busy || !u.email}
                          className="pib-btn-secondary text-xs font-label"
                        >
                          {busy ? 'Working...' : 'Send reset email'}
                        </button>
                        <button
                          onClick={() => createSetupLink(u)}
                          disabled={busy || !u.email}
                          className="pib-btn-ghost text-xs font-label"
                        >
                          Setup link
                        </button>
                        <button
                          onClick={() => {
                            setPasswordUid(showPassword ? null : u.uid)
                            setNewPassword('')
                            setPasswordError(null)
                          }}
                          disabled={busy}
                          className="pib-btn-ghost text-xs font-label"
                        >
                          {showPassword ? 'Cancel' : 'Set password'}
                        </button>
                        <button
                          onClick={() => startEdit(u)}
                          className="pib-btn-ghost text-xs font-label"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteUser(u.uid)}
                          disabled={deletingUid === u.uid}
                          className="pib-btn-ghost text-xs font-label text-red-400 hover:text-red-300"
                          title="Delete platform user"
                        >
                          {deletingUid === u.uid ? '...' : 'Delete'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {setupLinkByUid[u.uid] && (
                  <div className="mt-3 rounded-md border border-on-surface/10 bg-on-surface/5 p-3">
                    <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
                      Setup link
                    </p>
                    <code className="block text-[11px] break-all text-on-surface-variant">
                      {setupLinkByUid[u.uid]}
                    </code>
                  </div>
                )}

                {showPassword && (
                  <div className="mt-4 rounded-md border border-on-surface/10 bg-on-surface/5 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="New password, minimum 8 characters"
                        className="pib-input flex-1"
                        autoComplete="new-password"
                      />
                      <button
                        onClick={() => savePassword(u)}
                        disabled={busy || newPassword.length < 8}
                        className="pib-btn-primary text-sm font-label"
                      >
                        Save password
                      </button>
                    </div>
                    {passwordError && <p className="text-xs text-red-400 mt-2">{passwordError}</p>}
                  </div>
                )}

                {/* Org list */}
                {!isEditing && !u.isSuperAdmin && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {u.allowedOrgIds.map((id) => {
                      const o = orgsById.get(id)
                      return (
                        <span
                          key={id}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-on-surface/10 text-on-surface-variant"
                        >
                          {o?.name ?? id}
                        </span>
                      )
                    })}
                  </div>
                )}

                {/* Edit form */}
                {isEditing && (
                  <div className="mt-4 space-y-3 border-t border-on-surface/10 pt-4">
                    <label className="block">
                      <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                        Name
                      </span>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="pib-input w-full mt-1"
                      />
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editSuper}
                        onChange={(e) => setEditSuper(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm text-on-surface">
                        <strong>Super admin</strong> — full access to every organisation
                      </span>
                    </label>

                    {!editSuper && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                            Organisations
                          </span>
                          <div className="flex gap-2 text-xs">
                            <button
                              type="button"
                              className="pib-btn-ghost text-xs"
                              onClick={() => setEditAllowed(new Set(clientOrgs.map((o) => o.id)))}
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              className="pib-btn-ghost text-xs"
                              onClick={() => setEditAllowed(new Set())}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pib-card p-3">
                          {clientOrgs.map((o) => (
                            <label key={o.id} className="flex items-center gap-2 text-sm cursor-pointer p-1 rounded hover:bg-on-surface/5">
                              <input
                                type="checkbox"
                                checked={editAllowed.has(o.id)}
                                onChange={() => setEditAllowed((s) => toggleSet(s, o.id))}
                                className="w-4 h-4"
                              />
                              <span className="truncate">{o.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {editError && <p className="text-sm text-red-400">{editError}</p>}

                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingUid(null)}
                        className="pib-btn-ghost text-xs font-label"
                        disabled={editSaving}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveEdit}
                        className="pib-btn-primary text-xs font-label"
                        disabled={editSaving}
                      >
                        {editSaving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
