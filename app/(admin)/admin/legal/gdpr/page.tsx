'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface LogEntry {
  at?: string
  actor?: { uid?: string; role?: string }
  action?: string
  detail?: string
}

interface DSR {
  id: string
  type: 'access' | 'erasure' | 'portability' | 'rectification'
  subjectEmail: string
  orgId?: string | null
  status: 'open' | 'in_progress' | 'completed' | 'rejected'
  notes?: string
  requestedAt?: string
  completedAt?: string | null
  handledBy?: { uid?: string } | null
  log?: LogEntry[]
}

const TYPES = ['access', 'erasure', 'portability', 'rectification'] as const
const STATUSES = ['open', 'in_progress', 'completed', 'rejected'] as const

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    in_progress: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    completed: 'bg-green-500/10 text-green-400 border-green-500/20',
    rejected: 'bg-red-500/10 text-red-300 border-red-500/20',
  }
  return (
    <span className={`text-[10px] font-label uppercase tracking-widest px-2.5 py-1 rounded-full border ${map[status] ?? map.open}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

export default function GdprPage() {
  const [requests, setRequests] = useState<DSR[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterType, setFilterType] = useState<string>('')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newType, setNewType] = useState<string>('access')
  const [newEmail, setNewEmail] = useState('')
  const [newOrgId, setNewOrgId] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [showErase, setShowErase] = useState(false)

  const selected = useMemo(() => requests.find((r) => r.id === selectedId) ?? null, [requests, selectedId])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.set('status', filterStatus)
      if (filterType) params.set('type', filterType)
      const res = await fetch(`/api/v1/admin/legal/gdpr?${params.toString()}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to load')
      const data = body.data ?? body
      setRequests(data.requests ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load DSRs')
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterType])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (selected) setEditNotes(selected.notes ?? '') }, [selected])

  async function createDSR() {
    if (!newEmail.trim()) { setError('Subject email is required'); return }
    setBusy(true); setError(null); setFeedback(null)
    try {
      const res = await fetch('/api/v1/admin/legal/gdpr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: newType, subjectEmail: newEmail.trim(), orgId: newOrgId.trim() || undefined, notes: newNotes.trim() }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Create failed')
      const data = body.data ?? body
      setFeedback('DSR created')
      setNewEmail(''); setNewOrgId(''); setNewNotes('')
      await load()
      setSelectedId(data.request?.id ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function updateStatus(status: string, withNotes = false) {
    if (!selected) return
    setBusy(true); setError(null); setFeedback(null)
    try {
      const payload: Record<string, unknown> = { status }
      if (withNotes) payload.notes = editNotes
      const res = await fetch(`/api/v1/admin/legal/gdpr/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Update failed')
      setFeedback('Request updated')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  async function saveNotes() {
    if (!selected) return
    setBusy(true); setError(null); setFeedback(null)
    try {
      const res = await fetch(`/api/v1/admin/legal/gdpr/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: editNotes }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Save failed')
      setFeedback('Notes saved')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function confirmErase() {
    if (!selected) return
    setBusy(true); setError(null); setFeedback(null)
    try {
      const res = await fetch(`/api/v1/admin/legal/gdpr/${selected.id}/erase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Erase failed')
      const data = body.data ?? body
      setFeedback(`Erased ${data.erased?.users ?? 0} user record(s); ${data.erased?.skippedAdmins ?? 0} admin record(s) preserved`)
      setShowErase(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erase failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Legal</p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">GDPR Data-Subject Requests</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Manage access, erasure, portability and rectification requests. Audit logs are retained for 3 years.
        </p>
      </div>

      {feedback && <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-400">{feedback}</div>}
      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      {/* Create form */}
      <div className="pib-card space-y-3">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">New request</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-on-surface-variant">Type</span>
            <select value={newType} onChange={(e) => setNewType(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs text-on-surface-variant">Subject email</span>
            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="person@example.com"
              className="mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="block">
            <span className="text-xs text-on-surface-variant">Org ID (optional)</span>
            <input type="text" value={newOrgId} onChange={(e) => setNewOrgId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs text-on-surface-variant">Notes</span>
            <input type="text" value={newNotes} onChange={(e) => setNewNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface" />
          </label>
        </div>
        <button type="button" disabled={busy} onClick={createDSR}
          className="text-sm font-medium px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: 'var(--color-accent-v2)' }}>
          Create request
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-1.5 text-sm text-on-surface">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-1.5 text-sm text-on-surface">
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Queue */}
        <div className="lg:col-span-2 pib-card space-y-2">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-2">Request queue</p>
          {loading ? (
            <p className="text-sm text-on-surface-variant">Loading…</p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-on-surface-variant">No requests.</p>
          ) : (
            requests.map((r) => (
              <button key={r.id} type="button" onClick={() => setSelectedId(r.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedId === r.id ? 'border-[var(--color-accent-v2)] bg-[var(--color-surface-container)]' : 'border-[var(--color-card-border)] hover:bg-[var(--color-row-hover)]'
                }`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-on-surface">{r.type}</span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-xs text-on-surface-variant mt-1 truncate">{r.subjectEmail}</p>
              </button>
            ))
          )}
        </div>

        {/* Detail */}
        <div className="lg:col-span-3 pib-card space-y-3">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Request detail</p>
          {!selected ? (
            <p className="text-sm text-on-surface-variant">Select a request to view detail.</p>
          ) : (
            <>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-on-surface">{selected.subjectEmail}</span>
                  <StatusBadge status={selected.status} />
                </div>
                <p className="text-xs text-on-surface-variant">Type: {selected.type}{selected.orgId ? ` · Org: ${selected.orgId}` : ''}</p>
                {selected.requestedAt && <p className="text-[11px] text-on-surface-variant/70">Requested {String(selected.requestedAt).slice(0, 19).replace('T', ' ')}</p>}
              </div>

              <label className="block">
                <span className="text-xs text-on-surface-variant">Notes</span>
                <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3}
                  className="mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface" />
                <button type="button" disabled={busy} onClick={saveNotes}
                  className="mt-2 text-xs font-medium px-2.5 py-1 rounded-md border border-[var(--color-card-border)] text-on-surface hover:bg-[var(--color-surface-container)] disabled:opacity-50">
                  Save notes
                </button>
              </label>

              {/* Status workflow */}
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" disabled={busy} onClick={() => updateStatus('in_progress')}
                  className="text-sm font-medium px-3 py-1.5 rounded-lg border border-[var(--color-card-border)] text-on-surface hover:bg-[var(--color-surface-container)] disabled:opacity-50">Mark in progress</button>
                <button type="button" disabled={busy} onClick={() => updateStatus('completed')}
                  className="text-sm font-medium px-3 py-1.5 rounded-lg border border-green-500/30 text-green-300 hover:bg-green-500/10 disabled:opacity-50">Mark completed</button>
                <button type="button" disabled={busy} onClick={() => updateStatus('rejected')}
                  className="text-sm font-medium px-3 py-1.5 rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50">Reject</button>
              </div>

              {/* Export + Erase */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--color-card-border)]">
                <a href={`/api/v1/admin/legal/gdpr/${selected.id}/export?format=json`}
                  className="text-sm font-medium px-3 py-1.5 rounded-lg border border-[var(--color-card-border)] text-on-surface hover:bg-[var(--color-surface-container)]">
                  Export data (JSON)
                </a>
                <button type="button" disabled={busy} onClick={() => setShowErase(true)}
                  className="text-sm font-medium px-3 py-1.5 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                  Erase subject data
                </button>
              </div>

              {/* Audit log */}
              <div className="pt-3">
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-2">Audit log (3-year retention)</p>
                {!selected.log || selected.log.length === 0 ? (
                  <p className="text-xs text-on-surface-variant">No log entries.</p>
                ) : (
                  <ul className="space-y-2">
                    {[...selected.log].reverse().map((entry, i) => (
                      <li key={i} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-on-surface">{entry.action}</span>
                          <span className="text-[10px] text-on-surface-variant/70">{entry.at ? String(entry.at).slice(0, 19).replace('T', ' ') : ''}</span>
                        </div>
                        <p className="text-xs text-on-surface-variant mt-0.5">{entry.detail}</p>
                        {entry.actor?.uid && <p className="text-[10px] text-on-surface-variant/60 mt-0.5">by {entry.actor.uid} ({entry.actor.role})</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Erase confirm modal */}
      {showErase && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowErase(false)}>
          <div className="pib-card max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-headline font-bold text-on-surface">Confirm erasure</h2>
            <p className="text-sm text-on-surface-variant">
              This permanently scrubs PII (email, name) from all non-admin <code className="font-mono text-xs">users</code> records matching{' '}
              <span className="text-on-surface font-medium">{selected.subjectEmail}</span>, marks the request completed, and writes an immutable audit log entry. Admin accounts are preserved. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button type="button" disabled={busy} onClick={() => setShowErase(false)}
                className="text-sm font-medium px-3 py-1.5 rounded-lg border border-[var(--color-card-border)] text-on-surface hover:bg-[var(--color-surface-container)] disabled:opacity-50">Cancel</button>
              <button type="button" disabled={busy} onClick={confirmErase}
                className="text-sm font-medium px-3 py-1.5 rounded-lg text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">Erase now</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
