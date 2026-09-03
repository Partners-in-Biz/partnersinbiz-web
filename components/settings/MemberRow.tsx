// components/settings/MemberRow.tsx
'use client'

import { useEffect, useState } from 'react'
import type { OrgRole } from '@/lib/organizations/types'
import type { MemberAccessPolicy } from '@/lib/orgMembers/access-policy'

import { Icon } from '@/components/studio'

interface MemberRowProps {
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
  viewerRole: OrgRole
  isSelf: boolean
  onRemove: (uid: string) => void
  onRoleChange: (uid: string, newRole: OrgRole) => void
  onEditAccess?: (uid: string) => void
  onProfileUpdate?: (uid: string, updates: { jobTitle: string; department: string }) => Promise<boolean> | boolean
}

const ROLE_COLORS: Record<OrgRole, string> = {
  owner: 'text-[var(--st-warning)] bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)]',
  admin: 'text-blue-400 bg-blue-400/10',
  member: 'text-[var(--sc-accent)] bg-[color-mix(in_srgb,var(--sc-accent)_10%,transparent)]',
  viewer: 'text-[var(--color-pib-text-muted)] bg-[var(--color-pib-line-strong)]',
}

const ROLE_RANK: Record<OrgRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 }

export function MemberRow({
  uid,
  firstName,
  lastName,
  jobTitle,
  department,
  accessScope,
  accessSummary,
  avatarUrl,
  role,
  viewerRole,
  isSelf,
  onRemove,
  onRoleChange,
  onEditAccess,
  onProfileUpdate,
}: MemberRowProps) {
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || uid
  const initials = [firstName[0], lastName[0]].filter(Boolean).join('').toUpperCase() || '?'
  const canRemove = !isSelf && ROLE_RANK[viewerRole] >= 3 && role !== 'owner'
  const canChangeRole = !isSelf && viewerRole === 'owner' && role !== 'owner'
  const canEditAccess = !isSelf && ROLE_RANK[viewerRole] >= 3 && role !== 'owner' && Boolean(onEditAccess)
  const canEditProfile = !isSelf && ROLE_RANK[viewerRole] >= 3 && role !== 'owner' && Boolean(onProfileUpdate)
  const accessLabel = accessSummary || accessScope
  const [editingProfile, setEditingProfile] = useState(false)
  const [draftJobTitle, setDraftJobTitle] = useState(jobTitle)
  const [draftDepartment, setDraftDepartment] = useState(department ?? '')
  const [savingProfile, setSavingProfile] = useState(false)

  function startProfileEdit() {
    setDraftJobTitle(jobTitle)
    setDraftDepartment(department ?? '')
    setEditingProfile(true)
  }

  async function saveProfile() {
    if (!onProfileUpdate) return
    setSavingProfile(true)
    const nextUpdates = {
      jobTitle: draftJobTitle.trim(),
      department: draftDepartment.trim(),
    }
    const success = await Promise.resolve(onProfileUpdate(uid, nextUpdates))
    setSavingProfile(false)
    if (success !== false) {
      setEditingProfile(false)
    }
  }

  useEffect(() => {
    setDraftJobTitle(jobTitle)
    setDraftDepartment(department ?? '')
  }, [jobTitle, department])

  return (
    <div className="space-y-3 border-b border-[var(--color-pib-line)] px-5 py-4 last:border-0">
      <div className="flex items-center gap-4">
        <div className="w-9 h-9 rounded-md bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line-strong)] flex items-center justify-center text-sm font-medium text-[var(--color-pib-accent-hover)] shrink-0 overflow-hidden">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
          ) : (
            initials
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {jobTitle && <p className="text-xs text-[var(--color-pib-text-muted)] truncate">{jobTitle}</p>}
          {(department || accessLabel) && (
            <p className="text-[11px] text-[var(--color-pib-text-muted)] truncate">
              {[department, accessLabel].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md capitalize ${ROLE_COLORS[role]}`}>
          {role}
        </span>

        {canEditProfile && (
          <button
            type="button"
            onClick={startProfileEdit}
            title={`Edit profile for ${displayName}`}
            aria-label={`Edit profile for ${displayName}`}
            className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-accent)] transition-colors p-1"
          >
            <Icon name="badge" className="text-[18px]" />
          </button>
        )}

        {canChangeRole && (
          <select
            value={role}
            onChange={e => onRoleChange(uid, e.target.value as OrgRole)}
            className="text-xs bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] rounded-lg px-2 py-1 text-[var(--color-pib-text-muted)] cursor-pointer"
            aria-label={`Change role for ${displayName}`}
          >
            <option value="admin">Admin</option>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </select>
        )}

        {canEditAccess && (
          <button
            onClick={() => onEditAccess?.(uid)}
            title={`Edit access for ${displayName}`}
            aria-label={`Edit access for ${displayName}`}
            className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-accent)] transition-colors p-1"
          >
            <Icon name="tune" className="text-[18px]" />
          </button>
        )}

        {canRemove && (
          <button
            onClick={() => onRemove(uid)}
            title={`Remove ${displayName}`}
            aria-label={`Remove ${displayName}`}
            className="text-[var(--color-pib-text-muted)] hover:text-[var(--st-danger)] transition-colors p-1"
          >
            <Icon name="person_remove" className="text-[18px]" />
          </button>
        )}
      </div>

      {editingProfile && (
        <section className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs">
                Job title
                <input
                  type="text"
                  value={draftJobTitle}
                  onChange={(e) => setDraftJobTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1.5 text-sm text-[var(--color-pib-text)]"
                />
              </label>
              <label className="text-xs">
                Department
                <input
                  type="text"
                  value={draftDepartment}
                  onChange={(e) => setDraftDepartment(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1.5 text-sm text-[var(--color-pib-text)]"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setEditingProfile(false)}
                disabled={savingProfile}
                className="btn-pib-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveProfile}
                disabled={savingProfile}
                className="btn-pib-accent"
              >
                {savingProfile ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
