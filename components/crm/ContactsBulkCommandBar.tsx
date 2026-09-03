import { Icon } from '@/components/studio'
'use client'

export const BULK_ACTIONS = ['assign', 'stage', 'type', 'add-tags', 'remove-tags', 'assign-segment'] as const
export type BulkActionKey = typeof BULK_ACTIONS[number]

export const BULK_ACTION_LABELS: Record<BulkActionKey, string> = {
  assign: 'Assign to...',
  stage: 'Change stage to...',
  type: 'Change type to...',
  'add-tags': 'Add tags...',
  'remove-tags': 'Remove tags...',
  'assign-segment': 'Assign segment...',
}

export interface BulkSegmentOption {
  id: string
  name: string
}

function readableBulkContactLabel(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase()
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}

export interface BulkTeamMember {
  uid: string
  firstName: string
  lastName: string
  jobTitle?: string
  avatarUrl?: string
  role?: string
}

interface Props {
  selectedCount: number
  totalCount: number
  bulkAction: BulkActionKey
  bulkPending: boolean
  teamMembers: BulkTeamMember[]
  bulkAssignUid: string
  bulkStage: string
  bulkType: string
  bulkTagsInput: string
  stages: readonly string[]
  types: readonly string[]
  segments?: BulkSegmentOption[]
  bulkSegmentId?: string
  onActionChange: (action: BulkActionKey) => void
  onAssignUidChange: (value: string) => void
  onStageChange: (value: string) => void
  onTypeChange: (value: string) => void
  onTagsInputChange: (value: string) => void
  onSegmentChange?: (value: string) => void
  onClear: () => void
  onApply: () => void
  onDelete: () => void
  onExportSelected?: () => void
}

export function ContactsBulkCommandBar({
  selectedCount,
  totalCount,
  bulkAction,
  bulkPending,
  teamMembers,
  bulkAssignUid,
  bulkStage,
  bulkType,
  bulkTagsInput,
  stages,
  types,
  segments = [],
  bulkSegmentId = '',
  onActionChange,
  onAssignUidChange,
  onStageChange,
  onTypeChange,
  onTagsInputChange,
  onSegmentChange,
  onClear,
  onApply,
  onDelete,
  onExportSelected,
}: Props) {
  const coverage = totalCount > 0 ? Math.round((selectedCount / totalCount) * 100) : 0
  const actionLabel = BULK_ACTION_LABELS[bulkAction]
  const isDestructive = bulkAction === 'remove-tags'

  return (
    <section
      className="pib-card sticky top-4 z-40 space-y-3"
      aria-label="Bulk command center"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="pib-label">Bulk command center</p>
          <h2 className="truncate text-xs text-[var(--color-pib-text)]">Shape this contact set in one controlled move.</h2>
          <p className="mt-0.5 max-w-2xl text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
            Apply ownership, lifecycle, type, or tag updates to the selected contacts without leaving the list.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {onExportSelected && (
            <button
              onClick={onExportSelected}
              disabled={bulkPending}
              className="btn-pib-secondary h-8 gap-1.5 px-2 text-xs"
              aria-label="Export selected contacts as CSV"
            >
              <Icon name="file_download" />
              Export selected
            </button>
          )}
          <button
            onClick={onClear}
            className="btn-pib-ghost h-8 gap-1.5 px-2 text-xs"
            aria-label="Clear selected contacts"
          >
            <Icon name="close" />
            Clear selection
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="pib-stat-card">
          <p className="text-lg leading-6 text-[var(--color-pib-text)]">{selectedCount} selected</p>
          <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Selected records</p>
        </div>
        <div className="pib-stat-card">
          <p className="text-lg leading-6 text-[var(--color-pib-text)]">{coverage}%</p>
          <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Coverage</p>
        </div>
        <div className="pib-stat-card">
          <p className="text-xs leading-6 text-[var(--color-pib-text)]">{actionLabel}</p>
          <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Next operation</p>
        </div>
        <div className="pib-stat-card">
          <p className="text-xs leading-6 text-[var(--color-pib-text-muted)]">
            {isDestructive ? 'Tag removal only. Delete stays separate.' : 'Delete is isolated from updates.'}
          </p>
          <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Safety</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(180px,240px)_1fr_auto_auto] gap-2 items-end">
        <label className="space-y-1">
          <span className="pib-label">Operation</span>
          <select
            aria-label="Bulk action"
            value={bulkAction}
            onChange={(event) => onActionChange(event.target.value as BulkActionKey)}
            className="pib-select h-8 w-full text-xs"
          >
            {BULK_ACTIONS.map(action => (
              <option key={action} value={action}>
                {BULK_ACTION_LABELS[action]}
              </option>
            ))}
          </select>
        </label>

        <div>
          {bulkAction === 'assign' && (
            <label className="space-y-1 block">
              <span className="pib-label">Owner</span>
              {teamMembers.length > 0 ? (
                <select
                  aria-label="Assign selected contacts to owner"
                  value={bulkAssignUid}
                  onChange={(event) => onAssignUidChange(event.target.value)}
                  className="pib-select h-8 w-full text-xs"
                >
                  <option value="">Select member...</option>
                  {teamMembers.map(member => (
                    <option key={member.uid} value={member.uid}>
                      {member.firstName} {member.lastName}{member.jobTitle ? ` (${member.jobTitle})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  placeholder="User UID..."
                  value={bulkAssignUid}
                  onChange={(event) => onAssignUidChange(event.target.value)}
                  className="pib-input h-8 w-full text-xs"
                />
              )}
            </label>
          )}

          {bulkAction === 'stage' && (
            <label className="space-y-1 block">
              <span className="pib-label">Stage</span>
              <select
                value={bulkStage}
                onChange={(event) => onStageChange(event.target.value)}
                className="pib-select h-8 w-full text-xs"
              >
                {stages.map(stage => (
                  <option key={stage} value={stage}>{readableBulkContactLabel(stage)}</option>
                ))}
              </select>
            </label>
          )}

          {bulkAction === 'type' && (
            <label className="space-y-1 block">
              <span className="pib-label">Type</span>
              <select
                value={bulkType}
                onChange={(event) => onTypeChange(event.target.value)}
                className="pib-select h-8 w-full text-xs"
              >
                {types.map(type => (
                  <option key={type} value={type}>{readableBulkContactLabel(type)}</option>
                ))}
              </select>
            </label>
          )}

          {(bulkAction === 'add-tags' || bulkAction === 'remove-tags') && (
            <label className="space-y-1 block">
              <span className="pib-label">Tags</span>
              <input
                placeholder="tag1, tag2..."
                value={bulkTagsInput}
                onChange={(event) => onTagsInputChange(event.target.value)}
                className="pib-input h-8 w-full text-xs"
              />
            </label>
          )}

          {bulkAction === 'assign-segment' && (
            <label className="space-y-1 block">
              <span className="pib-label">Segment</span>
              {segments.length > 0 ? (
                <select
                  aria-label="Assign selected contacts to a segment"
                  value={bulkSegmentId}
                  onChange={(event) => onSegmentChange?.(event.target.value)}
                  className="pib-select h-8 w-full text-xs"
                >
                  <option value="">Select segment...</option>
                  {segments.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="py-2 text-xs text-[var(--color-pib-text-muted)]">
                  No segments yet. Create one in the Segments workspace first.
                </p>
              )}
            </label>
          )}
        </div>

        <button
          onClick={onApply}
          disabled={bulkPending}
          aria-label="Apply updates"
          className="btn-pib-primary h-8 gap-1.5 px-3 text-xs"
        >
          <Icon name="done_all" />
          {bulkPending ? 'Applying...' : 'Apply updates'}
        </button>

        <button
          onClick={onDelete}
          disabled={bulkPending}
          className="btn-pib-danger h-8 gap-1.5 px-2 text-xs"
          aria-label="Delete selected contacts"
        >
          <Icon name="delete" />
          Delete selected
        </button>
      </div>
    </section>
  )
}
