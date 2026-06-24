'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Surface, StatusPill, DialogDrawer, EmptyState } from '@/components/ui/AppFoundation'
import { apiGet, apiSend, formatDateTime } from '@/components/admin/orgs/OrgDetailApi'

type ContentType = 'social_post' | 'campaign'
type DecisionVerb = 'approve' | 'remove' | 'escalate'

interface QueueItem {
  contentId: string
  contentType: ContentType
  orgId: string
  orgName: string
  status: string
  platform: string
  preview: string
  confidence: number | null
  updatedAt: string | null
  createdAt: string | null
}

interface StrikeRow {
  orgId: string
  orgName: string
  strikes: number
  suspended: boolean
  suspendedAt: string | null
  warnings: Array<{ reason: string; contentId: string; at: string | null }>
}

interface DecisionRow {
  id: string
  contentId: string
  contentType: string
  orgId: string
  orgName: string
  decision: string
  reason: string
  confidence: number | null
  decidedBy: string
  decidedAt: string | null
}

interface ModerationPayload {
  items: QueueItem[]
  strikes: StrikeRow[]
  decisions: DecisionRow[]
}

function confidenceTone(confidence: number | null): 'neutral' | 'success' | 'warn' | 'danger' {
  if (confidence === null) return 'neutral'
  if (confidence >= 0.8) return 'success'
  if (confidence >= 0.5) return 'warn'
  return 'danger'
}

function confidenceLabel(confidence: number | null): string {
  if (confidence === null) return 'No score'
  return `${Math.round(confidence * 100)}% confident`
}

function decisionTone(decision: string): 'success' | 'danger' | 'warn' | 'neutral' {
  if (decision === 'approved') return 'success'
  if (decision === 'removed') return 'danger'
  if (decision === 'escalated') return 'warn'
  return 'neutral'
}

function isToday(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export function ModerationQueue() {
  const [data, setData] = useState<ModerationPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Dialog state for remove / escalate (which require a reason).
  const [dialog, setDialog] = useState<{ item: QueueItem; verb: Exclude<DecisionVerb, 'approve'> } | null>(null)
  const [reason, setReason] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await apiGet<ModerationPayload>('/api/v1/admin/moderation')
      setData(d)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load moderation queue')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const submit = useCallback(
    async (item: QueueItem, verb: DecisionVerb, reasonText: string) => {
      setBusyId(item.contentId)
      setActionError('')
      try {
        await apiSend(`/api/v1/admin/moderation/${encodeURIComponent(item.contentId)}`, 'POST', {
          contentType: item.contentType,
          orgId: item.orgId,
          decision: verb,
          reason: reasonText,
        })
        setDialog(null)
        setReason('')
        await load()
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Action failed')
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  const metrics = useMemo(() => {
    const items = data?.items ?? []
    const decisions = data?.decisions ?? []
    const strikes = data?.strikes ?? []
    return {
      pending: items.length,
      removedToday: decisions.filter((d) => d.decision === 'removed' && isToday(d.decidedAt)).length,
      escalated: decisions.filter((d) => d.decision === 'escalated').length,
      suspended: strikes.filter((s) => s.suspended).length,
    }
  }, [data])

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="pib-card p-8 text-sm text-[var(--color-pib-text-muted)]">Loading moderation queue…</div>
      </div>
    )
  }

  const items = data?.items ?? []
  const strikes = data?.strikes ?? []
  const decisions = data?.decisions ?? []

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="pib-card p-6">
        <p className="eyebrow">Trust &amp; safety</p>
        <h1 className="pib-page-title mt-2">Content moderation queue</h1>
        <p className="mt-3 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
          Review flagged social posts and campaigns, approve or remove content, and enforce the 3-strike org
          suspension policy. Every decision is recorded to the immutable audit log.
        </p>
      </header>

      {error && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-400">{error}</div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Pending review', value: metrics.pending },
          { label: 'Removed today', value: metrics.removedToday },
          { label: 'Escalated', value: metrics.escalated },
          { label: 'Suspended orgs', value: metrics.suspended },
        ].map((m) => (
          <div key={m.label} className="pib-card p-5">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{m.label}</p>
            <p className="mt-3 text-2xl font-semibold text-on-surface">{m.value}</p>
          </div>
        ))}
      </section>

      {/* Queue */}
      <Surface header={<span className="font-label">Review queue ({items.length})</span>}>
        {items.length === 0 ? (
          <EmptyState
            icon="verified"
            title="Queue is clear"
            description="No social posts or campaigns are awaiting moderation right now."
          />
        ) : (
          <div className="divide-y divide-white/5">
            {items.map((item) => (
              <div key={`${item.contentType}-${item.contentId}`} className="flex flex-col gap-3 py-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-on-surface">{item.orgName}</span>
                    <StatusPill tone="info">{item.contentType === 'campaign' ? 'Campaign' : 'Social post'}</StatusPill>
                    <StatusPill tone="neutral">{item.status}</StatusPill>
                    <StatusPill tone="neutral">{item.platform}</StatusPill>
                    <StatusPill tone={confidenceTone(item.confidence)}>{confidenceLabel(item.confidence)}</StatusPill>
                  </div>
                  <p className="mt-2 text-sm text-on-surface-variant">
                    {item.preview || <span className="italic opacity-70">No content preview available.</span>}
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant">Updated {formatDateTime(item.updatedAt)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    className="pib-btn-primary text-xs"
                    disabled={busyId === item.contentId}
                    onClick={() => void submit(item, 'approve', '')}
                  >
                    {busyId === item.contentId ? 'Working…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    className="pib-btn-secondary text-xs"
                    disabled={busyId === item.contentId}
                    onClick={() => { setActionError(''); setReason(''); setDialog({ item, verb: 'escalate' }) }}
                  >
                    Escalate
                  </button>
                  <button
                    type="button"
                    className="pib-btn-secondary text-xs"
                    style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }}
                    disabled={busyId === item.contentId}
                    onClick={() => { setActionError(''); setReason(''); setDialog({ item, verb: 'remove' }) }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Surface>

      {/* Strikes */}
      <Surface header={<span className="font-label">Strike &amp; warning log</span>}>
        {strikes.length === 0 ? (
          <p className="py-4 text-sm text-on-surface-variant">No strikes recorded against any org.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {strikes.map((s) => (
              <div key={s.orgId} className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-on-surface">{s.orgName}</span>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={s.strikes >= 3 ? 'danger' : s.strikes >= 1 ? 'warn' : 'neutral'}>
                      {s.strikes} / 3 strikes
                    </StatusPill>
                    {s.suspended && (
                      <StatusPill tone="danger" dot>
                        Suspended{s.suspendedAt ? ` · ${formatDateTime(s.suspendedAt)}` : ''}
                      </StatusPill>
                    )}
                  </div>
                </div>
                {s.warnings.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {s.warnings.map((w, i) => (
                      <li key={`${s.orgId}-${i}`} className="text-xs text-on-surface-variant">
                        <span className="opacity-70">{formatDateTime(w.at)}</span> — {w.reason || 'No reason recorded'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Surface>

      {/* Decisions audit */}
      <Surface header={<span className="font-label">Recent decisions</span>}>
        {decisions.length === 0 ? (
          <p className="py-4 text-sm text-on-surface-variant">No moderation decisions recorded yet.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {decisions.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={decisionTone(d.decision)}>{d.decision}</StatusPill>
                    <span className="text-sm text-on-surface">{d.orgName}</span>
                    <span className="text-xs text-on-surface-variant">{d.contentType}</span>
                  </div>
                  {d.reason && <p className="mt-1 text-xs text-on-surface-variant">{d.reason}</p>}
                </div>
                <div className="text-right text-xs text-on-surface-variant">
                  <p>{formatDateTime(d.decidedAt)}</p>
                  <p className="opacity-70">{d.decidedBy || 'system'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Surface>

      {/* Reason capture for remove / escalate */}
      <DialogDrawer
        open={dialog !== null}
        title={dialog?.verb === 'remove' ? 'Remove content' : 'Escalate content'}
        description={
          dialog?.verb === 'remove'
            ? 'Removing adds a strike to this org. Three strikes auto-suspends the org.'
            : 'Escalation flags this for senior review. No strike is added.'
        }
        onClose={() => { setDialog(null); setReason(''); setActionError('') }}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="pib-btn-secondary" onClick={() => { setDialog(null); setReason('') }}>
              Cancel
            </button>
            <button
              type="button"
              className="pib-btn-primary"
              disabled={!reason.trim() || (dialog ? busyId === dialog.item.contentId : false)}
              onClick={() => dialog && void submit(dialog.item, dialog.verb, reason.trim())}
            >
              {dialog?.verb === 'remove' ? 'Remove + strike' : 'Escalate'}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {dialog && (
            <p className="text-xs text-on-surface-variant">
              {dialog.item.orgName} · {dialog.item.contentType === 'campaign' ? 'Campaign' : 'Social post'} ·{' '}
              {dialog.item.preview.slice(0, 80) || 'No preview'}
            </p>
          )}
          <label className="block text-sm text-on-surface">
            Reason <span className="text-red-400">*</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Explain why this content is being actioned…"
              className="pib-input mt-1 w-full"
            />
          </label>
          {actionError && <p className="text-sm text-red-400">{actionError}</p>}
        </div>
      </DialogDrawer>
    </div>
  )
}

export default ModerationQueue
