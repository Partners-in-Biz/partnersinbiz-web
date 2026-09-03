'use client'

import { Icon } from '@/components/studio'

/**
 * Visible marker that a CRM record is linked to a real platform tenant.
 *
 * `companies.linkedOrgId` and `contacts.linkedUserId` drive sanctioned
 * cross-org reads, but until now they only surfaced as a buried entry in a
 * comma-joined "signals" string on companies, and not at all on contacts. This
 * makes the link legible wherever a record is shown.
 */

export type SystemLinkKind = 'org' | 'user'

export interface SystemLinkBadgeProps {
  kind: SystemLinkKind
  /** Name of the linked workspace / person, when known. */
  label?: string
  size?: 'sm' | 'md'
}

export function SystemLinkBadge({ kind, label, size = 'sm' }: SystemLinkBadgeProps) {
  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
  const icon = kind === 'org' ? 'hub' : 'link'
  const text = kind === 'org' ? 'Linked workspace' : 'Linked user'
  const tooltip = label
    ? `${text} - ${label}`
    : kind === 'org'
      ? 'This company is linked to a Partners in Biz workspace'
      : 'This contact is linked to a Partners in Biz user account'

  return (
    <span
      className={`pib-pill pib-pill-info inline-flex items-center gap-1 ${sizeClasses}`}
      title={tooltip}
    >
      <Icon name={icon} className="text-[12px]" />
      {text}
    </span>
  )
}
