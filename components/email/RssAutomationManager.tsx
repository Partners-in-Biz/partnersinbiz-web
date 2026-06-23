// components/email/RssAutomationManager.tsx
//
// Manages RSS digest automations (US-145): list existing, create/edit, delete.
// Talks to /api/v1/email/rss-automations. Recipients are resolved from the
// live CRM segments + tags.
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { scopedApiPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

interface RssRecipient {
  kind: 'segment' | 'tag' | 'contacts'
  segmentId?: string
  tag?: string
  contactIds?: string[]
}
interface RssSchedule {
  cadence: 'daily' | 'weekly'
  hourLocal: number
  dayOfWeek?: number
  timezone?: string
}
interface RssAutomation {
  id: string
  name: string
  feedUrl: string
  enabled: boolean
  schedule: RssSchedule
  subject: string
  bodyHtml: string
  recipient: RssRecipient
  maxItems: number
  lastSentCount?: number
}

interface SegmentLite {
  id: string
  name: string
}
interface TagLite {
  tag: string
  count: number
}

interface Props {
  orgScope: PortalOrgRouteScope
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function unwrap<T>(body: unknown): T {
  const b = body as { data?: unknown }
  return (b?.data ?? body) as T
}

function emptyDraft(): RssAutomation {
  return {
    id: '',
    name: '',
    feedUrl: '',
    enabled: true,
    schedule: { cadence: 'daily', hourLocal: 9, timezone: 'UTC' },
    subject: 'New from {{feed_title}}: {{latest_post_title}}',
    bodyHtml:
      '<p>Here are the latest posts:</p>{{posts_html}}<p style="margin-top:20px;font-size:12px;color:#888;">You subscribed to updates.</p>',
    recipient: { kind: 'segment', segmentId: '' },
    maxItems: 5,
  }
}

export default function RssAutomationManager({ orgScope }: Props) {
  const endpoint = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])

  const [list, setList] = useState<RssAutomation[]>([])
  const [segments, setSegments] = useState<SegmentLite[]>([])
  const [tags, setTags] = useState<TagLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<RssAutomation | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(endpoint('/api/v1/email/rss-automations')).then((r) => r.json().catch(() => ({}))),
      fetch(endpoint('/api/v1/crm/segments')).then((r) => r.json().catch(() => ({}))),
      fetch(endpoint('/api/v1/crm/tags')).then((r) => r.json().catch(() => ({}))),
    ])
      .then(([rssBody, segBody, tagBody]) => {
        const rss = unwrap<RssAutomation[]>(rssBody)
        setList(Array.isArray(rss) ? rss : [])
        const segData = unwrap<{ segments?: SegmentLite[] } | SegmentLite[]>(segBody)
        setSegments(Array.isArray(segData) ? segData : segData?.segments ?? [])
        const tagData = unwrap<{ tags?: TagLite[] } | TagLite[]>(tagBody)
        setTags(Array.isArray(tagData) ? tagData : tagData?.tags ?? [])
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false))
  }, [endpoint])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    try {
      const isNew = !draft.id
      const url = isNew
        ? endpoint('/api/v1/email/rss-automations')
        : endpoint(`/api/v1/email/rss-automations/${draft.id}`)
      const { id: _id, ...payload } = draft
      void _id
      const res = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orgScope.orgId ? { ...payload, orgId: orgScope.orgId } : payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`)
      setDraft(null)
      load()
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    await fetch(endpoint(`/api/v1/email/rss-automations/${id}`), { method: 'DELETE' })
    setList((prev) => prev.filter((a) => a.id !== id))
  }

  async function toggle(item: RssAutomation) {
    setList((prev) => prev.map((a) => (a.id === item.id ? { ...a, enabled: !a.enabled } : a)))
    await fetch(endpoint(`/api/v1/email/rss-automations/${item.id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !item.enabled }),
    })
  }

  const recipientLabel = useMemo(
    () => (r: RssRecipient) => {
      if (r.kind === 'segment') return `Segment: ${segments.find((s) => s.id === r.segmentId)?.name ?? r.segmentId}`
      if (r.kind === 'tag') return `Tag: ${r.tag}`
      return `${r.contactIds?.length ?? 0} contacts`
    },
    [segments],
  )

  if (loading) {
    return (
      <div className="bento-card !p-6">
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading RSS automations…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          {error}
          <button type="button" onClick={load} className="ml-3 underline">
            Retry
          </button>
        </div>
      )}

      {!draft && (
        <button type="button" onClick={() => setDraft(emptyDraft())} className="btn-pib-accent flex w-fit items-center gap-1.5 text-sm">
          <span className="material-symbols-outlined text-[16px]">add</span>
          New RSS digest
        </button>
      )}

      {/* Editor */}
      {draft && (
        <div className="bento-card !p-5 space-y-4">
          <h3 className="text-sm font-semibold">{draft.id ? 'Edit RSS digest' : 'New RSS digest'}</h3>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">RSS / Atom feed URL</span>
              <input
                value={draft.feedUrl}
                onChange={(e) => setDraft({ ...draft, feedUrl: e.target.value })}
                placeholder="https://blog.example.com/feed.xml"
                className="w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
              />
            </label>
          </div>

          {/* Schedule */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Cadence</span>
              <select
                value={draft.schedule.cadence}
                onChange={(e) =>
                  setDraft({ ...draft, schedule: { ...draft.schedule, cadence: e.target.value as 'daily' | 'weekly' } })
                }
                className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            {draft.schedule.cadence === 'weekly' && (
              <label className="block">
                <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Day</span>
                <select
                  value={draft.schedule.dayOfWeek ?? 1}
                  onChange={(e) => setDraft({ ...draft, schedule: { ...draft.schedule, dayOfWeek: parseInt(e.target.value, 10) } })}
                  className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
                >
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Hour (0-23)</span>
              <input
                type="number"
                min={0}
                max={23}
                value={draft.schedule.hourLocal}
                onChange={(e) => setDraft({ ...draft, schedule: { ...draft.schedule, hourLocal: parseInt(e.target.value || '0', 10) } })}
                className="w-20 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Timezone</span>
              <input
                value={draft.schedule.timezone ?? 'UTC'}
                onChange={(e) => setDraft({ ...draft, schedule: { ...draft.schedule, timezone: e.target.value } })}
                placeholder="UTC"
                className="w-40 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Posts per digest</span>
              <input
                type="number"
                min={1}
                max={20}
                value={draft.maxItems}
                onChange={(e) => setDraft({ ...draft, maxItems: parseInt(e.target.value || '5', 10) })}
                className="w-20 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
              />
            </label>
          </div>

          {/* Recipient */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Send to</span>
              <select
                value={draft.recipient.kind}
                onChange={(e) => {
                  const kind = e.target.value as RssRecipient['kind']
                  setDraft({
                    ...draft,
                    recipient:
                      kind === 'segment'
                        ? { kind, segmentId: segments[0]?.id ?? '' }
                        : kind === 'tag'
                          ? { kind, tag: tags[0]?.tag ?? '' }
                          : { kind, contactIds: [] },
                  })
                }}
                className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
              >
                <option value="segment">Segment</option>
                <option value="tag">Tag</option>
              </select>
            </label>
            {draft.recipient.kind === 'segment' && (
              <label className="block">
                <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Segment</span>
                <select
                  value={draft.recipient.segmentId ?? ''}
                  onChange={(e) => setDraft({ ...draft, recipient: { kind: 'segment', segmentId: e.target.value } })}
                  className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
                >
                  <option value="">Select…</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {draft.recipient.kind === 'tag' && (
              <label className="block">
                <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Tag</span>
                <select
                  value={draft.recipient.tag ?? ''}
                  onChange={(e) => setDraft({ ...draft, recipient: { kind: 'tag', tag: e.target.value } })}
                  className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
                >
                  <option value="">Select…</option>
                  {tags.map((t) => (
                    <option key={t.tag} value={t.tag}>
                      {t.tag} ({t.count})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* Templates */}
          <label className="block">
            <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Subject</span>
            <input
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              className="w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Body (HTML)</span>
            <textarea
              value={draft.bodyHtml}
              onChange={(e) => setDraft({ ...draft, bodyHtml: e.target.value })}
              rows={4}
              className="w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-xs font-mono"
            />
            <span className="mt-1 block text-[10px] text-[var(--color-pib-text-muted)]">
              Merge tags: {'{{latest_post_title}}'}, {'{{latest_post_link}}'}, {'{{posts_html}}'}, {'{{post_count}}'}, {'{{feed_title}}'}
            </span>
          </label>

          {saveError && <p className="text-xs text-red-300">{saveError}</p>}
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={saving} className="btn-pib-accent text-sm disabled:opacity-50">
              {saving ? 'Saving…' : 'Save digest'}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="btn-pib-secondary text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {list.length === 0 && !draft ? (
        <div className="bento-card !p-6 text-center">
          <span className="material-symbols-outlined mb-2 block text-3xl text-[var(--color-pib-text-muted)]">rss_feed</span>
          <p className="text-sm text-[var(--color-pib-text-muted)]">No RSS digests yet. Create one to auto-email new posts.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((item) => (
            <article key={item.id} className="bento-card !p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={[
                        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]',
                        item.enabled
                          ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                          : 'border-amber-400/20 bg-amber-400/10 text-amber-300',
                      ].join(' ')}
                    >
                      {item.enabled ? 'Active' : 'Paused'}
                    </span>
                    <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-0.5 text-[10px] text-[var(--color-pib-text-muted)]">
                      {item.schedule.cadence === 'weekly'
                        ? `Weekly ${DAYS[item.schedule.dayOfWeek ?? 1]} ${item.schedule.hourLocal}:00`
                        : `Daily ${item.schedule.hourLocal}:00`}{' '}
                      {item.schedule.timezone ?? 'UTC'}
                    </span>
                  </div>
                  <h3 className="truncate text-sm font-semibold">{item.name}</h3>
                  <p className="truncate text-xs text-[var(--color-pib-text-muted)]">{item.feedUrl}</p>
                  <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">{recipientLabel(item.recipient)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggle(item)}
                    title={item.enabled ? 'Pause' : 'Activate'}
                    className="cursor-pointer flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:bg-white/[0.06]"
                  >
                    <span className="material-symbols-outlined text-[17px]">{item.enabled ? 'pause' : 'play_arrow'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft(item)}
                    title="Edit"
                    className="cursor-pointer flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:bg-white/[0.06]"
                  >
                    <span className="material-symbols-outlined text-[17px]">edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    title="Delete"
                    className="cursor-pointer flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:bg-red-400/[0.08] hover:text-red-400"
                  >
                    <span className="material-symbols-outlined text-[17px]">delete</span>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
