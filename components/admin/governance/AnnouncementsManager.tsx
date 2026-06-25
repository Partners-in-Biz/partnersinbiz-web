// components/admin/governance/AnnouncementsManager.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'

type Status = 'draft' | 'scheduled' | 'published' | 'archived'

interface Announcement {
  id: string
  title: string
  body: string
  notes: string[]
  category: string
  version: string
  targetPlans: string[]
  status: Status
  publishAt: string | null
  publishedAt: string | null
  changelogEntryId: string | null
  views: number
  createdAt: string | null
  updatedAt: string | null
}

interface PlanOption {
  key: string
  name: string
}

interface Counts {
  total: number
  draft: number
  scheduled: number
  published: number
  archived: number
  totalViews: number
}

const inputClass =
  'mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface'

const EMPTY_COUNTS: Counts = { total: 0, draft: 0, scheduled: 0, published: 0, archived: 0, totalViews: 0 }
const EMPTY_FORM = {
  title: '',
  body: '',
  notesText: '',
  category: 'feature',
  version: '',
  publishAt: '',
}

function fmt(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toISOString().replace('T', ' ').slice(0, 16)
}

function statusBadge(status: Status): string {
  if (status === 'published') return 'bg-green-500/15 text-green-300'
  if (status === 'scheduled') return 'bg-blue-500/15 text-blue-300'
  if (status === 'archived') return 'bg-[var(--color-surface-container)] text-on-surface-variant'
  return 'bg-amber-500/15 text-amber-300'
}

export function AnnouncementsManager() {
  const [items, setItems] = useState<Announcement[]>([])
  const [plans, setPlans] = useState<PlanOption[]>([])
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [targetPlans, setTargetPlans] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/announcements', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to load announcements')
      const data = body.data ?? body
      setItems(data.announcements ?? [])
      setCounts({ ...EMPTY_COUNTS, ...(data.counts ?? {}) })
      setPlans(data.plans ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load announcements.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function resetForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setTargetPlans([])
  }

  function startEdit(a: Announcement) {
    setEditingId(a.id)
    setForm({
      title: a.title,
      body: a.body,
      notesText: a.notes.join('\n'),
      category: a.category,
      version: a.version,
      publishAt: a.publishAt ? a.publishAt.slice(0, 16) : '',
    })
    setTargetPlans(a.targetPlans)
    setNotice(null)
  }

  function togglePlan(key: string) {
    setTargetPlans((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]))
  }

  const save = useCallback(
    async (status: Status) => {
      if (!form.title.trim()) {
        setNotice({ tone: 'err', text: 'Title is required.' })
        return
      }
      if (status === 'scheduled' && !form.publishAt) {
        setNotice({ tone: 'err', text: 'Pick a publish date/time for a scheduled announcement.' })
        return
      }
      setBusy(true)
      setNotice(null)
      const payload = {
        ...(editingId ? { id: editingId } : {}),
        title: form.title,
        body: form.body,
        notes: form.notesText.split('\n').map((n) => n.trim()).filter(Boolean),
        category: form.category,
        version: form.version,
        targetPlans,
        status,
        publishAt: form.publishAt ? new Date(form.publishAt).toISOString() : null,
      }
      try {
        const res = await fetch('/api/v1/admin/announcements', {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error || 'Save failed')
        setNotice({
          tone: 'ok',
          text:
            status === 'published'
              ? 'Announcement published — it now appears in the portal changelog.'
              : `Announcement saved as ${status}.`,
        })
        resetForm()
        await load()
      } catch (e) {
        setNotice({ tone: 'err', text: e instanceof Error ? e.message : 'Save failed.' })
      } finally {
        setBusy(false)
      }
    },
    [form, targetPlans, editingId, load],
  )

  const transition = useCallback(
    async (a: Announcement, status: Status) => {
      setBusy(true)
      setNotice(null)
      try {
        const res = await fetch('/api/v1/admin/announcements', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: a.id, status }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error || 'Update failed')
        setNotice({ tone: 'ok', text: `"${a.title}" → ${status}.` })
        await load()
      } catch (e) {
        setNotice({ tone: 'err', text: e instanceof Error ? e.message : 'Update failed.' })
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  const remove = useCallback(
    async (a: Announcement) => {
      if (!window.confirm(`Delete announcement "${a.title}"?`)) return
      setBusy(true)
      setNotice(null)
      try {
        const res = await fetch(`/api/v1/admin/announcements?id=${encodeURIComponent(a.id)}`, { method: 'DELETE' })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error || 'Delete failed')
        setNotice({ tone: 'ok', text: 'Announcement deleted.' })
        if (editingId === a.id) resetForm()
        await load()
      } catch (e) {
        setNotice({ tone: 'err', text: e instanceof Error ? e.message : 'Delete failed.' })
      } finally {
        setBusy(false)
      }
    },
    [editingId, load],
  )

  function planName(key: string): string {
    return plans.find((p) => p.key === key)?.name ?? key
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Governance</p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">Announcements</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Author feature announcements, schedule them, target by plan, and publish to the portal changelog with view
          tracking.
        </p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: counts.total },
          { label: 'Draft', value: counts.draft },
          { label: 'Scheduled', value: counts.scheduled },
          { label: 'Published', value: counts.published },
          { label: 'Views', value: counts.totalViews },
        ].map((m) => (
          <div key={m.label} className="pib-card">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{m.label}</p>
            <p className="text-2xl font-headline font-bold text-on-surface mt-1">{m.value}</p>
          </div>
        ))}
      </div>

      {notice && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            notice.tone === 'ok'
              ? 'border-green-500/20 bg-green-500/10 text-green-300'
              : 'border-red-500/20 bg-red-500/10 text-red-300'
          }`}
        >
          {notice.text}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {/* Editor */}
      <div className="pib-card space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            {editingId ? 'Edit announcement' : 'New announcement'}
          </p>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-xs text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="text-xs text-on-surface-variant">Title</label>
            <input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-on-surface-variant">Category</label>
            <input className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-on-surface-variant">Version (optional)</label>
            <input className={inputClass} value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-on-surface-variant">Summary / body</label>
            <textarea
              rows={2}
              className={inputClass}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-on-surface-variant">Bullet notes (one per line)</label>
            <textarea
              rows={3}
              className={inputClass}
              value={form.notesText}
              onChange={(e) => setForm({ ...form, notesText: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-on-surface-variant">Schedule publish at (optional)</label>
            <input
              type="datetime-local"
              className={inputClass}
              value={form.publishAt}
              onChange={(e) => setForm({ ...form, publishAt: e.target.value })}
            />
          </div>
        </div>

        <div>
          <p className="text-xs text-on-surface-variant mb-2">Target plans (none selected = all plans)</p>
          <div className="flex flex-wrap gap-2">
            {plans.length === 0 ? (
              <span className="text-xs text-on-surface-variant">No plans configured — announcement targets everyone.</span>
            ) : (
              plans.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => togglePlan(p.key)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    targetPlans.includes(p.key)
                      ? 'border-[var(--color-accent-v2)] bg-[var(--color-accent-v2)]/15 text-on-surface'
                      : 'border-[var(--color-card-border)] text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {p.name}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => save('draft')}
            className="rounded-lg border border-[var(--color-card-border)] px-4 py-2 text-sm text-on-surface hover:bg-[var(--color-row-hover)] disabled:opacity-50 transition-colors"
          >
            Save draft
          </button>
          <button
            type="button"
            disabled={busy || !form.publishAt}
            onClick={() => save('scheduled')}
            className="rounded-lg border border-[var(--color-card-border)] px-4 py-2 text-sm text-on-surface hover:bg-[var(--color-row-hover)] disabled:opacity-50 transition-colors"
          >
            Schedule
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => save('published')}
            className="rounded-lg bg-[var(--color-accent-v2)] px-4 py-2 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {busy ? 'Saving…' : 'Publish now'}
          </button>
        </div>
      </div>

      {/* Listing */}
      <div className="overflow-x-auto rounded-xl border border-[var(--color-card-border)]">
        <table className="w-full text-left text-sm text-on-surface">
          <thead>
            <tr className="border-b border-[var(--color-card-border)] bg-[var(--color-surface-container)]">
              {['Title', 'Status', 'Target plans', 'Publish', 'Views', 'Updated', 'Actions'].map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-on-surface-variant">
                  Loading announcements…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-on-surface-variant">
                  No announcements yet. Author one above.
                </td>
              </tr>
            ) : (
              items.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-[var(--color-card-border)] last:border-b-0 hover:bg-[var(--color-row-hover)] transition-colors align-top"
                >
                  <td className="px-3 py-2">
                    <p className="font-medium text-on-surface">{a.title}</p>
                    <p className="text-[11px] text-on-surface-variant">
                      {a.category}
                      {a.version ? ` · ${a.version}` : ''}
                    </p>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${statusBadge(a.status)}`}>{a.status}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-on-surface-variant max-w-[160px]">
                    {a.targetPlans.length === 0 ? 'All plans' : a.targetPlans.map(planName).join(', ')}
                  </td>
                  <td className="px-3 py-2 text-xs text-on-surface-variant whitespace-nowrap">
                    {a.status === 'scheduled' ? `Scheduled ${fmt(a.publishAt)}` : a.publishedAt ? fmt(a.publishedAt) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-on-surface-variant">{a.views}</td>
                  <td className="px-3 py-2 text-xs text-on-surface-variant whitespace-nowrap">{fmt(a.updatedAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => startEdit(a)}
                        className="rounded-md border border-[var(--color-card-border)] px-2 py-1 text-xs text-on-surface hover:bg-[var(--color-row-hover)] transition-colors"
                      >
                        Edit
                      </button>
                      {a.status !== 'published' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => transition(a, 'published')}
                          className="rounded-md border border-[var(--color-card-border)] px-2 py-1 text-xs text-green-300 hover:bg-green-500/10 disabled:opacity-50 transition-colors"
                        >
                          Publish
                        </button>
                      )}
                      {a.status !== 'archived' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => transition(a, 'archived')}
                          className="rounded-md border border-[var(--color-card-border)] px-2 py-1 text-xs text-on-surface-variant hover:bg-[var(--color-row-hover)] disabled:opacity-50 transition-colors"
                        >
                          Archive
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(a)}
                        className="rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
