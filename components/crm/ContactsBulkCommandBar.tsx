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
      className="sticky top-4 z-40 space-y-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2"
      aria-label="Bulk command center"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Bulk command center</p>
          <h2 className="truncate text-xs font-semibold text-on-surface">Shape this contact set in one controlled move.</h2>
          <p className="sr-only">
            Apply ownership, lifecycle, type, or tag updates to the selected contacts without leaving the list.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {onExportSelected && (
            <button
              onClick={onExportSelected}
              disabled={bulkPending}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Export selected contacts as CSV"
            >
              <span className="material-symbols-outlined text-[14px]">file_download</span>
              Export selected
            </button>
          )}
          <button
            onClick={onClear}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
            aria-label="Clear selected contacts"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
            Clear selection
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className="text-lg font-semibold leading-6 text-on-surface">{selectedCount} selected</p>
          <p className="text-[11px] leading-4 text-on-surface-variant">Selected records</p>
        </div>
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className="text-lg font-semibold leading-6 text-on-surface">{coverage}%</p>
          <p className="text-[11px] leading-4 text-on-surface-variant">Coverage</p>
        </div>
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className="text-xs leading-6 text-on-surface">{actionLabel}</p>
          <p className="text-[11px] leading-4 text-on-surface-variant">Next operation</p>
        </div>
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className="text-xs leading-6 text-on-surface-variant">
            {isDestructive ? 'Tag removal only. Delete stays separate.' : 'Delete is isolated from updates.'}
          </p>
          <p className="text-[11px] leading-4 text-on-surface-variant">Safety</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(180px,240px)_1fr_auto_auto] gap-2 items-end">
        <label className="space-y-1">
          <span className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Operation</span>
          <select
            aria-label="Bulk action"
            value={bulkAction}
            onChange={(event) => onActionChange(event.target.value as BulkActionKey)}
            className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface"
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
              <span className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Owner</span>
              {teamMembers.length > 0 ? (
                <select
                  aria-label="Assign selected contacts to owner"
                  value={bulkAssignUid}
                  onChange={(event) => onAssignUidChange(event.target.value)}
                  className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface"
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
                  className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface placeholder:text-on-surface-variant"
                />
              )}
            </label>
          )}

          {bulkAction === 'stage' && (
            <label className="space-y-1 block">
              <span className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Stage</span>
              <select
                value={bulkStage}
                onChange={(event) => onStageChange(event.target.value)}
                className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface"
              >
                {stages.map(stage => (
                  <option key={stage} value={stage} className="bg-black">{readableBulkContactLabel(stage)}</option>
                ))}
              </select>
            </label>
          )}

          {bulkAction === 'type' && (
            <label className="space-y-1 block">
              <span className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Type</span>
              <select
                value={bulkType}
                onChange={(event) => onTypeChange(event.target.value)}
                className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface"
              >
                {types.map(type => (
                  <option key={type} value={type} className="bg-black">{readableBulkContactLabel(type)}</option>
                ))}
              </select>
            </label>
          )}

          {(bulkAction === 'add-tags' || bulkAction === 'remove-tags') && (
            <label className="space-y-1 block">
              <span className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Tags</span>
              <input
                placeholder="tag1, tag2..."
                value={bulkTagsInput}
                onChange={(event) => onTagsInputChange(event.target.value)}
                className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface placeholder:text-on-surface-variant"
              />
            </label>
          )}

          {bulkAction === 'assign-segment' && (
            <label className="space-y-1 block">
              <span className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Segment</span>
              {segments.length > 0 ? (
                <select
                  aria-label="Assign selected contacts to a segment"
                  value={bulkSegmentId}
                  onChange={(event) => onSegmentChange?.(event.target.value)}
                  className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface"
                >
                  <option value="" className="bg-black">Select segment...</option>
                  {segments.map((segment) => (
                    <option key={segment.id} value={segment.id} className="bg-black">
                      {segment.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="py-2 text-xs text-on-surface-variant">
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
          className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-[14px]">done_all</span>
          {bulkPending ? 'Applying...' : 'Apply updates'}
        </button>

        <button
          onClick={onDelete}
          disabled={bulkPending}
          className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-red-400/40 px-2 text-xs text-red-200 transition hover:bg-red-400/10 hover:text-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Delete selected contacts"
        >
          <span className="material-symbols-outlined text-[14px]">delete</span>
          Delete selected
        </button>
      </div>
    </section>
  )
}
