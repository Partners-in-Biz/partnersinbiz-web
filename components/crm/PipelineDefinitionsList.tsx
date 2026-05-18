'use client'

import type { Pipeline } from '@/lib/pipelines/types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PipelineDefinitionsListProps {
  pipelines: Pipeline[]
  onEdit: (p: Pipeline) => void
  onDelete: (p: Pipeline) => void
  onSetDefault: (p: Pipeline) => void
  onArchive: (p: Pipeline) => void
  isAdmin: boolean
}

// ── Badges ────────────────────────────────────────────────────────────────────

function DefaultBadge() {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--color-accent-v2)]/10 text-[var(--color-accent-v2)] border border-[var(--color-accent-v2)]/20">
      default
    </span>
  )
}

function ArchivedBadge() {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] border border-[var(--color-pib-line)]">
      archived
    </span>
  )
}

// ── Pipeline row ──────────────────────────────────────────────────────────────

function PipelineRow({
  pipeline,
  isAdmin,
  onEdit,
  onDelete,
  onSetDefault,
  onArchive,
}: {
  pipeline: Pipeline
  isAdmin: boolean
  onEdit: (p: Pipeline) => void
  onDelete: (p: Pipeline) => void
  onSetDefault: (p: Pipeline) => void
  onArchive: (p: Pipeline) => void
}) {
  const stageCount = pipeline.stages.length

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] rounded-lg">
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-[var(--color-pib-text)] truncate">{pipeline.name}</p>
          {pipeline.isDefault && <DefaultBadge />}
          {pipeline.archived && <ArchivedBadge />}
        </div>
        {pipeline.description && (
          <p className="text-xs text-[var(--color-pib-text-muted)] truncate mt-0.5">{pipeline.description}</p>
        )}
        <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
          {stageCount} stage{stageCount !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Admin actions */}
      {isAdmin && (
        <div className="flex items-center gap-1 shrink-0">
          {/* Set default (only if not already default and not archived) */}
          {!pipeline.isDefault && !pipeline.archived && (
            <button
              type="button"
              aria-label={`Set ${pipeline.name} as default`}
              onClick={() => onSetDefault(pipeline)}
              className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-[var(--color-accent-v2)] transition-colors p-1"
              title="Set as default"
            >
              <span className="material-symbols-outlined text-[18px]">star</span>
            </button>
          )}

          {/* Archive / unarchive */}
          <button
            type="button"
            aria-label={pipeline.archived ? `Unarchive ${pipeline.name}` : `Archive ${pipeline.name}`}
            onClick={() => onArchive(pipeline)}
            className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors p-1"
            title={pipeline.archived ? 'Unarchive' : 'Archive'}
          >
            <span className="material-symbols-outlined text-[18px]">
              {pipeline.archived ? 'unarchive' : 'archive'}
            </span>
          </button>

          {/* Edit */}
          <button
            type="button"
            aria-label={`Edit ${pipeline.name}`}
            onClick={() => onEdit(pipeline)}
            className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors p-1"
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
          </button>

          {/* Delete */}
          <button
            type="button"
            aria-label={`Delete ${pipeline.name}`}
            onClick={() => onDelete(pipeline)}
            className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-red-400 transition-colors p-1"
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      )}
    </div>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export function PipelineDefinitionsList({
  pipelines,
  onEdit,
  onDelete,
  onSetDefault,
  onArchive,
  isAdmin,
}: PipelineDefinitionsListProps) {
  if (pipelines.length === 0) {
    return (
      <p className="text-sm text-[var(--color-pib-text-muted)] italic">No pipelines yet.</p>
    )
  }

  // Sort: default first, then non-archived, then archived; alphabetical within groups
  const sorted = [...pipelines].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1
    if (!a.isDefault && b.isDefault) return 1
    if (!a.archived && b.archived) return -1
    if (a.archived && !b.archived) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="space-y-2">
      {sorted.map((p) => (
        <PipelineRow
          key={p.id}
          pipeline={p}
          isAdmin={isAdmin}
          onEdit={onEdit}
          onDelete={onDelete}
          onSetDefault={onSetDefault}
          onArchive={onArchive}
        />
      ))}
    </div>
  )
}
