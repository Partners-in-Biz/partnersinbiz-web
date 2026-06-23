'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { formatZar, formatDate } from '@/lib/billing/format'

interface Stage {
  daysAfterDue: number
  subject: string
  body: string
  suspend: boolean
}

interface DunningConfig {
  active: boolean
  stages: Stage[]
}

interface Sequence {
  id: string
  orgId: string
  orgName?: string
  invoiceNumber: string
  currentStage: number
  status: 'active' | 'resolved' | 'suspended'
  lastSentAt: number | null
}

interface OverdueInvoice {
  id: string
  invoiceNumber: string
  orgId: string
  orgName?: string
  total: number
  currency: string
  dueDateMs: number | null
  status: string
}

interface RunSummary {
  active: boolean
  overdueInvoices: number
  sequencesCreated: number
  remindersSent: number
  remindersQueued: number
  suspensions: number
  resolved: number
  skipped: number
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function money(amount: number, currency: string): string {
  if (currency === 'ZAR') return formatZar(amount, { decimals: true })
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-blue-500/15 text-blue-400',
  resolved: 'bg-green-500/15 text-green-400',
  suspended: 'bg-red-500/15 text-red-400',
}

function emptyStage(): Stage {
  return { daysAfterDue: 1, subject: '', body: '', suspend: false }
}

export default function DunningPage() {
  const [config, setConfig] = useState<DunningConfig>({ active: false, stages: [] })
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [overdue, setOverdue] = useState<OverdueInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [topError, setTopError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null)

  async function load() {
    setLoading(true)
    setTopError(null)
    try {
      const res = await fetch('/api/v1/admin/billing/dunning')
      const body = await res.json()
      if (!res.ok) {
        setTopError(body?.error ?? 'Failed to load dunning')
      } else {
        const data = body.data ?? {}
        setConfig({
          active: Boolean(data.config?.active),
          stages: Array.isArray(data.config?.stages) ? data.config.stages : [],
        })
        setSequences((data.sequences ?? []) as Sequence[])
        setOverdue((data.overdueInvoices ?? []) as OverdueInvoice[])
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load dunning')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function updateStage(index: number, patch: Partial<Stage>) {
    setConfig((c) => ({
      ...c,
      stages: c.stages.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }))
  }

  function addStage() {
    setConfig((c) => ({ ...c, stages: [...c.stages, emptyStage()] }))
  }

  function removeStage(index: number) {
    setConfig((c) => ({ ...c, stages: c.stages.filter((_, i) => i !== index) }))
  }

  async function save() {
    setSaving(true)
    setTopError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/v1/admin/billing/dunning', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: config.active, stages: config.stages }),
      })
      const body = await res.json()
      if (!res.ok) {
        setTopError(body?.error ?? 'Failed to save')
      } else {
        const data = body.data ?? {}
        setConfig({
          active: Boolean(data.config?.active),
          stages: Array.isArray(data.config?.stages) ? data.config.stages : [],
        })
        setNotice('Reminder schedule saved.')
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function runNow() {
    setRunning(true)
    setTopError(null)
    setNotice(null)
    setRunSummary(null)
    try {
      const res = await fetch('/api/v1/admin/billing/dunning/run', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        setTopError(body?.error ?? 'Failed to run dunning')
      } else {
        setRunSummary(body.data as RunSummary)
        setNotice('Dunning run complete.')
        await load()
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to run dunning')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">Dunning — EFT reminders</h1>
          <p className="text-sm text-on-surface/60 mt-1 max-w-2xl">
            These are EFT payment-reminder sequences. There are no card retries — when an invoice
            is overdue we email the client on a schedule. The final stage can suspend the org&apos;s
            subscription until they pay.
          </p>
        </div>
        <button
          className="pib-btn-primary whitespace-nowrap"
          onClick={runNow}
          disabled={running || loading}
        >
          {running ? 'Running…' : 'Run dunning now'}
        </button>
      </div>

      {topError && (
        <div className="pib-card border-red-500/40 bg-red-500/5 p-4 text-sm text-red-400">
          {topError}
        </div>
      )}
      {notice && (
        <div className="pib-card border-green-500/40 bg-green-500/5 p-4 text-sm text-green-400">
          {notice}
        </div>
      )}

      {runSummary && (
        <div className="pib-card p-4 text-sm text-on-surface">
          <div className="font-semibold mb-2">Last run</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Stat label="Overdue invoices" value={runSummary.overdueInvoices} />
            <Stat label="New sequences" value={runSummary.sequencesCreated} />
            <Stat label="Reminders sent" value={runSummary.remindersSent} />
            <Stat label="Reminders queued" value={runSummary.remindersQueued} />
            <Stat label="Suspensions" value={runSummary.suspensions} />
            <Stat label="Resolved" value={runSummary.resolved} />
            <Stat label="Skipped" value={runSummary.skipped} />
            <Stat label="Active" value={runSummary.active ? 'Yes' : 'No'} />
          </div>
          {!runSummary.active && (
            <p className="text-xs text-on-surface/60 mt-3">
              Dunning is currently inactive — only paid sequences were resolved. Turn it on below to
              send reminders.
            </p>
          )}
        </div>
      )}

      {/* Reminder schedule editor */}
      <section className="pib-card p-5 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-lg font-semibold text-on-surface">Reminder schedule</h2>
          <label className="flex items-center gap-2 text-sm text-on-surface cursor-pointer">
            <input
              type="checkbox"
              checked={config.active}
              onChange={(e) => setConfig((c) => ({ ...c, active: e.target.checked }))}
            />
            Active
          </label>
        </div>

        <p className="text-xs text-on-surface/60">
          Supported template variables:{' '}
          <code className="px-1 rounded bg-white/5">{'{{invoiceNumber}}'}</code>{' '}
          <code className="px-1 rounded bg-white/5">{'{{amount}}'}</code>{' '}
          <code className="px-1 rounded bg-white/5">{'{{orgName}}'}</code>
        </p>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : config.stages.length === 0 ? (
          <p className="text-sm text-on-surface/60">
            No stages yet. Add a stage to build the reminder sequence.
          </p>
        ) : (
          <div className="space-y-4">
            {config.stages.map((stage, i) => (
              <div key={i} className="border border-white/10 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2 text-sm text-on-surface">
                    <span className="font-medium">Stage {i + 1}</span>
                    <span className="text-on-surface/50">— fires</span>
                    <input
                      type="number"
                      min={0}
                      className="pib-input w-20"
                      value={stage.daysAfterDue}
                      onChange={(e) => updateStage(i, { daysAfterDue: Number(e.target.value) })}
                    />
                    <span className="text-on-surface/50">days after due</span>
                  </div>
                  <button
                    className="pib-btn-ghost text-red-400 text-xs"
                    onClick={() => removeStage(i)}
                  >
                    Remove
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-on-surface/60 mb-1">Subject</label>
                  <input
                    className="pib-input w-full"
                    value={stage.subject}
                    placeholder="Reminder: invoice {{invoiceNumber}} is overdue"
                    onChange={(e) => updateStage(i, { subject: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs text-on-surface/60 mb-1">Body</label>
                  <textarea
                    className="pib-input w-full min-h-[120px]"
                    value={stage.body}
                    placeholder="Hi {{orgName}}, invoice {{invoiceNumber}} for {{amount}} is overdue…"
                    onChange={(e) => updateStage(i, { body: e.target.value })}
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-on-surface cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stage.suspend}
                    onChange={(e) => updateStage(i, { suspend: e.target.checked })}
                  />
                  Suspend the org&apos;s subscription when this stage fires
                </label>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button className="pib-btn-secondary" onClick={addStage} disabled={loading}>
            Add stage
          </button>
          <button className="pib-btn-primary" onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save schedule'}
          </button>
        </div>
      </section>

      {/* Active sequences */}
      <section className="pib-card p-5 space-y-4">
        <h2 className="text-lg font-semibold text-on-surface">Active sequences</h2>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : sequences.length === 0 ? (
          <p className="text-sm text-on-surface/60">No dunning sequences yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-on-surface/50 border-b border-white/10">
                  <th className="py-2 pr-4">Org</th>
                  <th className="py-2 pr-4">Invoice</th>
                  <th className="py-2 pr-4">Stage</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Last sent</th>
                </tr>
              </thead>
              <tbody>
                {sequences.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 text-on-surface">
                    <td className="py-2 pr-4">{s.orgName ?? s.orgId}</td>
                    <td className="py-2 pr-4">{s.invoiceNumber}</td>
                    <td className="py-2 pr-4">{s.currentStage}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs ${
                          STATUS_STYLES[s.status] ?? 'bg-white/10 text-on-surface/70'
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{formatDate(s.lastSentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Overdue invoices not yet in a sequence */}
      <section className="pib-card p-5 space-y-4">
        <h2 className="text-lg font-semibold text-on-surface">Overdue — not yet in a sequence</h2>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : overdue.length === 0 ? (
          <p className="text-sm text-on-surface/60">
            No overdue invoices waiting. Run dunning to start sequences for any that appear.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-on-surface/50 border-b border-white/10">
                  <th className="py-2 pr-4">Org</th>
                  <th className="py-2 pr-4">Invoice</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2 pr-4">Due</th>
                  <th className="py-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((inv) => (
                  <tr key={inv.id} className="border-b border-white/5 text-on-surface">
                    <td className="py-2 pr-4">{inv.orgName ?? inv.orgId}</td>
                    <td className="py-2 pr-4">{inv.invoiceNumber}</td>
                    <td className="py-2 pr-4">{money(inv.total, inv.currency)}</td>
                    <td className="py-2 pr-4">{formatDate(inv.dueDateMs)}</td>
                    <td className="py-2 pr-4">{inv.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-on-surface/50">{label}</div>
      <div className="text-base font-semibold text-on-surface">{value}</div>
    </div>
  )
}
