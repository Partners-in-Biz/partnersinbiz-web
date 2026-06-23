// components/email/TriggerConfigPanel.tsx
//
// Trigger configuration UI for the visual sequence builder (US-107).
//
// Supports four trigger types — segment / tag / form / date — by fetching the
// real CRM resources (segments, tags, forms) from the existing list endpoints.
//
// NOTE: lib/sequences/types.ts has NO trigger schema (the runtime is
// enrollment-driven, and CRM automation rules use an `enroll_in_sequence`
// action to enroll contacts). This panel persists its config in an ADDITIVE
// `trigger` field on the sequence doc, which the sequences API PUT/POST spreads
// through verbatim. The cron ignores it. See the SequenceTrigger type below —
// it should eventually be promoted into lib/sequences/types.ts (reported as a
// needed shared-type change).
'use client'

import { useEffect, useState } from 'react'

export type SequenceTrigger =
  | { type: 'segment'; segmentId: string; segmentName?: string }
  | { type: 'tag'; tag: string }
  | { type: 'form'; formId: string; formName?: string }
  | { type: 'date'; field: string; offsetDays: number }
  | { type: 'manual' }

interface SegmentLite {
  id: string
  name: string
}
interface TagLite {
  tag: string
  count: number
}
interface FormLite {
  id: string
  name: string
}

interface Props {
  value: SequenceTrigger
  onChange: (t: SequenceTrigger) => void
  /** Scoped fetch helper — wraps endpoints with the right orgId. */
  endpoint: (path: string) => string
}

const TRIGGER_TYPES: Array<{ id: SequenceTrigger['type']; label: string; icon: string; sub: string }> = [
  { id: 'segment', label: 'Segment', icon: 'group_work', sub: 'Enroll contacts matching a dynamic segment.' },
  { id: 'tag', label: 'Tag', icon: 'sell', sub: 'Enroll when a contact gains a tag.' },
  { id: 'form', label: 'Form', icon: 'description', sub: 'Enroll on a lead-capture form submission.' },
  { id: 'date', label: 'Date', icon: 'event', sub: 'Enroll relative to a date field on the contact.' },
  { id: 'manual', label: 'Manual', icon: 'touch_app', sub: 'Enroll contacts manually or via the API.' },
]

const DATE_FIELDS = [
  { id: 'createdAt', label: 'Contact created date' },
  { id: 'subscribedAt', label: 'Subscribed date' },
  { id: 'birthday', label: 'Birthday' },
  { id: 'renewalDate', label: 'Renewal date' },
]

function unwrap<T>(body: unknown): T {
  const b = body as { data?: unknown }
  return (b?.data ?? body) as T
}

export default function TriggerConfigPanel({ value, onChange, endpoint }: Props) {
  const [segments, setSegments] = useState<SegmentLite[]>([])
  const [tags, setTags] = useState<TagLite[]>([])
  const [forms, setForms] = useState<FormLite[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    Promise.all([
      fetch(endpoint('/api/v1/crm/segments')).then((r) => r.json().catch(() => ({}))),
      fetch(endpoint('/api/v1/crm/tags')).then((r) => r.json().catch(() => ({}))),
      fetch(endpoint('/api/v1/forms')).then((r) => r.json().catch(() => ({}))),
    ])
      .then(([segBody, tagBody, formBody]) => {
        if (cancelled) return
        const segData = unwrap<{ segments?: SegmentLite[] } | SegmentLite[]>(segBody)
        setSegments(Array.isArray(segData) ? segData : segData?.segments ?? [])
        const tagData = unwrap<{ tags?: TagLite[] } | TagLite[]>(tagBody)
        setTags(Array.isArray(tagData) ? tagData : tagData?.tags ?? [])
        const formData = unwrap<{ forms?: FormLite[] } | FormLite[]>(formBody)
        setForms(Array.isArray(formData) ? formData : formData?.forms ?? [])
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load trigger sources.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint])

  function selectType(type: SequenceTrigger['type']) {
    switch (type) {
      case 'segment':
        onChange({ type: 'segment', segmentId: segments[0]?.id ?? '', segmentName: segments[0]?.name })
        break
      case 'tag':
        onChange({ type: 'tag', tag: tags[0]?.tag ?? '' })
        break
      case 'form':
        onChange({ type: 'form', formId: forms[0]?.id ?? '', formName: forms[0]?.name })
        break
      case 'date':
        onChange({ type: 'date', field: 'createdAt', offsetDays: 0 })
        break
      default:
        onChange({ type: 'manual' })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Enrollment trigger</h3>
        <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
          Choose what enrolls contacts into this sequence. Segment, tag, and form sources are pulled
          live from your CRM.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {TRIGGER_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => selectType(t.id)}
            className={[
              'cursor-pointer rounded-lg border px-3 py-2.5 text-left transition-colors',
              value.type === t.id
                ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)]'
                : 'border-[var(--color-pib-line)] hover:bg-white/[0.03]',
            ].join(' ')}
          >
            <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-accent)]">{t.icon}</span>
            <p className="mt-1 text-xs font-medium">{t.label}</p>
            <p className="text-[10px] text-[var(--color-pib-text-muted)] leading-tight">{t.sub}</p>
          </button>
        ))}
      </div>

      {loadError && (
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
          {loadError}
        </p>
      )}

      <div className="bento-card !p-4">
        {loading ? (
          <p className="text-xs text-[var(--color-pib-text-muted)]">Loading trigger sources…</p>
        ) : value.type === 'segment' ? (
          <label className="block">
            <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Segment</span>
            <select
              value={value.segmentId}
              onChange={(e) => {
                const seg = segments.find((s) => s.id === e.target.value)
                onChange({ type: 'segment', segmentId: e.target.value, segmentName: seg?.name })
              }}
              className="w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
            >
              <option value="">Select a segment…</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {segments.length === 0 && <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">No segments yet.</p>}
          </label>
        ) : value.type === 'tag' ? (
          <label className="block">
            <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Tag</span>
            <select
              value={value.tag}
              onChange={(e) => onChange({ type: 'tag', tag: e.target.value })}
              className="w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
            >
              <option value="">Select a tag…</option>
              {tags.map((t) => (
                <option key={t.tag} value={t.tag}>
                  {t.tag} ({t.count})
                </option>
              ))}
            </select>
            {tags.length === 0 && <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">No tags yet.</p>}
          </label>
        ) : value.type === 'form' ? (
          <label className="block">
            <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Form</span>
            <select
              value={value.formId}
              onChange={(e) => {
                const form = forms.find((f) => f.id === e.target.value)
                onChange({ type: 'form', formId: e.target.value, formName: form?.name })
              }}
              className="w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
            >
              <option value="">Select a form…</option>
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {forms.length === 0 && <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">No forms yet.</p>}
          </label>
        ) : value.type === 'date' ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Date field</span>
              <select
                value={value.field}
                onChange={(e) => onChange({ type: 'date', field: e.target.value, offsetDays: value.offsetDays })}
                className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
              >
                {DATE_FIELDS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Offset (days)</span>
              <input
                type="number"
                value={value.offsetDays}
                onChange={(e) => onChange({ type: 'date', field: value.field, offsetDays: parseInt(e.target.value || '0', 10) })}
                className="w-24 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
              />
            </label>
            <p className="text-[11px] text-[var(--color-pib-text-muted)] pb-2">
              Negative = before the date (e.g. -3 = 3 days before renewal).
            </p>
          </div>
        ) : (
          <p className="text-xs text-[var(--color-pib-text-muted)]">
            Contacts are enrolled manually from the CRM, by an automation rule, or via the API.
          </p>
        )}
      </div>
    </div>
  )
}
