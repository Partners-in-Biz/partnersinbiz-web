'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { resetPassword } from '@/lib/firebase/auth'
import { copyToClipboard } from '@/lib/utils/clipboard'

type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'

interface LinkedClientOrg {
  id: string
  name: string
  slug: string
  role?: OrgRole
  source: 'membership' | 'user'
}

interface PlatformMember {
  uid: string
  email: string
  displayName: string
  role: 'client'
  orgId?: string
  orgIds: string[]
  linkedOrgs: LinkedClientOrg[]
  authFound: boolean
  emailVerified?: boolean
  disabled?: boolean
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

function RoleBadge({ role }: { role?: OrgRole }) {
  if (!role) return null
  const colors: Record<OrgRole, string> = {
    owner: 'var(--color-accent-v2)',
    admin: '#2563eb',
    member: '#6b7280',
    viewer: '#9ca3af',
  }
  return (
    <span
      className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ background: `${colors[role]}20`, color: colors[role] }}
    >
      {role}
    </span>
  )
}

export default function PlatformMembersPage() {
  const [members, setMembers] = useState<PlatformMember[]>([])
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [loading, setLoading] = useState(true)
  const [topError, setTopError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [passwordUid, setPasswordUid] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [setupLinkByUid, setSetupLinkByUid] = useState<Record<string, string>>({})
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createOrgId, setCreateOrgId] = useState('')
  const [createRole, setCreateRole] = useState<OrgRole>('member')
  const [createPassword, setCreatePassword] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const clientOrgs = useMemo(
    () => orgs.filter((org) => org.type !== 'platform_owner'),
    [orgs],
  )

  async function load() {
    setLoading(true)
    setTopError(null)
    try {
      const [membersRes, orgsRes] = await Promise.all([
        fetch('/api/v1/admin/platform-members'),
        fetch('/api/v1/organizations'),
      ])
      const membersBody = await membersRes.json()
      const orgsBody = await orgsRes.json()
      if (!membersRes.ok) {
        setTopError(membersBody?.error ?? 'Failed to load platform members')
        setMembers([])
      } else {
        setMembers(membersBody.data ?? [])
      }
      if (orgsRes.ok) setOrgs(orgsBody.data ?? [])
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load platform members')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter((member) => {
      const haystack = [
        member.displayName,
        member.email,
        member.uid,
        ...member.linkedOrgs.map((org) => `${org.name} ${org.slug} ${org.id}`),
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [members, search])

  async function sendFirebaseReset(member: PlatformMember) {
    setBusyUid(member.uid)
    setNotice(null)
    try {
      await resetPassword(member.email)
      setNotice(`Firebase reset email sent to ${member.email}.`)
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to send Firebase reset email')
    } finally {
      setBusyUid(null)
    }
  }

  async function createSetupLink(member: PlatformMember) {
    setBusyUid(member.uid)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/platform-members/${member.uid}/reset`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to create setup link')
      const setupLink = body.data?.setupLink
      if (setupLink) {
        setSetupLinkByUid((prev) => ({ ...prev, [member.uid]: setupLink }))
        await copyToClipboard(setupLink)
        setNotice(`Setup link copied for ${member.email}.`)
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to create setup link')
    } finally {
      setBusyUid(null)
    }
  }

  async function savePassword(member: PlatformMember) {
    setBusyUid(member.uid)
    setPasswordError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/platform-members/${member.uid}/password`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to set password')
      setNotice(`Password updated for ${member.email}.`)
      setPasswordUid(null)
      setNewPassword('')
      await load()
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to set password')
    } finally {
      setBusyUid(null)
    }
  }

  async function updateOrgRole(member: PlatformMember, org: LinkedClientOrg, role: OrgRole) {
    const label = member.displayName || member.email || member.uid
    setBusyUid(member.uid)
    setTopError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/organizations/${org.id}/members/${member.uid}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to update member role')
      setNotice(`Updated ${label} to ${role} in ${org.name}.`)
      await load()
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to update member role')
    } finally {
      setBusyUid(null)
    }
  }

  async function removeOrgLink(member: PlatformMember, org: LinkedClientOrg) {
    const label = member.displayName || member.email || member.uid
    const confirmed = window.confirm(
      `Remove ${label} from ${org.name}? This removes their client portal access for that organisation.`,
    )
    if (!confirmed) return

    setBusyUid(member.uid)
    setTopError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/organizations/${org.id}/members/${member.uid}`, {
        method: 'DELETE',
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to remove organisation link')
      setNotice(`Removed ${label} from ${org.name}.`)
      await load()
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to remove organisation link')
    } finally {
      setBusyUid(null)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setTopError(null)
    setNotice(null)
    if (!createName.trim() || !createEmail.trim()) {
      setCreateError('Name and email are required')
      return
    }
    if (!createOrgId) {
      setCreateError('Choose the client account this login belongs to')
      return
    }
    if (createPassword.length < 8) {
      setCreateError('Password must be at least 8 characters')
      return
    }

    setCreating(true)
    try {
      const res = await fetch('/api/v1/admin/platform-members', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          email: createEmail.trim(),
          orgId: createOrgId,
          role: createRole,
          password: createPassword,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setCreateError(body?.error ?? 'Failed to add portal login')
        return
      }

      setNotice(`Portal login created for ${createEmail.trim()}.`)
      setCreateName('')
      setCreateEmail('')
      setCreateOrgId('')
      setCreateRole('member')
      setCreatePassword('')
      setShowCreate(false)
      await load()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to add portal login')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Settings / Platform
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Client Portal Access</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Platform-admin controls for client portal logins, account links, role changes, resets, and access removal.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start md:self-auto">
          <button
            onClick={() => setShowCreate((value) => !value)}
            className="pib-btn-primary text-sm font-label"
          >
            {showCreate ? 'Cancel' : '+ Add portal login'}
          </button>
          <Link href="/admin/settings" className="pib-btn-ghost text-sm font-label">
            Back to settings
          </Link>
        </div>
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
                placeholder="jane@client.co.za"
                className="pib-input w-full mt-1"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Client account
              </span>
              <select
                value={createOrgId}
                onChange={(e) => setCreateOrgId(e.target.value)}
                className="pib-input w-full mt-1"
                required
              >
                <option value="">Choose client account...</option>
                {clientOrgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Client portal role
              </span>
              <select
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value as OrgRole)}
                className="pib-input w-full mt-1"
              >
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Password
              </span>
              <input
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                placeholder="Set their first password, minimum 8 characters"
                className="pib-input w-full mt-1"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
          </div>
          {createError && <p className="text-xs text-red-400">{createError}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={creating || createPassword.length < 8}
              className="pib-btn-primary text-sm font-label"
            >
              {creating ? 'Adding...' : 'Add portal login'}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="pib-card p-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Portal logins</p>
          <p className="text-2xl font-headline font-bold text-on-surface mt-1">{members.length}</p>
        </div>
        <div className="pib-card p-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Missing Auth</p>
          <p className="text-2xl font-headline font-bold text-on-surface mt-1">
            {members.filter((member) => !member.authFound).length}
          </p>
        </div>
        <div className="pib-card p-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Multi-account users</p>
          <p className="text-2xl font-headline font-bold text-on-surface mt-1">
            {members.filter((member) => member.linkedOrgs.length > 1).length}
          </p>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search by name, email, uid, or client account..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="pib-input w-full"
      />

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="pib-card p-6 text-center text-sm text-on-surface-variant">
          {members.length === 0 ? 'No client logins found.' : 'No matches.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((member) => {
            const showPassword = passwordUid === member.uid
            const busy = busyUid === member.uid
            return (
              <li key={member.uid} className="pib-card p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <Avatar name={member.displayName || member.email} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-on-surface truncate">
                          {member.displayName || '(no name)'}
                        </p>
                        {!member.authFound && (
                          <span className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">
                            Auth missing
                          </span>
                        )}
                        {member.disabled && (
                          <span className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">
                            Disabled
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-on-surface-variant truncate">{member.email}</p>
                      <p className="text-[11px] text-on-surface-variant/60 mt-0.5 font-mono truncate">
                        {member.uid}
                      </p>
                      {member.lastSignInTime ? (
                        <p className="text-[11px] text-on-surface-variant/60 mt-0.5">
                          Last login: {new Date(member.lastSignInTime).toLocaleString()}
                        </p>
                      ) : (
                        <p className="text-[11px] text-on-surface-variant/40 mt-0.5">Never signed in</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <button
                      onClick={() => sendFirebaseReset(member)}
                      disabled={busy || !member.email || !member.authFound}
                      className="pib-btn-secondary text-xs font-label"
                    >
                      {busy ? 'Working...' : 'Send reset email'}
                    </button>
                    <button
                      onClick={() => createSetupLink(member)}
                      disabled={busy || !member.email || !member.authFound}
                      className="pib-btn-ghost text-xs font-label"
                    >
                      Setup link
                    </button>
                    <button
                      onClick={() => {
                        setPasswordUid(showPassword ? null : member.uid)
                        setNewPassword('')
                        setPasswordError(null)
                      }}
                      disabled={busy || !member.authFound}
                      className="pib-btn-ghost text-xs font-label"
                    >
                      {showPassword ? 'Cancel' : 'Set password'}
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {member.linkedOrgs.length === 0 ? (
                    <span className="text-xs text-on-surface-variant">No linked client accounts</span>
                  ) : (
                    member.linkedOrgs.map((org) => (
                      <span
                        key={`${member.uid}-${org.id}`}
                        className="inline-flex flex-wrap items-center overflow-hidden rounded-full bg-on-surface/10 text-xs text-on-surface-variant"
                        title={org.source === 'user' ? 'Linked from user profile' : 'Linked from organisation members'}
                      >
                        <Link
                          href={`/admin/org/${org.slug}/dashboard`}
                          className="inline-flex items-center gap-2 px-3 py-1 hover:text-on-surface transition-colors"
                        >
                          <span>{org.name}</span>
                          <RoleBadge role={org.role} />
                          {org.source === 'user' && (
                            <span className="text-[10px] font-label uppercase tracking-wide text-amber-400">
                              profile
                            </span>
                          )}
                        </Link>
                        {org.source === 'membership' ? (
                          <label className="border-l border-on-surface/10 px-2 py-1 text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                            <span className="sr-only">Set {org.name} role</span>
                            <select
                              value={org.role ?? 'member'}
                              onChange={(event) => updateOrgRole(member, org, event.target.value as OrgRole)}
                              disabled={busy}
                              className="bg-transparent text-[10px] uppercase outline-none disabled:opacity-50"
                              title={`Set ${member.email || member.displayName || member.uid} role in ${org.name}`}
                            >
                              <option value="owner">Owner</option>
                              <option value="admin">Admin</option>
                              <option value="member">Member</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          </label>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => removeOrgLink(member, org)}
                          disabled={busy}
                          className="border-l border-on-surface/10 px-2 py-1 text-[10px] font-label uppercase tracking-wide text-on-surface-variant hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                          title={`Remove ${member.email || member.displayName || member.uid} from ${org.name}`}
                        >
                          Remove
                        </button>
                      </span>
                    ))
                  )}
                </div>

                {setupLinkByUid[member.uid] && (
                  <div className="mt-3 rounded-md border border-on-surface/10 bg-on-surface/5 p-3">
                    <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
                      Setup link
                    </p>
                    <code className="block text-[11px] break-all text-on-surface-variant">
                      {setupLinkByUid[member.uid]}
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
                        onClick={() => savePassword(member)}
                        disabled={busy || newPassword.length < 8}
                        className="pib-btn-primary text-sm font-label"
                      >
                        Save password
                      </button>
                    </div>
                    {passwordError && <p className="text-xs text-red-400 mt-2">{passwordError}</p>}
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
