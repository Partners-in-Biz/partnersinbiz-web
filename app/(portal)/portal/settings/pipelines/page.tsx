// app/(portal)/portal/settings/pipelines/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { PipelineDefinitionsList } from '@/components/crm/PipelineDefinitionsList'
import { PipelineDrawer } from '@/components/crm/PipelineDrawer'
import { extractPipelinesList } from '@/lib/pipelines/response'
import type { Pipeline } from '@/lib/pipelines/types'

type HealthFilter = 'all' | 'ready' | 'needs-work'

function pipelineHealth(pipeline: Pipeline): { score: number; gaps: string[] } {
  const stages = pipeline.stages ?? []
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

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: string }) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p className="mt-3 font-display text-3xl leading-none text-[var(--color-pib-text)]">{value}</p>
      <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">{sub}</p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all')

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
      const res = await fetch(`/api/v1/crm/pipelines?archived=${archived}`)
      if (res.status === 404) {
        setFetchError('Pipelines API is not yet available. It will be ready shortly.')
        setPipelines([])
        return
      }
      if (!res.ok) {
        setFetchError('Failed to load pipelines. Please try again.')
        setPipelines([])
        return
      }
      const body = await res.json()
      const list = extractPipelinesList(body)
      setPipelines(list)
    } catch {
      setFetchError('Could not reach the server. Check your connection.')
      setPipelines([])
    } finally {
      setLoading(false)
    }
  }, [])

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
    try {
      const res = await fetch(`/api/v1/crm/pipelines/${p.id}/set-default`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.error ?? 'Failed to set default pipeline.')
        return
      }
      await fetchPipelines(showArchived)
    } catch {
      alert('Could not reach the server.')
    }
  }

  async function handleArchive(p: Pipeline) {
    try {
      const res = await fetch(`/api/v1/crm/pipelines/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: !p.archived }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.error ?? 'Failed to update pipeline.')
        return
      }
      await fetchPipelines(showArchived)
    } catch {
      alert('Could not reach the server.')
    }
  }

  async function handleDelete(p: Pipeline) {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/v1/crm/pipelines/${p.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        // 400 means live deals are attached — surface a friendly message
        const msg = res.status === 400
          ? (body.error ?? 'This pipeline has live deals and cannot be deleted. Archive it instead.')
          : (body.error ?? 'Failed to delete pipeline.')
        alert(msg)
        return
      }
      await fetchPipelines(showArchived)
    } catch {
      alert('Could not reach the server.')
    }
  }

  async function handleSave(data: Partial<Pipeline>) {
    const isEdit = drawerMode === 'edit' && editingPipeline?.id
    const url = isEdit
      ? `/api/v1/crm/pipelines/${editingPipeline!.id}`
      : '/api/v1/crm/pipelines'
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

  // ── Render ─────────────────────────────────────────────────────────────────────

  const activePipelines = pipelines.filter((pipeline) => !pipeline.archived)
  const archivedPipelines = pipelines.filter((pipeline) => pipeline.archived)
  const defaultPipeline = pipelines.find((pipeline) => pipeline.isDefault)
  const totalStages = pipelines.reduce((sum, pipeline) => sum + pipeline.stages.length, 0)
  const activeStageTotal = activePipelines.reduce((sum, pipeline) => sum + pipeline.stages.length, 0)
  const openStageCount = pipelines.reduce((sum, pipeline) => sum + pipeline.stages.filter((stage) => stage.kind === 'open').length, 0)
  const wonStageCount = pipelines.reduce((sum, pipeline) => sum + pipeline.stages.filter((stage) => stage.kind === 'won').length, 0)
  const lostStageCount = pipelines.reduce((sum, pipeline) => sum + pipeline.stages.filter((stage) => stage.kind === 'lost').length, 0)
  const readyCount = pipelines.filter((pipeline) => pipelineHealth(pipeline).score >= 100).length
  const needsWorkCount = pipelines.filter((pipeline) => pipelineHealth(pipeline).score < 100).length
  const averageStages = activePipelines.length > 0 ? activeStageTotal / activePipelines.length : 0
  const filteredPipelines = pipelines.filter((pipeline) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q ||
      pipeline.name.toLowerCase().includes(q) ||
      pipeline.description?.toLowerCase().includes(q) ||
      pipeline.stages.some((stage) => stage.label.toLowerCase().includes(q) || stage.kind.includes(q))
    const health = pipelineHealth(pipeline)
    const matchesHealth =
      healthFilter === 'all' ||
      (healthFilter === 'ready' && health.score >= 100) ||
      (healthFilter === 'needs-work' && health.score < 100)
    return matchesSearch && matchesHealth
  })
  const canClearFilters = Boolean(search) || healthFilter !== 'all'

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">CRM settings</p>
          <h1 className="pib-page-title mt-2">Pipeline command center</h1>
          <p className="pib-page-sub max-w-2xl">
            Design the sales paths that drive deal stages, forecasts, win/loss analytics, and automation triggers.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={openCreate}
            className="cursor-pointer btn-pib-accent flex items-center gap-1.5 text-sm shrink-0"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            New pipeline
          </button>
        )}
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active pipelines" value={String(activePipelines.length)} sub={`${archivedPipelines.length} archived definitions hidden by default`} icon="account_tree" />
        <StatCard label="Default route" value={defaultPipeline ? 'Set' : 'Missing'} sub={defaultPipeline?.name ?? 'Choose a default path for new deals'} icon="star" />
        <StatCard label="Stage coverage" value={String(totalStages)} sub={`${openStageCount} open, ${wonStageCount} won, ${lostStageCount} lost`} icon="schema" />
        <StatCard label="Pipeline health" value={`${readyCount}/${pipelines.length || 0}`} sub={`${needsWorkCount} definition${needsWorkCount === 1 ? '' : 's'} need setup work`} icon="monitoring" />
      </section>

      {/* Read-only banner for non-admins */}
      {role !== null && !isAdmin && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line)] text-sm text-[var(--color-pib-text-muted)]">
          <span className="material-symbols-outlined text-[16px] align-middle mr-1.5">info</span>
          Only admins can manage pipelines.
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pib-input min-w-[220px] flex-1"
              placeholder="Search pipeline, stage, or outcome..."
            />
            <select
              value={healthFilter}
              onChange={(event) => setHealthFilter(event.target.value as HealthFilter)}
              className="pib-input !w-auto"
            >
              <option value="all">All health</option>
              <option value="ready">Ready</option>
              <option value="needs-work">Needs work</option>
            </select>
            <label className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] px-3 text-sm text-[var(--color-pib-text-muted)]">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setShowArchived(e.target.checked)}
                className="cursor-pointer"
              />
              Show archived
            </label>
          </div>

          {canClearFilters ? (
            <button
              type="button"
              onClick={() => { setSearch(''); setHealthFilter('all') }}
              className="btn-pib-secondary text-xs inline-flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[14px]">filter_alt_off</span>
              Clear filters
            </button>
          ) : null}
        </div>

        <div className="bento-card !p-5 space-y-4">
          <div>
            <p className="eyebrow !text-[10px]">Pipeline focus</p>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
              Every live path should include open work, a won close, and a lost close so reports and automations can trust the outcome.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
              <p className="font-display text-xl text-[var(--color-pib-text)]">{averageStages.toFixed(1)}</p>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">Avg stages</p>
            </div>
            <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
              <p className="font-display text-xl text-[var(--color-pib-text)]">{wonStageCount}</p>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">Won exits</p>
            </div>
            <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
              <p className="font-display text-xl text-[var(--color-pib-text)]">{lostStageCount}</p>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">Lost exits</p>
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="pib-skeleton h-24" />)}
        </div>
      ) : fetchError ? (
        <div className="px-4 py-3 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm text-[var(--color-pib-text-muted)]">
          {fetchError}
        </div>
      ) : pipelines.length === 0 ? (
        <div className="bento-card !p-8 text-center">
          <span className="material-symbols-outlined text-[34px] text-[var(--color-pib-text-muted)] mb-3 block">account_tree</span>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            No pipelines yet. Define the first sales path for this workspace.
          </p>
          {isAdmin && (
            <button
              type="button"
              onClick={openCreate}
              className="cursor-pointer btn-pib-accent flex items-center gap-1.5 text-sm mx-auto mt-4"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              New pipeline
            </button>
          )}
        </div>
      ) : filteredPipelines.length === 0 ? (
        <div className="bento-card !p-8 text-center">
          <span className="material-symbols-outlined text-[34px] text-[var(--color-pib-text-muted)] mb-3 block">search_off</span>
          <p className="text-sm font-medium text-[var(--color-pib-text)]">No pipelines match this view.</p>
          <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">Clear the filters to return to the full pipeline library.</p>
        </div>
      ) : (
        <PipelineDefinitionsList
          pipelines={filteredPipelines}
          isAdmin={isAdmin}
          onEdit={openEdit}
          onDelete={handleDelete}
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
