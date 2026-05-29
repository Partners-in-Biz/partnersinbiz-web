'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { Campaign, CampaignStats, CampaignStatus } from '@/lib/campaigns/types'
import type { Sequence } from '@/lib/sequences/types'
import type { EmailDomain } from '@/lib/email/domains'
import type { Segment } from '@/lib/crm/segments'

interface OrganizationSummary {
  id: string
  slug: string
  name: string
}

const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: 'bg-surface-container text-on-surface-variant',
  scheduled: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-gray-200 text-gray-700',
}

const SHARED_DOMAIN_LABEL = 'Shared (partnersinbiz.online)'

const EMPTY_STATS_LOCAL: CampaignStats = {
  enrolled: 0,
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  bounced: 0,
  unsubscribed: 0,
}

type AudienceMode = 'segment' | 'manual'

function pct(num: number, denom: number): string {
  if (!denom) return '—'
  return `${((num / denom) * 100).toFixed(1)}%`
}

function parseIdList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export default function CampaignDetailPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string
  const id = params.id as string

  const [orgId, setOrgId] = useState<string | null>(null)

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Editable form state — mirrors campaign fields
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fromDomainId, setFromDomainId] = useState('')
  const [fromName, setFromName] = useState('')
  const [fromLocal, setFromLocal] = useState('campaigns')
  const [replyTo, setReplyTo] = useState('')

  const [audienceMode, setAudienceMode] = useState<AudienceMode>('segment')
  const [segmentId, setSegmentId] = useState('')
  const [contactIdsRaw, setContactIdsRaw] = useState('')

  const [sequenceId, setSequenceId] = useState('')

  const [captureSourceIdsRaw, setCaptureSourceIdsRaw] = useState('')
  const [tagsRaw, setTagsRaw] = useState('')
  const [triggersOpen, setTriggersOpen] = useState(false)

  // Lookups
  const [domains, setDomains] = useState<EmailDomain[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [sequences, setSequences] = useState<Sequence[]>([])

  // Segment count preview
  const [segmentCount, setSegmentCount] = useState<number | null>(null)
  const [segmentCountLoading, setSegmentCountLoading] = useState(false)

  // Action state
  const [saving, setSaving] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const loadCampaign = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/campaigns/${id}`)
      if (!res.ok) {
        setNotFound(true)
        return
      }
      const body = await res.json()
      const c = body.data as Campaign
      setCampaign(c)
      setOrgId(c.orgId)
      setName(c.name ?? '')
      setDescription(c.description ?? '')
      setFromDomainId(c.fromDomainId ?? '')
      setFromName(c.fromName ?? '')
      setFromLocal(c.fromLocal ?? 'campaigns')
      setReplyTo(c.replyTo ?? '')
      setSegmentId(c.segmentId ?? '')
      setContactIdsRaw((c.contactIds ?? []).join('\n'))
      setAudienceMode(c.segmentId ? 'segment' : (c.contactIds && c.contactIds.length > 0 ? 'manual' : 'segment'))
      setSequenceId(c.sequenceId ?? '')
      setCaptureSourceIdsRaw((c.triggers?.captureSourceIds ?? []).join(', '))
      setTagsRaw((c.triggers?.tags ?? []).join(', '))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadCampaign()
  }, [loadCampaign])

  // Resolve slug → org for breadcrumb display only (campaign already has orgId)
  const [orgName, setOrgName] = useState('')
  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/organizations')
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        const list = (body.data ?? []) as OrganizationSummary[]
        const match = list.find((o) => o.slug === slug)
        setOrgName(match?.name ?? '')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [slug])

  // Load lookups once orgId is known
  useEffect(() => {
    if (!orgId) return
    fetch(`/api/v1/email/domains?orgId=${encodeURIComponent(orgId)}`)
      .then((r) => r.json())
      .then((b) => setDomains((b.data ?? []) as EmailDomain[]))
      .catch(() => {})
    fetch(`/api/v1/crm/segments?orgId=${encodeURIComponent(orgId)}`)
      .then((r) => r.json())
      .then((b) => setSegments((Array.isArray(b.data) ? b.data : b.data?.segments ?? []) as Segment[]))
      .catch(() => {})
    fetch(`/api/v1/sequences?orgId=${encodeURIComponent(orgId)}`)
      .then((r) => r.json())
      .then((b) => setSequences((b.data ?? []) as Sequence[]))
      .catch(() => {})
  }, [orgId])

  // Resolve segment count when segment changes
  useEffect(() => {
    if (audienceMode !== 'segment' || !segmentId) {
      setSegmentCount(null)
      return
    }
    let cancelled = false
    setSegmentCountLoading(true)
    fetch(`/api/v1/crm/segments/${segmentId}/resolve`, { method: 'POST' })
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return
        const c = typeof b?.data?.count === 'number' ? b.data.count : null
        setSegmentCount(c)
      })
      .catch(() => {
        if (!cancelled) setSegmentCount(null)
      })
      .finally(() => {
        if (!cancelled) setSegmentCountLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [audienceMode, segmentId])

  const selectedSequence = useMemo(
    () => sequences.find((s) => s.id === sequenceId) ?? null,
    [sequences, sequenceId],
  )

  const selectedDomain = useMemo(
    () => domains.find((d) => d.id === fromDomainId) ?? null,
    [domains, fromDomainId],
  )

  const fromPreview = useMemo(() => {
    const dn = selectedDomain?.name || 'partnersinbiz.online'
    const local = (fromLocal || 'campaigns').trim()
    const display = (fromName || '').trim()
    const addr = `${local}@${dn}`
    return display ? `${display} <${addr}>` : addr
  }, [selectedDomain, fromLocal, fromName])

  const status: CampaignStatus = campaign?.status ?? 'draft'
  const editable = status === 'draft' || status === 'paused'
  const stats = campaign?.stats ?? EMPTY_STATS_LOCAL

  async function handleSave() {
    if (!campaign) return
    setError(null)
    setInfo(null)
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description,
        fromDomainId,
        fromName,
        fromLocal,
        replyTo,
        sequenceId,
        triggers: {
          captureSourceIds: parseIdList(captureSourceIdsRaw),
          tags: parseIdList(tagsRaw),
        },
      }
      if (audienceMode === 'segment') {
        body.segmentId = segmentId
        body.contactIds = []
      } else {
        body.segmentId = ''
        body.contactIds = parseIdList(contactIdsRaw)
      }
      const res = await fetch(`/api/v1/campaigns/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const respBody = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(respBody.error ?? 'Failed to save')
        return
      }
      setInfo('Saved')
      await loadCampaign()
    } catch {
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleLaunch() {
    if (!campaign) return
    const audienceSize =
      audienceMode === 'segment'
        ? segmentCount ?? 0
        : parseIdList(contactIdsRaw).length
    const confirmed = confirm(
      `Enroll ${audienceSize} contact${audienceSize === 1 ? '' : 's'} and start sending?`,
    )
    if (!confirmed) return
    setError(null)
    setInfo(null)
    setLaunching(true)
    try {
      const res = await fetch(`/api/v1/campaigns/${id}/launch`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Failed to launch')
        return
      }
      const enrolled = body.data?.enrolled ?? 0
      const total = body.data?.audienceSize ?? 0
      setInfo(`Launched. Enrolled ${enrolled} of ${total} contacts.`)
      await loadCampaign()
    } catch {
      setError('Failed to launch')
    } finally {
      setLaunching(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this campaign? This cannot be undone.')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/v1/campaigns/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to delete')
        setDeleting(false)
        return
      }
      router.push(`/admin/org/${slug}/campaigns`)
    } catch {
      setError('Failed to delete')
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="h-40 rounded-xl bg-surface-container animate-pulse" />
      </div>
    )
  }
  if (notFound || !campaign) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-on-surface-variant">
        Campaign not found.
      </div>
    )
  }

  return (
    <div className="pb-12">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-surface border-b border-outline-variant">
        <div className="p-4 max-w-4xl mx-auto flex items-center gap-3 flex-wrap">
          <button
            onClick={() => router.push(`/admin/org/${slug}/campaigns`)}
            className="text-sm text-on-surface-variant hover:underline"
          >
            ← Campaigns
          </button>
          <div className="flex-1 min-w-[180px]">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!editable}
              className="w-full text-lg font-semibold bg-transparent border-b border-outline-variant text-on-surface outline-none pb-1 disabled:opacity-70"
            />
          </div>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] ?? ''}`}
          >
            {status}
          </span>
          <div className="flex gap-2">
            {editable && (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface text-sm font-medium border border-outline-variant disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={handleLaunch}
                  disabled={launching || saving}
                  className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-sm font-medium disabled:opacity-50"
                >
                  {launching ? 'Launching…' : 'Launch'}
                </button>
              </>
            )}
            {status === 'active' && (
              <span className="px-3 py-1.5 rounded-lg bg-green-100 text-green-800 text-sm font-medium">
                Active
              </span>
            )}
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1.5 rounded-lg bg-surface-container text-red-600 text-sm font-medium border border-outline-variant disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
        {(error || info) && (
          <div className="px-4 pb-3 max-w-4xl mx-auto">
            {error && <p className="text-sm text-red-600">{error}</p>}
            {info && <p className="text-sm text-green-700">{info}</p>}
          </div>
        )}
      </div>

      <div className="p-6 max-w-4xl mx-auto space-y-8">
        {orgName && (
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            {orgName}
          </p>
        )}

        {/* Description */}
        <div>
          <label className="block text-xs uppercase tracking-wide text-on-surface-variant mb-2">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!editable}
            rows={2}
            placeholder="Optional internal note about the campaign goal."
            className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
          />
        </div>

        {/* Section 1: Sender */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide">
            Sender
          </h2>
          <div className="rounded-xl bg-surface-container border border-outline-variant p-4 space-y-3">
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">
                Sending domain
              </label>
              <select
                value={fromDomainId}
                onChange={(e) => setFromDomainId(e.target.value)}
                disabled={!editable}
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
              >
                <option value="">{SHARED_DOMAIN_LABEL}</option>
                {domains.map((d) => {
                  const isVerified = d.status === 'verified'
                  return (
                    <option key={d.id} value={d.id} disabled={!isVerified}>
                      {d.name}
                      {!isVerified ? ` — ${d.status}` : ''}
                    </option>
                  )
                })}
              </select>
              {domains.some((d) => d.status !== 'verified') && (
                <p className="text-xs text-on-surface-variant mt-1">
                  Pending or failed domains can&apos;t be selected. Verify them in Email Domains first.
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-on-surface-variant mb-1">
                  From name
                </label>
                <input
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  disabled={!editable}
                  placeholder="e.g. AHS Law"
                  className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
                />
              </div>
              <div>
                <label className="block text-xs text-on-surface-variant mb-1">
                  From local part
                </label>
                <input
                  value={fromLocal}
                  onChange={(e) => setFromLocal(e.target.value)}
                  disabled={!editable}
                  placeholder="campaigns"
                  className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">
                Reply-to (optional)
              </label>
              <input
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                disabled={!editable}
                placeholder="reply@yourdomain.com"
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
              />
            </div>
            <p className="text-xs text-on-surface-variant font-mono break-all pt-1">
              Preview: {fromPreview}
            </p>
          </div>
        </section>

        {/* Section 2: Audience */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide">
            Audience
          </h2>
          <div className="rounded-xl bg-surface-container border border-outline-variant p-4 space-y-3">
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-on-surface">
                <input
                  type="radio"
                  name="audienceMode"
                  value="segment"
                  checked={audienceMode === 'segment'}
                  onChange={() => setAudienceMode('segment')}
                  disabled={!editable}
                />
                Use a segment
              </label>
              <label className="flex items-center gap-2 text-sm text-on-surface">
                <input
                  type="radio"
                  name="audienceMode"
                  value="manual"
                  checked={audienceMode === 'manual'}
                  onChange={() => setAudienceMode('manual')}
                  disabled={!editable}
                />
                Pick contacts manually
              </label>
            </div>

            {audienceMode === 'segment' ? (
              <>
                <select
                  value={segmentId}
                  onChange={(e) => setSegmentId(e.target.value)}
                  disabled={!editable}
                  className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
                >
                  <option value="">Select a segment…</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-on-surface-variant">
                  {!segmentId
                    ? 'No segment selected.'
                    : segmentCountLoading
                      ? 'Counting matches…'
                      : segmentCount === null
                        ? 'Could not resolve segment.'
                        : `${segmentCount} contact${segmentCount === 1 ? '' : 's'} match`}
                </p>
              </>
            ) : (
              <>
                <textarea
                  value={contactIdsRaw}
                  onChange={(e) => setContactIdsRaw(e.target.value)}
                  disabled={!editable}
                  rows={4}
                  placeholder="Paste contact IDs (comma- or newline-separated)"
                  className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm font-mono disabled:opacity-70"
                />
                <p className="text-xs text-on-surface-variant">
                  {parseIdList(contactIdsRaw).length} contact ID
                  {parseIdList(contactIdsRaw).length === 1 ? '' : 's'} entered.
                </p>
              </>
            )}
          </div>
        </section>

        {/* Section 3: Content */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide">
            Content
          </h2>
          <div className="rounded-xl bg-surface-container border border-outline-variant p-4 space-y-3">
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">
                Sequence
              </label>
              <select
                value={sequenceId}
                onChange={(e) => setSequenceId(e.target.value)}
                disabled={!editable}
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
              >
                <option value="">Select a sequence…</option>
                {sequences.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.steps?.length ?? 0} steps)
                  </option>
                ))}
              </select>
            </div>
            {selectedSequence && (selectedSequence.steps?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-outline-variant bg-surface">
                <div className="px-3 py-2 border-b border-outline-variant text-xs uppercase tracking-wide text-on-surface-variant">
                  Steps preview
                </div>
                <ol className="divide-y divide-outline-variant">
                  {selectedSequence.steps.map((step, idx) => {
                    const snippet =
                      (step.bodyText || step.bodyHtml || '').replace(/\s+/g, ' ').slice(0, 140)
                    return (
                      <li key={idx} className="px-3 py-2">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="font-medium text-on-surface text-sm truncate">
                            {idx + 1}. {step.subject || '(no subject)'}
                          </p>
                          <span className="text-xs text-on-surface-variant whitespace-nowrap">
                            {step.delayDays === 0
                              ? 'Send immediately'
                              : `+${step.delayDays} day${step.delayDays === 1 ? '' : 's'}`}
                          </span>
                        </div>
                        {snippet && (
                          <p className="text-xs text-on-surface-variant mt-0.5 truncate">
                            {snippet}
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </div>
            )}
          </div>
        </section>

        {/* Section 4: Triggers */}
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setTriggersOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-on-surface-variant uppercase tracking-wide hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[18px]">
              {triggersOpen ? 'expand_more' : 'chevron_right'}
            </span>
            Auto-enrollment triggers
          </button>
          {triggersOpen && (
            <div className="rounded-xl bg-surface-container border border-outline-variant p-4 space-y-3">
              <div>
                <label className="block text-xs text-on-surface-variant mb-1">
                  Capture source IDs
                </label>
                <input
                  value={captureSourceIdsRaw}
                  onChange={(e) => setCaptureSourceIdsRaw(e.target.value)}
                  disabled={!editable}
                  placeholder="Comma-separated capture source IDs"
                  className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
                />
              </div>
              <div>
                <label className="block text-xs text-on-surface-variant mb-1">
                  Tag triggers
                </label>
                <input
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  disabled={!editable}
                  placeholder="Comma-separated tags"
                  className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
                />
              </div>
              <p className="text-xs text-on-surface-variant">
                When Phase 2 ships, contacts captured from these sources or gaining these tags
                will be auto-enrolled in this campaign.
              </p>
            </div>
          )}
        </section>

        {/* Section 5: Stats */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide">
            Stats
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[
              { label: 'Enrolled', value: stats.enrolled },
              { label: 'Sent', value: stats.sent },
              { label: 'Delivered', value: stats.delivered },
              { label: 'Opened', value: stats.opened },
              { label: 'Clicked', value: stats.clicked },
              { label: 'Bounced', value: stats.bounced },
              { label: 'Unsubscribed', value: stats.unsubscribed },
              { label: 'Open rate', value: pct(stats.opened, stats.sent), text: true },
              { label: 'Click rate', value: pct(stats.clicked, stats.sent), text: true },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-xl bg-surface-container border border-outline-variant p-3"
              >
                <p className="text-xs text-on-surface-variant">{card.label}</p>
                <p className="text-xl font-semibold text-on-surface tabular-nums mt-1">
                  {card.text ? card.value : (card.value as number)}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
