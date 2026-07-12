// app/(portal)/portal/settings/pipelines/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { PipelineDefinitionsList } from '@/components/crm/PipelineDefinitionsList'
import { PipelineDrawer } from '@/components/crm/PipelineDrawer'
import { extractPipelinesList } from '@/lib/pipelines/response'
import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

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
    <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">{label}</p>
        <span className="material-symbols-outlined text-[16px] text-on-surface-variant">{icon}</span>
      </div>
      <p className="mt-1 text-lg font-semibold leading-none text-on-surface">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-on-surface-variant">{sub}</p>
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
        // 400 means live deals are attached — surface a friendly message
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
    <div className="space-y-2">
      <header className="flex h-11 items-center gap-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/55 px-3">
        <span className="material-symbols-outlined grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-[15px] text-primary" aria-hidden="true">account_tree</span>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">CRM settings</p>
          <h1 className="truncate text-sm font-semibold leading-tight text-on-surface">Pipeline command center</h1>
        </div>
        <p className="ml-2 hidden min-w-0 truncate text-xs text-on-surface-variant lg:block">
          Design the sales paths that drive deal stages, forecasts, win/loss analytics, and automation triggers.
        </p>
        {isAdmin && (
          <button
            type="button"
            onClick={openCreate}
            className="ml-auto flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
            New pipeline
          </button>
        )}
      </header>

      {!fetchError && (
        <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
          className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3"
        >
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-2">
              <span className="material-symbols-outlined mt-0.5 text-[16px] text-amber-200" aria-hidden="true">alt_route</span>
              <div className="min-w-0">
                <p className="text-[10px] font-label uppercase tracking-[0.22em] text-amber-200">Revenue routing</p>
                <h2 className="mt-0.5 text-sm font-semibold text-on-surface">Default route is missing</h2>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-on-surface-variant">
                  New deals need a default revenue path before the team scales pipeline entry.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="flex h-7 items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 text-[11px] font-semibold text-amber-100">
                    {pipelineDisplayName(defaultCandidatePipeline)}
                  </span>
                  <span className="text-[11px] text-on-surface-variant">
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
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
                >
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">star</span>
                  Set default route
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openEdit(defaultCandidatePipeline)}
                  aria-label={`Review ${pipelineDisplayName(defaultCandidatePipeline)} before setting a default pipeline route`}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
                >
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">edit_note</span>
                  Review setup
                </button>
              )
            )}
          </div>
        </section>
      )}

      {/* Read-only banner for non-admins */}
      {role !== null && !isAdmin && (
        <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/55 px-3 py-2 text-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-[16px] align-middle mr-1.5">info</span>
          Only admins can manage pipelines.
        </div>
      )}

      {!fetchError && (
        <section className="grid gap-2 lg:grid-cols-[1fr_340px]">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/65 px-2 py-1.5">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-8 min-w-[220px] flex-1 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface placeholder:text-on-surface-variant"
                placeholder="Search pipeline, stage, or outcome..."
              />
              <select
                aria-label="Filter pipelines by health"
                value={healthFilter}
                onChange={(event) => setHealthFilter(event.target.value as HealthFilter)}
                className="h-8 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface"
              >
                <option value="all">All health</option>
                <option value="ready">Ready</option>
                <option value="needs-work">Needs work</option>
              </select>
              <label className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-on-surface-variant">
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
                  className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">filter_alt_off</span>
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-3">
            <div>
              <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Pipeline focus</p>
              <p className="mt-1 text-xs leading-5 text-on-surface-variant">
                Every live path should include open work, a won close, and a lost close so reports and automations can trust the outcome.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
                <p className="text-lg font-semibold text-on-surface">{averageStages.toFixed(1)}</p>
                <p className="text-[11px] leading-4 text-on-surface-variant">Avg stages</p>
              </div>
              <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
                <p className="text-lg font-semibold text-on-surface">{wonStageCount}</p>
                <p className="text-[11px] leading-4 text-on-surface-variant">Won exits</p>
              </div>
              <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
                <p className="text-lg font-semibold text-on-surface">{lostStageCount}</p>
                <p className="text-[11px] leading-4 text-on-surface-variant">Lost exits</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {deleteError && (
        <div className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-100">
          <span className="material-symbols-outlined mr-1.5 align-middle text-[16px]" aria-hidden="true">error</span>
          {deleteError}
        </div>
      )}

      {actionError && (
        <section
          role="status"
          aria-label="Pipeline action failed"
          className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2"
        >
          <div className="flex gap-2">
            <span className="material-symbols-outlined mt-0.5 text-[16px] text-amber-200" aria-hidden="true">warning</span>
            <div>
              <p className="text-xs font-medium text-amber-100">{actionError}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-on-surface-variant">
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
          className="rounded-xl border border-red-400/40 bg-red-400/10 p-3"
        >
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-2">
              <span className="material-symbols-outlined mt-0.5 text-[16px] text-red-200" aria-hidden="true">warning</span>
              <div className="min-w-0">
                <p className="text-[10px] font-label uppercase tracking-[0.22em] text-red-200">Pipeline delete</p>
                <h2 id="pipeline-delete-confirm-title" className="mt-0.5 text-sm font-semibold text-red-50">
                  Delete pipeline &quot;{pipelineDisplayName(pendingDeletePipeline)}&quot;?
                </h2>
                <p id="pipeline-delete-confirm-description" className="mt-1 max-w-2xl text-xs leading-5 text-red-100/90">
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
                className="flex h-8 cursor-pointer items-center rounded-md border border-[var(--color-card-border)] px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
                disabled={deletingId === pendingDeletePipeline.id}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeletePipeline}
                aria-label={`Confirm delete pipeline ${pipelineDisplayName(pendingDeletePipeline)}`}
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-red-400/40 bg-red-400/10 px-2 text-xs font-semibold text-red-100 transition hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={deletingId === pendingDeletePipeline.id}
              >
                <span className="material-symbols-outlined text-[15px]" aria-hidden="true">delete</span>
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
        <section className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-2">
              <span className="material-symbols-outlined mt-0.5 text-[16px] text-amber-200" aria-hidden="true">warning</span>
              <div className="min-w-0">
                <p className="text-[10px] font-label uppercase tracking-[0.22em] text-amber-200">Source health</p>
                <h2 className="mt-0.5 text-sm font-semibold text-on-surface">
                  Pipeline definitions could not load
                </h2>
                <p className="mt-1 text-xs leading-5 text-on-surface-variant">{fetchError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => fetchPipelines(showArchived)}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
              aria-label="Retry loading pipelines"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">refresh</span>
              Retry
            </button>
          </div>
        </section>
      ) : pipelines.length > 0 && filteredPipelines.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-6 text-center">
          <span className="material-symbols-outlined mb-2 block text-[19px] text-on-surface-variant" aria-hidden="true">search_off</span>
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Filtered revenue path</p>
          <h2 className="mt-1 text-sm font-semibold text-on-surface">No pipelines match this view.</h2>
          <p className="mt-1 text-xs text-on-surface-variant">Clear the pipeline filters to return to every revenue path.</p>
          <button
            type="button"
            onClick={clearPipelineFilters}
            className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
            aria-label="Show all pipelines"
          >
            <span className="material-symbols-outlined text-[15px]" aria-hidden="true">filter_alt_off</span>
            Show all pipelines
          </button>
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
