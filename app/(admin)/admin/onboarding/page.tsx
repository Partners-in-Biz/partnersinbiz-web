'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PageHeader,
  PageTabs,
  Surface,
  StatusPill,
  EmptyState,
  DialogDrawer,
} from '@/components/ui/AppFoundation'

type Status = 'new' | 'in_progress' | 'blocked' | 'complete'

interface InternalNote {
  id: string
  authorUid: string
  authorEmail: string
  body: string
  createdAt: string | null
}

interface Submission {
  id: string
  orgId: string | null
  businessName: string
  contactName: string
  contactEmail: string
  progress: number
  assignedAdminUid: string | null
  status: Status
  internalNotes: InternalNote[]
  product: string | null
  createdAt: string | null
  updatedAt: string | null
}

interface AdminOption {
  uid: string
  email: string
  displayName: string
}

const STATUS_TONE: Record<Status, 'info' | 'accent' | 'warn' | 'success'> = {
  new: 'info',
  in_progress: 'accent',
  blocked: 'warn',
  complete: 'success',
}
const STATUS_LABEL: Record<Status, string> = {
  new: 'New',
  in_progress: 'In progress',
  blocked: 'Blocked',
  complete: 'Complete',
}
const STATUSES: Status[] = ['new', 'in_progress', 'blocked', 'complete']

function unwrap<T>(body: unknown): T {
  const b = body as { data?: T }
  return (b?.data ?? body) as T
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-pib-line)]">
      <div className="h-full rounded-full bg-[var(--color-pib-accent)] transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

export default function OnboardingPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [admins, setAdmins] = useState<AdminOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'all' | Status>('all')
  const [toast, setToast] = useState('')

  const [selected, setSelected] = useState<Submission | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [saving, setSaving] = useState(false)

  // Email compose
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [sending, setSending] = useState(false)

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 3000)
  }, [])

  const adminName = useCallback((uid: string | null) => {
    if (!uid) return 'Unassigned'
    return admins.find((a) => a.uid === uid)?.displayName ?? uid
  }, [admins])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/admin/onboarding')
      const json = await res.json()
      if (!res.ok || json.success === false) throw new Error(json.error || 'Failed to load submissions')
      const data = unwrap<{ submissions: Submission[]; admins: AdminOption[] }>(json)
      setSubmissions(data.submissions ?? [])
      setAdmins(data.admins ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load submissions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(
    () => (tab === 'all' ? submissions : submissions.filter((s) => s.status === tab)),
    [submissions, tab],
  )

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: submissions.length }
    for (const s of STATUSES) c[s] = submissions.filter((x) => x.status === s).length
    return c
  }, [submissions])

  const patch = useCallback(async (id: string, payload: Record<string, unknown>) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/admin/onboarding/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || json.success === false) throw new Error(json.error || 'Update failed')
      const updated = unwrap<Submission>(json)
      setSubmissions((prev) => prev.map((s) => (s.id === id ? updated : s)))
      setSelected((cur) => (cur && cur.id === id ? updated : cur))
      return updated
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Update failed')
      return null
    } finally {
      setSaving(false)
    }
  }, [flash])

  const addNote = useCallback(async () => {
    if (!selected || !noteDraft.trim()) return
    const ok = await patch(selected.id, { note: noteDraft.trim() })
    if (ok) { setNoteDraft(''); flash('Note added') }
  }, [selected, noteDraft, patch, flash])

  const sendEmail = useCallback(async () => {
    if (!selected) return
    if (!emailSubject.trim() || !emailBody.trim()) { flash('Subject and body required'); return }
    setSending(true)
    try {
      const res = await fetch(`/api/v1/admin/onboarding/${selected.id}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: emailSubject.trim(), body: emailBody.trim() }),
      })
      const json = await res.json()
      if (!res.ok || json.success === false) throw new Error(json.error || 'Send failed')
      setEmailOpen(false)
      setEmailSubject('')
      setEmailBody('')
      flash('Email sent')
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }, [selected, emailSubject, emailBody, flash])

  const tabs = useMemo(() => [
    { label: 'All', value: 'all', badge: counts.all },
    ...STATUSES.map((s) => ({ label: STATUS_LABEL[s], value: s, badge: counts[s] })),
  ], [counts])

  return (
    <div className="px-4 py-6 md:px-8">
      <PageHeader
        eyebrow="Client onboarding"
        title="Onboarding queue"
        description="Triage incoming onboarding submissions: track progress, assign an admin, leave internal notes, and email the contact."
        tabs={<PageTabs tabs={tabs} value={tab} onValueChange={(v) => setTab(v as 'all' | Status)} ariaLabel="Filter by status" />}
      />

      {toast && (
        <div className="mb-4 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-accent-soft)] px-4 py-2 text-sm text-on-surface">
          {toast}
        </div>
      )}
      {error && (
        <Surface className="mb-4"><p className="text-sm text-on-surface">{error}</p></Surface>
      )}

      {loading ? (
        <div className="grid gap-3">{[0, 1, 2].map((i) => <div key={i} className="pib-skeleton h-20 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <Surface>
          <EmptyState icon="inbox" title="No submissions" description="Onboarding submissions will appear here as they come in." />
        </Surface>
      ) : (
        <div className="grid gap-3">
          {filtered.map((s) => (
            <Surface key={s.id} as="button" className="text-left w-full" onClick={() => { setSelected(s); setNoteDraft('') }}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-headline text-base text-on-surface">{s.businessName || '(unnamed)'}</h3>
                    <StatusPill tone={STATUS_TONE[s.status]} dot>{STATUS_LABEL[s.status]}</StatusPill>
                    {s.product && <StatusPill tone="neutral">{s.product}</StatusPill>}
                  </div>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {s.contactName || '—'} · {s.contactEmail || 'no email'} · {fmtDate(s.createdAt)}
                  </p>
                  <div className="mt-3 max-w-md">
                    <div className="mb-1 flex items-center justify-between text-xs text-on-surface-variant">
                      <span>Progress</span><span>{s.progress}%</span>
                    </div>
                    <ProgressBar value={s.progress} />
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-on-surface-variant">
                  <div className="font-label uppercase tracking-wide opacity-70">Assigned</div>
                  <div className="text-on-surface">{adminName(s.assignedAdminUid)}</div>
                </div>
              </div>
            </Surface>
          ))}
        </div>
      )}

      {/* Detail drawer */}
      <DialogDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.businessName || 'Submission'}
        description={selected ? `${selected.contactName || '—'} · ${selected.contactEmail || 'no email'}` : undefined}
        footer={selected ? (
          <>
            <button type="button" className="pib-btn-ghost" onClick={() => setSelected(null)}>Close</button>
            <button
              type="button"
              className="pib-btn-primary"
              onClick={() => { setEmailSubject(`Following up on your onboarding — ${selected.businessName}`); setEmailBody(''); setEmailOpen(true) }}
            >
              <span className="material-symbols-outlined text-[18px]">mail</span>
              Email contact
            </button>
          </>
        ) : undefined}
      >
        {selected && (
          <div className="flex flex-col gap-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="font-label text-xs uppercase tracking-wide text-on-surface-variant">Status</span>
                <select className="pib-input" value={selected.status} disabled={saving}
                  onChange={(e) => patch(selected.id, { status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-label text-xs uppercase tracking-wide text-on-surface-variant">Assigned admin</span>
                <select className="pib-input" value={selected.assignedAdminUid ?? ''} disabled={saving}
                  onChange={(e) => patch(selected.id, { assignedAdminUid: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {admins.map((a) => <option key={a.uid} value={a.uid}>{a.displayName}</option>)}
                </select>
              </label>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="font-label text-xs uppercase tracking-wide text-on-surface-variant">Progress</span>
                <span className="text-xs text-on-surface">{selected.progress}%</span>
              </div>
              <input
                type="range" min={0} max={100} step={5} value={selected.progress} disabled={saving}
                onChange={(e) => setSelected({ ...selected, progress: Number(e.target.value) })}
                onMouseUp={(e) => patch(selected.id, { progress: Number((e.target as HTMLInputElement).value) })}
                onTouchEnd={(e) => patch(selected.id, { progress: Number((e.target as HTMLInputElement).value) })}
                className="w-full accent-[var(--color-pib-accent)]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs text-on-surface-variant">
              <div><div className="font-label uppercase tracking-wide opacity-70">Created</div><div className="text-on-surface">{fmtDate(selected.createdAt)}</div></div>
              <div><div className="font-label uppercase tracking-wide opacity-70">Updated</div><div className="text-on-surface">{fmtDate(selected.updatedAt)}</div></div>
              {selected.orgId && <div><div className="font-label uppercase tracking-wide opacity-70">Org ID</div><div className="text-on-surface break-all">{selected.orgId}</div></div>}
              {selected.product && <div><div className="font-label uppercase tracking-wide opacity-70">Product</div><div className="text-on-surface">{selected.product}</div></div>}
            </div>

            {/* Internal notes */}
            <div className="flex flex-col gap-2">
              <span className="font-label text-xs uppercase tracking-wide text-on-surface-variant">Internal notes</span>
              <div className="flex gap-2">
                <input
                  className="pib-input flex-1" placeholder="Add an internal note…" value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addNote() } }}
                />
                <button type="button" className="pib-btn-secondary" disabled={saving || !noteDraft.trim()} onClick={addNote}>Add</button>
              </div>
              {selected.internalNotes.length === 0 ? (
                <p className="text-xs text-on-surface-variant">No notes yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {selected.internalNotes.map((n) => (
                    <li key={n.id} className="rounded-lg border border-[var(--color-pib-line)] p-3">
                      <p className="text-sm text-on-surface whitespace-pre-wrap">{n.body}</p>
                      <p className="mt-1 text-[11px] text-on-surface-variant">{n.authorEmail || n.authorUid} · {fmtDate(n.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogDrawer>

      {/* Email compose */}
      <DialogDrawer
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        title="Email contact"
        description={selected ? `To: ${selected.contactEmail}` : undefined}
        footer={
          <>
            <button type="button" className="pib-btn-ghost" onClick={() => setEmailOpen(false)}>Cancel</button>
            <button type="button" className="pib-btn-primary" disabled={sending} onClick={sendEmail}>
              {sending ? 'Sending…' : 'Send email'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-label text-xs uppercase tracking-wide text-on-surface-variant">Subject</span>
            <input className="pib-input" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-label text-xs uppercase tracking-wide text-on-surface-variant">Message</span>
            <textarea className="pib-input min-h-[180px]" value={emailBody} onChange={(e) => setEmailBody(e.target.value)} placeholder="Write your follow-up…" />
          </label>
          <p className="text-xs text-on-surface-variant">Sent from {`peet@partnersinbiz.online`} via Resend. The send is recorded in the audit log.</p>
        </div>
      </DialogDrawer>
    </div>
  )
}
