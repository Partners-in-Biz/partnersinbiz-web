// app/(portal)/portal/settings/team/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { MemberRow } from '@/components/settings/MemberRow'
import { TeamAccessGovernancePanel } from '@/components/settings/TeamAccessGovernancePanel'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import type { OrgRole } from '@/lib/organizations/types'
import {
  WORKSPACE_MODULE_KEYS,
  accessSummaryForPolicy,
  normalizeMemberAccessPolicy,
  type MemberAccessPolicy,
  type RecordScope,
  type WorkspaceModuleKey,
} from '@/lib/orgMembers/access-policy'

interface Member {
  uid: string
  firstName: string
  lastName: string
  jobTitle: string
  department?: string
  accessScope?: string
  accessPolicy?: MemberAccessPolicy
  accessSummary?: string
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

const MODULE_LABELS: Record<WorkspaceModuleKey, string> = {
  crm: 'CRM',
  projects: 'Projects',
  documents: 'Documents',
  marketing: 'Marketing',
  messages: 'Messages',
  email: 'Email',
  reports: 'Reports',
  research: 'Research',
  properties: 'Properties',
  billing: 'Billing',
  mobileApps: 'Mobile Apps',
  youtubeStudio: 'YouTube Studio',
  bookStudio: 'Book Studio',
}

function memberDisplayName(member: Pick<Member, 'uid' | 'firstName' | 'lastName'>) {
  return [member.firstName, member.lastName].filter(Boolean).join(' ') || member.uid
}

export default function TeamPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const teamEndpoint = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])
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
  const [pendingRemoveMember, setPendingRemoveMember] = useState<Member | null>(null)
  const [removingUid, setRemovingUid] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState('')
  const [editingAccessMember, setEditingAccessMember] = useState<Member | null>(null)
  const [accessDraft, setAccessDraft] = useState<MemberAccessPolicy | null>(null)
  const [accessLoading, setAccessLoading] = useState(false)
  const [accessSaving, setAccessSaving] = useState(false)
  const [accessError, setAccessError] = useState('')

  const loadTeamMembers = useCallback(() => (
    fetch(teamEndpoint('/api/v1/portal/settings/team')).then(r => r.ok ? r.json() : null).then(d => {
      if (Array.isArray(d?.members)) setMembers(d.members)
    })
  ), [teamEndpoint])

  useEffect(() => {
    Promise.all([
      fetch(teamEndpoint('/api/v1/portal/settings/team')).then(r => r.ok ? r.json() : null),
      fetch(teamEndpoint('/api/v1/portal/settings/profile')).then(r => r.ok ? r.json() : null),
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
  }, [teamEndpoint])

  async function handleRemove(uid: string) {
    setRemovingUid(uid)
    setRemoveError('')
    const res = await fetch(teamEndpoint(`/api/v1/portal/settings/team/${uid}`), { method: 'DELETE' })
    if (res.ok) {
      setMembers(prev => prev.filter(m => m.uid !== uid))
      setPendingRemoveMember(null)
    } else {
      const body = await res.json().catch(() => ({}))
      setRemoveError(body.error ?? 'Failed to remove team member.')
    }
    setRemovingUid(null)
  }

  async function handleRoleChange(uid: string, newRole: OrgRole) {
    const res = await fetch(teamEndpoint(`/api/v1/portal/settings/team/${uid}/role`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    })
    if (res.ok) {
      setMembers(prev => prev.map(m => m.uid === uid ? { ...m, role: newRole } : m))
    }
  }

  async function handleEditAccess(member: Member) {
    setEditingAccessMember(member)
    setAccessDraft(member.accessPolicy ? normalizeMemberAccessPolicy(member.accessPolicy) : null)
    setAccessError('')
    setAccessLoading(true)
    const res = await fetch(teamEndpoint(`/api/v1/portal/settings/team/${member.uid}/access`))
    if (res.ok) {
      const body = await res.json().catch(() => ({}))
      if (body.accessPolicy) setAccessDraft(normalizeMemberAccessPolicy(body.accessPolicy))
    } else {
      const body = await res.json().catch(() => ({}))
      setAccessError(body.error ?? 'Failed to load access settings.')
    }
    setAccessLoading(false)
  }

  function updateAccessDraft(mutator: (policy: MemberAccessPolicy) => MemberAccessPolicy) {
    setAccessDraft(prev => {
      const base = normalizeMemberAccessPolicy(prev ?? { preset: 'custom', modules: {}, recordScopes: {} })
      return normalizeMemberAccessPolicy({ ...mutator(base), preset: 'custom' })
    })
  }

  function toggleModule(moduleKey: WorkspaceModuleKey) {
    updateAccessDraft(policy => ({
      ...policy,
      modules: { ...policy.modules, [moduleKey]: !policy.modules[moduleKey] },
    }))
  }

  function setRecordScope(moduleKey: 'crm' | 'projects', scope: RecordScope) {
    updateAccessDraft(policy => ({
      ...policy,
      recordScopes: { ...policy.recordScopes, [moduleKey]: scope },
    }))
  }

  async function handleSaveAccess() {
    if (!editingAccessMember || !accessDraft) return
    setAccessSaving(true)
    setAccessError('')
    const nextPolicy = normalizeMemberAccessPolicy({ ...accessDraft, preset: 'custom' })
    const res = await fetch(teamEndpoint(`/api/v1/portal/settings/team/${editingAccessMember.uid}/access`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessPolicy: nextPolicy }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok) {
      const savedPolicy = normalizeMemberAccessPolicy(body.accessPolicy ?? nextPolicy)
      const accessSummary = body.accessSummary ?? accessSummaryForPolicy(savedPolicy)
      setMembers(prev => prev.map(member => member.uid === editingAccessMember.uid ? {
        ...member,
        accessPolicy: savedPolicy,
        accessSummary,
      } : member))
      setEditingAccessMember(null)
      setAccessDraft(null)
    } else {
      setAccessError(body.error ?? 'Failed to save access settings.')
    }
    setAccessSaving(false)
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    setInviting(true)
    setInviteError('')
    setInviteSent(false)
    const res = await fetch(teamEndpoint('/api/v1/portal/settings/team/invite'), {
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
      loadTeamMembers()
    } else {
      const body = await res.json().catch(() => ({}))
      setInviteError(body.error ?? 'Failed to invite. Try again.')
    }
    setInviting(false)
  }

  const viewerRole = myProfile.role ?? 'viewer'
  const canInvite = viewerRole === 'owner' || viewerRole === 'admin'
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

      <TeamAccessGovernancePanel
        members={members}
        canPrepareCrmInvite={canInvite}
        onPrepareCrmInvite={prepareCrmInvite}
      />

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
              onRemove={() => {
                setPendingRemoveMember(m)
                setRemoveError('')
              }}
              onRoleChange={handleRoleChange}
              onEditAccess={() => handleEditAccess(m)}
            />
          ))
        )}
      </section>

      {editingAccessMember && (
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-access-drawer-title"
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] p-5 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4 border-b border-[var(--color-pib-line)] pb-4">
            <div>
              <p className="eyebrow !text-[10px]">Team member access</p>
              <h2 id="team-access-drawer-title" className="mt-1 font-display text-xl text-[var(--color-pib-text)]">
                Edit access for {memberDisplayName(editingAccessMember)}
              </h2>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                {editingAccessMember.jobTitle || editingAccessMember.role}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingAccessMember(null)
                setAccessDraft(null)
                setAccessError('')
              }}
              aria-label="Close access editor"
              className="grid h-9 w-9 place-items-center rounded-lg text-[var(--color-pib-text-muted)] hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-5">
            {accessLoading || !accessDraft ? (
              <div className="space-y-3">
                <div className="pib-skeleton h-12" />
                <div className="pib-skeleton h-48" />
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-2 sm:grid-cols-2">
                  {WORKSPACE_MODULE_KEYS.map(moduleKey => (
                    <label
                      key={moduleKey}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-pib-text)]"
                    >
                      <span>{MODULE_LABELS[moduleKey]}</span>
                      <input
                        type="checkbox"
                        checked={accessDraft.modules[moduleKey]}
                        onChange={() => toggleModule(moduleKey)}
                        className="h-4 w-4 accent-[var(--color-pib-accent)]"
                      />
                    </label>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <InviteField id="team-access-crm-scope" label="CRM record scope">
                    <select
                      id="team-access-crm-scope"
                      value={accessDraft.recordScopes.crm}
                      onChange={e => setRecordScope('crm', e.target.value as RecordScope)}
                      className="pib-select"
                      disabled={!accessDraft.modules.crm}
                    >
                      <option value="owned_or_linked">Owned or linked records</option>
                      <option value="all">All CRM records</option>
                    </select>
                  </InviteField>
                  <InviteField id="team-access-projects-scope" label="Projects record scope">
                    <select
                      id="team-access-projects-scope"
                      value={accessDraft.recordScopes.projects}
                      onChange={e => setRecordScope('projects', e.target.value as RecordScope)}
                      className="pib-select"
                      disabled={!accessDraft.modules.projects}
                    >
                      <option value="owned_or_linked">Owned or linked projects</option>
                      <option value="all">All projects</option>
                    </select>
                  </InviteField>
                </div>
              </div>
            )}

            {accessError && (
              <p className="mt-4 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-100">
                {accessError}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-pib-line)] pt-4">
            <button
              type="button"
              onClick={() => {
                setEditingAccessMember(null)
                setAccessDraft(null)
                setAccessError('')
              }}
              className="btn-pib-secondary text-sm"
              disabled={accessSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveAccess}
              className="btn-pib-accent text-sm"
              disabled={accessSaving || accessLoading || !accessDraft}
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">save</span>
              {accessSaving ? 'Saving...' : 'Save access'}
            </button>
          </div>
        </section>
      )}

      {pendingRemoveMember && (
        <section
          role="alertdialog"
          aria-labelledby="team-remove-confirm-title"
          aria-describedby="team-remove-confirm-description"
          className="rounded-[var(--radius-card)] border border-red-400/25 bg-red-500/10 p-5 shadow-[0_18px_40px_rgba(127,29,29,0.18)]"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-red-200" aria-hidden="true">
                person_remove
              </span>
              <div>
                <p className="eyebrow !text-[10px] !text-red-100/80">Workspace access removal</p>
                <h2 id="team-remove-confirm-title" className="mt-1 font-display text-lg text-red-50">
                  Remove {[pendingRemoveMember.firstName, pendingRemoveMember.lastName].filter(Boolean).join(' ') || pendingRemoveMember.uid} from this workspace?
                </h2>
                <p id="team-remove-confirm-description" className="mt-2 max-w-2xl text-sm text-red-100/90">
                  This removes their access to CRM contacts, deals, projects, and workspace data. Existing activity history remains available for audit.
                </p>
                {removeError && (
                  <p className="mt-3 rounded-lg border border-red-300/25 bg-red-400/10 px-3 py-2 text-sm text-red-100">
                    {removeError}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <button
                type="button"
                onClick={() => {
                  setPendingRemoveMember(null)
                  setRemoveError('')
                }}
                disabled={removingUid === pendingRemoveMember.uid}
                aria-label={`Cancel remove ${[pendingRemoveMember.firstName, pendingRemoveMember.lastName].filter(Boolean).join(' ') || pendingRemoveMember.uid} from workspace`}
                className="btn-pib-secondary text-xs disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleRemove(pendingRemoveMember.uid)}
                disabled={removingUid === pendingRemoveMember.uid}
                aria-label={`Confirm remove ${[pendingRemoveMember.firstName, pendingRemoveMember.lastName].filter(Boolean).join(' ') || pendingRemoveMember.uid} from workspace`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300/30 bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-50 transition-colors hover:bg-red-500/30 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">person_remove</span>
                {removingUid === pendingRemoveMember.uid ? 'Removing...' : 'Remove member'}
              </button>
            </div>
          </div>
        </section>
      )}

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
