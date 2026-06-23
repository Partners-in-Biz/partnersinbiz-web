'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type RecipientSource = 'all_users' | 'by_role' | 'by_org'

interface BroadcastRow {
  id: string
  subject: string
  status: string
  recipientDescription: string
  recipientCount: number
  sentCount: number
  failedCount: number
  suppressedCount: number
  scheduledFor: string | null
  sentAt: string | null
  createdAt: string | null
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

const MERGE_TAGS = ['{{firstName}}', '{{name}}', '{{email}}']

const STATUS_CLS: Record<string, string> = {
  sent: 'bg-green-500/10 text-green-400',
  sending: 'bg-sky-500/10 text-sky-400',
  scheduled: 'bg-amber-500/10 text-amber-400',
  draft: 'bg-on-surface/10 text-on-surface-variant',
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function EmailBroadcastPage() {
  const [history, setHistory] = useState<BroadcastRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [subject, setSubject] = useState('')
  const [html, setHtml] = useState('<p>Hi {{firstName}},</p>\n<p>...</p>')
  const [source, setSource] = useState<RecipientSource>('all_users')
  const [role, setRole] = useState('client')
  const [orgId, setOrgId] = useState('')

  const [count, setCount] = useState<number | null>(null)
  const [countDesc, setCountDesc] = useState('')
  const [counting, setCounting] = useState(false)

  const [testTo, setTestTo] = useState('')
  const [sendingTest, setSendingTest] = useState(false)
  const [showPreview, setShowPreview] = useState(true)

  const [scheduledFor, setScheduledFor] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/admin/email/broadcast')
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to load history')
      setHistory((body.data ?? []) as BroadcastRow[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const refreshCount = useCallback(async () => {
    setCounting(true)
    setCount(null)
    try {
      const params = new URLSearchParams({ count: '1', source })
      if (source === 'by_role') params.set('role', role)
      if (source === 'by_org') params.set('orgId', orgId)
      const res = await fetch(`/api/v1/admin/email/broadcast?${params.toString()}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to count')
      setCount(body.data.count)
      setCountDesc(body.data.description)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to count recipients')
    } finally {
      setCounting(false)
    }
  }, [source, role, orgId])

  // Recompute the live count whenever the audience selector changes.
  useEffect(() => {
    if (source === 'by_org' && !orgId.trim()) {
      setCount(null)
      return
    }
    refreshCount()
  }, [source, role, orgId, refreshCount])

  function buildFilter() {
    const f: { source: RecipientSource; role?: string; orgId?: string } = { source }
    if (source === 'by_role') f.role = role
    if (source === 'by_org') f.orgId = orgId.trim()
    return f
  }

  async function sendTest() {
    if (!testTo.trim()) return
    setSendingTest(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/v1/admin/email/test-send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: testTo.trim(), subject, html }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Test send failed')
      setNotice(`Test sent to ${testTo.trim()} via ${body.data.provider}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test send failed')
    } finally {
      setSendingTest(false)
    }
  }

  async function submit(mode: 'send' | 'schedule') {
    if (!subject.trim() || !html.trim()) {
      setError('Subject and content are required.')
      return
    }
    if (mode === 'send' && !confirm(`Send this broadcast now to ${count ?? '?'} recipients?`)) return
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const payload: Record<string, unknown> = {
        subject: subject.trim(),
        html,
        recipientFilter: buildFilter(),
        mode,
      }
      if (mode === 'schedule') payload.scheduledFor = scheduledFor
      const res = await fetch('/api/v1/admin/email/broadcast', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to submit broadcast')
      const d = body.data
      setNotice(
        d.status === 'sent'
          ? `Broadcast sent: ${d.sentCount} delivered, ${d.failedCount ?? 0} failed, ${d.suppressedCount ?? 0} suppressed.`
          : d.note ?? `Broadcast recorded as ${d.status}.`,
      )
      await loadHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit broadcast')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Platform / Email
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Platform Broadcast</h1>
          <p className="text-sm text-on-surface-variant mt-0.5 max-w-2xl">
            Send a one-off email to platform users. Target by audience, preview with merge tags, send
            a test, then dispatch now or schedule.
          </p>
        </div>
        <Link href="/admin/email" className="pib-btn-ghost text-sm font-label self-start md:self-auto">
          Back to deliverability
        </Link>
      </div>

      {error && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">{error}</div>
      )}
      {notice && (
        <div className="pib-card border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-400">{notice}</div>
      )}

      <div className="pib-card p-5 space-y-4">
        {/* Audience */}
        <div>
          <p className="text-xs font-label uppercase tracking-wide text-on-surface-variant mb-2">Audience</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-[11px] text-on-surface-variant">Source</span>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as RecipientSource)}
                className="pib-input w-full mt-1"
              >
                <option value="all_users">All platform users</option>
                <option value="by_role">By role</option>
                <option value="by_org">By organisation</option>
              </select>
            </label>
            {source === 'by_role' && (
              <label className="block">
                <span className="text-[11px] text-on-surface-variant">Role</span>
                <select value={role} onChange={(e) => setRole(e.target.value)} className="pib-input w-full mt-1">
                  <option value="client">client</option>
                  <option value="admin">admin</option>
                  <option value="ai">ai</option>
                  <option value="guest">guest</option>
                </select>
              </label>
            )}
            {source === 'by_org' && (
              <label className="block">
                <span className="text-[11px] text-on-surface-variant">Org ID</span>
                <input
                  type="text"
                  value={orgId}
                  onChange={(e) => setOrgId(e.target.value)}
                  placeholder="org_xxx"
                  className="pib-input w-full mt-1 font-mono"
                />
              </label>
            )}
            <div className="flex items-end">
              <div className="pib-card w-full p-3 bg-[var(--color-surface-container)]">
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                  Live recipients
                </p>
                <p className="text-xl font-headline font-bold text-on-surface">
                  {counting ? '…' : count ?? '—'}
                </p>
                {countDesc && <p className="text-[11px] text-on-surface-variant">{countDesc}</p>}
              </div>
            </div>
          </div>
        </div>

        {/* Subject + editor */}
        <label className="block">
          <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">Subject</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Your subject line"
            className="pib-input w-full mt-1"
          />
        </label>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
              HTML content
            </span>
            <div className="flex items-center gap-2">
              {MERGE_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setHtml((h) => h + ' ' + tag)}
                  className="text-[11px] font-mono px-2 py-0.5 rounded bg-on-surface/10 text-on-surface-variant hover:text-on-surface"
                >
                  {tag}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowPreview((s) => !s)}
                className="text-[11px] font-label text-on-surface-variant hover:text-on-surface"
              >
                {showPreview ? 'Hide preview' : 'Show preview'}
              </button>
            </div>
          </div>
          <div className={`grid gap-3 ${showPreview ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
            <textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              className="pib-input w-full font-mono text-xs min-h-[260px]"
              rows={14}
            />
            {showPreview && (
              <iframe
                title="preview"
                className="w-full min-h-[260px] rounded-md border border-[var(--color-card-border)] bg-white"
                sandbox=""
                srcDoc={html}
              />
            )}
          </div>
        </div>

        {/* Test send */}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <label className="block flex-1">
            <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
              Send a test to
            </span>
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@example.com"
              className="pib-input w-full mt-1"
            />
          </label>
          <button onClick={sendTest} disabled={sendingTest} className="pib-btn-secondary text-sm font-label">
            {sendingTest ? 'Sending…' : 'Send test'}
          </button>
        </div>

        {/* Schedule + send */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end border-t border-[var(--color-card-border)] pt-4">
          <label className="block flex-1">
            <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
              Schedule for (optional)
            </span>
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="pib-input w-full mt-1"
            />
          </label>
          <button
            onClick={() => submit('schedule')}
            disabled={submitting || !scheduledFor}
            className="pib-btn-secondary text-sm font-label"
          >
            Schedule
          </button>
          <button onClick={() => submit('send')} disabled={submitting} className="pib-btn-primary text-sm font-label">
            {submitting ? 'Working…' : 'Send now'}
          </button>
        </div>
      </div>

      {/* History */}
      <div className="pib-card p-5">
        <h2 className="text-lg font-headline font-bold text-on-surface mb-3">History</h2>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No broadcasts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant border-b border-[var(--color-card-border)]">
                  <th className="py-2 pr-3">Subject</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Audience</th>
                  <th className="py-2 pr-3">Recipients</th>
                  <th className="py-2 pr-3">Sent</th>
                  <th className="py-2 pr-3">When</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.id} className="border-b border-[var(--color-card-border)]/50">
                    <td className="py-2 pr-3 text-on-surface max-w-[220px] truncate">{b.subject}</td>
                    <td className="py-2 pr-3">
                      <span className={`text-[11px] font-label px-2 py-0.5 rounded-full ${STATUS_CLS[b.status] ?? 'bg-on-surface/10 text-on-surface-variant'}`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-on-surface-variant text-xs">{b.recipientDescription}</td>
                    <td className="py-2 pr-3 text-on-surface-variant text-xs">{b.recipientCount}</td>
                    <td className="py-2 pr-3 text-on-surface-variant text-xs">
                      {b.sentCount}
                      {b.suppressedCount ? ` (${b.suppressedCount} sup)` : ''}
                    </td>
                    <td className="py-2 pr-3 text-on-surface-variant text-xs whitespace-nowrap">
                      {fmtTime(b.sentAt ?? b.scheduledFor ?? b.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
