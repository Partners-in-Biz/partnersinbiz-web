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
      className="w-9 h-9 rounded-md flex items-center justify-center text-xs font-medium text-[var(--color-pib-ink)] flex-shrink-0"
      style={{ backgroundColor: 'var(--color-pib-cyan)' }}
    >
      {initials || '?'}
    </div>
  )
}

function ScopeBadge({ user }: { user: PlatformUser }) {
  if (user.isSuperAdmin) {
    return (
      <span className="pib-pill pib-pill-accent">
        Super admin
      </span>
    )
  }
  return (
    <span className="pib-pill pib-pill-blue">
      Restricted admin
    </span>
  )
}

function adminScopeLabel(user: PlatformUser) {
  if (user.isSuperAdmin) return 'allowedOrgIds: [] means global access'
  return `allowedOrgIds: ${user.allowedOrgIds.length} client org${user.allowedOrgIds.length === 1 ? '' : 's'}`
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

  // Hide the platform_owner org from selectable client list  -  it's the
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
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Admin · Access</p>
          <h1 className="pib-page-title mt-2">Platform Admin Users</h1>
          <p className="pib-page-sub">
            Staff accounts for PiB operators. Super admins have global platform access; restricted admins are limited by allowedOrgIds.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="btn-pib-primary"
        >
          {showCreate ? 'Cancel' : '+ Add platform user'}
        </button>
      </header>

      {topError && (
        <div className="pib-card px-4 py-3 text-sm text-[var(--color-error)]">
          {topError}
        </div>
      )}

      {notice && (
        <div className="pib-card px-4 py-3 text-sm text-[var(--color-pib-green)]">
          {notice}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="pib-card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="pib-label">
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
              <span className="pib-label">
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
            <span className="text-sm text-[var(--color-pib-text)]">
              <strong>Super admin</strong>  -  full platform-admin access to every client workspace. The API stores this as an empty allowedOrgIds list.
            </span>
          </label>

          {!createSuper && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="pib-label">
                  allowedOrgIds for this restricted admin
                </span>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    className="btn-pib-ghost text-xs"
                    onClick={() => setCreateAllowed(new Set(clientOrgs.map((o) => o.id)))}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="btn-pib-ghost text-xs"
                    onClick={() => setCreateAllowed(new Set())}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pib-card p-3">
                {clientOrgs.length === 0 && (
                  <p className="text-xs text-[var(--color-pib-text-muted)] col-span-2">No client organisations yet.</p>
                )}
                {clientOrgs.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm cursor-pointer p-1 rounded hover:bg-[var(--color-row-hover)]">
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
            <p className="text-sm text-[var(--color-error)]">{createError}</p>
          )}

          {setupLink && (
            <div className="pib-card p-3 text-xs">
              <p className="pib-label text-[var(--color-pib-green)] mb-1">User created</p>
              <p className="text-[var(--color-pib-text-muted)]">A welcome email with a password setup link has been sent. You can also share this link directly:</p>
              <code className="block mt-2 break-all bg-[var(--color-pib-surface-2)] p-2 rounded text-[11px]">{setupLink}</code>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="btn-pib-ghost text-sm font-label"
              disabled={creating}
            >
              Cancel
            </button>
            <button type="submit" className="btn-pib-primary text-sm font-label" disabled={creating}>
              {creating ? 'Creating...' : 'Create platform user'}
            </button>
          </div>
        </form>
      )}

      {/* Search */}
      <input aria-label="Search by name or email"
        type="text"
        placeholder="Search by name or email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="pib-input w-full"
      />

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-md" />
          <Skeleton className="h-16 rounded-md" />
          <Skeleton className="h-16 rounded-md" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="pib-card p-6 text-center text-sm text-[var(--color-pib-text-muted)]">
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
                        <span className="text-sm font-medium text-[var(--color-pib-text)] truncate">
                          {u.displayName || '(no name)'}
                        </span>
                        <ScopeBadge user={u} />
                      </div>
                      <p className="text-xs text-[var(--color-pib-text-muted)] truncate">{u.email}</p>
                      <p className="text-[11px] text-[var(--color-pib-text-faint)] mt-0.5 font-mono">
                        {adminScopeLabel(u)}
                      </p>
                      {u.lastSignInTime ? (
                        <p className="text-[11px] text-[var(--color-pib-text-faint)] mt-0.5">
                          Last login: {new Date(u.lastSignInTime).toLocaleString()}
                        </p>
                      ) : (
                        <p className="text-[11px] text-[var(--color-pib-text-faint)] mt-0.5">Never signed in</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    {!isEditing && (
                      <>
                        <button
                          onClick={() => sendFirebaseReset(u)}
                          disabled={busy || !u.email}
                          className="btn-pib-secondary text-xs font-label"
                        >
                          {busy ? 'Working...' : 'Send reset email'}
                        </button>
                        <button
                          onClick={() => createSetupLink(u)}
                          disabled={busy || !u.email}
                          className="btn-pib-ghost text-xs font-label"
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
                          className="btn-pib-ghost text-xs font-label"
                        >
                          {showPassword ? 'Cancel' : 'Set password'}
                        </button>
                        <button
                          onClick={() => startEdit(u)}
                          className="btn-pib-ghost text-xs font-label"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteUser(u.uid)}
                          disabled={deletingUid === u.uid}
                          className="btn-pib-ghost text-xs font-label text-[var(--color-error)]"
                          title="Delete platform user"
                        >
                          {deletingUid === u.uid ? '...' : 'Delete'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {setupLinkByUid[u.uid] && (
                  <div className="mt-3 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3">
                    <p className="pib-label mb-1">
                      Setup link
                    </p>
                    <code className="block text-[11px] break-all text-[var(--color-pib-text-muted)]">
                      {setupLinkByUid[u.uid]}
                    </code>
                  </div>
                )}

                {showPassword && (
                  <div className="mt-4 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input aria-label="New password, minimum 8 characters"
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
                        className="btn-pib-primary text-sm font-label"
                      >
                        Save password
                      </button>
                    </div>
                    {passwordError && <p className="text-xs text-[var(--color-error)] mt-2">{passwordError}</p>}
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
                          className="text-[11px] px-2 py-0.5 rounded-md bg-[var(--color-pib-surface-2)] text-[var(--color-pib-text-muted)]"
                        >
                          {o?.name ?? id}
                        </span>
                      )
                    })}
                  </div>
                )}

                {/* Edit form */}
                {isEditing && (
                  <div className="mt-4 space-y-3 border-t border-[var(--color-pib-line)] pt-4">
                    <label className="block">
                      <span className="pib-label">
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
                      <span className="text-sm text-[var(--color-pib-text)]">
                        <strong>Super admin</strong>  -  full platform-admin access to every client workspace. Save with allowedOrgIds as an empty list.
                      </span>
                    </label>

                    {!editSuper && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="pib-label">
                            allowedOrgIds for this restricted admin
                          </span>
                          <div className="flex gap-2 text-xs">
                            <button
                              type="button"
                              className="btn-pib-ghost text-xs"
                              onClick={() => setEditAllowed(new Set(clientOrgs.map((o) => o.id)))}
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              className="btn-pib-ghost text-xs"
                              onClick={() => setEditAllowed(new Set())}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pib-card p-3">
                          {clientOrgs.map((o) => (
                            <label key={o.id} className="flex items-center gap-2 text-sm cursor-pointer p-1 rounded hover:bg-[var(--color-row-hover)]">
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

                    {editError && <p className="text-sm text-[var(--color-error)]">{editError}</p>}

                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingUid(null)}
                        className="btn-pib-ghost text-xs font-label"
                        disabled={editSaving}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveEdit}
                        className="btn-pib-primary text-xs font-label"
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
