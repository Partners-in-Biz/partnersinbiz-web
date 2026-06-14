'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { EmailCampaignDetailWorkspace } from '@/components/campaigns/EmailCampaignDetailWorkspace'
import { AdminOperatorGate } from '@/components/admin/AdminOperatorGate'
import { EMPTY_STATS, type Campaign, type CampaignStatus } from '@/lib/campaigns/types'
import type { Sequence } from '@/lib/sequences/types'
import type { EmailDomain } from '@/lib/email/domains'
import type { Segment } from '@/lib/crm/segments'
import type { BrandKitWire } from '@/lib/brand-kit/types'

interface OrganizationSummary {
  id: string
  slug: string
  name: string
}

const SHARED_DOMAIN_LABEL = 'Shared (partnersinbiz.online)'

type AudienceMode = 'segment' | 'manual'
type PendingAction = 'launch' | 'delete' | null

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
  const [orgName, setOrgName] = useState('')
  const [brandKit, setBrandKit] = useState<BrandKitWire | null>(null)

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

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

  const [domains, setDomains] = useState<EmailDomain[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [sequences, setSequences] = useState<Sequence[]>([])

  const [segmentCount, setSegmentCount] = useState<number | null>(null)
  const [segmentCountLoading, setSegmentCountLoading] = useState(false)

  const [saving, setSaving] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
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
    fetch(`/api/v1/brand-kit?orgId=${encodeURIComponent(orgId)}`)
      .then((r) => r.json())
      .then((b) => setBrandKit((b.data ?? null) as BrandKitWire | null))
      .catch(() => setBrandKit(null))
  }, [orgId])

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

  const selectedSegment = useMemo(() => {
    if (!segmentId) return null
    const match = segments.find((s) => s.id === segmentId)
    return match ? { id: match.id, name: match.name } : { id: segmentId, name: 'Segment' }
  }, [segments, segmentId])

  const fromPreview = useMemo(() => {
    const dn = selectedDomain?.name || 'partnersinbiz.online'
    const local = (fromLocal || 'campaigns').trim()
    const display = (fromName || '').trim()
    const addr = `${local}@${dn}`
    return display ? `${display} <${addr}>` : addr
  }, [selectedDomain, fromLocal, fromName])

  const status: CampaignStatus = campaign?.status ?? 'draft'
  const editable = status === 'draft' || status === 'paused'
  const stats = campaign?.stats ?? EMPTY_STATS
  const manualContactIds = useMemo(() => parseIdList(contactIdsRaw), [contactIdsRaw])
  const triggerSourceIds = useMemo(() => parseIdList(captureSourceIdsRaw), [captureSourceIdsRaw])
  const triggerTags = useMemo(() => parseIdList(tagsRaw), [tagsRaw])
  const audienceSize =
    audienceMode === 'segment'
      ? segmentCount ?? 0
      : manualContactIds.length

  const previewCampaign = useMemo<Campaign | null>(() => {
    if (!campaign) return null
    return {
      ...campaign,
      name: name.trim() || campaign.name,
      description,
      fromDomainId,
      fromName,
      fromLocal,
      replyTo,
      sequenceId,
      segmentId: audienceMode === 'segment' ? segmentId : '',
      contactIds: audienceMode === 'manual' ? manualContactIds : [],
      triggers: {
        captureSourceIds: triggerSourceIds,
        tags: triggerTags,
      },
      stats,
    }
  }, [
    audienceMode,
    campaign,
    description,
    fromDomainId,
    fromLocal,
    fromName,
    manualContactIds,
    name,
    replyTo,
    segmentId,
    sequenceId,
    stats,
    triggerSourceIds,
    triggerTags,
  ])

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
          captureSourceIds: triggerSourceIds,
          tags: triggerTags,
        },
      }
      if (audienceMode === 'segment') {
        body.segmentId = segmentId
        body.contactIds = []
      } else {
        body.segmentId = ''
        body.contactIds = manualContactIds
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

  async function performLaunch() {
    if (!campaign) return
    setPendingAction(null)
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

  async function performDelete() {
    setPendingAction(null)
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
      <div className="p-6 max-w-6xl mx-auto">
        <div className="h-40 rounded-xl bg-surface-container animate-pulse" />
      </div>
    )
  }

  if (notFound || !campaign || !previewCampaign) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-on-surface-variant">
        Campaign not found.
      </div>
    )
  }

  const adminActions = (
    <div className="pib-card !p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow !text-[10px]">Admin controls</p>
        {status === 'active' && (
          <span className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-label uppercase tracking-wide text-emerald-200">
            Active
          </span>
        )}
      </div>
      <AdminOperatorGate
        title="Email campaign launch is approval-gated"
        body="Use this admin view to configure the draft campaign, evidence, domains, audience, and sequence. Enrolling contacts or sending messages requires an approved Projects/Kanban gate before execution."
      />
      <div className="flex flex-wrap gap-2">
        {editable && (
          <>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="btn-pib-secondary !py-2 !px-3 !text-xs disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              disabled
              className="btn-pib-accent !py-2 !px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-50"
              title="Campaign launch requires an approved Projects/Kanban gate before client-visible sending."
            >
              Approval gate required
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setPendingAction('delete')}
          disabled={deleting}
          className="btn-pib-secondary !py-2 !px-3 !text-xs !text-red-200 disabled:opacity-50"
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </div>
      {pendingAction === 'launch' && (
        <div
          role="alertdialog"
          aria-label="Confirm campaign launch"
          className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-100 space-y-3"
        >
          <p>
            Enroll {audienceSize} contact{audienceSize === 1 ? '' : 's'} and start sending?
          </p>
          <div className="flex gap-2">
            <button type="button" disabled className="btn-pib-accent !py-1.5 !px-2 !text-xs disabled:cursor-not-allowed disabled:opacity-50" title="Start sending requires an approved Projects/Kanban gate.">
              Approval gate required
            </button>
            <button
              type="button"
              onClick={() => setPendingAction(null)}
              className="btn-pib-secondary !py-1.5 !px-2 !text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {pendingAction === 'delete' && (
        <div
          role="alertdialog"
          aria-label="Confirm campaign delete"
          className="rounded-lg border border-red-300/30 bg-red-300/10 p-3 text-xs text-red-100 space-y-3"
        >
          <p>Delete this campaign? This cannot be undone.</p>
          <div className="flex gap-2">
            <button type="button" onClick={performDelete} className="btn-pib-secondary !py-1.5 !px-2 !text-xs !text-red-100">
              Delete campaign
            </button>
            <button
              type="button"
              onClick={() => setPendingAction(null)}
              className="btn-pib-secondary !py-1.5 !px-2 !text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {(error || info) && (
        <div className="space-y-1">
          {error && <p className="text-xs text-red-300">{error}</p>}
          {info && <p className="text-xs text-emerald-300">{info}</p>}
        </div>
      )}
    </div>
  )

  const setupPanel = (
    <section className="space-y-4">
      <div className="space-y-1.5">
        <p className="eyebrow !text-[10px]">Admin setup</p>
        <h2 className="font-headline text-2xl tracking-tight">Campaign configuration</h2>
        <p className="text-sm text-[var(--color-pib-text-muted)] max-w-2xl">
          Edit the sender, audience, content, and enrollment rules for this company campaign.
        </p>
      </div>
      <div className="pib-card space-y-6">
        <div>
          <label className="block text-xs uppercase tracking-wide text-on-surface-variant mb-2">
            Campaign name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!editable}
            className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
          />
        </div>

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

        <div className="hairline" />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide">
            Sender
          </h3>
          <div className="grid grid-cols-1 gap-3">
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
                      {!isVerified ? ` - ${d.status}` : ''}
                    </option>
                  )
                })}
              </select>
              {domains.some((d) => d.status !== 'verified') && (
                <p className="text-xs text-on-surface-variant mt-1">
                  Pending or failed domains cannot be selected. Verify them in Email Domains first.
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
                  placeholder={orgName || 'Company name'}
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

        <div className="hairline" />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide">
            Audience
          </h3>
          <div className="flex flex-wrap gap-4">
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
                <option value="">Select a segment...</option>
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
                    ? 'Counting matches...'
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
                {manualContactIds.length} contact ID{manualContactIds.length === 1 ? '' : 's'} entered.
              </p>
            </>
          )}
        </section>

        <div className="hairline" />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide">
            Content
          </h3>
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
              <option value="">Select a sequence...</option>
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.steps?.length ?? 0} steps)
                </option>
              ))}
            </select>
          </div>
        </section>

        <div className="hairline" />

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
            <div className="space-y-3">
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
                Contacts captured from these sources or gaining these tags are auto-enrolled
                when the capture hooks run.
              </p>
            </div>
          )}
        </section>
      </div>
    </section>
  )

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {orgName && (
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-4">
          {orgName}
        </p>
      )}
      <EmailCampaignDetailWorkspace
        campaign={previewCampaign}
        sequence={selectedSequence}
        segment={selectedSegment}
        domain={selectedDomain}
        brand={{
          brandName: brandKit?.brandName || orgName,
          primaryColor: brandKit?.primaryColor,
          accentColor: brandKit?.accentColor,
          textColor: brandKit?.textColor,
          mutedTextColor: brandKit?.mutedTextColor,
        }}
        backHref={`/admin/org/${slug}/campaigns`}
        actions={adminActions}
        setupPanel={setupPanel}
      />
    </div>
  )
}
