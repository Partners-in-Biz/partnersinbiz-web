// components/settings/MemberRow.tsx
'use client'

import type { OrgRole } from '@/lib/organizations/types'
import type { MemberAccessPolicy } from '@/lib/orgMembers/access-policy'

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
}

const ROLE_COLORS: Record<OrgRole, string> = {
  owner: 'text-amber-400 bg-amber-400/10',
  admin: 'text-blue-400 bg-blue-400/10',
  member: 'text-violet-400 bg-violet-400/10',
  viewer: 'text-[var(--color-pib-text-muted)] bg-[var(--color-pib-line-strong)]',
}

const ROLE_RANK: Record<OrgRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 }

export function MemberRow({ uid, firstName, lastName, jobTitle, department, accessScope, accessSummary, avatarUrl, role, viewerRole, isSelf, onRemove, onRoleChange, onEditAccess }: MemberRowProps) {
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || uid
  const initials = [firstName[0], lastName[0]].filter(Boolean).join('').toUpperCase() || '?'
  const canRemove = !isSelf && ROLE_RANK[viewerRole] >= 3 && role !== 'owner'
  const canChangeRole = !isSelf && viewerRole === 'owner' && role !== 'owner'
  const canEditAccess = !isSelf && ROLE_RANK[viewerRole] >= 3 && role !== 'owner' && Boolean(onEditAccess)
  const accessLabel = accessSummary || accessScope

  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-[var(--color-pib-line)] last:border-0">
      <div className="w-9 h-9 rounded-full bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line-strong)] flex items-center justify-center text-sm font-medium text-[var(--color-pib-accent-hover)] shrink-0 overflow-hidden">
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

      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${ROLE_COLORS[role]}`}>
        {role}
      </span>

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
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            tune
          </span>
        </button>
      )}

      {canRemove && (
        <button
          onClick={() => onRemove(uid)}
          title={`Remove ${displayName}`}
          aria-label={`Remove ${displayName}`}
          className="text-[var(--color-pib-text-muted)] hover:text-red-400 transition-colors p-1"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            person_remove
          </span>
        </button>
      )}
    </div>
  )
}
