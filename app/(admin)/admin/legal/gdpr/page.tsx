'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import { DialogDrawer, EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import {
  Button,
  ButtonLink,
  DataItem,
  DataList,
  Field,
  Input,
  Notice,
  Panel,
  Select,
  Skeleton,
  Status,
  Textarea,
  Toolbar,
} from '@/components/studio'

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

function statusTone(status: string): 'info' | 'warning' | 'success' | 'danger' {
  if (status === 'open') return 'info'
  if (status === 'in_progress') return 'warning'
  if (status === 'completed') return 'success'
  return 'danger'
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

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    if (selected) setEditNotes(selected.notes ?? '')
  }, [selected])

  async function createDSR() {
    if (!newEmail.trim()) {
      setError('Subject email is required')
      return
    }
    setBusy(true)
    setError(null)
    setFeedback(null)
    try {
      const res = await fetch('/api/v1/admin/legal/gdpr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: newType,
          subjectEmail: newEmail.trim(),
          orgId: newOrgId.trim() || undefined,
          notes: newNotes.trim(),
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Create failed')
      const data = body.data ?? body
      setFeedback('DSR created')
      setNewEmail('')
      setNewOrgId('')
      setNewNotes('')
      await load()
      setSelectedId(data.request?.id ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function updateStatus(status: string) {
    if (!selected) return
    setBusy(true)
    setError(null)
    setFeedback(null)
    try {
      const res = await fetch(`/api/v1/admin/legal/gdpr/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
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
    setBusy(true)
    setError(null)
    setFeedback(null)
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
    setBusy(true)
    setError(null)
    setFeedback(null)
    try {
      const res = await fetch(`/api/v1/admin/legal/gdpr/${selected.id}/erase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Erase failed')
      const data = body.data ?? body
      setFeedback(
        `Erased ${data.erased?.users ?? 0} user record(s); ${data.erased?.skippedAdmins ?? 0} admin record(s) preserved`,
      )
      setShowErase(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erase failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        eyebrow="Legal"
        title="GDPR data-subject requests."
        description="Manage access, erasure, portability and rectification requests. Audit logs are retained for 3 years."
      />

      {feedback ? <Notice tone="success">{feedback}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Panel className="space-y-4">
        <p className="sc-tiny">New request</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field id="dsr-type" label="Type">
            <Select aria-label="Type" id="dsr-type" value={newType} onChange={(e) => setNewType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field id="dsr-email" label="Subject email">
              <Input aria-label="Subject email" id="dsr-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="person@example.com"
              />
            </Field>
          </div>
          <Field id="dsr-org" label="Org ID (optional)">
            <Input aria-label="Org ID (optional)" id="dsr-org" value={newOrgId} onChange={(e) => setNewOrgId(e.target.value)} className="font-mono" />
          </Field>
          <div className="md:col-span-2">
            <Field id="dsr-notes" label="Notes">
              <Input aria-label="Notes" id="dsr-notes" value={newNotes} onChange={(e) => setNewNotes(e.target.value)} />
            </Field>
          </div>
        </div>
        <Button type="button" disabled={busy} onClick={createDSR}>
          Create request
        </Button>
      </Panel>

      <Toolbar>
        <Select
          aria-label="Filter by status"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </Select>
        <Select aria-label="Filter by type" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </Toolbar>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        <Panel className="space-y-4 lg:col-span-2">
          <p className="sc-tiny">Request queue</p>
          {loading ? (
            <Skeleton height="6rem" />
          ) : requests.length === 0 ? (
            <EmptyState title="No requests." description="Create a data-subject request to begin." />
          ) : (
            requests.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={`w-full rounded-[6px] border p-4 text-left transition-colors ${
                  selectedId === r.id
                    ? 'border-[var(--sc-accent)] bg-[color-mix(in_srgb,var(--sc-ink)_4%,transparent)]'
                    : 'border-[var(--sc-line)] hover:border-[var(--sc-line-strong)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="sc-body text-[var(--sc-ink)]">{r.type}</span>
                  <Status tone={statusTone(r.status)}>{r.status.replace('_', ' ')}</Status>
                </div>
                <p className="sc-tiny mt-1 truncate">{r.subjectEmail}</p>
              </button>
            ))
          )}
        </Panel>

        <Panel className="space-y-4 lg:col-span-3">
          <p className="sc-tiny">Request detail</p>
          {!selected ? (
            <EmptyState title="Select a request." description="Pick a request to view detail." />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="sc-body text-[var(--sc-ink)]">{selected.subjectEmail}</span>
                <Status tone={statusTone(selected.status)}>{selected.status.replace('_', ' ')}</Status>
              </div>
              <DataList>
                <DataItem label="Type">{selected.type}</DataItem>
                {selected.orgId ? <DataItem label="Org"><span className="font-mono text-xs">{selected.orgId}</span></DataItem> : null}
                {selected.requestedAt ? (
                  <DataItem label="Requested">
                    <span className="st-num">{String(selected.requestedAt).slice(0, 19).replace('T', ' ')}</span>
                  </DataItem>
                ) : null}
              </DataList>

              <Field id="dsr-edit-notes" label="Notes">
                <Textarea aria-label="Notes" id="dsr-edit-notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} />
              </Field>
              <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={saveNotes}>
                Save notes
              </Button>

              <Toolbar>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => updateStatus('in_progress')}>
                  Mark in progress
                </Button>
                <Button type="button" disabled={busy} onClick={() => updateStatus('completed')}>
                  Mark completed
                </Button>
                <Button type="button" variant="danger" disabled={busy} onClick={() => updateStatus('rejected')}>
                  Reject
                </Button>
              </Toolbar>

              <Toolbar>
                <ButtonLink href={`/api/v1/admin/legal/gdpr/${selected.id}/export?format=json`} variant="ghost" size="sm">
                  Export data (JSON)
                </ButtonLink>
                <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => setShowErase(true)}>
                  Erase subject data
                </Button>
              </Toolbar>

              <div className="space-y-2 border-t border-[var(--sc-line)] pt-4">
                <p className="sc-tiny">Audit log (3-year retention)</p>
                {!selected.log || selected.log.length === 0 ? (
                  <p className="sc-body text-[var(--sc-ink-soft)]">No log entries.</p>
                ) : (
                  <ul className="space-y-2">
                    {[...selected.log].reverse().map((entry, i) => (
                      <li key={i} className="rounded-[6px] border border-[var(--sc-line)] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="sc-body text-[var(--sc-ink)]">{entry.action}</span>
                          <span className="st-num sc-tiny">
                            {entry.at ? String(entry.at).slice(0, 19).replace('T', ' ') : ''}
                          </span>
                        </div>
                        <p className="sc-tiny mt-1">{entry.detail}</p>
                        {entry.actor?.uid ? (
                          <p className="sc-tiny mt-1 font-mono">
                            by {entry.actor.uid} ({entry.actor.role})
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </Panel>
      </div>

      <DialogDrawer
        open={showErase && Boolean(selected)}
        title="Confirm erasure."
        description={
          selected
            ? `This permanently scrubs PII from non-admin users matching ${selected.subjectEmail}, marks the request completed, and writes an immutable audit log entry. Admin accounts are preserved. This cannot be undone.`
            : ''
        }
        onClose={() => setShowErase(false)}
        footer={
          <Toolbar>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setShowErase(false)}>
              Cancel
            </Button>
            <Button type="button" variant="danger" disabled={busy} onClick={confirmErase}>
              Erase now
            </Button>
          </Toolbar>
        }
      />
    </div>
  )
}
