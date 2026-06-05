'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import type {
  BehavioralRule,
  EngagementScoreRule,
} from '@/lib/crm/segments'
import { BehavioralRuleEditor } from '@/components/crm/segments/BehavioralRuleEditor'
import { EngagementRuleEditor } from '@/components/crm/segments/EngagementRuleEditor'
import { PREDEFINED_SEGMENTS } from '@/lib/crm/predefined-segments'
import {
  SegmentCommandCenter,
  matchesSegmentCommandFocus,
  matchesSegmentSearch,
  type SegmentCommandFocus,
} from '@/components/crm/SegmentCommandCenter'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

const STAGES = ['', 'new', 'contacted', 'replied', 'demo', 'proposal', 'won', 'lost']
const TYPES = ['', 'lead', 'prospect', 'client', 'churned']
const SOURCES = ['', 'manual', 'form', 'import', 'outreach']

interface SegmentFilters {
  tags?: string[]
  capturedFromIds?: string[]
  stage?: string
  type?: string
  source?: string
  behavioral?: BehavioralRule[]
  engagement?: EngagementScoreRule
}

interface Segment {
  id: string
  name: string
  description: string
  filters: SegmentFilters
  createdAt?: unknown
}

interface FormState {
  name: string
  description: string
  tags: string
  stage: string
  type: string
  source: string
  behavioral: BehavioralRule[]
  engagement: EngagementScoreRule | null
}

export function extractSegmentsList(body: unknown): Segment[] {
  if (!body || typeof body !== 'object') return []
  const data = (body as { data?: unknown }).data
  if (Array.isArray(data)) return data as Segment[]
  if (data && typeof data === 'object' && Array.isArray((data as { segments?: unknown }).segments)) {
    return (data as { segments: Segment[] }).segments
  }
  return []
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  tags: '',
  stage: '',
  type: '',
  source: '',
  behavioral: [],
  engagement: null,
}

function filtersFromForm(f: FormState): SegmentFilters {
  const filters: SegmentFilters = {}
  const tags = f.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  if (tags.length) filters.tags = tags
  if (f.stage) filters.stage = f.stage
  if (f.type) filters.type = f.type
  if (f.source) filters.source = f.source
  if (f.behavioral.length) filters.behavioral = f.behavioral
  if (f.engagement) filters.engagement = f.engagement
  return filters
}

function formFromSegment(s: Segment): FormState {
  return {
    name: s.name ?? '',
    description: s.description ?? '',
    tags: (s.filters?.tags ?? []).join(', '),
    stage: s.filters?.stage ?? '',
    type: s.filters?.type ?? '',
    source: s.filters?.source ?? '',
    behavioral: Array.isArray(s.filters?.behavioral) ? s.filters.behavioral : [],
    engagement: s.filters?.engagement ?? null,
  }
}

function segmentDisplayName(segment: Segment): string {
  return segment.name?.trim() || 'Segment name missing'
}

export default function PortalSegmentsPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const segmentEndpoint = useCallback(
    (path: string) => scopedApiPath(path, orgScope),
    [orgScope],
  )
  const [segments, setSegments] = useState<Segment[]>([])
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState<FormState>(EMPTY_FORM)
  const [savingNew, setSavingNew] = useState(false)
  const [newError, setNewError] = useState('')
  const [search, setSearch] = useState('')
  const [focus, setFocus] = useState<SegmentCommandFocus>('all')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')
  const [pendingDeleteSegment, setPendingDeleteSegment] = useState<Segment | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')

  const fetchSegments = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await fetch(segmentEndpoint('/api/v1/crm/segments'))
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : `Failed to load segments (${res.status})`)
      }
      const list = extractSegmentsList(body)
      setSegments(list)
      setCounts({})
      // Lazy count resolution
      list.forEach((s) => {
        setCounts((prev) => (prev[s.id] !== undefined ? prev : { ...prev, [s.id]: null }))
        fetch(segmentEndpoint(`/api/v1/crm/segments/${s.id}/resolve`), { method: 'POST' })
          .then((r) => (r.ok ? r.json() : null))
          .then((b) => {
            if (b && typeof b.data?.count === 'number') {
              setCounts((prev) => ({ ...prev, [s.id]: b.data.count }))
            } else if (b && typeof b.count === 'number') {
              setCounts((prev) => ({ ...prev, [s.id]: b.count }))
            }
          })
          .catch(() => {})
      })
    } catch (err) {
      setSegments([])
      setCounts({})
      setLoadError(err instanceof Error ? err.message : 'Failed to load segments')
    } finally {
      setLoading(false)
    }
  }, [segmentEndpoint])

  useEffect(() => {
    fetchSegments()
  }, [fetchSegments])

  async function createSegment(e: React.FormEvent) {
    e.preventDefault()
    if (!newForm.name.trim()) {
      setNewError('Name is required')
      return
    }
    setSavingNew(true)
    setNewError('')
    try {
      const res = await fetch(segmentEndpoint('/api/v1/crm/segments'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: newForm.name.trim(),
          description: newForm.description.trim(),
          filters: filtersFromForm(newForm),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed to create segment')
      }
      setNewForm(EMPTY_FORM)
      setShowNew(false)
      fetchSegments()
    } catch (err: unknown) {
      setNewError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingNew(false)
    }
  }

  function startEdit(s: Segment) {
    setEditingId(s.id)
    setEditForm(formFromSegment(s))
    setEditError('')
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingId) return
    if (!editForm.name.trim()) {
      setEditError('Name is required')
      return
    }
    setSavingEdit(true)
    setEditError('')
    try {
      const res = await fetch(segmentEndpoint(`/api/v1/crm/segments/${editingId}`), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name.trim(),
          description: editForm.description.trim(),
          filters: filtersFromForm(editForm),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Save failed')
      }
      setEditingId(null)
      // Refresh count for this segment
      fetch(segmentEndpoint(`/api/v1/crm/segments/${editingId}/resolve`), { method: 'POST' })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          const count = b?.data?.count ?? b?.count
          if (typeof count === 'number') {
            setCounts((prev) => ({ ...prev, [editingId]: count }))
          }
        })
        .catch(() => {})
      fetchSegments()
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingEdit(false)
    }
  }

  async function deleteSegment(id: string, name: string) {
    setDeletingId(id)
    setDeleteError('')
    try {
      const res = await fetch(segmentEndpoint(`/api/v1/crm/segments/${id}`), { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setDeleteError(body.error ?? `Failed to delete segment "${name}".`)
        return
      }
      setSegments((prev) => prev.filter((s) => s.id !== id))
      setCounts((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setPendingDeleteSegment(null)
      if (editingId === id) setEditingId(null)
    } catch {
      setDeleteError('Could not reach the server.')
    } finally {
      setDeletingId(null)
    }
  }

  async function confirmDeleteSegment() {
    if (!pendingDeleteSegment) return
    await deleteSegment(pendingDeleteSegment.id, segmentDisplayName(pendingDeleteSegment))
  }

  function applyTemplate(presetId: string, target: 'new' | 'edit') {
    const preset = PREDEFINED_SEGMENTS.find((p) => p.id === presetId)
    if (!preset) return
    const setForm = target === 'new' ? setNewForm : setEditForm
    const cur = target === 'new' ? newForm : editForm
    setForm({
      ...cur,
      name: cur.name || preset.name,
      description: cur.description || preset.description,
      tags: (preset.filters.tags ?? []).join(', '),
      stage: preset.filters.stage ?? '',
      type: preset.filters.type ?? '',
      source: preset.filters.source ?? '',
      behavioral: preset.filters.behavioral ?? [],
      engagement: preset.filters.engagement ?? null,
    })
    if (target === 'new') setShowNew(true)
  }

  const filteredSegments = useMemo(
    () => segments.filter((segment) =>
      matchesSegmentSearch(segment, search) &&
      matchesSegmentCommandFocus(segment, counts, focus),
    ),
    [counts, focus, search, segments],
  )

  const renderForm = (
    form: FormState,
    setForm: (f: FormState) => void,
    onSubmit: (e: React.FormEvent) => void,
    onCancel: () => void,
    saving: boolean,
    error: string,
    submitLabel: string,
    target: 'new' | 'edit',
  ) => (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Template picker */}
      <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
          Use template
        </label>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) applyTemplate(e.target.value, target)
            e.target.value = ''
          }}
          className="pib-input w-full md:w-72"
        >
          <option value="" className="bg-black">
            — Choose a recipe —
          </option>
          {PREDEFINED_SEGMENTS.map((p) => (
            <option key={p.id} value={p.id} className="bg-black">
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
            Name *
          </label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="pib-input"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
            Description
          </label>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="pib-input"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
          Tags (comma separated)
        </label>
        <input
          value={form.tags}
          onChange={(e) => setForm({ ...form, tags: e.target.value })}
          placeholder="vip, newsletter"
          className="pib-input"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
            Stage
          </label>
          <select
            value={form.stage}
            onChange={(e) => setForm({ ...form, stage: e.target.value })}
            className="pib-input"
          >
            {STAGES.map((s) => (
              <option key={s || '_'} value={s} className="bg-black">
                {s || 'Any stage'}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
            Type
          </label>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="pib-input"
          >
            {TYPES.map((t) => (
              <option key={t || '_'} value={t} className="bg-black">
                {t || 'Any type'}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
            Source
          </label>
          <select
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
            className="pib-input"
          >
            {SOURCES.map((s) => (
              <option key={s || '_'} value={s} className="bg-black">
                {s || 'Any source'}
              </option>
            ))}
          </select>
        </div>
      </div>

      <BehavioralBlock
        rules={form.behavioral}
        engagement={form.engagement}
        filters={filtersFromForm(form)}
        segmentEndpoint={segmentEndpoint}
        onRulesChange={(rules) => setForm({ ...form, behavioral: rules })}
        onEngagementChange={(e) => setForm({ ...form, engagement: e })}
      />

      {error && (
        <p className="text-[11px]" style={{ color: 'var(--color-pib-danger, #FCA5A5)' }}>
          {error}
        </p>
      )}
      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={saving} className="btn-pib-accent disabled:opacity-40">
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="btn-pib-secondary">
          Cancel
        </button>
      </div>
    </form>
  )

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">CRM</p>
        <div className="flex items-end justify-between gap-4 flex-wrap mt-2">
          <div>
            <h1 className="pib-page-title">Segments</h1>
            <p className="pib-page-sub max-w-2xl">
              Save reusable filters across your contact base — slice by tag, stage, type, source,
              or email engagement.
            </p>
          </div>
          {!showNew && (
            <button onClick={() => setShowNew(true)} className="btn-pib-accent">
              <span className="material-symbols-outlined text-base" aria-hidden="true">add</span>
              New segment
            </button>
          )}
        </div>
      </header>

      {!loading && segments.length > 0 && (
        <SegmentCommandCenter
          segments={segments}
          counts={counts}
          search={search}
          focus={focus}
          onSearchChange={setSearch}
          onFocusChange={setFocus}
        />
      )}

      {deleteError && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          <span className="material-symbols-outlined mr-1.5 align-middle text-[16px]" aria-hidden="true">error</span>
          {deleteError}
        </div>
      )}

      {pendingDeleteSegment && (
        <section
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="segment-delete-confirm-title"
          aria-describedby="segment-delete-confirm-description"
          className="rounded-lg border border-red-400/25 bg-red-500/10 p-5 shadow-[0_18px_40px_rgba(127,29,29,0.18)]"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-red-200" aria-hidden="true">warning</span>
              <div>
                <p className="eyebrow !text-[10px] !text-red-100/80">Saved audience delete</p>
                <h2 id="segment-delete-confirm-title" className="mt-1 font-display text-lg text-red-50">
                  Delete segment &quot;{segmentDisplayName(pendingDeleteSegment)}&quot;?
                </h2>
                <p id="segment-delete-confirm-description" className="mt-2 max-w-2xl text-sm text-red-100/90">
                  This removes the saved audience lens for {counts[pendingDeleteSegment.id] ?? 'unresolved'} contact{counts[pendingDeleteSegment.id] === 1 ? '' : 's'}. Existing contact records and campaign history stay available for audit.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <button
                type="button"
                onClick={() => {
                  setPendingDeleteSegment(null)
                  setDeleteError('')
                }}
                className="btn-pib-secondary text-xs"
                disabled={deletingId === pendingDeleteSegment.id}
                aria-label={`Cancel delete for segment ${segmentDisplayName(pendingDeleteSegment)}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteSegment}
                aria-label={`Confirm delete segment ${segmentDisplayName(pendingDeleteSegment)}`}
                className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-red-300/30 bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-50 transition-colors hover:border-red-200/60 hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={deletingId === pendingDeleteSegment.id}
              >
                <span className="material-symbols-outlined text-[15px]" aria-hidden="true">delete</span>
                {deletingId === pendingDeleteSegment.id ? 'Deleting...' : 'Delete segment'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* New segment inline form */}
      {showNew && (
        <section className="bento-card !p-6 space-y-4">
          <p className="eyebrow !text-[10px]">New segment</p>
          {renderForm(
            newForm,
            setNewForm,
            createSegment,
            () => {
              setShowNew(false)
              setNewForm(EMPTY_FORM)
              setNewError('')
            },
            savingNew,
            newError,
            'Create segment',
            'new',
          )}
        </section>
      )}

      {/* Segments list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="pib-skeleton h-20" />
          ))}
        </div>
      ) : loadError ? (
        <section className="rounded-[var(--radius-card)] border border-amber-500/25 bg-amber-500/[0.07] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-amber-200" aria-hidden="true">warning</span>
              <div>
                <p className="eyebrow !text-[10px] text-amber-200">Source health</p>
                <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">Segments could not load</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">{loadError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={fetchSegments}
              className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 text-sm"
              aria-label="Retry loading segments"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>
              Retry
            </button>
          </div>
        </section>
      ) : segments.length === 0 ? (
        <div className="bento-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]" aria-hidden="true">filter_alt</span>
          <h2 className="font-display text-2xl mt-4">No segments yet.</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-2">
            Build a saved filter to target the right people each time.
          </p>
          {!showNew && (
            <button onClick={() => setShowNew(true)} className="btn-pib-accent mt-6">
              <span className="material-symbols-outlined text-base" aria-hidden="true">add</span>
              Create first segment
            </button>
          )}
        </div>
      ) : filteredSegments.length === 0 ? (
        <div className="bento-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">search_off</span>
          <p className="eyebrow !text-[10px] mt-2">Filtered audience view</p>
          <h2 className="font-display text-2xl mt-3">No saved audiences match this view.</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-2">
            Clear the segment search and focus filters to return to every saved audience.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setFocus('all')
            }}
            className="btn-pib-secondary mt-6"
          >
            Show all segments
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSegments.map((s) => {
            const isEditing = editingId === s.id
            const count = counts[s.id]
            const displayName = segmentDisplayName(s)
            const filterChips: string[] = []
            if (s.filters?.stage) filterChips.push(`stage: ${s.filters.stage}`)
            if (s.filters?.type) filterChips.push(`type: ${s.filters.type}`)
            if (s.filters?.source) filterChips.push(`source: ${s.filters.source}`)
            if (s.filters?.tags?.length) filterChips.push(`tags: ${s.filters.tags.join(', ')}`)
            if (s.filters?.behavioral?.length) {
              filterChips.push(
                `${s.filters.behavioral.length} behavioral rule${s.filters.behavioral.length === 1 ? '' : 's'}`,
              )
            }
            if (s.filters?.engagement) filterChips.push('engagement score')

            return (
              <div key={s.id} className="bento-card !p-5">
                {isEditing ? (
                  <div className="space-y-4">
                    <p className="eyebrow !text-[10px]">Edit segment</p>
                    {renderForm(
                      editForm,
                      setEditForm,
                      saveEdit,
                      () => setEditingId(null),
                      savingEdit,
                      editError,
                      'Save changes',
                      'edit',
                    )}
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-display text-xl">{displayName}</h3>
                        <span className="pill">
                          {count === undefined || count === null ? '…' : `${count} contact${count === 1 ? '' : 's'}`}
                        </span>
                      </div>
                      {s.description && (
                        <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">{s.description}</p>
                      )}
                      {filterChips.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {filterChips.map((c) => (
                            <span
                              key={c}
                              className="text-[11px] font-mono text-[var(--color-pib-text-muted)] border border-[var(--color-pib-line)] rounded-full px-2 py-0.5"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => startEdit(s)} className="btn-pib-secondary !py-2 !px-3 !text-sm">
                        <span className="material-symbols-outlined text-base">edit</span>
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          setPendingDeleteSegment(s)
                          setDeleteError('')
                        }}
                        className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-danger,#FCA5A5)] transition-colors p-2"
                        aria-label={`Delete segment ${displayName}`}
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface BehavioralBlockProps {
  rules: BehavioralRule[]
  engagement: EngagementScoreRule | null
  filters: SegmentFilters
  segmentEndpoint: (path: string) => string
  onRulesChange: (rules: BehavioralRule[]) => void
  onEngagementChange: (rule: EngagementScoreRule | null) => void
}

/**
 * Wraps the two behavioral editors and runs a debounced live preview hitting
 * /api/v1/crm/segments/preview every time the filter shape changes.
 */
function BehavioralBlock({
  rules,
  engagement,
  filters,
  segmentEndpoint,
  onRulesChange,
  onEngagementChange,
}: BehavioralBlockProps) {
  const [liveCount, setLiveCount] = useState<number | null>(null)
  const [liveLoading, setLiveLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reqIdRef = useRef(0)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const myId = ++reqIdRef.current
      setLiveLoading(true)
      try {
        const res = await fetch(segmentEndpoint('/api/v1/crm/segments/preview'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filters }),
        })
        if (!res.ok) {
          if (reqIdRef.current === myId) setLiveCount(null)
          return
        }
        const body = await res.json()
        const count = body?.data?.count ?? body?.count
        if (reqIdRef.current === myId && typeof count === 'number') {
          setLiveCount(count)
        }
      } catch {
        if (reqIdRef.current === myId) setLiveCount(null)
      } finally {
        if (reqIdRef.current === myId) setLiveLoading(false)
      }
    }, 500)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // Re-run whenever the JSON-shape of filters changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters), segmentEndpoint])

  return (
    <div className="space-y-5 pt-2 border-t border-[var(--color-pib-line)]">
      <BehavioralRuleEditor
        rules={rules}
        onChange={onRulesChange}
        liveCount={liveCount}
        liveCountLoading={liveLoading}
      />
      <EngagementRuleEditor rule={engagement} onChange={onEngagementChange} />
    </div>
  )
}
