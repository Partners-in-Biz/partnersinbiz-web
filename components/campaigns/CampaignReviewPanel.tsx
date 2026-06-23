'use client'

// US-105 — Review + send/schedule panel. Surfaced as a slide-over from the
// editor. Shows computed recipient count (real API), a deliverability score,
// unsubscribe-link presence, a "Send now" action (launch endpoint), and a
// datetime + timezone scheduler with a live countdown + cancel.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EmailDocument } from '@/lib/email-builder/types'

interface RecipientInfo {
  count: number
  beforeExclusions: number
  excluded: number
  source: string
}

interface Props {
  campaignId: string
  orgId: string
  doc: EmailDocument
  subject: string
  status: string
  scheduledAtIso: string | null
  hasVerifiedDomain: boolean
  onClose: () => void
  // Called after a state change (launch/schedule/cancel) so the parent can
  // refresh. Receives the new status.
  onStatusChange: (status: string) => void
  doneHref: string
}

const TIMEZONES = [
  'Africa/Johannesburg',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Australia/Sydney',
  'UTC',
]

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if ('data' in b) return (b.data as T) ?? null
    return b as unknown as T
  }
  return null
}

// Heuristic deliverability score 0–100. Pure presentational signal built from
// document structure + sender config — not a guarantee, an at-a-glance check.
function computeDeliverability(doc: EmailDocument, subject: string, hasUnsub: boolean, hasVerifiedDomain: boolean) {
  let score = 100
  const issues: string[] = []
  if (!subject.trim()) {
    score -= 25
    issues.push('Subject line is empty.')
  } else if (subject.length > 90) {
    score -= 8
    issues.push('Subject is long — aim for under 60 characters.')
  }
  if (!doc.preheader?.trim()) {
    score -= 8
    issues.push('No preview text set.')
  }
  if (!hasUnsub) {
    score -= 30
    issues.push('No unsubscribe link — add a footer block.')
  }
  if (!hasVerifiedDomain) {
    score -= 12
    issues.push('Sending from the shared domain. A verified domain improves inbox placement.')
  }
  const textLen = JSON.stringify(doc.blocks).length
  if (textLen < 200) {
    score -= 10
    issues.push('Very little content — may look thin to spam filters.')
  }
  const imageBlocks = doc.blocks.filter((b) => b.type === 'image' || b.type === 'hero').length
  const textBlocks = doc.blocks.filter((b) => b.type === 'paragraph' || b.type === 'heading').length
  if (imageBlocks > 0 && textBlocks === 0) {
    score -= 15
    issues.push('Image-only emails are flagged by spam filters — add some text.')
  }
  return { score: Math.max(0, Math.min(100, score)), issues }
}

function hasUnsubscribe(doc: EmailDocument): boolean {
  return doc.blocks.some(
    (b) =>
      b.type === 'footer' &&
      typeof (b.props as { unsubscribeUrl?: string }).unsubscribeUrl === 'string' &&
      (b.props as { unsubscribeUrl?: string }).unsubscribeUrl!.length > 0,
  )
}

export function CampaignReviewPanel({
  campaignId,
  orgId,
  doc,
  subject,
  status,
  scheduledAtIso,
  hasVerifiedDomain,
  onClose,
  onStatusChange,
  doneHref,
}: Props) {
  const router = useRouter()
  const [recipients, setRecipients] = useState<RecipientInfo | null>(null)
  const [loadingRecipients, setLoadingRecipients] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [scheduleLocal, setScheduleLocal] = useState('')
  const [timezone, setTimezone] = useState('Africa/Johannesburg')
  const [now, setNow] = useState(() => Date.now())

  const unsub = useMemo(() => hasUnsubscribe(doc), [doc])
  const deliverability = useMemo(
    () => computeDeliverability(doc, subject, unsub, hasVerifiedDomain),
    [doc, subject, unsub, hasVerifiedDomain],
  )

  const orgQuery = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''

  const loadRecipients = useCallback(async () => {
    setLoadingRecipients(true)
    try {
      const res = await fetch(`/api/v1/campaigns/${campaignId}/recipients${orgQuery}`)
      const body = await res.json().catch(() => null)
      const data = unwrap<RecipientInfo>(body)
      if (res.ok && data) setRecipients(data)
    } finally {
      setLoadingRecipients(false)
    }
  }, [campaignId, orgQuery])

  useEffect(() => {
    loadRecipients()
  }, [loadRecipients])

  // Live countdown ticker
  useEffect(() => {
    if (status !== 'scheduled' || !scheduledAtIso) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [status, scheduledAtIso])

  const countdown = useMemo(() => {
    if (!scheduledAtIso) return null
    const target = new Date(scheduledAtIso).getTime()
    const diff = target - now
    if (diff <= 0) return 'Sending now…'
    const s = Math.floor(diff / 1000)
    const days = Math.floor(s / 86400)
    const hours = Math.floor((s % 86400) / 3600)
    const mins = Math.floor((s % 3600) / 60)
    const secs = s % 60
    const parts: string[] = []
    if (days) parts.push(`${days}d`)
    if (hours || days) parts.push(`${hours}h`)
    parts.push(`${mins}m`)
    parts.push(`${secs}s`)
    return parts.join(' ')
  }, [scheduledAtIso, now])

  async function sendNow() {
    if (!confirm('Send this campaign now? This enrols every recipient immediately.')) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/v1/campaigns/${campaignId}/launch`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError((body && (body.error as string)) || 'Failed to send.')
        return
      }
      const data = unwrap<{ enrolled?: number }>(body)
      setMessage(`Campaign launched — ${data?.enrolled ?? 0} contacts enrolled.`)
      onStatusChange('active')
      setTimeout(() => router.push(doneHref), 1200)
    } finally {
      setBusy(false)
    }
  }

  async function schedule() {
    if (!scheduleLocal) {
      setError('Pick a date and time first.')
      return
    }
    const scheduledAt = new Date(scheduleLocal)
    if (isNaN(scheduledAt.getTime())) {
      setError('Invalid date/time.')
      return
    }
    if (scheduledAt.getTime() <= Date.now()) {
      setError('Scheduled time must be in the future.')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/v1/campaigns/${campaignId}/schedule-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: scheduledAt.toISOString(), timezone }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError((body && (body.error as string)) || 'Failed to schedule.')
        return
      }
      setMessage(`Scheduled for ${scheduledAt.toLocaleString()}.`)
      onStatusChange('scheduled')
    } finally {
      setBusy(false)
    }
  }

  async function cancelSchedule() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/v1/campaigns/${campaignId}/schedule-email`, { method: 'DELETE' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError((body && (body.error as string)) || 'Failed to cancel.')
        return
      }
      setMessage('Schedule cancelled — back to draft.')
      onStatusChange('draft')
    } finally {
      setBusy(false)
    }
  }

  const scoreColor =
    deliverability.score >= 80 ? '#4ADE80' : deliverability.score >= 55 ? '#FBBF24' : '#F87171'

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-md bg-[var(--color-pib-surface)] border-l border-[var(--color-pib-line)] overflow-y-auto"
      >
        <div className="sticky top-0 bg-[var(--color-pib-surface)] border-b border-[var(--color-pib-line)] px-5 py-4 flex items-center justify-between z-10">
          <h2 className="font-headline text-xl">Review &amp; send</h2>
          <button onClick={onClose} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-5 space-y-6">
          {message && (
            <div className="pib-card !p-3 border border-emerald-500/40 bg-emerald-500/5 text-sm text-emerald-300">
              {message}
            </div>
          )}
          {error && (
            <div className="pib-card !p-3 border border-rose-500/40 bg-rose-500/5 text-sm text-rose-300">
              {error}
            </div>
          )}

          {/* Recipients */}
          <section className="pib-card space-y-2">
            <p className="eyebrow !text-[10px]">Recipients</p>
            {loadingRecipients ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">Resolving audience…</p>
            ) : recipients ? (
              <>
                <p className="font-display text-4xl tabular-nums leading-none">{recipients.count.toLocaleString()}</p>
                <p className="text-xs text-[var(--color-pib-text-muted)]">
                  From {recipients.source}
                  {recipients.excluded > 0 ? ` · ${recipients.excluded} excluded` : ''}
                </p>
              </>
            ) : (
              <p className="text-sm text-[var(--color-pib-text-muted)]">Could not resolve recipient count.</p>
            )}
          </section>

          {/* Deliverability */}
          <section className="pib-card space-y-3">
            <div className="flex items-center justify-between">
              <p className="eyebrow !text-[10px]">Deliverability score</p>
              <span className="font-display text-2xl tabular-nums" style={{ color: scoreColor }}>
                {deliverability.score}
              </span>
            </div>
            <div className="h-2 rounded-full bg-[var(--color-pib-surface-2)] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${deliverability.score}%`, background: scoreColor }} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm">
                <span
                  className="material-symbols-outlined text-[18px]"
                  style={{ color: unsub ? '#4ADE80' : '#F87171' }}
                >
                  {unsub ? 'check_circle' : 'cancel'}
                </span>
                <span className="text-[var(--color-pib-text-muted)]">
                  {unsub ? 'Unsubscribe link present' : 'No unsubscribe link (required)'}
                </span>
              </div>
              {deliverability.issues.map((issue, i) => (
                <p key={i} className="text-xs text-amber-300/90 pl-6">• {issue}</p>
              ))}
              {deliverability.issues.length === 0 && (
                <p className="text-xs text-emerald-300/90 pl-6">Looks great — no issues found.</p>
              )}
            </div>
          </section>

          {/* Send now */}
          <section className="pib-card space-y-3">
            <p className="eyebrow !text-[10px]">Send now</p>
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              Launches immediately and enrols every recipient.
            </p>
            <button
              onClick={sendNow}
              disabled={busy || status === 'active' || status === 'completed' || !unsub}
              className="btn-pib-primary w-full justify-center disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-base">send</span>
              {status === 'active' ? 'Already sent' : 'Send now'}
            </button>
            {!unsub && (
              <p className="text-xs text-rose-300">Add a footer block with an unsubscribe link before sending.</p>
            )}
          </section>

          {/* Schedule */}
          <section className="pib-card space-y-3">
            <p className="eyebrow !text-[10px]">Schedule</p>
            {status === 'scheduled' && scheduledAtIso ? (
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-[var(--color-pib-text)]">
                    Scheduled for {new Date(scheduledAtIso).toLocaleString()}
                  </p>
                  <p className="font-display text-2xl tabular-nums mt-1" style={{ color: 'var(--color-pib-accent)' }}>
                    {countdown}
                  </p>
                </div>
                <button onClick={cancelSchedule} disabled={busy} className="btn-pib-secondary w-full justify-center disabled:opacity-50">
                  Cancel schedule
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="datetime-local"
                  value={scheduleLocal}
                  onChange={(e) => setScheduleLocal(e.target.value)}
                  className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded-md px-3 py-2 text-sm text-[var(--color-pib-text)]"
                />
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded-md px-3 py-2 text-sm text-[var(--color-pib-text)]"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
                <button
                  onClick={schedule}
                  disabled={busy || !unsub}
                  className="btn-pib-secondary w-full justify-center disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-base">schedule_send</span>
                  Schedule send
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
