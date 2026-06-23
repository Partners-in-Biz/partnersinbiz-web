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
      className="sticky top-4 z-40 pib-card-section p-4 space-y-4 shadow-xl"
      aria-label="Bulk command center"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Bulk command center</p>
          <h2 className="font-display text-xl mt-1">Shape this contact set in one controlled move.</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1 max-w-2xl">
            Apply ownership, lifecycle, type, or tag updates to the selected contacts without leaving the list.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onExportSelected && (
            <button
              onClick={onExportSelected}
              disabled={bulkPending}
              className="btn-pib-secondary !text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Export selected contacts as CSV"
            >
              <span className="material-symbols-outlined text-[16px]">file_download</span>
              Export selected
            </button>
          )}
          <button
            onClick={onClear}
            className="btn-pib-secondary !text-xs"
            aria-label="Clear selected contacts"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
            Clear selection
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
          <p className="eyebrow !text-[10px]">Selected records</p>
          <p className="font-display text-2xl mt-1">{selectedCount} selected</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
          <p className="eyebrow !text-[10px]">Coverage</p>
          <p className="font-display text-2xl mt-1">{coverage}%</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
          <p className="eyebrow !text-[10px]">Next operation</p>
          <p className="text-sm mt-1 text-[var(--color-pib-text)]">{actionLabel}</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
          <p className="eyebrow !text-[10px]">Safety</p>
          <p className="text-sm mt-1 text-[var(--color-pib-text-muted)]">
            {isDestructive ? 'Tag removal only. Delete stays separate.' : 'Delete is isolated from updates.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(180px,240px)_1fr_auto_auto] gap-3 items-end">
        <label className="space-y-1">
          <span className="eyebrow !text-[10px]">Operation</span>
          <select
            aria-label="Bulk action"
            value={bulkAction}
            onChange={(event) => onActionChange(event.target.value as BulkActionKey)}
            className="pib-input !w-full !py-2 !text-sm"
          >
            {BULK_ACTIONS.map(action => (
              <option key={action} value={action} className="bg-black">
                {BULK_ACTION_LABELS[action]}
              </option>
            ))}
          </select>
        </label>

        <div>
          {bulkAction === 'assign' && (
            <label className="space-y-1 block">
              <span className="eyebrow !text-[10px]">Owner</span>
              {teamMembers.length > 0 ? (
                <select
                  aria-label="Assign selected contacts to owner"
                  value={bulkAssignUid}
                  onChange={(event) => onAssignUidChange(event.target.value)}
                  className="pib-input !w-full !py-2 !text-sm"
                >
                  <option value="" className="bg-black">Select member...</option>
                  {teamMembers.map(member => (
                    <option key={member.uid} value={member.uid} className="bg-black">
                      {member.firstName} {member.lastName}{member.jobTitle ? ` (${member.jobTitle})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  placeholder="User UID..."
                  value={bulkAssignUid}
                  onChange={(event) => onAssignUidChange(event.target.value)}
                  className="pib-input !py-2 !text-sm w-full"
                />
              )}
            </label>
          )}

          {bulkAction === 'stage' && (
            <label className="space-y-1 block">
              <span className="eyebrow !text-[10px]">Stage</span>
              <select
                value={bulkStage}
                onChange={(event) => onStageChange(event.target.value)}
                className="pib-input !w-full !py-2 !text-sm"
              >
                {stages.map(stage => (
                  <option key={stage} value={stage} className="bg-black">{readableBulkContactLabel(stage)}</option>
                ))}
              </select>
            </label>
          )}

          {bulkAction === 'type' && (
            <label className="space-y-1 block">
              <span className="eyebrow !text-[10px]">Type</span>
              <select
                value={bulkType}
                onChange={(event) => onTypeChange(event.target.value)}
                className="pib-input !w-full !py-2 !text-sm"
              >
                {types.map(type => (
                  <option key={type} value={type} className="bg-black">{readableBulkContactLabel(type)}</option>
                ))}
              </select>
            </label>
          )}

          {(bulkAction === 'add-tags' || bulkAction === 'remove-tags') && (
            <label className="space-y-1 block">
              <span className="eyebrow !text-[10px]">Tags</span>
              <input
                placeholder="tag1, tag2..."
                value={bulkTagsInput}
                onChange={(event) => onTagsInputChange(event.target.value)}
                className="pib-input !py-2 !text-sm w-full"
              />
            </label>
          )}

          {bulkAction === 'assign-segment' && (
            <label className="space-y-1 block">
              <span className="eyebrow !text-[10px]">Segment</span>
              {segments.length > 0 ? (
                <select
                  aria-label="Assign selected contacts to a segment"
                  value={bulkSegmentId}
                  onChange={(event) => onSegmentChange?.(event.target.value)}
                  className="pib-input !w-full !py-2 !text-sm"
                >
                  <option value="" className="bg-black">Select segment...</option>
                  {segments.map((segment) => (
                    <option key={segment.id} value={segment.id} className="bg-black">
                      {segment.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-[var(--color-pib-text-muted)] py-2">
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
          className="btn-pib-accent !py-2.5 !text-sm justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-[16px]">done_all</span>
          {bulkPending ? 'Applying...' : 'Apply updates'}
        </button>

        <button
          onClick={onDelete}
          disabled={bulkPending}
          className="text-sm text-red-300 hover:text-red-200 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-[var(--radius-card)] border border-red-400/30 hover:bg-red-400/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Delete selected contacts"
        >
          <span className="material-symbols-outlined text-[16px]">delete</span>
          Delete selected
        </button>
      </div>
    </section>
  )
}
