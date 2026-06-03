// app/(portal)/portal/settings/team/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { MemberRow } from '@/components/settings/MemberRow'
import type { OrgRole } from '@/lib/organizations/types'

interface Member {
  uid: string
  firstName: string
  lastName: string
  jobTitle: string
  department?: string
  accessScope?: string
  avatarUrl: string
  role: OrgRole
}

interface MyProfile {
  uid: string
  role: OrgRole | null
}

function InviteField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="pib-label !mb-0">
        {label}
      </label>
      {children}
    </div>
  )
}

function pluralLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [myProfile, setMyProfile] = useState<MyProfile>({ uid: '', role: null })
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Exclude<OrgRole, 'owner'>>('member')
  const [inviteJobTitle, setInviteJobTitle] = useState('')
  const [inviteDepartment, setInviteDepartment] = useState('')
  const [inviteAccessScope, setInviteAccessScope] = useState('all')
  const [inviteNote, setInviteNote] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSent, setInviteSent] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/portal/settings/team').then(r => r.ok ? r.json() : null),
      fetch('/api/v1/portal/settings/profile').then(r => r.ok ? r.json() : null),
    ]).then(([teamData, profileData]) => {
      if (Array.isArray(teamData?.members)) setMembers(teamData.members)
      if (profileData?.profile) {
        setMyProfile(p => ({ ...p, role: profileData.profile.role }))
      }
    }).finally(() => setLoading(false))
    // Get current uid from org endpoint
    fetch('/api/v1/portal/org')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.user?.uid) setMyProfile(p => ({ ...p, uid: d.user.uid })) })
      .catch(() => {})
  }, [])

  async function handleRemove(uid: string) {
    if (!confirm('Remove this member from the workspace?')) return
    const res = await fetch(`/api/v1/portal/settings/team/${uid}`, { method: 'DELETE' })
    if (res.ok) setMembers(prev => prev.filter(m => m.uid !== uid))
  }

  async function handleRoleChange(uid: string, newRole: OrgRole) {
    const res = await fetch(`/api/v1/portal/settings/team/${uid}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    })
    if (res.ok) {
      setMembers(prev => prev.map(m => m.uid === uid ? { ...m, role: newRole } : m))
    }
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    setInviting(true)
    setInviteError('')
    setInviteSent(false)
    const res = await fetch('/api/v1/portal/settings/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: inviteEmail,
        role: inviteRole,
        jobTitle: inviteJobTitle,
        department: inviteDepartment,
        accessScope: inviteAccessScope,
        inviteNote,
      }),
    })
    if (res.ok) {
      setInviteEmail('')
      setInviteRole('member')
      setInviteJobTitle('')
      setInviteDepartment('')
      setInviteAccessScope('all')
      setInviteNote('')
      setInviteSent(true)
      fetch('/api/v1/portal/settings/team').then(r => r.ok ? r.json() : null).then(d => {
        if (Array.isArray(d?.members)) setMembers(d.members)
      })
    } else {
      const body = await res.json().catch(() => ({}))
      setInviteError(body.error ?? 'Failed to invite. Try again.')
    }
    setInviting(false)
  }

  const viewerRole = myProfile.role ?? 'viewer'
  const canInvite = viewerRole === 'owner' || viewerRole === 'admin'
  const adminCount = members.filter((member) => member.role === 'owner' || member.role === 'admin').length
  const crmCoverageCount = members.filter((member) => member.accessScope === 'crm').length
  const reviewerCount = members.filter((member) => member.role === 'viewer' || member.accessScope === 'readonly').length
  const needsCrmCoverage = crmCoverageCount === 0

  function prepareCrmInvite() {
    setInviteRole('member')
    setInviteDepartment('Sales')
    setInviteAccessScope('crm')
    if (!inviteJobTitle.trim()) setInviteJobTitle('CRM operator')
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="pib-skeleton h-24" />
        <div className="pib-skeleton h-48" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <p className="eyebrow">Workspace settings</p>
        <h1 className="pib-page-title mt-2">Team</h1>
        <p className="pib-page-sub max-w-2xl">
          Manage who can access this workspace, what role they hold, and which area of the business they support.
        </p>
      </header>

      <section
        role="region"
        aria-label="Team access governance"
        className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.14)]"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-3">
            <span className="material-symbols-outlined mt-0.5 text-[var(--color-pib-accent)]" aria-hidden="true">admin_panel_settings</span>
            <div>
              <p className="eyebrow !text-[10px]">Access governance</p>
              <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">
                {needsCrmCoverage ? 'Employee access needs CRM coverage' : 'Employee access is mapped'}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
                {needsCrmCoverage
                  ? 'A CEO needs at least one clearly assigned CRM or sales operator before contacts, deals, and follow-ups can scale across the team.'
                  : 'CRM and sales coverage is assigned, so managers can delegate relationship work without relying on generic workspace access.'}
              </p>
            </div>
          </div>
          {canInvite && needsCrmCoverage && (
            <button
              type="button"
              onClick={prepareCrmInvite}
              className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 text-sm"
              aria-label="Prepare CRM sales invite"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">person_add</span>
              Prepare CRM invite
            </button>
          )}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
            <p className="eyebrow !text-[10px]">People</p>
            <p className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">{pluralLabel(members.length, 'member')}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
            <p className="eyebrow !text-[10px]">Admins</p>
            <p className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">{pluralLabel(adminCount, 'admin')}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
            <p className="eyebrow !text-[10px]">CRM operators</p>
            <p className={['mt-2 font-display text-2xl', needsCrmCoverage ? 'text-amber-200' : 'text-[var(--color-pib-text)]'].join(' ')}>
              {crmCoverageCount} CRM/sales
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
            <p className="eyebrow !text-[10px]">Reviewers</p>
            <p className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">{pluralLabel(reviewerCount, 'reviewer')}</p>
          </div>
        </div>
      </section>

      <section className="pib-card-section">
        <div className="pib-card-section-header flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Members</p>
            <h2 className="mt-1 text-base font-semibold text-[var(--color-pib-text)]">Workspace access</h2>
          </div>
          <span className="inline-flex w-fit items-center rounded-full border border-[var(--color-pib-line)] bg-white/[0.03] px-3 py-1 text-xs text-[var(--color-pib-text-muted)]">
            {members.length} member{members.length === 1 ? '' : 's'}
          </span>
        </div>
        {members.length === 0 ? (
          <p className="text-sm text-[var(--color-pib-text-muted)] px-5 py-6">No members found.</p>
        ) : (
          members.map(m => (
            <MemberRow
              key={m.uid}
              {...m}
              viewerRole={viewerRole as OrgRole}
              isSelf={m.uid === myProfile.uid}
              onRemove={handleRemove}
              onRoleChange={handleRoleChange}
            />
          ))
        )}
      </section>

      {canInvite && (
        <section className="pib-card space-y-5">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-accent-soft)] text-[18px] text-[var(--color-pib-accent)]" aria-hidden="true">
              person_add
            </span>
            <div>
              <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Invite access</p>
              <h2 className="mt-1 text-base font-semibold text-[var(--color-pib-text)]">Invite team member</h2>
              <p className="mt-1 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
                Send a workspace invite with the right role, department context, and access focus.
              </p>
            </div>
          </div>

          <form onSubmit={handleInvite} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <InviteField id="team-invite-email" label="Email">
                <input
                  id="team-invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="colleague@example.com"
                  required
                  className="pib-input"
                />
              </InviteField>
              <InviteField id="team-invite-role" label="Role">
                <select
                  id="team-invite-role"
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as Exclude<OrgRole, 'owner'>)}
                  className="pib-select"
                >
                  {viewerRole === 'owner' && <option value="admin">Admin</option>}
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </InviteField>
              <InviteField id="team-invite-job-title" label="Job title">
                <input
                  id="team-invite-job-title"
                  type="text"
                  value={inviteJobTitle}
                  onChange={e => setInviteJobTitle(e.target.value)}
                  placeholder="Client success lead"
                  className="pib-input"
                />
              </InviteField>
              <InviteField id="team-invite-department" label="Department">
                <input
                  id="team-invite-department"
                  type="text"
                  value={inviteDepartment}
                  onChange={e => setInviteDepartment(e.target.value)}
                  placeholder="Sales, marketing, finance..."
                  className="pib-input"
                />
              </InviteField>
              <InviteField id="team-invite-access" label="Workspace access">
                <select
                  id="team-invite-access"
                  value={inviteAccessScope}
                  onChange={e => setInviteAccessScope(e.target.value)}
                  className="pib-select"
                >
                  <option value="all">All workspace areas</option>
                  <option value="crm">CRM and sales</option>
                  <option value="marketing">Marketing</option>
                  <option value="projects">Projects</option>
                  <option value="billing">Billing</option>
                  <option value="readonly">Read-only review</option>
                </select>
              </InviteField>
              <div className="flex items-end">
                <button type="submit" disabled={inviting} className="btn-pib-accent w-full">
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">send</span>
                  {inviting ? 'Inviting...' : 'Send invite'}
                </button>
              </div>
            </div>
            <InviteField id="team-invite-note" label="Invite note">
              <textarea
                id="team-invite-note"
                value={inviteNote}
                onChange={e => setInviteNote(e.target.value)}
                placeholder="Add onboarding context or first responsibilities."
                rows={3}
                className="pib-textarea resize-none"
              />
            </InviteField>
          </form>
          {inviteSent && (
            <p className="flex items-center gap-1.5 text-xs text-[var(--color-pib-accent)]">
              <span className="material-symbols-outlined text-[15px]" aria-hidden="true">check_circle</span>
              Invite sent.
            </p>
          )}
          {inviteError && (
            <p className="flex items-center gap-1.5 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-100">
              <span className="material-symbols-outlined text-[15px]" aria-hidden="true">error</span>
              {inviteError}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
