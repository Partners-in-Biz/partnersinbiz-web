'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { FunnelResults } from '@/lib/analytics/types'
import { VALID_FUNNEL_WINDOWS } from '@/lib/analytics/types'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'

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
    <div className="max-w-5xl mx-auto space-y-6">
      <AnalyticsNav active="funnels" propertyId={propertyId} />
      <h1 className="text-xl font-headline font-bold text-on-surface">Funnels</h1>

      <div className="pib-card p-4 space-y-3">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        <div className="flex justify-end">
          <button onClick={fetchFunnels} disabled={!propertyId || loading} className="pib-btn-primary text-sm font-label">
            {loading ? 'Loading…' : 'Load Funnels'}
          </button>
        </div>
      </div>

      {/* Create funnel form */}
      {propertyId && (
        <div className="pib-card p-4 space-y-4">
          <h2 className="text-sm font-label font-semibold text-on-surface">Create Funnel</h2>
          <div>
            <label className="text-xs text-on-surface-variant font-label block mb-1">Name</label>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="App Store Conversion" className="pib-input text-sm w-72" />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-on-surface-variant font-label block">Steps (event names)</label>
            {newSteps.map((s, i) => (
              <div key={i} className="flex gap-2 items-center">
                <span className="text-xs text-on-surface-variant w-6">{i + 1}.</span>
                <input
                  type="text"
                  value={s}
                  onChange={e => setNewSteps(steps => steps.map((x, j) => j === i ? e.target.value : x))}
                  placeholder="event_name"
                  className="pib-input text-sm w-56"
                />
                {newSteps.length > 2 && (
                  <button onClick={() => setNewSteps(steps => steps.filter((_, j) => j !== i))} className="text-xs text-red-400">✕</button>
                )}
              </div>
            ))}
            <button onClick={() => setNewSteps(s => [...s, ''])} className="pib-btn-secondary text-xs px-3 py-1.5">
              + Add Step
            </button>
          </div>
          <div>
            <label className="text-xs text-on-surface-variant font-label block mb-1">Conversion Window</label>
            <select value={newWindow} onChange={e => setNewWindow(e.target.value)} className="pib-input text-sm w-32">
              {VALID_FUNNEL_WINDOWS.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button onClick={createFunnel} disabled={creating || !newName.trim()} className="pib-btn-primary text-sm font-label">
            {creating ? 'Creating…' : 'Create Funnel'}
          </button>
        </div>
      )}

      {/* Funnels list */}
      {funnels.length > 0 && (
        <div className="space-y-4">
          {funnels.map(f => (
            <div key={f.id} className="pib-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-label font-semibold text-on-surface">{f.name}</h3>
                  <p className="text-xs text-on-surface-variant">
                    {f.steps.map(s => s.event).join(' → ')} · window: {f.window}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => viewResults(f.id)} className="pib-btn-secondary text-xs px-3 py-1.5">
                    View Results
                  </button>
                  <button onClick={() => deleteFunnel(f.id)} className="pib-btn-secondary text-xs px-3 py-1.5 text-red-400">
                    Delete
                  </button>
                </div>
              </div>

              {selectedFunnel === f.id && (
                <div className="border-t border-[var(--color-outline-variant)] pt-3">
                  {resultsLoading && <div className="pib-skeleton h-12 rounded-lg" />}
                  {!resultsLoading && results && (
                    <div className="space-y-2">
                      <p className="text-xs text-on-surface-variant font-label">Last 30 days</p>
                      <div className="flex gap-4 flex-wrap">
                        {results.steps.map((step, i) => (
                          <div key={i} className="text-center">
                            <p className="text-xs font-mono text-on-surface">{step.event}</p>
                            <p className="text-lg font-bold text-on-surface">{step.count}</p>
                            {step.conversionFromPrev !== null && (
                              <p className="text-xs text-on-surface-variant">{step.conversionFromPrev}% from prev</p>
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-on-surface-variant">
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
        <div className="pib-card p-8 text-center text-on-surface-variant text-sm">
          No funnels yet — create one above.
        </div>
      )}
    </div>
  )
}
