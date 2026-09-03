'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import type {
  BehavioralRule,
  EngagementScoreRule,
  RuleGroup,
} from '@/lib/crm/segments'
import { BehavioralRuleEditor } from '@/components/crm/segments/BehavioralRuleEditor'
import { EngagementRuleEditor } from '@/components/crm/segments/EngagementRuleEditor'
import { RuleGroupEditor, emptyRuleGroup } from '@/components/crm/segments/RuleGroupEditor'
import { PREDEFINED_SEGMENTS } from '@/lib/crm/predefined-segments'
import {
  SegmentCommandCenter,
  matchesSegmentCommandFocus,
  matchesSegmentSearch,
  type SegmentCommandFocus,
} from '@/components/crm/SegmentCommandCenter'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import { extractSegmentsList } from '@/lib/segments/extractSegmentsList'
import { Icon } from '@/components/studio'

const STAGES = ['', 'new', 'contacted', 'replied', 'demo', 'proposal', 'won', 'lost']
const TYPES = ['', 'lead', 'prospect', 'client', 'churned']
const SOURCES = ['', 'manual', 'form', 'import', 'outreach']

const FIELD_LABEL_CLS = 'pib-label mb-0'
const INPUT_CLS = 'pib-input h-8 px-2 text-xs'

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
  ruleGroup?: RuleGroup
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
  /** US-055: optional generic rule tree. null = use simple filters above. */
  ruleGroup: RuleGroup | null
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
  ruleGroup: null,
}

function ruleGroupHasRules(g: RuleGroup | null | undefined): boolean {
  return !!g && Array.isArray(g.rules) && g.rules.length > 0
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
    ruleGroup: ruleGroupHasRules(s.ruleGroup) ? (s.ruleGroup as RuleGroup) : null,
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
      const list = extractSegmentsList<Segment>(body)
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
          ruleGroup: ruleGroupHasRules(newForm.ruleGroup) ? newForm.ruleGroup : null,
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
          ruleGroup: ruleGroupHasRules(editForm.ruleGroup) ? editForm.ruleGroup : null,
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
    <form onSubmit={onSubmit} className="space-y-3">
      {/* Template picker */}
      <div className="space-y-1">
        <label className={FIELD_LABEL_CLS}>
          Use template
        </label>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) applyTemplate(e.target.value, target)
            e.target.value = ''
          }}
          aria-label="Use template"
          className={`${INPUT_CLS} md:w-72`}
        >
          <option value="" className="bg-black">
            - Choose a recipe -
          </option>
          {PREDEFINED_SEGMENTS.map((p) => (
            <option key={p.id} value={p.id} className="bg-black">
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL_CLS}>
            Name *
          </label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={INPUT_CLS}
            aria-label="Segment name"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL_CLS}>
            Description
          </label>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className={INPUT_CLS}
            aria-label="Segment description"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className={FIELD_LABEL_CLS}>
          Tags (comma separated)
        </label>
        <input
          value={form.tags}
          onChange={(e) => setForm({ ...form, tags: e.target.value })}
          placeholder="vip, newsletter"
          className={INPUT_CLS}
          aria-label="Tags"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL_CLS}>
            Stage
          </label>
          <select
            value={form.stage}
            onChange={(e) => setForm({ ...form, stage: e.target.value })}
            className={INPUT_CLS}
            aria-label="Stage"
          >
            {STAGES.map((s) => (
              <option key={s || '_'} value={s} className="bg-black">
                {s || 'Any stage'}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL_CLS}>
            Type
          </label>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className={INPUT_CLS}
            aria-label="Type"
          >
            {TYPES.map((t) => (
              <option key={t || '_'} value={t} className="bg-black">
                {t || 'Any type'}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL_CLS}>
            Source
          </label>
          <select
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
            className={INPUT_CLS}
            aria-label="Source"
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

      <AdvancedRuleBlock
        group={form.ruleGroup}
        segmentEndpoint={segmentEndpoint}
        onChange={(g) => setForm({ ...form, ruleGroup: g })}
      />

      {error && (
        <p className="text-[11px] text-[var(--color-error)]">
          {error}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="btn-pib-primary text-xs"
        >
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-pib-secondary text-xs"
        >
          Cancel
        </button>
      </div>
    </form>
  )

  return (
    <div className="flex min-h-0 flex-col space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <Icon name="filter_alt" />
          <div className="min-w-0">
            <p className="eyebrow">CRM</p>
            <h1 className="pib-page-title mt-2">Segments</h1>
            <p className="pib-page-sub max-w-2xl">
              Save reusable filters across your contact base - slice by tag, stage, type, source,
              or email engagement.
            </p>
          </div>
        </div>
        {!showNew && (
          <button
            onClick={() => setShowNew(true)}
            className="btn-pib-primary text-xs shrink-0"
          >
            <Icon name="add" />
            New segment
          </button>
        )}
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
        <div className="rounded-lg border border-[var(--color-error)]/40 bg-[var(--color-error-container)] px-3 py-2 text-xs text-[var(--color-error)]">
          <Icon name="error" className="mr-1.5 align-middle" />
          {deleteError}
        </div>
      )}

      {pendingDeleteSegment && (
        <section
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="segment-delete-confirm-title"
          aria-describedby="segment-delete-confirm-description"
          className="pib-card border-[var(--color-error)]/40 bg-[var(--color-error-container)]"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-2.5">
              <Icon name="warning" className="mt-0.5 text-[var(--color-error)]" />
              <div>
                <p className="eyebrow text-[var(--color-error)]">Saved audience delete</p>
                <h2 id="segment-delete-confirm-title" className="mt-1 text-sm text-[var(--color-pib-text)]">
                  Delete segment &quot;{segmentDisplayName(pendingDeleteSegment)}&quot;?
                </h2>
                <p id="segment-delete-confirm-description" className="mt-1 max-w-2xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
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
                className="btn-pib-danger text-xs"
                disabled={deletingId === pendingDeleteSegment.id}
              >
                <Icon name="delete" />
                {deletingId === pendingDeleteSegment.id ? 'Deleting...' : 'Delete segment'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* New segment inline form */}
      {showNew && (
        <section className="pib-surface">
          <div className="pib-surface-header">
            <p className="pib-label mb-0">New segment</p>
          </div>
          <div className="pib-surface-body">
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
          </div>
        </section>
      )}

      {/* Segments list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="pib-skeleton h-14" />
          ))}
        </div>
      ) : loadError ? (
        <section className="pib-card border-[var(--color-pib-accent)]/40 bg-[var(--color-pib-accent-soft)]">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <Icon name="warning" className="mt-0.5 text-[var(--color-pib-accent-hover)]" />
              <div>
                <p className="eyebrow text-[var(--color-pib-accent-hover)]">Source health</p>
                <h2 className="mt-1 text-sm text-[var(--color-pib-text)]">Segments could not load</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{loadError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={fetchSegments}
              className="btn-pib-secondary text-xs shrink-0"
              aria-label="Retry loading segments"
            >
              <Icon name="refresh" />
              Retry
            </button>
          </div>
        </section>
      ) : segments.length === 0 ? (
        <div className="pib-empty-state">
          <Icon name="filter_alt" />
          <h2 className="pib-empty-state-title">No segments yet.</h2>
          <p className="pib-empty-state-description">
            Build a saved filter to target the right people each time.
          </p>
          {!showNew && (
            <button
              onClick={() => setShowNew(true)}
              className="btn-pib-primary text-xs mt-5"
            >
              <Icon name="add" />
              Create first segment
            </button>
          )}
        </div>
      ) : filteredSegments.length === 0 ? (
        <div className="pib-empty-state">
          <Icon name="search_off" />
          <p className="eyebrow">Filtered audience view</p>
          <h2 className="pib-empty-state-title mt-2">No saved audiences match this view.</h2>
          <p className="pib-empty-state-description">
            Clear the segment search and focus filters to return to every saved audience.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setFocus('all')
            }}
            className="btn-pib-secondary text-xs mt-5"
          >
            Show all segments
          </button>
        </div>
      ) : (
        <div className="pib-surface pib-surface-list">
          {filteredSegments.map((s, index) => {
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
            if (ruleGroupHasRules(s.ruleGroup)) {
              filterChips.push(`advanced rules (${s.ruleGroup!.rules.length})`)
            }

            return (
              <div
                key={s.id}
                className={`p-4 transition hover:bg-[var(--color-row-hover)] ${index > 0 ? 'border-t border-[var(--color-pib-line)]' : ''}`}
              >
                {isEditing ? (
                  <div className="space-y-3">
                    <p className="pib-label mb-0">Edit segment</p>
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
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm text-[var(--color-pib-text)]">{displayName}</h3>
                        <span className="pib-pill pib-pill-accent">
                          {count === undefined || count === null ? '…' : `${count} contact${count === 1 ? '' : 's'}`}
                        </span>
                      </div>
                      {s.description && (
                        <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{s.description}</p>
                      )}
                      {filterChips.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {filterChips.map((c) => (
                            <span
                              key={c}
                              className="pib-pill"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => startEdit(s)}
                        className="btn-pib-ghost text-xs"
                      >
                        <Icon name="edit" />
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          setPendingDeleteSegment(s)
                          setDeleteError('')
                        }}
                        className="grid h-8 w-8 place-items-center rounded text-[var(--color-pib-text-muted)] transition hover:bg-[var(--color-pib-surface-soft)] hover:text-[var(--color-error)]"
                        aria-label={`Delete segment ${displayName}`}
                      >
                        <Icon name="delete" />
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
    <div className="space-y-3 border-t border-[var(--color-pib-line)] pt-3">
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

interface AdvancedRuleBlockProps {
  group: RuleGroup | null
  segmentEndpoint: (path: string) => string
  onChange: (group: RuleGroup | null) => void
}

/**
 * US-055 - the generic field/operator/value + AND/OR group editor, with its own
 * debounced live preview hitting /api/v1/crm/segments/preview with `ruleGroup`.
 * When enabled, the rule group takes precedence over the simple filters above.
 */
function AdvancedRuleBlock({ group, segmentEndpoint, onChange }: AdvancedRuleBlockProps) {
  const [liveCount, setLiveCount] = useState<number | null>(null)
  const [liveLoading, setLiveLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reqIdRef = useRef(0)
  const enabled = !!group

  const serialized = JSON.stringify(group ?? null)

  useEffect(() => {
    if (!group || !Array.isArray(group.rules) || group.rules.length === 0) {
      setLiveCount(null)
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const myId = ++reqIdRef.current
      setLiveLoading(true)
      try {
        const res = await fetch(segmentEndpoint('/api/v1/crm/segments/preview'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ruleGroup: group }),
        })
        if (!res.ok) {
          if (reqIdRef.current === myId) setLiveCount(null)
          return
        }
        const body = await res.json()
        const count = body?.data?.count ?? body?.count
        if (reqIdRef.current === myId && typeof count === 'number') setLiveCount(count)
      } catch {
        if (reqIdRef.current === myId) setLiveCount(null)
      } finally {
        if (reqIdRef.current === myId) setLiveLoading(false)
      }
    }, 500)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, segmentEndpoint])

  return (
    <div className="space-y-2 border-t border-[var(--color-pib-line)] pt-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="pib-label mb-0">
            Advanced rule builder
          </p>
          <p className="mt-0.5 max-w-md text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
            Combine any contact field with AND/OR groups. When enabled this takes
            precedence over the simple tag/stage/type filters above.
          </p>
        </div>
        {!enabled ? (
          <button
            type="button"
            onClick={() => onChange(emptyRuleGroup())}
            className="btn-pib-secondary text-xs"
          >
            <Icon name="tune" />
            Build advanced rules
          </button>
        ) : (
          <div className="flex items-center gap-2">
            {(liveLoading || liveCount !== null) && (
              <span className="pib-pill pib-pill-accent">
                {liveLoading ? '…' : `${liveCount} match${liveCount === 1 ? '' : 'es'}`}
              </span>
            )}
            <button
              type="button"
              onClick={() => onChange(null)}
              className="btn-pib-ghost text-xs"
            >
              Clear
            </button>
          </div>
        )}
      </div>
      {enabled && group && <RuleGroupEditor group={group} onChange={onChange} />}
    </div>
  )
}
