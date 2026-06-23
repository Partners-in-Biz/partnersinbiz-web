'use client'

import { useCallback, useState } from 'react'
import {
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABELS,
  type CustomReportSpec,
  type ReportCategory,
  type ReportKpis,
  type ReportMetricKey,
  type ReportSection,
  type ReportSectionType,
} from '@/lib/reports/types'

const METRIC_KEYS: ReportMetricKey[] = [
  'total_revenue', 'invoiced_revenue', 'invoiced_revenue_paid', 'outstanding',
  'mrr', 'arr', 'active_subs', 'new_subs', 'churn', 'subscription_revenue',
  'ad_revenue', 'ad_spend', 'impressions', 'clicks',
  'installs', 'uninstalls', 'iap_revenue',
  'sessions', 'pageviews', 'users', 'conversions',
]

const SECTION_LABELS: Record<ReportSectionType, string> = {
  text: 'Text',
  metric: 'Metric',
  chart: 'Chart',
  table: 'Table',
  page_break: 'Page break',
}

const fmtNum = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 })

function uid() {
  return `sec_${Math.random().toString(36).slice(2, 10)}`
}

function defaultPeriod(): { start: string; end: string } {
  const now = new Date()
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)) // last day of prev month
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

interface PreviewData {
  kpis: ReportKpis | null
  series: Array<{ metric: string; series: Array<{ date: string; value: number }> }>
}

interface Props {
  orgId: string | null
  onSaved: (report: { id: string; publicToken: string | null }) => void
}

export function CustomReportBuilder({ orgId, onSaved }: Props) {
  const dp = defaultPeriod()
  const [title, setTitle] = useState('Custom report')
  const [category, setCategory] = useState<ReportCategory>('custom')
  const [start, setStart] = useState(dp.start)
  const [end, setEnd] = useState(dp.end)
  const [sections, setSections] = useState<ReportSection[]>([
    { id: uid(), type: 'text', title: 'Overview', body: 'Write your summary here.' },
    { id: uid(), type: 'metric', title: 'Total revenue', dataSource: { kind: 'snapshot', metric: 'total_revenue' } },
  ])
  const [preview, setPreview] = useState<PreviewData>({ kpis: null, series: [] })
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function api(path: string) {
    return orgId ? `${path}${path.includes('?') ? '&' : '?'}orgId=${encodeURIComponent(orgId)}` : path
  }

  const buildSpec = useCallback(
    (): CustomReportSpec => ({
      title,
      category,
      period: { start, end, tz: 'UTC' },
      sections,
    }),
    [title, category, start, end, sections],
  )

  function addSection(type: ReportSectionType) {
    const base: ReportSection = { id: uid(), type }
    if (type === 'metric' || type === 'chart') base.dataSource = { kind: 'snapshot', metric: 'total_revenue' }
    if (type === 'table') base.dataSource = { kind: 'snapshot', metrics: ['total_revenue', 'mrr', 'active_subs'] }
    if (type === 'text') base.body = ''
    setSections((s) => [...s, base])
  }

  function updateSection(id: string, patch: Partial<ReportSection>) {
    setSections((s) => s.map((sec) => (sec.id === id ? { ...sec, ...patch } : sec)))
  }

  function updateDataSource(id: string, patch: Partial<NonNullable<ReportSection['dataSource']>>) {
    setSections((s) =>
      s.map((sec) =>
        sec.id === id ? { ...sec, dataSource: { ...(sec.dataSource ?? { kind: 'snapshot' }), ...patch } } : sec,
      ),
    )
  }

  function moveSection(id: string, dir: -1 | 1) {
    setSections((s) => {
      const i = s.findIndex((x) => x.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= s.length) return s
      const next = [...s]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function removeSection(id: string) {
    setSections((s) => s.filter((sec) => sec.id !== id))
  }

  const runPreview = useCallback(async () => {
    setPreviewing(true)
    setError(null)
    try {
      const res = await fetch(api('/api/v1/reports/preview'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, spec: buildSpec() }),
      })
      const b = await res.json()
      if (!res.ok) { setError(b.error ?? 'Preview failed'); return }
      setPreview({ kpis: b.kpis ?? null, series: b.series ?? [] })
    } catch {
      setError('Preview failed')
    } finally {
      setPreviewing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, buildSpec])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(api('/api/v1/reports/custom'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, spec: buildSpec() }),
      })
      const b = await res.json()
      if (!res.ok) { setError(b.error ?? 'Save failed'); return }
      onSaved(b.report)
    } catch {
      setError('Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function generatePdf() {
    // Save first, then download the PDF of the saved report.
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(api('/api/v1/reports/custom'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, spec: buildSpec() }),
      })
      const b = await res.json()
      if (!res.ok) { setError(b.error ?? 'Save failed'); return }
      const pdfRes = await fetch(api(`/api/v1/reports/${b.report.id}/pdf`))
      if (pdfRes.ok) {
        const blob = await pdfRes.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${title.replace(/[^a-z0-9]+/gi, '_')}.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      }
      onSaved(b.report)
    } catch {
      setError('Generate PDF failed')
    } finally {
      setSaving(false)
    }
  }

  const k = preview.kpis
  function metricVal(key?: ReportMetricKey) {
    if (!k || !key) return 0
    const v = (k as unknown as Record<string, unknown>)[key]
    return typeof v === 'number' ? v : 0
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Editor */}
      <div className="space-y-5">
        <div className="bento-card !p-5 space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-[var(--color-pib-text-muted)] mb-1">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="pib-input !text-sm w-full" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-[var(--color-pib-text-muted)] mb-1">Type</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as ReportCategory)} className="pib-input !text-sm w-full">
                {REPORT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{REPORT_CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[var(--color-pib-text-muted)] mb-1">Start</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="pib-input !text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[var(--color-pib-text-muted)] mb-1">End</label>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="pib-input !text-sm w-full" />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {sections.map((sec, i) => (
            <div key={sec.id} className="bento-card !p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="pib-pill !text-[10px] uppercase">{SECTION_LABELS[sec.type]}</span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => moveSection(sec.id, -1)} disabled={i === 0} aria-label="Move up" className="btn-pib-secondary !py-1 !px-2 !text-xs disabled:opacity-40">
                    <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                  </button>
                  <button type="button" onClick={() => moveSection(sec.id, 1)} disabled={i === sections.length - 1} aria-label="Move down" className="btn-pib-secondary !py-1 !px-2 !text-xs disabled:opacity-40">
                    <span className="material-symbols-outlined text-[14px]">arrow_downward</span>
                  </button>
                  <button type="button" onClick={() => removeSection(sec.id)} aria-label="Remove section" className="btn-pib-secondary !py-1 !px-2 !text-xs !text-rose-300 !border-rose-400/40">
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                  </button>
                </div>
              </div>

              {sec.type !== 'page_break' && (
                <input
                  value={sec.title ?? ''}
                  onChange={(e) => updateSection(sec.id, { title: e.target.value })}
                  placeholder="Section title"
                  className="pib-input !text-sm w-full"
                />
              )}

              {sec.type === 'text' && (
                <textarea
                  value={sec.body ?? ''}
                  onChange={(e) => updateSection(sec.id, { body: e.target.value })}
                  placeholder="Body text. Blank lines separate paragraphs."
                  rows={4}
                  className="pib-input !text-sm w-full"
                />
              )}

              {(sec.type === 'metric' || sec.type === 'chart') && (
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={sec.dataSource?.kind ?? 'snapshot'}
                    onChange={(e) => updateDataSource(sec.id, { kind: e.target.value as 'snapshot' | 'manual' })}
                    className="pib-input !text-sm"
                  >
                    <option value="snapshot">Live snapshot</option>
                    <option value="manual">Manual value</option>
                  </select>
                  {sec.dataSource?.kind === 'manual' ? (
                    <input
                      type="number"
                      value={sec.dataSource?.value ?? 0}
                      onChange={(e) => updateDataSource(sec.id, { value: Number(e.target.value) })}
                      className="pib-input !text-sm"
                    />
                  ) : (
                    <select
                      value={sec.dataSource?.metric ?? 'total_revenue'}
                      onChange={(e) => updateDataSource(sec.id, { metric: e.target.value as ReportMetricKey })}
                      className="pib-input !text-sm"
                    >
                      {METRIC_KEYS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {sec.type === 'table' && (
                <div className="space-y-2">
                  <select
                    value={sec.dataSource?.kind ?? 'snapshot'}
                    onChange={(e) => updateDataSource(sec.id, { kind: e.target.value as 'snapshot' | 'manual' })}
                    className="pib-input !text-sm w-full"
                  >
                    <option value="snapshot">Snapshot metrics</option>
                    <option value="manual">Manual rows</option>
                  </select>
                  {sec.dataSource?.kind === 'manual' ? (
                    <p className="text-xs text-[var(--color-pib-text-muted)]">
                      Manual rows render as supplied (label · value). Edit JSON in the API; the live preview shows snapshot tables.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {METRIC_KEYS.map((m) => {
                        const on = sec.dataSource?.metrics?.includes(m)
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              const cur = sec.dataSource?.metrics ?? []
                              const next = on ? cur.filter((x) => x !== m) : [...cur, m]
                              updateDataSource(sec.id, { metrics: next })
                            }}
                            className={`pib-pill !text-[10px] ${on ? 'pib-pill-info !border-[var(--color-pib-accent)]' : ''}`}
                          >
                            {m}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add section toolbar */}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SECTION_LABELS) as ReportSectionType[]).map((t) => (
            <button key={t} type="button" onClick={() => addSection(t)} className="btn-pib-secondary !py-2 !px-3 !text-sm">
              <span className="material-symbols-outlined text-base">add</span>
              {SECTION_LABELS[t]}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-rose-300">{error}</p>}

        <div className="flex flex-wrap gap-2 pt-2">
          <button type="button" onClick={runPreview} disabled={previewing} className="btn-pib-secondary !py-2 !px-4 !text-sm disabled:opacity-60">
            {previewing ? 'Loading...' : 'Refresh preview'}
          </button>
          <button type="button" onClick={generatePdf} disabled={saving} className="btn-pib-secondary !py-2 !px-4 !text-sm disabled:opacity-60">
            {saving ? 'Working...' : 'Generate PDF'}
          </button>
          <button type="button" onClick={save} disabled={saving} className="btn-pib-accent !py-2 !px-4 !text-sm disabled:opacity-60">
            {saving ? 'Saving...' : 'Save report'}
          </button>
        </div>
      </div>

      {/* Live preview */}
      <div className="bento-card !p-6 space-y-6 lg:sticky lg:top-6 self-start">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl">{title || 'Untitled report'}</h2>
          <span className="text-xs font-mono text-[var(--color-pib-text-muted)]">{start} → {end}</span>
        </div>
        {!k && (
          <p className="text-xs text-[var(--color-pib-text-muted)]">
            Press “Refresh preview” to pull live numbers for snapshot sections.
          </p>
        )}
        <div className="space-y-5">
          {sections.map((sec) => (
            <PreviewSection key={sec.id} sec={sec} metricVal={metricVal} k={k} />
          ))}
        </div>
      </div>
    </div>
  )
}

function PreviewSection({
  sec,
  metricVal,
  k,
}: {
  sec: ReportSection
  metricVal: (key?: ReportMetricKey) => number
  k: ReportKpis | null
}) {
  if (sec.type === 'page_break') {
    return <div className="border-t border-dashed border-white/20 text-[10px] text-center text-[var(--color-pib-text-muted)] uppercase tracking-widest pt-2">page break</div>
  }
  if (sec.type === 'text') {
    return (
      <div>
        {sec.title ? <h3 className="eyebrow mb-2">{sec.title}</h3> : null}
        {(sec.body ?? '').split('\n\n').map((p, i) => (
          <p key={i} className="text-sm text-[var(--color-pib-text-muted)] mb-2">{p}</p>
        ))}
      </div>
    )
  }
  if (sec.type === 'metric') {
    const val = sec.dataSource?.kind === 'manual' ? sec.dataSource.value ?? 0 : metricVal(sec.dataSource?.metric)
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--color-pib-text-muted)] font-mono mb-2">{sec.title ?? sec.dataSource?.metric}</div>
        <div className="text-3xl font-display tabular-nums">{fmtNum.format(val)}</div>
      </div>
    )
  }
  if (sec.type === 'chart') {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="text-xs uppercase tracking-wider text-[var(--color-pib-text-muted)] font-mono mb-2">{sec.title ?? sec.dataSource?.metric}</div>
        <div className="text-2xl font-display tabular-nums text-[var(--color-pib-accent)]">{fmtNum.format(metricVal(sec.dataSource?.metric))}</div>
        <p className="text-[10px] text-[var(--color-pib-text-muted)] mt-1">Trend rendered in the published report.</p>
      </div>
    )
  }
  // table
  const rows = sec.dataSource?.kind === 'manual'
    ? (sec.dataSource.rows ?? []).map((r) => ({ label: r.label, value: r.value }))
    : (sec.dataSource?.metrics ?? []).map((m) => ({ label: m, value: k ? fmtNum.format(metricVal(m)) : '—' }))
  return (
    <div>
      {sec.title ? <h3 className="eyebrow mb-2">{sec.title}</h3> : null}
      <div className="rounded-2xl border border-white/10 overflow-hidden">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2 border-b border-white/5 text-sm">
            <span className="text-[var(--color-pib-text-muted)] font-mono">{r.label}</span>
            <span className="tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
