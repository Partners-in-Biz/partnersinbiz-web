'use client'

import { useEffect, useMemo, useState } from 'react'

type AccessMember = {
  id?: string
  uid?: string
  displayName?: string
  email?: string
  role?: string
  status?: string
  memberType?: string
}

type AccessOrganization = {
  id?: string
  orgId?: string
  companyId?: string
  recipientCompanyName?: string
  recipientEmail?: string
  role?: string
  status?: string
}

type AccessInvite = {
  id?: string
  recipientEmail?: string
  recipientName?: string
  recipientCompanyName?: string
  status?: string
  role?: string
}

interface AccessData {
  members: AccessMember[]
  organizations: AccessOrganization[]
  invites: AccessInvite[]
}

const ROLE_OPTIONS = ['manager', 'contributor', 'reviewer', 'viewer'] as const

function labelForMember(member: AccessMember): string {
  return member.displayName || member.email || member.uid || 'Unknown member'
}

function labelForOrganization(org: AccessOrganization): string {
  return org.recipientCompanyName || org.recipientEmail || org.orgId || org.companyId || 'External organisation'
}

function StatusPill({ value }: { value?: string }) {
  return (
    <span className="rounded-full border border-[var(--color-card-border)] px-2 py-0.5 text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
      {value || 'active'}
    </span>
  )
}

export function ProjectPeopleAccessPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<AccessData>({ members: [], organizations: [], invites: [] })
  const [loading, setLoading] = useState(true)
  const [memberUid, setMemberUid] = useState('')
  const [memberRole, setMemberRole] = useState('contributor')
  const [companyId, setCompanyId] = useState('')
  const [contactId, setContactId] = useState('')
  const [orgRole, setOrgRole] = useState('reviewer')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const auditRows = useMemo(
    () => [
      ...data.members.map((item) => ({ id: item.id || item.uid || labelForMember(item), label: labelForMember(item), kind: 'Member', status: item.status, role: item.role })),
      ...data.organizations.map((item) => ({ id: item.id || item.orgId || labelForOrganization(item), label: labelForOrganization(item), kind: 'Organisation', status: item.status, role: item.role })),
      ...data.invites.map((item) => ({ id: item.id || item.recipientEmail || item.recipientName || 'invite', label: item.recipientEmail || item.recipientName || item.recipientCompanyName || 'Pending invite', kind: 'Invite', status: item.status, role: item.role })),
    ],
    [data],
  )

  async function loadAccess() {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/access`)
      const body = await res.json().catch(() => ({}))
      const next = body.data ?? {}
      setData({
        members: Array.isArray(next.members) ? next.members : [],
        organizations: Array.isArray(next.organizations) ? next.organizations : [],
        invites: Array.isArray(next.invites) ? next.invites : [],
      })
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project access')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAccess().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function postAccess(payload: Record<string, unknown>) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Project access update failed')
      await loadAccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Project access update failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">People & Access</p>
          <h2 className="mt-1 text-xl font-headline font-bold text-on-surface">Project collaboration</h2>
          <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">Invite people and organisations to this project without granting workspace-wide access.</p>
        </div>
        <button type="button" onClick={() => loadAccess()} className="pib-btn-secondary text-xs font-label" disabled={loading}>
          Refresh
        </button>
      </div>

      {error ? <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
          <h3 className="text-sm font-headline font-semibold text-on-surface">Internal members</h3>
          <div className="mt-3 space-y-2">
            {data.members.length === 0 ? <p className="text-sm text-on-surface-variant">{loading ? 'Loading members...' : 'No project members yet.'}</p> : null}
            {data.members.map((member) => (
              <div key={member.id || member.uid} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-on-surface">{labelForMember(member)}</p>
                  <p className="text-xs text-on-surface-variant">{member.memberType || 'internal'} / {member.role || 'viewer'}</p>
                </div>
                <StatusPill value={member.status} />
              </div>
            ))}
          </div>
          <form
            className="mt-4 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!memberUid.trim()) return
              postAccess({ action: 'add_member', uid: memberUid.trim(), role: memberRole }).then(() => setMemberUid(''))
            }}
          >
            <label className="min-w-[170px] flex-1">
              <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Member user ID</span>
              <input value={memberUid} onChange={(event) => setMemberUid(event.target.value)} className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface" />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Role</span>
              <select value={memberRole} onChange={(event) => setMemberRole(event.target.value)} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface">
                {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            <button type="submit" className="pib-btn-primary text-xs font-label" disabled={submitting || !memberUid.trim()}>Add</button>
          </form>
        </div>

        <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
          <h3 className="text-sm font-headline font-semibold text-on-surface">External organisations</h3>
          <div className="mt-3 space-y-2">
            {data.organizations.length === 0 ? <p className="text-sm text-on-surface-variant">{loading ? 'Loading organisations...' : 'No external organisations yet.'}</p> : null}
            {data.organizations.map((org) => (
              <div key={org.id || org.orgId || org.companyId} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-on-surface">{labelForOrganization(org)}</p>
                  <p className="text-xs text-on-surface-variant">{org.role || 'viewer'}</p>
                </div>
                <StatusPill value={org.status} />
              </div>
            ))}
          </div>
          <form
            className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault()
              if (!companyId.trim()) return
              postAccess({ action: 'invite_organizations', invites: [{ companyId: companyId.trim(), contactId: contactId.trim(), role: orgRole }] }).then(() => {
                setCompanyId('')
                setContactId('')
              })
            }}
          >
            <label>
              <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">CRM company ID</span>
              <input value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface" />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">CRM contact ID</span>
              <input value={contactId} onChange={(event) => setContactId(event.target.value)} className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface" />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Role</span>
              <select value={orgRole} onChange={(event) => setOrgRole(event.target.value)} className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface">
                {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            <button type="submit" className="pib-btn-primary self-end text-xs font-label" disabled={submitting || !companyId.trim()}>Invite</button>
          </form>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
        <h3 className="text-sm font-headline font-semibold text-on-surface">Access audit</h3>
        <div className="mt-3 grid gap-2">
          {auditRows.length === 0 ? <p className="text-sm text-on-surface-variant">{loading ? 'Loading audit...' : 'No access records yet.'}</p> : null}
          {auditRows.map((row) => (
            <div key={`${row.kind}-${row.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-on-surface">{row.label}</p>
                <p className="text-xs text-on-surface-variant">{row.kind} / {row.role || 'viewer'}</p>
              </div>
              <StatusPill value={row.status} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
