'use client'

import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'
import { Icon } from '@/components/studio'

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
    <span className="pib-pill pib-pill-accent">
      default
    </span>
  )
}

function ArchivedBadge() {
  return (
    <span className="pib-pill pib-pill-accent">
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

function isPipelineSetupArtifact(pipeline: Pipeline): boolean {
  const name = pipeline.name?.trim().toLowerCase() ?? ''
  if (!name) return false
  return /\b(smoke|test|delete)\b/.test(name)
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
  const needsSetupReview = isPipelineSetupArtifact(pipeline)

  return (
    <div className="border-b border-[var(--color-card-border)] transition last:border-b-0 hover:bg-white/[0.02]">
      {/* Info */}
      <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">{displayName}</p>
            {pipeline.isDefault && <DefaultBadge />}
            {pipeline.archived && <ArchivedBadge />}
            <span className={`pib-pill ${healthScore >= 100 && !needsSetupReview ? 'pib-pill-success' : 'pib-pill-warn'}`}>
              {needsSetupReview ? 'Review setup' : healthScore >= 100 ? 'Ready' : `${healthScore}% setup`}
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
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--color-card-border)] px-2 py-1 text-[11px] font-medium text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
              >
                <Icon name="edit_note" className="text-[13px]" />
                Add note
              </button>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {visibleStages.length > 0 ? visibleStages.map((stage) => (
              <span
                key={stage.id}
                className={[
                  'pib-pill',
                  stage.kind === 'won'
                    ? 'pib-pill-success'
                    : stage.kind === 'lost'
                      ? 'pib-pill-danger'
                      : '',
                ].join(' ')}
                title={`${stageDisplayName(stage)} (${stage.probability}% probability)`}
              >
                <Icon name={stage.kind === 'won' ? 'check_circle' : stage.kind === 'lost' ? 'cancel' : 'radio_button_unchecked'} className="text-[13px]" />
                {stageDisplayName(stage)}
              </span>
            )) : (
              <span className="inline-flex flex-wrap items-center gap-2 text-xs text-[var(--st-warning)]">
                No stages configured.
                {isAdmin && (
                  <button
                    type="button"
                    aria-label={`Add stages for ${displayName}`}
                    onClick={() => onEdit(pipeline)}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-amber-400/40 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] px-2 py-1 text-[11px] font-medium text-[var(--st-warning)] transition hover:bg-[color-mix(in_srgb,var(--st-warning)_20%,transparent)]"
                  >
                    <Icon name="add_circle" className="text-[13px]" />
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
          <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
            <p className="text-lg font-medium text-[var(--color-pib-text)]">{stageCount}</p>
            <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Stages</p>
          </div>
          <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
            <p className="text-lg font-medium text-[var(--color-pib-text)]">{openCount}</p>
            <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Open</p>
          </div>
          <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
            <p className="text-lg font-medium text-emerald-200">{wonCount}</p>
            <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Won</p>
          </div>
          <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
            <p className="text-lg font-medium text-red-200">{lostCount}</p>
            <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Lost</p>
          </div>
        </div>
      </div>

      {/* Admin actions */}
      {isAdmin && (
        <div className="flex items-center justify-end gap-1 px-3 pb-2">
          {/* Set default (only if not already default and not archived) */}
          {!pipeline.isDefault && !pipeline.archived && (
            needsSetupReview ? (
              <button
                type="button"
                aria-label={`Review setup for ${displayName} before setting it as default`}
                onClick={() => onEdit(pipeline)}
                className="grid h-8 w-8 cursor-pointer place-items-center rounded-md text-[var(--st-warning)] transition hover:bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] hover:text-[var(--st-warning)]"
                title="Review setup before default"
              >
                <Icon name="edit_note" className="text-[16px]" />
              </button>
            ) : (
            <button
              type="button"
              aria-label={`Set ${displayName} as default`}
              onClick={() => onSetDefault(pipeline)}
              className="grid h-8 w-8 cursor-pointer place-items-center rounded-md text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-primary"
              title="Set as default"
            >
              <Icon name="star" className="text-[16px]" />
            </button>
            )
          )}

          {/* Archive / unarchive */}
          <button
            type="button"
            aria-label={pipeline.archived ? `Unarchive ${displayName}` : `Archive ${displayName}`}
            onClick={() => onArchive(pipeline)}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-md text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
            title={pipeline.archived ? 'Unarchive' : 'Archive'}
          >
            <Icon name={pipeline.archived ? 'unarchive' : 'archive'} className="text-[16px]" />
          </button>

          {/* Edit */}
          <button
            type="button"
            aria-label={`Edit ${displayName}`}
            onClick={() => onEdit(pipeline)}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-md text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
            title="Edit pipeline"
          >
            <Icon name="edit" className="text-[16px]" />
          </button>

          {/* Delete */}
          <button
            type="button"
            aria-label={`Delete ${displayName}`}
            onClick={() => onDelete(pipeline)}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-md text-[var(--color-pib-text-muted)] transition hover:bg-red-400/10 hover:text-red-300"
            title="Delete pipeline"
          >
            <Icon name="delete" className="text-[16px]" />
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
      <div className="overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
        <div className="grid gap-0 lg:grid-cols-[1.1fr_1.4fr]">
          <div className="border-b border-[var(--color-card-border)] p-4 lg:border-b-0 lg:border-r">
            <span className="mb-2"><Icon name="account_tree" className="text-[15px]" /></span>
            <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Pipeline setup</p>
            <h2 className="mt-1 text-base font-medium leading-tight text-[var(--color-pib-text)]">
              Launch your first revenue path
            </h2>
            <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">
              Start with one board that every employee understands: a clear intake stage, open work,
              and trusted won/lost exits for forecasts, automations, and CEO-level reporting.
            </p>

            {isAdmin && onCreate ? (
              <button
                type="button"
                onClick={onCreate}
                className="mt-3 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition"
              >
                <Icon name="add" className="text-[16px]" />
                Create the first pipeline
              </button>
            ) : (
              <p className="mt-3 rounded-md border border-[var(--color-card-border)] bg-black/10 px-2.5 py-1.5 text-[11px] text-[var(--color-pib-text-muted)]">
                Ask an admin to create the first pipeline before teams start logging deals.
              </p>
            )}
          </div>

          <div className="grid gap-px bg-[var(--color-card-border)] sm:grid-cols-2">
            {blueprint.map((item) => (
              <div key={item.label} className="bg-[var(--color-card)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">{item.label}</p>
                    <p className="mt-1 text-lg font-medium leading-none text-[var(--color-pib-text)]">{item.value}</p>
                  </div>
                  <Icon name={item.icon} className="text-[16px] text-[var(--color-pib-text-muted)]" />
                </div>
                <p className="mt-2 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{item.copy}</p>
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
    <div className="overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
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
