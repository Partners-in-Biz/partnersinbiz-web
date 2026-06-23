'use client'

import { useState } from 'react'
import { Surface, StatusPill, DialogDrawer } from '@/components/ui/AppFoundation'
import { apiSend, formatZar, formatDate, type OrgDetail } from './OrgDetailApi'

type Dialog = null | 'suspend' | 'unsuspend' | 'reset' | 'message' | 'delete'

const STATUS_TONE: Record<string, 'success' | 'warn' | 'danger' | 'neutral'> = {
  active: 'success', suspended: 'danger', churned: 'neutral', trial: 'warn',
}

function MetricCard({ icon, label, value }: { icon: string; label: string; value: number | string }) {
  return (
    <div className="pib-stat-card">
      <div className="mb-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-accent)]">{icon}</span>
        <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</span>
      </div>
      <p className="text-2xl font-headline font-bold text-on-surface">{value}</p>
    </div>
  )
}

export function OrgDetailOverviewPanel({ org, onChanged }: { org: OrgDetail; onChanged: () => void }) {
  const slug = org.slug
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  // form state
  const [reason, setReason] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [msgSubject, setMsgSubject] = useState('')
  const [msgBody, setMsgBody] = useState('')
  const [msgEmail, setMsgEmail] = useState(true)
  const [confirmName, setConfirmName] = useState('')
  const [resetLink, setResetLink] = useState('')

  function close() {
    setDialog(null); setError(''); setReason(''); setInternalNote(''); setMsgSubject('')
    setMsgBody(''); setConfirmName(''); setResetLink('')
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Action failed') } finally { setBusy(false) }
  }

  function doImpersonate() {
    if (!org.owner) { setError('No owner to impersonate'); return }
    run(async () => {
      const res = await apiSend<{ customToken: string }>(
        `/api/v1/admin/users/${org.owner!.uid}/impersonate`, 'POST',
      )
      window.open(`/admin/impersonate?token=${encodeURIComponent(res.customToken)}`, '_blank', 'noopener')
      setInfo('Impersonation token issued — opened in a new tab.')
    })
  }

  function doReset() {
    run(async () => {
      const res = await apiSend<{ link: string; emailSent: boolean }>(
        `/api/v1/admin/org/${slug}/reset-owner-password`, 'POST', { sendEmail: notify },
      )
      setResetLink(res.link)
    })
  }

  function doSuspend() {
    run(async () => {
      await apiSend(`/api/v1/admin/org/${slug}/suspend`, 'POST', { action: 'suspend', reason, internalNote, notify })
      close(); onChanged()
    })
  }

  function doUnsuspend() {
    run(async () => {
      await apiSend(`/api/v1/admin/org/${slug}/suspend`, 'POST', { action: 'unsuspend' })
      close(); onChanged()
    })
  }

  function doMessage() {
    run(async () => {
      await apiSend(`/api/v1/admin/org/${slug}/message`, 'POST', { subject: msgSubject, message: msgBody, alsoEmail: msgEmail })
      close(); setInfo('Message sent.')
    })
  }

  function doDelete() {
    run(async () => {
      await apiSend(`/api/v1/admin/org/${slug}`, 'DELETE', { confirmName })
      close(); onChanged()
    })
  }

  async function toggleDevMode(enabled: boolean) {
    run(async () => {
      await apiSend(`/api/v1/admin/org/${slug}/dev-mode`, 'POST', { enabled })
      onChanged()
    })
  }

  const suspended = org.status === 'suspended'

  return (
    <div className="space-y-6">
      {info && <div className="pib-card !py-2 text-sm text-green-400">{info}</div>}

      {suspended && org.suspension && (
        <div className="pib-card border border-red-500/30 !bg-red-500/5">
          <p className="text-sm font-medium text-red-400">This organisation is suspended.</p>
          <p className="text-xs text-on-surface-variant">Reason: {String(org.suspension.reason ?? '—')}</p>
        </div>
      )}

      {/* Meta */}
      <Surface header={<span className="font-label">Organisation</span>}>
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <Meta label="Status" value={<StatusPill tone={STATUS_TONE[org.status] ?? 'neutral'} dot>{org.status}</StatusPill>} />
          <Meta label="Plan" value={org.plan ?? '—'} />
          <Meta label="Owner" value={org.owner ? (org.owner.displayName || org.owner.email || org.owner.uid) : '—'} />
          <Meta label="Owner email" value={org.owner?.email || '—'} />
          <Meta label="MRR" value={formatZar(org.mrrZar)} />
          <Meta label="Industry" value={org.industry || '—'} />
          <Meta label="Website" value={org.website || '—'} />
          <Meta label="Created" value={formatDate(org.createdAt)} />
        </div>
      </Surface>

      {/* Metrics */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard icon="contacts" label="Contacts" value={org.metrics.contacts} />
        <MetricCard icon="mail" label="Sends 30d" value={org.metrics.emailSends30d} />
        <MetricCard icon="share" label="Social" value={org.metrics.socialAccounts} />
        <MetricCard icon="folder" label="Projects" value={org.metrics.projects} />
        <MetricCard icon="campaign" label="Campaigns" value={org.metrics.campaigns} />
        <MetricCard icon="group" label="Team" value={org.metrics.teamSize} />
      </div>

      {/* Actions */}
      <Surface header={<span className="font-label">Actions</span>}>
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="pib-btn-secondary" disabled={busy || !org.owner} onClick={doImpersonate}>
            <span className="material-symbols-outlined text-[18px]">login</span> Impersonate owner
          </button>
          <button type="button" className="pib-btn-secondary" disabled={busy} onClick={() => setDialog('reset')}>
            <span className="material-symbols-outlined text-[18px]">lock_reset</span> Reset owner password
          </button>
          <button type="button" className="pib-btn-secondary" disabled={busy} onClick={() => setDialog('message')}>
            <span className="material-symbols-outlined text-[18px]">mail</span> Send message
          </button>
          {suspended ? (
            <button type="button" className="pib-btn-secondary" disabled={busy} onClick={() => setDialog('unsuspend')}>
              <span className="material-symbols-outlined text-[18px]">check_circle</span> Unsuspend
            </button>
          ) : (
            <button type="button" className="pib-btn-secondary" disabled={busy} onClick={() => setDialog('suspend')}>
              <span className="material-symbols-outlined text-[18px]">block</span> Suspend
            </button>
          )}
          <button type="button" className="pib-btn-ghost text-red-400" disabled={busy} onClick={() => setDialog('delete')}>
            <span className="material-symbols-outlined text-[18px]">delete</span> Delete
          </button>
        </div>
      </Surface>

      {/* Dev mode */}
      <Surface header={<span className="font-label">Developer mode</span>}>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-on-surface-variant">
            When enabled, the client portal shows a “development workspace” banner so the client knows the
            workspace is being set up or tested. Sets <code>devMode</code> and <code>settings.portalDevBanner</code>.
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={org.devMode}
            disabled={busy}
            onClick={() => toggleDevMode(!org.devMode)}
            className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50"
            style={{ background: org.devMode ? 'var(--color-pib-accent)' : 'rgba(255,255,255,0.15)' }}
          >
            <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: org.devMode ? '22px' : '2px' }} />
          </button>
        </div>
      </Surface>

      {/* ── Dialogs ── */}
      <DialogDrawer
        open={dialog === 'reset'}
        title="Reset owner password"
        description={org.owner?.email ? `Generates a reset link for ${org.owner.email}.` : 'Generates a reset link for the owner.'}
        onClose={close}
        footer={resetLink ? (
          <div className="flex justify-end"><button type="button" className="pib-btn-primary" onClick={close}>Done</button></div>
        ) : (
          <div className="flex justify-end gap-2">
            <button type="button" className="pib-btn-secondary" onClick={close}>Cancel</button>
            <button type="button" className="pib-btn-primary" disabled={busy} onClick={doReset}>Generate link</button>
          </div>
        )}
      >
        {resetLink ? (
          <div className="space-y-2">
            <p className="text-sm text-on-surface">Reset link generated{notify ? ' and emailed to the owner' : ''}:</p>
            <textarea readOnly className="pib-textarea w-full text-xs" rows={3} value={resetLink} />
          </div>
        ) : (
          <label className="flex items-center gap-2 text-sm text-on-surface">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Also email the link to the owner
          </label>
        )}
      </DialogDrawer>

      <DialogDrawer
        open={dialog === 'message'}
        title="Send message to organisation"
        onClose={close}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="pib-btn-secondary" onClick={close}>Cancel</button>
            <button type="button" className="pib-btn-primary" disabled={busy || !msgBody.trim()} onClick={doMessage}>Send</button>
          </div>
        }
      >
        <div className="space-y-3">
          <input className="pib-input w-full" placeholder="Subject (optional)" value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)} />
          <textarea className="pib-textarea w-full" rows={5} placeholder="Message…" value={msgBody} onChange={(e) => setMsgBody(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-on-surface">
            <input type="checkbox" checked={msgEmail} onChange={(e) => setMsgEmail(e.target.checked)} />
            Also email the owner
          </label>
        </div>
      </DialogDrawer>

      <DialogDrawer
        open={dialog === 'suspend'}
        title="Suspend organisation"
        description="The org status becomes “suspended”. Provide a reason."
        onClose={close}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="pib-btn-secondary" onClick={close}>Cancel</button>
            <button type="button" className="pib-btn-primary" disabled={busy || !reason.trim()} onClick={doSuspend}>Suspend</button>
          </div>
        }
      >
        <div className="space-y-3">
          <textarea className="pib-textarea w-full" rows={3} placeholder="Reason (shown to owner if notified)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <textarea className="pib-textarea w-full" rows={2} placeholder="Internal note (not shown to owner)" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-on-surface">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Email the owner a suspension notice
          </label>
        </div>
      </DialogDrawer>

      <DialogDrawer
        open={dialog === 'unsuspend'}
        title="Unsuspend organisation"
        description="Restore this org to active status."
        onClose={close}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="pib-btn-secondary" onClick={close}>Cancel</button>
            <button type="button" className="pib-btn-primary" disabled={busy} onClick={doUnsuspend}>Unsuspend</button>
          </div>
        }
      >
        <p className="text-sm text-on-surface-variant">The org returns to active and the suspension record is cleared.</p>
      </DialogDrawer>

      <DialogDrawer
        open={dialog === 'delete'}
        title="Delete organisation"
        description="Soft-delete: status → churned, billing cancelled. Type the org name to confirm."
        onClose={close}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="pib-btn-secondary" onClick={close}>Cancel</button>
            <button type="button" className="pib-btn-primary" disabled={busy || confirmName.trim() !== org.name.trim()} onClick={doDelete}>
              Delete organisation
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          <p className="text-sm text-on-surface-variant">Type <strong className="text-on-surface">{org.name}</strong> to confirm.</p>
          <input className="pib-input w-full" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={org.name} />
        </div>
      </DialogDrawer>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-on-surface-variant">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-on-surface">{value}</span>
    </div>
  )
}
