'use client'

import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PipelineDefinitionsListProps {
  pipelines: Pipeline[]
  onCreate?: () => void
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

function pipelineStages(pipeline: Pipeline): PipelineStage[] {
  return Array.isArray(pipeline.stages) ? pipeline.stages : []
}

function pipelineDisplayName(pipeline: Pipeline): string {
  return pipeline.name?.trim() || 'Pipeline name missing'
}

function stageDisplayName(stage: PipelineStage): string {
  return stage.label?.trim() || 'Stage name missing'
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
  const stages = pipelineStages(pipeline)
  const displayName = pipelineDisplayName(pipeline)
  const stageCount = stages.length
  const openCount = stages.filter((stage) => stage.kind === 'open').length
  const wonCount = stages.filter((stage) => stage.kind === 'won').length
  const lostCount = stages.filter((stage) => stage.kind === 'lost').length
  const healthChecks = [
    Boolean(pipeline.name?.trim()),
    stageCount > 0,
    openCount > 0,
    wonCount > 0,
    lostCount > 0,
  ]
  const healthScore = Math.round((healthChecks.filter(Boolean).length / healthChecks.length) * 100)
  const visibleStages = [...stages].sort((a, b) => a.order - b.order).slice(0, 6)
  const hasOperatingNote = Boolean(pipeline.description?.trim())

  return (
    <div className="bento-card !p-0 overflow-hidden">
      {/* Info */}
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-base font-semibold text-[var(--color-pib-text)] truncate">{displayName}</p>
            {pipeline.isDefault && <DefaultBadge />}
            {pipeline.archived && <ArchivedBadge />}
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${healthScore >= 100 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-200'}`}>
              {healthScore >= 100 ? 'Ready' : `${healthScore}% setup`}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-xs text-[var(--color-pib-text-muted)] line-clamp-2">
              {hasOperatingNote
                ? pipeline.description
                : 'No operating note yet. Add when this path should be used and what qualifies a deal for each stage.'}
            </p>
            {isAdmin && !hasOperatingNote && (
              <button
                type="button"
                aria-label={`Add operating note for ${displayName}`}
                onClick={() => onEdit(pipeline)}
                className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] px-2 py-1 text-[11px] font-medium text-[var(--color-pib-text)] transition-colors hover:border-[var(--color-accent-v2)]/40 hover:bg-[var(--color-accent-v2)]/10"
              >
                <span className="material-symbols-outlined text-[13px]">edit_note</span>
                Add note
              </button>
            )}
          </div>

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
                title={`${stageDisplayName(stage)} (${stage.probability}% probability)`}
              >
                <span className="material-symbols-outlined text-[13px]">
                  {stage.kind === 'won' ? 'check_circle' : stage.kind === 'lost' ? 'cancel' : 'radio_button_unchecked'}
                </span>
                {stageDisplayName(stage)}
              </span>
            )) : (
              <span className="inline-flex flex-wrap items-center gap-2 text-xs text-amber-200">
                No stages configured.
                {isAdmin && (
                  <button
                    type="button"
                    aria-label={`Add stages for ${displayName}`}
                    onClick={() => onEdit(pipeline)}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[11px] font-medium text-amber-100 transition-colors hover:border-amber-200/50 hover:bg-amber-300/15"
                  >
                    <span className="material-symbols-outlined text-[13px]">add_circle</span>
                    Add stages
                  </button>
                )}
              </span>
            )}
            {stages.length > visibleStages.length && (
              <span className="text-xs text-[var(--color-pib-text-muted)]">+{stages.length - visibleStages.length} more</span>
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
              aria-label={`Set ${displayName} as default`}
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
            aria-label={pipeline.archived ? `Unarchive ${displayName}` : `Archive ${displayName}`}
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
            aria-label={`Edit ${displayName}`}
            onClick={() => onEdit(pipeline)}
            className="cursor-pointer w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.06] transition-colors"
            title="Edit pipeline"
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
          </button>

          {/* Delete */}
          <button
            type="button"
            aria-label={`Delete ${displayName}`}
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
  onCreate,
  onEdit,
  onDelete,
  onSetDefault,
  onArchive,
  isAdmin,
}: PipelineDefinitionsListProps) {
  if (pipelines.length === 0) {
    const blueprint = [
      {
        label: 'Deal intake',
        value: 'Open',
        icon: 'radio_button_unchecked',
        copy: 'Where new opportunities enter the board.',
      },
      {
        label: 'Won exit',
        value: '100%',
        icon: 'check_circle',
        copy: 'A clean close point for revenue reports.',
      },
      {
        label: 'Lost exit',
        value: '0%',
        icon: 'cancel',
        copy: 'A clean loss point for coaching and analysis.',
      },
      {
        label: 'Default route',
        value: 'Set',
        icon: 'star',
        copy: 'The path every new deal can trust by default.',
      },
    ]

    return (
      <div className="bento-card !p-0 overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[1.1fr_1.4fr]">
          <div className="border-b border-[var(--color-pib-line)] p-6 lg:border-b-0 lg:border-r">
            <span className="material-symbols-outlined mb-4 block text-[34px] text-[var(--color-accent-v2)]">account_tree</span>
            <p className="eyebrow !text-[10px]">Pipeline setup</p>
            <h2 className="mt-2 font-display text-2xl leading-tight text-[var(--color-pib-text)]">
              Launch your first revenue path
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--color-pib-text-muted)]">
              Start with one board that every employee understands: a clear intake stage, open work,
              and trusted won/lost exits for forecasts, automations, and CEO-level reporting.
            </p>

            {isAdmin && onCreate ? (
              <button
                type="button"
                onClick={onCreate}
                className="btn-pib-accent mt-5 inline-flex cursor-pointer items-center gap-1.5 text-sm"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                Create the first pipeline
              </button>
            ) : (
              <p className="mt-5 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                Ask an admin to create the first pipeline before teams start logging deals.
              </p>
            )}
          </div>

          <div className="grid gap-px bg-[var(--color-pib-line)] sm:grid-cols-2">
            {blueprint.map((item) => (
              <div key={item.label} className="bg-[var(--color-pib-surface)] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-pib-text-muted)]">{item.label}</p>
                    <p className="mt-2 font-display text-2xl leading-none text-[var(--color-pib-text)]">{item.value}</p>
                  </div>
                  <span className="material-symbols-outlined text-[21px] text-[var(--color-pib-text-muted)]">{item.icon}</span>
                </div>
                <p className="mt-4 text-xs leading-5 text-[var(--color-pib-text-muted)]">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Sort: default first, then non-archived, then archived; alphabetical within groups
  const sorted = [...pipelines].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1
    if (!a.isDefault && b.isDefault) return 1
    if (!a.archived && b.archived) return -1
    if (a.archived && !b.archived) return 1
    return pipelineDisplayName(a).localeCompare(pipelineDisplayName(b))
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
