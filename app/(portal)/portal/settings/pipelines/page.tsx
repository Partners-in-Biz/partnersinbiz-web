// app/(portal)/portal/settings/pipelines/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { Icon } from '@/components/studio'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { PipelineDefinitionsList } from '@/components/crm/PipelineDefinitionsList'
import { PipelineDrawer } from '@/components/crm/PipelineDrawer'
import { extractPipelinesList } from '@/lib/pipelines/response'
import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import { PageHeader } from '@/components/ui/AppFoundation'

type HealthFilter = 'all' | 'ready' | 'needs-work'

function pipelineHealth(pipeline: Pipeline): { score: number; gaps: string[] } {
  const stages = pipelineStages(pipeline)
  const checks = [
    { ok: Boolean(pipeline.name?.trim()), label: 'name' },
    { ok: stages.length > 0, label: 'stages' },
    { ok: stages.some((stage) => stage.kind === 'open'), label: 'open stage' },
    { ok: stages.some((stage) => stage.kind === 'won'), label: 'won stage' },
    { ok: stages.some((stage) => stage.kind === 'lost'), label: 'lost stage' },
  ]
  const passed = checks.filter((check) => check.ok).length
  return {
    score: Math.round((passed / checks.length) * 100),
    gaps: checks.filter((check) => !check.ok).map((check) => check.label),
  }
}

function pipelineStages(pipeline: Pipeline): PipelineStage[] {
  return Array.isArray(pipeline.stages) ? pipeline.stages : []
}

function pipelineDisplayName(pipeline: Pipeline): string {
  return pipeline.name?.trim() || 'Pipeline name missing'
}

function pipelineSearchText(pipeline: Pipeline): string {
  return [
    pipelineDisplayName(pipeline),
    pipeline.description,
    ...pipelineStages(pipeline).flatMap((stage) => [stage.label, stage.kind]),
  ].filter(Boolean).join(' ').toLowerCase()
}

function isPipelineSetupArtifact(pipeline?: Pipeline): boolean {
  const name = pipeline?.name?.trim().toLowerCase() ?? ''
  if (!name) return false
  return /\b(smoke|test|delete)\b/.test(name)
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: string }) {
  return (
    <div className="pib-stat-card min-w-0" data-module-accent="cyan">
      <div className="flex items-start justify-between gap-2">
        <p className="pib-label">{label}</p>
        <Icon name={icon} />
      </div>
      <p className="mt-2 text-2xl leading-none text-[var(--color-pib-text)]">{value}</p>
      <p className="mt-2 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{sub}</p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PipelinesPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all')
  const [pendingDeletePipeline, setPendingDeletePipeline] = useState<Pipeline | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const pipelineEndpoint = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editingPipeline, setEditingPipeline] = useState<Partial<Pipeline> | undefined>(undefined)

  // ── Role fetch ───────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/v1/portal/settings/profile')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.profile?.role) setRole(d.profile.role) })
      .catch(() => {})
  }, [])

  // ── Pipelines fetch ───────────────────────────────────────────────────────────

  const fetchPipelines = useCallback(async (archived: boolean) => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(pipelineEndpoint(`/api/v1/crm/pipelines?archived=${archived}`))
      const body = await res.json().catch(() => ({}))
      if (res.status === 404) {
        setFetchError('Pipelines API is not yet available. It will be ready shortly.')
        setPipelines([])
        return
      }
      if (!res.ok) {
        setFetchError(typeof body?.error === 'string' ? body.error : 'Failed to load pipelines. Please try again.')
        setPipelines([])
        return
      }
      const list = extractPipelinesList(body)
      setPipelines(list)
    } catch {
      setFetchError('Could not reach the server. Check your connection.')
      setPipelines([])
    } finally {
      setLoading(false)
    }
  }, [pipelineEndpoint])

  useEffect(() => {
    fetchPipelines(showArchived)
  }, [showArchived, fetchPipelines])

  // ── Role gate ──────────────────────────────────────────────────────────────────

  const isAdmin = role === 'admin' || role === 'owner'

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function openCreate() {
    setEditingPipeline(undefined)
    setDrawerMode('create')
    setDrawerOpen(true)
  }

  function openEdit(p: Pipeline) {
    setEditingPipeline(p)
    setDrawerMode('edit')
    setDrawerOpen(true)
  }

  async function handleSetDefault(p: Pipeline) {
    setActionError(null)
    try {
      const res = await fetch(pipelineEndpoint(`/api/v1/crm/pipelines/${p.id}/set-default`), { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setActionError(body.error ?? 'Failed to set default pipeline.')
        return
      }
      await fetchPipelines(showArchived)
    } catch {
      setActionError('Could not reach the server.')
    }
  }

  async function handleArchive(p: Pipeline) {
    setActionError(null)
    try {
      const res = await fetch(pipelineEndpoint(`/api/v1/crm/pipelines/${p.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: !p.archived }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setActionError(body.error ?? 'Failed to update pipeline.')
        return
      }
      await fetchPipelines(showArchived)
    } catch {
      setActionError('Could not reach the server.')
    }
  }

  async function handleDelete(p: Pipeline) {
    setDeletingId(p.id)
    setDeleteError(null)
    try {
      const res = await fetch(pipelineEndpoint(`/api/v1/crm/pipelines/${p.id}`), { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        // 400 means live deals are attached - surface a friendly message
        const msg = res.status === 400
          ? (body.error ?? 'This pipeline has live deals and cannot be deleted. Archive it instead.')
          : (body.error ?? 'Failed to delete pipeline.')
        setDeleteError(msg)
        return
      }
      setPendingDeletePipeline(null)
      await fetchPipelines(showArchived)
    } catch {
      setDeleteError('Could not reach the server.')
    } finally {
      setDeletingId(null)
    }
  }

  async function confirmDeletePipeline() {
    if (!pendingDeletePipeline) return
    await handleDelete(pendingDeletePipeline)
  }

  async function handleSave(data: Partial<Pipeline>) {
    const isEdit = drawerMode === 'edit' && editingPipeline?.id
    const url = isEdit
      ? pipelineEndpoint(`/api/v1/crm/pipelines/${editingPipeline!.id}`)
      : pipelineEndpoint('/api/v1/crm/pipelines')
    const method = isEdit ? 'PATCH' : 'POST'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const err = new Error(body.error ?? 'Save failed')
      if (body.details) Object.assign(err, { details: body.details })
      throw err
    }

    await fetchPipelines(showArchived)
  }

  function clearPipelineFilters() {
    setSearch('')
    setHealthFilter('all')
  }

  // ── Render ─────────────────────────────────────────────────────────────────────

  const activePipelines = pipelines.filter((pipeline) => !pipeline.archived)
  const archivedPipelines = pipelines.filter((pipeline) => pipeline.archived)
  const defaultPipeline = pipelines.find((pipeline) => pipeline.isDefault)
  const defaultCandidatePipeline = !defaultPipeline
    ? activePipelines.find((pipeline) => pipelineHealth(pipeline).score >= 100) ?? activePipelines[0]
    : undefined
  const defaultCandidateReady = defaultCandidatePipeline
    ? pipelineHealth(defaultCandidatePipeline).score >= 100 && !isPipelineSetupArtifact(defaultCandidatePipeline)
    : false
  const totalStages = pipelines.reduce((sum, pipeline) => sum + pipelineStages(pipeline).length, 0)
  const activeStageTotal = activePipelines.reduce((sum, pipeline) => sum + pipelineStages(pipeline).length, 0)
  const openStageCount = pipelines.reduce((sum, pipeline) => sum + pipelineStages(pipeline).filter((stage) => stage.kind === 'open').length, 0)
  const wonStageCount = pipelines.reduce((sum, pipeline) => sum + pipelineStages(pipeline).filter((stage) => stage.kind === 'won').length, 0)
  const lostStageCount = pipelines.reduce((sum, pipeline) => sum + pipelineStages(pipeline).filter((stage) => stage.kind === 'lost').length, 0)
  const readyCount = pipelines.filter((pipeline) => pipelineHealth(pipeline).score >= 100).length
  const needsWorkCount = pipelines.filter((pipeline) => pipelineHealth(pipeline).score < 100).length
  const averageStages = activePipelines.length > 0 ? activeStageTotal / activePipelines.length : 0
  const filteredPipelines = pipelines.filter((pipeline) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || pipelineSearchText(pipeline).includes(q)
    const health = pipelineHealth(pipeline)
    const matchesHealth =
      healthFilter === 'all' ||
      (healthFilter === 'ready' && health.score >= 100) ||
      (healthFilter === 'needs-work' && health.score < 100)
    return matchesSearch && matchesHealth
  })
  const canClearFilters = Boolean(search) || healthFilter !== 'all'

  return (
    <div className="space-y-6">
      <PageHeader
        accent="cyan"
        eyebrow="CRM settings"
        title="Pipeline command center"
        description="Design the sales paths that drive deal stages, forecasts, win/loss analytics, and automation triggers."
        actions={isAdmin ? (
          <button
            type="button"
            onClick={openCreate}
            className="btn-pib-primary btn-pib-sm shrink-0"
          >
            <Icon name="add" />
            New pipeline
          </button>
        ) : undefined}
      />

      {!fetchError && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Active pipelines" value={String(activePipelines.length)} sub={`${archivedPipelines.length} archived definitions hidden by default`} icon="account_tree" />
          <StatCard label="Default route" value={defaultPipeline ? 'Set' : 'Missing'} sub={defaultPipeline ? pipelineDisplayName(defaultPipeline) : 'Choose a default path for new deals'} icon="star" />
          <StatCard label="Stage coverage" value={String(totalStages)} sub={`${openStageCount} open, ${wonStageCount} won, ${lostStageCount} lost`} icon="schema" />
          <StatCard label="Pipeline health" value={`${readyCount}/${pipelines.length || 0}`} sub={`${needsWorkCount} definition${needsWorkCount === 1 ? '' : 's'} need setup work`} icon="monitoring" />
        </section>
      )}

      {!fetchError && defaultCandidatePipeline && (
        <section
          role="region"
          aria-label="Default pipeline route review"
          className="pib-card"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <Icon name="alt_route" />
              <div className="min-w-0">
                <p className="pib-label">Revenue routing</p>
                <h2 className="mt-0.5 text-sm text-[var(--color-pib-text)]">Default route is missing</h2>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
                  New deals need a default revenue path before the team scales pipeline entry.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="pib-pill pib-pill-warn">
                    {pipelineDisplayName(defaultCandidatePipeline)}
                  </span>
                  <span className="text-[11px] text-[var(--color-pib-text-muted)]">
                    {defaultCandidateReady
                      ? 'Ready to become the first route for new deals.'
                      : 'Needs setup before it can carry new deals confidently.'}
                  </span>
                </div>
              </div>
            </div>
            {isAdmin && (
              defaultCandidateReady ? (
                <button
                  type="button"
                  onClick={() => handleSetDefault(defaultCandidatePipeline)}
                  aria-label={`Set ${pipelineDisplayName(defaultCandidatePipeline)} as default pipeline route`}
                  className="btn-pib-secondary shrink-0"
                >
                  <Icon name="star" />
                  Set default route
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openEdit(defaultCandidatePipeline)}
                  aria-label={`Review ${pipelineDisplayName(defaultCandidatePipeline)} before setting a default pipeline route`}
                  className="btn-pib-secondary shrink-0"
                >
                  <Icon name="edit_note" />
                  Review setup
                </button>
              )
            )}
          </div>
        </section>
      )}

      {/* Read-only banner for non-admins */}
      {role !== null && !isAdmin && (
        <div className="pib-card flex items-center gap-2 !py-3 text-xs text-[var(--color-pib-text-muted)]">
          <Icon name="info" />
          Only admins can manage pipelines.
        </div>
      )}

      {!fetchError && (
        <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search pipelines"
                  className="pib-input min-w-[220px] flex-1"
                placeholder="Search pipeline, stage, or outcome..."
              />
              <select
                aria-label="Filter pipelines by health"
                value={healthFilter}
                onChange={(event) => setHealthFilter(event.target.value as HealthFilter)}
                className="pib-select w-auto"
              >
                <option value="all">All health</option>
                <option value="ready">Ready</option>
                <option value="needs-work">Needs work</option>
              </select>
              <label className="pib-pill cursor-pointer gap-1.5">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={e => setShowArchived(e.target.checked)}
                  className="cursor-pointer"
                />
                Show archived
              </label>
              {canClearFilters ? (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setHealthFilter('all') }}
                  className="btn-pib-ghost"
                >
                  <Icon name="filter_alt_off" />
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>

          <div className="pib-card space-y-4">
            <div>
              <p className="pib-label">Pipeline focus</p>
              <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                Every live path should include open work, a won close, and a lost close so reports and automations can trust the outcome.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded border border-[var(--color-pib-line)] px-2 py-2">
                <p className="text-lg text-[var(--color-pib-text)]">{averageStages.toFixed(1)}</p>
                <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Avg stages</p>
              </div>
              <div className="rounded border border-[var(--color-pib-line)] px-2 py-2">
                <p className="text-lg text-[var(--color-pib-text)]">{wonStageCount}</p>
                <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Won exits</p>
              </div>
              <div className="rounded border border-[var(--color-pib-line)] px-2 py-2">
                <p className="text-lg text-[var(--color-pib-text)]">{lostStageCount}</p>
                <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Lost exits</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {deleteError && (
        <div className="pib-card flex items-center gap-2 !py-3 text-xs text-[var(--color-error)]">
          <Icon name="error" />
          {deleteError}
        </div>
      )}

      {actionError && (
        <section
          role="status"
          aria-label="Pipeline action failed"
          className="pib-card !py-3"
        >
          <div className="flex gap-3">
            <Icon name="warning" />
            <div>
              <p className="text-xs font-medium text-[var(--color-pib-text)]">{actionError}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
                No pipeline changes were applied. Review permissions or retry the action from this workspace.
              </p>
            </div>
          </div>
        </section>
      )}

      {pendingDeletePipeline && (
        <section
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="pipeline-delete-confirm-title"
          aria-describedby="pipeline-delete-confirm-description"
          className="pib-card border-[var(--color-pib-line-strong)]"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <Icon name="warning" />
              <div className="min-w-0">
                <p className="pib-label">Pipeline delete</p>
                <h2 id="pipeline-delete-confirm-title" className="mt-0.5 text-sm text-[var(--color-pib-text)]">
                  Delete pipeline &quot;{pipelineDisplayName(pendingDeletePipeline)}&quot;?
                </h2>
                <p id="pipeline-delete-confirm-description" className="mt-1 max-w-2xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
                  This removes the revenue path with {pipelineStages(pendingDeletePipeline).length} stage{pipelineStages(pendingDeletePipeline).length === 1 ? '' : 's'}. Existing deal history stays available for audit.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <button
                type="button"
                aria-label={`Cancel delete pipeline ${pipelineDisplayName(pendingDeletePipeline)}`}
                onClick={() => {
                  setPendingDeletePipeline(null)
                  setDeleteError(null)
                }}
                className="btn-pib-ghost"
                disabled={deletingId === pendingDeletePipeline.id}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeletePipeline}
                aria-label={`Confirm delete pipeline ${pipelineDisplayName(pendingDeletePipeline)}`}
                className="btn-pib-danger"
                disabled={deletingId === pendingDeletePipeline.id}
              >
                <Icon name="delete" />
                {deletingId === pendingDeletePipeline.id ? 'Deleting...' : 'Delete pipeline'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="pib-skeleton h-20" />)}
        </div>
      ) : fetchError ? (
        <section className="pib-card">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <Icon name="warning" />
              <div className="min-w-0">
                <p className="pib-label">Source health</p>
                <h2 className="mt-0.5 text-sm text-[var(--color-pib-text)]">
                  Pipeline definitions could not load
                </h2>
                <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{fetchError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => fetchPipelines(showArchived)}
              className="btn-pib-secondary shrink-0"
              aria-label="Retry loading pipelines"
            >
              <Icon name="refresh" />
              Retry
            </button>
          </div>
        </section>
      ) : pipelines.length > 0 && filteredPipelines.length === 0 ? (
        <div className="pib-empty-state">
          <Icon name="search_off" />
          <p className="pib-label">Filtered revenue path</p>
          <h2 className="pib-empty-state-title">No pipelines match this view.</h2>
          <p className="pib-empty-state-description">Clear the pipeline filters to return to every revenue path.</p>
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={clearPipelineFilters}
              className="btn-pib-secondary"
              aria-label="Show all pipelines"
            >
              <Icon name="filter_alt_off" />
              Show all pipelines
            </button>
          </div>
        </div>
      ) : (
        <PipelineDefinitionsList
          pipelines={filteredPipelines}
          isAdmin={isAdmin}
          onCreate={openCreate}
          onEdit={openEdit}
          onDelete={(pipeline) => {
            setPendingDeletePipeline(pipeline)
            setDeleteError(null)
          }}
          onSetDefault={handleSetDefault}
          onArchive={handleArchive}
        />
      )}

      {/* Drawer */}
      <PipelineDrawer
        open={drawerOpen}
        mode={drawerMode}
        pipeline={editingPipeline}
        onSave={handleSave}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}
