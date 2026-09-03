'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { DateRangePicker, defaultRange, type DateRangeValue } from '@/components/analytics/DateRangePicker'
import { LineSeries } from '@/components/analytics/Charts'
import { KpiCard, SimpleTable } from '@/components/analytics/Primitives'
import { Icon } from '@/components/studio'
import { PageHeader, EmptyState } from '@/components/ui/AppFoundation'

type GoalType = 'event' | 'pageview' | 'duration'

interface Goal {
  id: string
  name: string
  type: GoalType
  target: string
  minDuration: number
  value: number
  active: boolean
}

interface GoalResults {
  goal: { id: string; name: string }
  completions: number
  totalSessions: number
  completionRate: number
  totalValue: number
  series: Array<{ date: string; completions: number; value: number }>
  revenueByChannel: Array<{ channel: string; completions: number; value: number }>
}

export default function ConversionsPage() {
  const sp = useSearchParams()
  const [propertyId, setPropertyId] = useState(sp?.get('propertyId') ?? '')
  const [range, setRange] = useState<DateRangeValue>(defaultRange(30))
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<GoalType>('event')
  const [newTarget, setNewTarget] = useState('')
  const [newMinDuration, setNewMinDuration] = useState(60)
  const [newValue, setNewValue] = useState(0)
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null)
  const [results, setResults] = useState<GoalResults | null>(null)
  const [resultsLoading, setResultsLoading] = useState(false)
  const [error, setError] = useState('')

  async function fetchGoals() {
    if (!propertyId.trim()) return
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/analytics/conversions?propertyId=${encodeURIComponent(propertyId)}`)
      if (!res.ok) throw new Error('Failed')
      const body = await res.json()
      setGoals(body.data ?? body)
    } catch {
      setGoals([])
    } finally {
      setLoading(false)
    }
  }

  async function createGoal() {
    if (!newName.trim()) { setError('Name required'); return }
    if (newType !== 'duration' && !newTarget.trim()) { setError('Target required'); return }
    setError('')
    setCreating(true)
    try {
      const res = await fetch('/api/v1/analytics/conversions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          name: newName,
          type: newType,
          target: newTarget,
          minDuration: newMinDuration,
          value: newValue,
        }),
      })
      if (!res.ok) {
        const b = await res.json()
        throw new Error(b.error ?? 'Failed')
      }
      setNewName(''); setNewType('event'); setNewTarget(''); setNewMinDuration(60); setNewValue(0)
      await fetchGoals()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create goal')
    } finally {
      setCreating(false)
    }
  }

  async function viewResults(goalId: string) {
    setSelectedGoal(goalId)
    setResultsLoading(true)
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to })
      const res = await fetch(`/api/v1/analytics/conversions/${goalId}/results?${qs}`)
      if (!res.ok) throw new Error('Failed')
      const body = await res.json()
      setResults(body.data ?? body)
    } catch {
      setResults(null)
    } finally {
      setResultsLoading(false)
    }
  }

  async function toggleActive(goal: Goal) {
    const next = !goal.active
    await fetch(`/api/v1/analytics/conversions/${goal.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: next }),
    })
    setGoals(gs => gs.map(g => g.id === goal.id ? { ...g, active: next } : g))
  }

  async function deleteGoal(goalId: string) {
    if (!confirm('Delete this goal?')) return
    await fetch(`/api/v1/analytics/conversions/${goalId}`, { method: 'DELETE' })
    setGoals(gs => gs.filter(g => g.id !== goalId))
    if (selectedGoal === goalId) { setSelectedGoal(null); setResults(null) }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6" data-module-accent="violet">
      <AnalyticsNav active="conversions" propertyId={propertyId} />
      <PageHeader
        eyebrow="Analytics · Conversions"
        title="Conversions."
      />

      <div className="st-panel space-y-4">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        {propertyId && <DateRangePicker value={range} onChange={setRange} />}
        <div className="flex justify-end">
          <button name="page-action-4" onClick={fetchGoals} disabled={!propertyId || loading} className="st-btn st-btn--primary text-sm">
            {loading ? 'Loading…' : 'Load Goals'}
          </button>
        </div>
      </div>

      {/* Create goal form */}
      {propertyId && (
        <div className="st-panel space-y-4">
          <div className="flex items-center gap-3">
            <Icon name="flag" />
            <h2 className="pib-label mb-0">Create Goal</h2>
          </div>
          <div>
            <label className="pib-label mb-1">Name</label>
            <input name="text" type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Newsletter Signup" className="pib-input text-sm w-72" />
          </div>
          <div>
            <label className="pib-label mb-1">Type</label>
            <select name="page-select-5" value={newType} onChange={e => setNewType(e.target.value as GoalType)} className="pib-select text-sm w-40">
              <option value="event">event</option>
              <option value="pageview">pageview</option>
              <option value="duration">duration</option>
            </select>
          </div>
          {newType === 'duration' ? (
            <div>
              <label className="pib-label mb-1">Min Duration (seconds)</label>
              <input name="number" type="number" value={newMinDuration} onChange={e => setNewMinDuration(Number(e.target.value))} className="pib-input text-sm w-40" />
            </div>
          ) : (
            <div>
              <label className="pib-label mb-1">
                {newType === 'pageview' ? 'Target (URL path)' : 'Target (event name)'}
              </label>
              <input name="text" type="text" value={newTarget} onChange={e => setNewTarget(e.target.value)} placeholder={newType === 'pageview' ? '/thank-you' : 'signup_complete'} className="pib-input text-sm w-56" />
            </div>
          )}
          <div>
            <label className="pib-label mb-1">Value (ZAR)</label>
            <input name="number" type="number" value={newValue} onChange={e => setNewValue(Number(e.target.value))} className="pib-input text-sm w-40" />
          </div>
          {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
          <button name="page-action-6" onClick={createGoal} disabled={creating || !newName.trim()} className="st-btn st-btn--primary text-sm">
            {creating ? 'Creating…' : 'Create Goal'}
          </button>
        </div>
      )}

      {/* Goals list */}
      {goals.length > 0 && (
        <div className="space-y-4">
          {goals.map(g => (
            <div key={g.id} className="st-panel space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Icon name="flag" />
                  <div>
                    <h3 className="text-sm font-medium text-[var(--color-pib-text)]">
                      {g.name} {!g.active && <span className="text-xs text-[var(--color-pib-text-muted)]">(inactive)</span>}
                    </h3>
                    <p className="text-xs text-[var(--color-pib-text-muted)]">
                      {g.type === 'duration' ? `duration ≥ ${g.minDuration}s` : `${g.type}: ${g.target}`} · R{g.value}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button name="page-action-7" onClick={() => viewResults(g.id)} className="st-btn st-btn--secondary text-xs px-3 py-1.5">
                    View Results
                  </button>
                  <button name="page-action-8" onClick={() => toggleActive(g)} className="st-btn st-btn--secondary text-xs px-3 py-1.5">
                    {g.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button name="page-action-9" onClick={() => deleteGoal(g.id)} className="st-btn st-btn--ghost text-xs px-3 py-1.5 text-[var(--color-error)]">
                    Delete
                  </button>
                </div>
              </div>

              {selectedGoal === g.id && (
                <div className="border-t border-[var(--color-pib-line)] pt-3 space-y-4">
                  {resultsLoading && <div className="pib-skeleton h-12" />}
                  {!resultsLoading && results && (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <KpiCard label="Completions" value={results.completions.toLocaleString()} accent />
                        <KpiCard label="Completion Rate" value={`${results.completionRate}%`} />
                        <KpiCard label="Total Value" value={`R${results.totalValue.toLocaleString()}`} />
                      </div>
                      <div className="st-panel">
                        <h4 className="pib-label mb-3">Goal completions over time</h4>
                        <LineSeries data={results.series} xKey="date" yKey="completions" label="Completions" />
                      </div>
                      <div>
                        <h4 className="pib-label mb-2">Revenue by channel</h4>
                        <SimpleTable
                          columns={[
                            { key: 'channel', label: 'Channel' },
                            { key: 'completions', label: 'Completions', align: 'right' },
                            { key: 'value', label: 'Value (R)', align: 'right' },
                          ]}
                          rows={results.revenueByChannel}
                          empty="No revenue in this range."
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && goals.length === 0 && propertyId && (
        <EmptyState title="No goals yet  -  create one above." />
      )}
    </div>
  )
}
