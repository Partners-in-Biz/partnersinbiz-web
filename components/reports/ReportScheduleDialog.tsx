'use client'

import { useEffect, useState } from 'react'
import type { ReportsWorkspaceReport } from './ReportsWorkspace'
import { REPORT_EMAIL_TEMPLATES } from '@/lib/reports/templates'

interface Schedule {
  id: string
  name: string
  cadence: 'weekly' | 'monthly' | 'quarterly'
  category: string
  type: string
  recipients: string[]
  template: string
  status: 'active' | 'paused'
  nextSendAt: string
  lastSentAt: string | null
  unsubscribed: string[]
  sourceReportId?: string | null
}

interface Props {
  report: ReportsWorkspaceReport
  orgId: string | null
  onClose: () => void
  onMutated?: () => void
}

const CADENCES = ['weekly', 'monthly', 'quarterly'] as const

export function ReportScheduleDialog({ report, orgId, onClose, onMutated }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // New-schedule form
  const [name, setName] = useState(report.brand?.orgName ? `${report.brand.orgName} report` : 'Scheduled report')
  const [cadence, setCadence] = useState<(typeof CADENCES)[number]>('monthly')
  const [recipients, setRecipients] = useState('')
  const [template, setTemplate] = useState(REPORT_EMAIL_TEMPLATES[0].id)

  function api(path: string) {
    return orgId ? `${path}${path.includes('?') ? '&' : '?'}orgId=${encodeURIComponent(orgId)}` : path
  }

  async function refresh() {
    const b = await fetch(api('/api/v1/reports/schedules')).then((r) => r.json())
    setSchedules(b.schedules ?? [])
    setLoading(false)
  }

  useEffect(() => {
    refresh().catch(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createSchedule() {
    const recips = recipients.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean)
    setBusy(true)
    try {
      await fetch(api('/api/v1/reports/schedules'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orgId,
          name,
          cadence,
          category: report.category ?? 'monthly',
          type: report.type,
          recipients: recips,
          template,
          sourceReportId: report.id,
        }),
      })
      setRecipients('')
      await refresh()
      onMutated?.()
    } finally {
      setBusy(false)
    }
  }

  async function patchSchedule(id: string, patch: Partial<Schedule>) {
    setBusy(true)
    try {
      await fetch(api(`/api/v1/reports/schedules/${id}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      await refresh()
      onMutated?.()
    } finally {
      setBusy(false)
    }
  }

  async function removeSchedule(id: string) {
    setBusy(true)
    try {
      await fetch(api(`/api/v1/reports/schedules/${id}`), { method: 'DELETE' })
      await refresh()
      onMutated?.()
    } finally {
      setBusy(false)
    }
  }

  async function sendNow(id: string) {
    setBusy(true)
    try {
      await fetch(api(`/api/v1/reports/schedules/${id}/send-now`), { method: 'POST' })
      await refresh()
      onMutated?.()
    } finally {
      setBusy(false)
    }
  }

  async function unsubscribe(id: string, email: string) {
    setBusy(true)
    try {
      await fetch(api(`/api/v1/reports/schedules/${id}/unsubscribe`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div className="bento-card !p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-6" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between">
          <h2 className="font-display text-xl">Report scheduling</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {/* Existing schedules */}
        {loading ? (
          <div className="pib-skeleton h-24" />
        ) : schedules.length === 0 ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">No schedules yet. Create one below.</p>
        ) : (
          <div className="space-y-3">
            {schedules.map((s) => (
              <div key={s.id} className="pib-card !p-4 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[var(--color-pib-accent)] text-base">schedule</span>
                    <span className="font-medium text-sm">{s.name}</span>
                    <span className={`pib-pill !text-[10px] ${s.status === 'active' ? 'pib-pill-success' : ''}`}>{s.status}</span>
                  </div>
                  <span className="text-xs font-mono text-[var(--color-pib-text-muted)]">
                    {s.cadence} · next {s.nextSendAt}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-pib-text-muted)] font-mono">
                  Template {s.template} · {s.recipients.length} recipient{s.recipients.length === 1 ? '' : 's'}
                  {s.lastSentAt ? ` · last sent ${s.lastSentAt.slice(0, 10)}` : ''}
                </p>
                {s.recipients.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {s.recipients.map((r) => (
                      <span key={r} className="pib-pill !text-[10px] inline-flex items-center gap-1">
                        {r}
                        <button type="button" onClick={() => unsubscribe(s.id, r)} aria-label={`Unsubscribe ${r}`} title="Unsubscribe">
                          <span className="material-symbols-outlined text-[12px] leading-none">close</span>
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => patchSchedule(s.id, { status: s.status === 'active' ? 'paused' : 'active' })}
                    className="btn-pib-secondary !py-1.5 !px-3 !text-xs"
                  >
                    {s.status === 'active' ? 'Pause' : 'Resume'}
                  </button>
                  <button type="button" disabled={busy} onClick={() => sendNow(s.id)} className="btn-pib-secondary !py-1.5 !px-3 !text-xs">
                    Send now
                  </button>
                  <select
                    value={s.cadence}
                    disabled={busy}
                    onChange={(e) => patchSchedule(s.id, { cadence: e.target.value as Schedule['cadence'] })}
                    className="pib-input !py-1.5 !px-2 !text-xs"
                  >
                    {CADENCES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    value={s.template}
                    disabled={busy}
                    onChange={(e) => patchSchedule(s.id, { template: e.target.value })}
                    className="pib-input !py-1.5 !px-2 !text-xs"
                  >
                    {REPORT_EMAIL_TEMPLATES.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removeSchedule(s.id)}
                    className="btn-pib-secondary !py-1.5 !px-3 !text-xs !text-rose-300 !border-rose-400/40 ml-auto"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <hr className="border-white/10" />

        {/* New schedule */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">New schedule</h3>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Schedule name" className="pib-input !text-sm w-full" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-[var(--color-pib-text-muted)] mb-1">Cadence</label>
              <select value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)} className="pib-input !text-sm w-full">
                {CADENCES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-[var(--color-pib-text-muted)] mb-1">Template</label>
              <select value={template} onChange={(e) => setTemplate(e.target.value)} className="pib-input !text-sm w-full">
                {REPORT_EMAIL_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          <textarea
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="Recipient emails, comma-separated"
            rows={2}
            className="pib-input !text-sm w-full"
          />
          <button type="button" disabled={busy} onClick={createSchedule} className="btn-pib-accent !py-2 !px-4 !text-sm disabled:opacity-60">
            {busy ? 'Saving...' : 'Create schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}
