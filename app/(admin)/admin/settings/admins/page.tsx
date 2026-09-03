// app/(admin)/admin/settings/admins/page.tsx
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

interface AdminUser {
  uid: string
  email: string
  name: string
  adminRole: string
  allowedOrgIds: string[]
  active: boolean
  lastLoginAt: string | null
  activeSessions: number
}

const ADMIN_ROLES = ['superadmin', 'support', 'finance', 'content'] as const

const PERMISSION_MATRIX: Record<string, string[]> = {
  superadmin: [
    'Full platform access - all organisations',
    'Manage admins, roles, and deactivation',
    'Edit platform settings, maintenance, and alerts',
    'Billing, legal, moderation, and infrastructure',
  ],
  support: [
    'View and respond to support queues',
    'Read client organisations and members',
    'Trigger client communications',
    'No billing or platform-config write access',
  ],
  finance: [
    'View and process billing, EFT, and invoices',
    'Read revenue, churn, and trial reports',
    'No admin management or infrastructure access',
  ],
  content: [
    'Manage content, announcements, and changelog',
    'Run moderation queues',
    'No billing, admin, or infrastructure access',
  ],
}

const ROLE_BADGE: Record<string, string> = {
  superadmin: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
  support: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  finance: 'bg-[color-mix(in_srgb,var(--st-warning)_12%,transparent)] text-[var(--st-warning)] border-[color-mix(in_srgb,var(--st-warning)_40%,transparent)]',
  content: 'bg-teal-500/10 text-teal-300 border-teal-500/20',
}

export default function AdminsPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyUid, setBusyUid] = useState<string | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('support')
  const [inviting, setInviting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/settings/admins')
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Load failed')
      setAdmins((body.data ?? body) as AdminUser[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load admins.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function invite() {
    setInviting(true)
    setFeedback(null)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/settings/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, name: inviteName, adminRole: inviteRole }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Invite failed')
      setFeedback(`Invited ${inviteEmail} as ${inviteRole}.`)
      setInviteEmail('')
      setInviteName('')
      setInviteRole('support')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not invite admin.')
    } finally {
      setInviting(false)
    }
  }

  async function patchAdmin(uid: string, payload: Record<string, unknown>, label: string) {
    setBusyUid(uid)
    setFeedback(null)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/settings/admins/${encodeURIComponent(uid)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Update failed')
      setFeedback(label)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update admin.')
    } finally {
      setBusyUid(null)
    }
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <header>
        <Link href="/admin/settings" className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">← Settings</Link>
        <p className="eyebrow mt-2">Admin · Access control</p>
        <h1 className="pib-page-title mt-2">Admin Users</h1>
      </header>

      {feedback && <div className="st-panel py-2 text-xs text-[var(--color-pib-green)]">{feedback}</div>}
      {error && <div className="st-panel py-2 text-xs text-[var(--color-error)]">{error}</div>}

      {/* Invite */}
      <div className="st-panel space-y-3">
        <p className="sc-tiny">Invite admin</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="email@partnersinbiz.online" className="st-input md:col-span-2" aria-label="Invite email" />
          <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Full name" className="st-input" aria-label="Invite full name" />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="st-select" aria-label="Invite role">
            {ADMIN_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={invite} disabled={inviting || !inviteEmail} className="st-btn st-btn--primary disabled:opacity-60">
            {inviting ? 'Inviting…' : 'Invite admin'}
          </button>
        </div>
      </div>

      {/* Admin table */}
      <div className="st-panel">
        <p className="sc-tiny mb-3">Admins</p>
        {loading ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">Loading admins…</p>
        ) : admins.length === 0 ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">No admins found.</p>
        ) : (
          <div className="overflow-hidden rounded-[6px] border border-[var(--color-pib-line)]">
            <div className="grid grid-cols-12 gap-2 border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-3 py-2 sc-tiny">
              <span className="col-span-4">Admin</span>
              <span className="col-span-2">Role</span>
              <span className="col-span-2">Status</span>
              <span className="col-span-2">Sessions</span>
              <span className="col-span-2 text-right">Actions</span>
            </div>
            {admins.map((a) => (
              <div key={a.uid} className="grid grid-cols-12 gap-2 items-center border-b border-[var(--color-pib-line)] px-3 py-3 text-sm last:border-b-0 hover:bg-[var(--color-row-hover)]">
                <div className="col-span-4 min-w-0">
                  <p className="text-[var(--color-pib-text)] truncate">{a.email || a.uid}</p>
                  <p className="text-[11px] text-[var(--color-pib-text-muted)] truncate">{a.name || '-'}</p>
                </div>
                <div className="col-span-2">
                  <select
                    value={a.adminRole}
                    disabled={busyUid === a.uid}
                    onChange={(e) => patchAdmin(a.uid, { adminRole: e.target.value }, `Role updated for ${a.email}`)}
                    className={`rounded border px-2 py-1 text-[10px] font-label uppercase tracking-widest ${ROLE_BADGE[a.adminRole] ?? 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)]'}`}
                    aria-label={`Role for ${a.email || a.uid}`}
                  >
                    {ADMIN_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <span className={`st-status ${a.active ? 'st-status st-status--success' : 'st-status st-status--danger'}`}>
                    {a.active ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <div className="col-span-2 text-[var(--color-pib-text-muted)]">{a.activeSessions}</div>
                <div className="col-span-2 text-right">
                  <button
                    type="button"
                    disabled={busyUid === a.uid}
                    onClick={() => patchAdmin(a.uid, { active: !a.active }, `${a.active ? 'Deactivated' : 'Reactivated'} ${a.email}`)}
                    className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] disabled:opacity-60"
                  >
                    {a.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Permission matrix */}
      <div className="st-panel">
        <p className="sc-tiny mb-3">Permission matrix (reference)</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ADMIN_ROLES.map((role) => (
            <div key={role} className="rounded-[6px] border border-[var(--color-pib-line)] p-4">
              <span className={`inline-block text-[10px] font-label uppercase tracking-widest px-2 py-1 rounded border ${ROLE_BADGE[role]}`}>{role}</span>
              <ul className="mt-3 space-y-1.5">
                {PERMISSION_MATRIX[role].map((cap) => (
                  <li key={cap} className="text-xs text-[var(--color-pib-text-muted)] flex gap-2">
                    <span style={{ color: 'var(--color-accent-v2)' }}>•</span>{cap}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
