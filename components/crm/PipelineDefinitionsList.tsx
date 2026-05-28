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
  const openCount = pipeline.stages.filter((stage) => stage.kind === 'open').length
  const wonCount = pipeline.stages.filter((stage) => stage.kind === 'won').length
  const lostCount = pipeline.stages.filter((stage) => stage.kind === 'lost').length
  const healthChecks = [
    Boolean(pipeline.name?.trim()),
    stageCount > 0,
    openCount > 0,
    wonCount > 0,
    lostCount > 0,
  ]
  const healthScore = Math.round((healthChecks.filter(Boolean).length / healthChecks.length) * 100)
  const visibleStages = [...pipeline.stages].sort((a, b) => a.order - b.order).slice(0, 6)

  return (
    <div className="bento-card !p-0 overflow-hidden">
      {/* Info */}
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-base font-semibold text-[var(--color-pib-text)] truncate">{pipeline.name}</p>
            {pipeline.isDefault && <DefaultBadge />}
            {pipeline.archived && <ArchivedBadge />}
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${healthScore >= 100 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-200'}`}>
              {healthScore >= 100 ? 'Ready' : `${healthScore}% setup`}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)] line-clamp-2">
            {pipeline.description || 'No operating note yet. Add when this path should be used and what qualifies a deal for each stage.'}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {visibleStages.length > 0 ? visibleStages.map((stage) => (
              <span
                key={stage.id}
                className={[
                  'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px]',
                  stage.kind === 'won'
                    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                    : stage.kind === 'lost'
                      ? 'border-red-400/20 bg-red-400/10 text-red-200'
                      : 'border-[var(--color-pib-line)] bg-white/[0.03] text-[var(--color-pib-text-muted)]',
                ].join(' ')}
                title={`${stage.label} (${stage.probability}% probability)`}
              >
                <span className="material-symbols-outlined text-[13px]">
                  {stage.kind === 'won' ? 'check_circle' : stage.kind === 'lost' ? 'cancel' : 'radio_button_unchecked'}
                </span>
                {stage.label}
              </span>
            )) : (
              <span className="text-xs text-amber-200">No stages configured.</span>
            )}
            {pipeline.stages.length > visibleStages.length && (
              <span className="text-xs text-[var(--color-pib-text-muted)]">+{pipeline.stages.length - visibleStages.length} more</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 text-center lg:w-[300px]">
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-2">
            <p className="font-display text-lg text-[var(--color-pib-text)]">{stageCount}</p>
            <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">Stages</p>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-2">
            <p className="font-display text-lg text-[var(--color-pib-text)]">{openCount}</p>
            <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">Open</p>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-2">
            <p className="font-display text-lg text-emerald-200">{wonCount}</p>
            <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">Won</p>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-2">
            <p className="font-display text-lg text-red-200">{lostCount}</p>
            <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">Lost</p>
          </div>
        </div>
      </div>

      {/* Admin actions */}
      {isAdmin && (
        <div className="flex items-center justify-end gap-1 border-t border-[var(--color-pib-line)] px-3 py-2">
          {/* Set default (only if not already default and not archived) */}
          {!pipeline.isDefault && !pipeline.archived && (
            <button
              type="button"
              aria-label={`Set ${pipeline.name} as default`}
              onClick={() => onSetDefault(pipeline)}
              className="cursor-pointer w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-accent-v2)] hover:bg-white/[0.06] transition-colors"
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
            className="cursor-pointer w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.06] transition-colors"
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
            className="cursor-pointer w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.06] transition-colors"
            title="Edit pipeline"
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
          </button>

          {/* Delete */}
          <button
            type="button"
            aria-label={`Delete ${pipeline.name}`}
            onClick={() => onDelete(pipeline)}
            className="cursor-pointer w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-red-400 hover:bg-red-400/[0.08] transition-colors"
            title="Delete pipeline"
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
