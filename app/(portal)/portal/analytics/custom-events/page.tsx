'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { DateRangePicker, defaultRange, type DateRangeValue } from '@/components/analytics/DateRangePicker'
import { KpiCard, SimpleTable, CopyButton } from '@/components/analytics/Primitives'
import { Icon } from '@/components/studio'
import { PageHeader, EmptyState } from '@/components/ui/AppFoundation'

interface CustomEvent {
  id: string
  name: string
  description: string
  properties: string[]
  registered: boolean
  triggerCount: number
  lastTriggered: string | null
}

interface BreakdownData {
  event: string
  total: number
  uniqueUsers: number
  breakdown: Array<{ key: string; values: Array<{ value: string; count: number }> }>
}

function fmtDate(iso: string | null): string {
  if (!iso) return ' - '
  const d = new Date(iso)
  return isNaN(d.getTime()) ? ' - ' : d.toLocaleString()
}

function snippet(name: string): string {
  return `analytics.track('${name}', { /* props */ })`
}

export default function CustomEventsPage() {
  const sp = useSearchParams()
  const [propertyId, setPropertyId] = useState(sp?.get('propertyId') ?? '')
  const [events, setEvents] = useState<CustomEvent[]>([])
  const [loading, setLoading] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [propsInput, setPropsInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [selected, setSelected] = useState<string | null>(null)
  const [range, setRange] = useState<DateRangeValue>(defaultRange(30))
  const [breakdown, setBreakdown] = useState<BreakdownData | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    try {
      const qs = new URLSearchParams({ propertyId })
      const res = await fetch(`/api/v1/analytics/custom-events?${qs}`)
      const body = await res.json()
      const data = res.ok ? (body.data ?? body) : []
      setEvents(Array.isArray(data) ? data : [])
    } catch { setEvents([]) } finally { setLoading(false) }
  }, [propertyId])

  useEffect(() => { load() }, [load])

  const loadBreakdown = useCallback(async () => {
    if (!propertyId || !selected) return
    setBreakdownLoading(true)
    try {
      const qs = new URLSearchParams({ propertyId, event: selected, from: range.from, to: range.to })
      const res = await fetch(`/api/v1/analytics/custom-events/breakdown?${qs}`)
      const body = await res.json()
      setBreakdown(res.ok ? (body.data ?? body) : null)
    } catch { setBreakdown(null) } finally { setBreakdownLoading(false) }
  }, [propertyId, selected, range])

  useEffect(() => { loadBreakdown() }, [loadBreakdown])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!propertyId || !name.trim()) return
    setSaving(true)
    setFormError(null)
    try {
      const properties = propsInput.split(',').map(p => p.trim()).filter(Boolean)
      const res = await fetch('/api/v1/analytics/custom-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, name: name.trim(), description: description.trim(), properties }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setFormError(body?.error ?? 'Failed to define event.')
        return
      }
      setName('')
      setDescription('')
      setPropsInput('')
      await load()
    } catch {
      setFormError('Failed to define event.')
    } finally {
      setSaving(false)
    }
  }

  const selectedEvent = useMemo(() => events.find(ev => ev.name === selected) ?? null, [events, selected])

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6" data-module-accent="violet">
      <AnalyticsNav active="custom-events" propertyId={propertyId} />
      <PageHeader
        eyebrow="Analytics · Custom Events"
        title="Custom Events."
      />

      <div className="st-panel space-y-4">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
      </div>

      {!propertyId && (
        <EmptyState title="Select a client and property to manage custom events." />
      )}

      {propertyId && (
        <>
          <form onSubmit={submit} className="st-panel space-y-4">
            <div className="flex items-center gap-3">
              <Icon name="bolt" />
              <h2 className="pib-label mb-0">Define an event</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="pib-label">Name</label>
                <input name="text"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="signup_completed"
                  className="pib-input text-sm w-full"
                  required
                />
              </div>
              <div>
                <label className="pib-label">Description</label>
                <input name="text"
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Fired when a user finishes signup"
                  className="pib-input text-sm w-full"
                />
              </div>
            </div>
            <div>
              <label className="pib-label">Properties (comma-separated)</label>
              <input name="text"
                type="text"
                value={propsInput}
                onChange={e => setPropsInput(e.target.value)}
                placeholder="plan, source, referrer"
                className="pib-input text-sm w-full"
              />
            </div>
            {formError && <p className="text-xs text-[var(--color-error)]">{formError}</p>}
            <button name="page-action-10" type="submit" disabled={saving || !name.trim()} className="st-btn st-btn--primary text-sm px-4 py-2">
              {saving ? 'Saving…' : 'Define event'}
            </button>
          </form>

          {loading && <div className="pib-skeleton h-24" />}

          {!loading && (
            <div className="space-y-2">
              <h2 className="pib-label mb-2">Events</h2>
              {events.length === 0 ? (
                <EmptyState title="No custom events defined yet." />
              ) : (
                <div className="pib-surface pib-surface-table overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-pib-line)]">
                        <th className="px-3 py-2 text-xs font-label text-[var(--color-pib-text-muted)] text-left">Name</th>
                        <th className="px-3 py-2 text-xs font-label text-[var(--color-pib-text-muted)] text-left">Description</th>
                        <th className="px-3 py-2 text-xs font-label text-[var(--color-pib-text-muted)] text-right">Triggers</th>
                        <th className="px-3 py-2 text-xs font-label text-[var(--color-pib-text-muted)] text-left">Last triggered</th>
                        <th className="px-3 py-2 text-xs font-label text-[var(--color-pib-text-muted)] text-left">Status</th>
                        <th className="px-3 py-2 text-xs font-label text-[var(--color-pib-text-muted)] text-right">Snippet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map(ev => (
                        <tr
                          key={ev.id}
                          onClick={() => setSelected(ev.name)}
                          className={`border-b border-[var(--color-pib-line)] last:border-0 cursor-pointer hover:bg-[var(--color-row-hover)] ${selected === ev.name ? 'bg-[var(--color-pib-violet-soft)]' : ''}`}
                        >
                          <td className="px-3 py-2 text-[var(--color-pib-text)] font-medium">{ev.name}</td>
                          <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">{ev.description || ' - '}</td>
                          <td className="px-3 py-2 text-[var(--color-pib-text)] text-right tabular-nums">{ev.triggerCount.toLocaleString()}</td>
                          <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">{fmtDate(ev.lastTriggered)}</td>
                          <td className="px-3 py-2">
                            {ev.registered ? (
                              <span className="pib-pill pib-pill-success">Registered</span>
                            ) : (
                              <span className="pib-pill pib-pill-warn">Unregistered</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
                            <CopyButton text={snippet(ev.name)} label="Snippet" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {selected && (
            <div className="st-panel space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="pib-label mb-0">
                  Breakdown · <span className="text-[var(--color-pib-violet)]">{selected}</span>
                </h2>
                <DateRangePicker value={range} onChange={setRange} />
              </div>

              {breakdownLoading && <div className="pib-skeleton h-24" />}

              {!breakdownLoading && breakdown && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <KpiCard label="Total" value={breakdown.total.toLocaleString()} accent />
                    <KpiCard label="Unique Users" value={breakdown.uniqueUsers.toLocaleString()} />
                    {selectedEvent && <KpiCard label="Properties" value={selectedEvent.properties.length} />}
                  </div>

                  {breakdown.breakdown.length === 0 ? (
                    <div className="pib-empty-state">
                      <p className="pib-empty-state-description">No property data in this range.</p>
                    </div>
                  ) : (
                    <div className="grid md:grid-cols-2 gap-4">
                      {breakdown.breakdown.map(b => (
                        <div key={b.key} className="space-y-2">
                          <h3 className="pib-label">{b.key}</h3>
                          <SimpleTable
                            columns={[
                              { key: 'value', label: 'Value' },
                              { key: 'count', label: 'Count', align: 'right' },
                            ]}
                            rows={b.values.map(v => ({ value: v.value, count: v.count.toLocaleString() }))}
                            empty="No values."
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
