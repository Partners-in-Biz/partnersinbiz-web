'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { FunnelResults } from '@/lib/analytics/types'
import { VALID_FUNNEL_WINDOWS } from '@/lib/analytics/types'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { Icon } from '@/components/studio'
import { PageHeader, EmptyState } from '@/components/ui/AppFoundation'

interface Funnel {
  id: string
  name: string
  propertyId: string
  steps: Array<{ event: string }>
  window: string
}

export default function FunnelsPage() {
  const sp = useSearchParams()
  const initialPid = sp?.get('propertyId') ?? ''
  const [propertyId, setPropertyId] = useState(initialPid)
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSteps, setNewSteps] = useState(['', ''])
  const [newWindow, setNewWindow] = useState('24h')
  const [selectedFunnel, setSelectedFunnel] = useState<string | null>(null)
  const [results, setResults] = useState<FunnelResults | null>(null)
  const [resultsLoading, setResultsLoading] = useState(false)
  const [error, setError] = useState('')

  async function fetchFunnels() {
    if (!propertyId.trim()) return
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/analytics/funnels?propertyId=${encodeURIComponent(propertyId)}`)
      if (!res.ok) throw new Error('Failed')
      const body = await res.json()
      setFunnels(body.data)
    } catch {
      setFunnels([])
    } finally {
      setLoading(false)
    }
  }

  async function createFunnel() {
    const steps = newSteps.filter(s => s.trim()).map(event => ({ event: event.trim() }))
    if (steps.length < 2) { setError('At least 2 steps required'); return }
    setError('')
    setCreating(true)
    try {
      const res = await fetch('/api/v1/analytics/funnels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ propertyId, name: newName, steps, window: newWindow }),
      })
      if (!res.ok) {
        const b = await res.json()
        throw new Error(b.error ?? 'Failed')
      }
      setNewName(''); setNewSteps(['', '']); setNewWindow('24h')
      await fetchFunnels()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create funnel')
    } finally {
      setCreating(false)
    }
  }

  async function viewResults(funnelId: string) {
    setSelectedFunnel(funnelId)
    setResultsLoading(true)
    try {
      const to = new Date().toISOString()
      const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const res = await fetch(`/api/v1/analytics/funnels/${funnelId}/results?from=${from}&to=${to}`)
      if (!res.ok) throw new Error('Failed')
      const body = await res.json()
      setResults(body.data)
    } catch {
      setResults(null)
    } finally {
      setResultsLoading(false)
    }
  }

  async function deleteFunnel(funnelId: string) {
    if (!confirm('Delete this funnel?')) return
    await fetch(`/api/v1/analytics/funnels/${funnelId}`, { method: 'DELETE' })
    setFunnels(f => f.filter(x => x.id !== funnelId))
    if (selectedFunnel === funnelId) { setSelectedFunnel(null); setResults(null) }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6" data-module-accent="violet">
      <AnalyticsNav active="funnels" propertyId={propertyId} />
      <PageHeader
        eyebrow="Analytics · Funnels"
        title="Funnels."
      />

      <div className="st-panel space-y-4">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        <div className="flex justify-end">
          <button name="page-action-12" onClick={fetchFunnels} disabled={!propertyId || loading} className="st-btn st-btn--primary text-sm">
            {loading ? 'Loading…' : 'Load Funnels'}
          </button>
        </div>
      </div>

      {/* Create funnel form */}
      {propertyId && (
        <div className="st-panel space-y-4">
          <div className="flex items-center gap-3">
            <Icon name="filter_alt" />
            <h2 className="pib-label mb-0">Create Funnel</h2>
          </div>
          <div>
            <label className="pib-label mb-1">Name</label>
            <input name="text" type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="App Store Conversion" className="pib-input text-sm w-72" />
          </div>
          <div className="space-y-2">
            <label className="pib-label">Steps (event names)</label>
            {newSteps.map((s, i) => (
              <div key={i} className="flex gap-2 items-center">
                <span className="text-xs text-[var(--color-pib-text-muted)] w-6">{i + 1}.</span>
                <input name="text"
                  type="text"
                  value={s}
                  onChange={e => setNewSteps(steps => steps.map((x, j) => j === i ? e.target.value : x))}
                  placeholder="event_name"
                  className="pib-input text-sm w-56"
                />
                {newSteps.length > 2 && (
                  <button name="page-action-13" onClick={() => setNewSteps(steps => steps.filter((_, j) => j !== i))} className="text-xs text-[var(--color-error)]">✕</button>
                )}
              </div>
            ))}
            <button name="page-action-14" onClick={() => setNewSteps(s => [...s, ''])} className="st-btn st-btn--secondary text-xs px-3 py-1.5">
              + Add Step
            </button>
          </div>
          <div>
            <label className="pib-label mb-1">Conversion Window</label>
            <select name="page-select-15" value={newWindow} onChange={e => setNewWindow(e.target.value)} className="pib-select text-sm w-32">
              {VALID_FUNNEL_WINDOWS.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
          <button name="page-action-16" onClick={createFunnel} disabled={creating || !newName.trim()} className="st-btn st-btn--primary text-sm">
            {creating ? 'Creating…' : 'Create Funnel'}
          </button>
        </div>
      )}

      {/* Funnels list */}
      {funnels.length > 0 && (
        <div className="space-y-4">
          {funnels.map(f => (
            <div key={f.id} className="st-panel space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Icon name="filter_alt" />
                  <div>
                    <h3 className="text-sm font-medium text-[var(--color-pib-text)]">{f.name}</h3>
                    <p className="text-xs text-[var(--color-pib-text-muted)]">
                      {f.steps.map(s => s.event).join(' → ')} · window: {f.window}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button name="page-action-17" onClick={() => viewResults(f.id)} className="st-btn st-btn--secondary text-xs px-3 py-1.5">
                    View Results
                  </button>
                  <button name="page-action-18" onClick={() => deleteFunnel(f.id)} className="st-btn st-btn--ghost text-xs px-3 py-1.5 text-[var(--color-error)]">
                    Delete
                  </button>
                </div>
              </div>

              {selectedFunnel === f.id && (
                <div className="border-t border-[var(--color-pib-line)] pt-3">
                  {resultsLoading && <div className="pib-skeleton h-12" />}
                  {!resultsLoading && results && (
                    <div className="space-y-2">
                      <p className="pib-label">Last 30 days</p>
                      <div className="flex gap-4 flex-wrap">
                        {results.steps.map((step, i) => (
                          <div key={i} className="text-center">
                            <p className="text-xs font-mono text-[var(--color-pib-text)]">{step.event}</p>
                            <p className="text-lg text-[var(--color-pib-text)]">{step.count}</p>
                            {step.conversionFromPrev !== null && (
                              <p className="text-xs text-[var(--color-pib-text-muted)]">{step.conversionFromPrev}% from prev</p>
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-[var(--color-pib-text-muted)]">
                        Total: {results.totalEntered} entered → {results.totalConverted} converted
                        ({results.totalEntered > 0 ? Math.round(results.totalConverted / results.totalEntered * 100) : 0}%)
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && funnels.length === 0 && propertyId && (
        <EmptyState title="No funnels yet  -  create one above." />
      )}
    </div>
  )
}
