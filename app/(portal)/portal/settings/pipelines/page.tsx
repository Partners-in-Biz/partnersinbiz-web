// app/(portal)/portal/settings/pipelines/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { PipelineDefinitionsList } from '@/components/crm/PipelineDefinitionsList'
import { PipelineDrawer } from '@/components/crm/PipelineDrawer'
import { extractPipelinesList } from '@/lib/pipelines/response'
import type { Pipeline } from '@/lib/pipelines/types'

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

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

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-semibold mb-1">Pipelines</h1>
      <p className="text-sm text-[var(--color-pib-text-muted)] mb-6">
        Define sales pipelines and their stages for this workspace.
      </p>

      {/* Read-only banner for non-admins */}
      {role !== null && !isAdmin && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line)] text-sm text-[var(--color-pib-text-muted)]">
          <span className="material-symbols-outlined text-[16px] align-middle mr-1.5">info</span>
          Only admins can manage pipelines.
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <label className="flex items-center gap-2 cursor-pointer text-sm text-[var(--color-pib-text-muted)]">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => setShowArchived(e.target.checked)}
            className="cursor-pointer"
          />
          Show archived
        </label>

        {isAdmin && (
          <button
            type="button"
            onClick={openCreate}
            className="cursor-pointer btn-pib-accent flex items-center gap-1.5 text-sm"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            Add pipeline
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
      ) : fetchError ? (
        <div className="px-4 py-3 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm text-[var(--color-pib-text-muted)]">
          {fetchError}
        </div>
      ) : pipelines.length === 0 ? (
        <div className="px-5 py-8 rounded-xl border border-dashed border-[var(--color-pib-line)] text-center">
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            No pipelines yet.
            {isAdmin && (
              <> Click <span className="font-medium text-[var(--color-pib-text)]">Add pipeline</span> to define your first one.</>
            )}
          </p>
        </div>
      ) : (
        <PipelineDefinitionsList
          pipelines={pipelines}
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
