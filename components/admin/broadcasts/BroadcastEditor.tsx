'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AiAssistantPanel from '@/components/admin/email/AiAssistantPanel'
import PreflightPanel from '@/components/admin/email/PreflightPanel'
import { PageTabs } from '@/components/ui/AppFoundation'
import type { Broadcast, BroadcastStatus } from '@/lib/broadcasts/types'
import type { PreflightReport } from '@/lib/email/preflight'
import { countSmsSegments } from '@/lib/sms/segments'

type Tab = 'audience' | 'content' | 'schedule' | 'preflight' | 'stats'

const STATUS_COLORS: Record<BroadcastStatus, string> = {
  draft: 'bg-surface-container text-on-surface-variant',
  scheduled: 'bg-blue-100 text-blue-800',
  sending: 'bg-amber-100 text-amber-800',
  sent: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
  canceled: 'bg-surface-container text-on-surface-variant line-through',
}

interface DomainOption {
  id: string
  name: string
  status: string
}

interface TemplateOption {
  id: string
  name: string
}

interface PreviewResult {
  audienceSize: number
  sampleContacts: Array<{ email: string; name: string; company: string }>
}

interface StatsResult {
  audienceSize: number
  stats: {
    sent: number
    delivered: number
    opened: number
    clicked: number
    bounced: number
    unsubscribed: number
    failed: number
    queued: number
  }
  rates: {
    deliveryRate: number
    openRate: number
    clickRate: number
    unsubRate: number
  }
}

interface Props {
  id: string
  initial: Broadcast
  onBack: () => void
  onDeleted: () => void
}

export default function BroadcastEditor({ id, initial, onBack, onDeleted }: Props) {
  const [tab, setTab] = useState<Tab>('audience')
  const [broadcast, setBroadcast] = useState<Broadcast>(initial)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [domains, setDomains] = useState<DomainOption[]>([])
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testStatus, setTestStatus] = useState<string | null>(null)
  const [scheduledForLocal, setScheduledForLocal] = useState('')
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [stats, setStats] = useState<StatsResult | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [contactInput, setContactInput] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [preflight, setPreflight] = useState<PreflightReport | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)

  const runPreflight = useCallback(async () => {
    setPreflightLoading(true)
    try {
      const r = await fetch(`/api/v1/broadcasts/${id}/preflight`, { method: 'POST' })
      const b = await r.json()
      if (r.ok && b?.data?.report) setPreflight(b.data.report as PreflightReport)
    } catch {
      // Non-fatal — UI shows "preflight unavailable" via null state.
    } finally {
      setPreflightLoading(false)
    }
  }, [id])

  const readOnly = !['draft', 'paused', 'scheduled'].includes(broadcast.status)

  // Pre-fill the schedule input from any existing scheduledFor.
  useEffect(() => {
    if (broadcast.scheduledFor) {
      // scheduledFor comes back as Firestore Timestamp serialized — has _seconds.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ts = broadcast.scheduledFor as any
      const millis =
        typeof ts?.toMillis === 'function'
          ? ts.toMillis()
          : ts?._seconds
            ? ts._seconds * 1000
            : 0
      if (millis > 0) {
        const d = new Date(millis)
        // Format yyyy-MM-ddTHH:mm in local time for datetime-local input.
        const pad = (n: number) => String(n).padStart(2, '0')
        const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
        setScheduledForLocal(local)
      }
    }
  }, [broadcast.scheduledFor])

  // Load domains + templates for the picker dropdowns.
  useEffect(() => {
    const orgId = broadcast.orgId
    if (!orgId) return
    fetch(`/api/v1/email/domains?orgId=${encodeURIComponent(orgId)}`)
      .then((r) => r.json())
      .then((b) => {
        if (Array.isArray(b?.data)) {
          setDomains(
            b.data
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .map((d: any) => ({ id: d.id, name: d.name, status: d.status }))
              .filter((d: DomainOption) => d.status === 'verified'),
          )
        }
      })
      .catch(() => setDomains([]))

    fetch(`/api/v1/email-templates?orgId=${encodeURIComponent(orgId)}`)
      .then((r) => r.json())
      .then((b) => {
        if (Array.isArray(b?.data)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setTemplates(b.data.map((t: any) => ({ id: t.id, name: t.name ?? '(untitled template)' })))
        }
      })
      .catch(() => setTemplates([]))
  }, [broadcast.orgId])

  const refreshPreview = useCallback(async () => {
    setPreviewing(true)
    try {
      const r = await fetch(`/api/v1/broadcasts/${id}/preview`)
      const b = await r.json()
      if (r.ok) setPreview(b.data ?? null)
    } finally {
      setPreviewing(false)
    }
  }, [id])

  // Preview on tab=audience or after a save.
  useEffect(() => {
    if (tab === 'audience' && broadcast.orgId) {
      refreshPreview()
    }
  }, [tab, broadcast.orgId, refreshPreview])

  // Auto-run preflight when the operator opens the preflight or schedule tab.
  useEffect(() => {
    if (tab === 'preflight' || tab === 'schedule') {
      runPreflight()
    }
  }, [tab, runPreflight])

  // Live stats polling on the stats tab.
  useEffect(() => {
    if (tab !== 'stats') return
    let cancelled = false
    const tick = async () => {
      const r = await fetch(`/api/v1/broadcasts/${id}/stats`)
      const b = await r.json()
      if (!cancelled && r.ok) setStats(b.data ?? null)
    }
    tick()
    const handle = setInterval(tick, 10_000)
    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [id, tab])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/broadcasts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: broadcast.name,
          description: broadcast.description,
          channel: broadcast.channel ?? 'email',
          fromDomainId: broadcast.fromDomainId,
          fromName: broadcast.fromName,
          fromLocal: broadcast.fromLocal,
          replyTo: broadcast.replyTo,
          content: broadcast.content,
          audience: broadcast.audience,
          audienceLocalDelivery: broadcast.audienceLocalDelivery ?? false,
          localDeliveryWindowHours: broadcast.localDeliveryWindowHours ?? 24,
        }),
      })
      if (res.ok) setSavedAt(Date.now())
    } finally {
      setSaving(false)
    }
  }, [broadcast, id])

  const channel: 'email' | 'sms' = broadcast.channel ?? 'email'
  const isSms = channel === 'sms'
  const smsSegInfo = useMemo(() => countSmsSegments(broadcast.content?.bodyText ?? ''), [
    broadcast.content?.bodyText,
  ])

  const remove = useCallback(async () => {
    if (!confirm('Delete this broadcast?')) return
    const res = await fetch(`/api/v1/broadcasts/${id}`, { method: 'DELETE' })
    if (res.ok) onDeleted()
  }, [id, onDeleted])

  const sendTest = useCallback(async () => {
    if (!testTo.trim()) return
    setTestStatus('Sending…')
    try {
      // Save current content first so the test reflects edits.
      await save()
      const r = await fetch(`/api/v1/broadcasts/${id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testTo.trim() }),
      })
      const b = await r.json()
      setTestStatus(r.ok ? `Sent (resendId: ${b.data?.resendId || 'dryrun'})` : `Failed: ${b.error}`)
    } catch (err) {
      setTestStatus(`Failed: ${(err as Error).message}`)
    }
  }, [id, save, testTo])

  const schedule = useCallback(async () => {
    setScheduleError(null)
    if (!scheduledForLocal) {
      setScheduleError('Pick a date and time first.')
      return
    }
    const iso = new Date(scheduledForLocal).toISOString()
    await save()
    const r = await fetch(`/api/v1/broadcasts/${id}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledFor: iso }),
    })
    const b = await r.json()
    if (!r.ok) {
      const issues = (b?.issues as string[] | undefined)?.join(' ') ?? b?.error ?? 'Failed to schedule.'
      setScheduleError(issues)
      return
    }
    setBroadcast((prev) => ({ ...prev, status: 'scheduled' }))
  }, [id, save, scheduledForLocal])

  const sendNow = useCallback(async () => {
    if (!confirm('Send this broadcast now?')) return
    setScheduleError(null)
    await save()
    const r = await fetch(`/api/v1/broadcasts/${id}/send-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ immediate: false }),
    })
    const b = await r.json()
    if (!r.ok) {
      const issues = (b?.issues as string[] | undefined)?.join(' ') ?? b?.error ?? 'Failed to send.'
      setScheduleError(issues)
      return
    }
    setBroadcast((prev) => ({ ...prev, status: 'scheduled' }))
  }, [id, save])

  const pauseToggle = useCallback(async () => {
    const action = broadcast.status === 'scheduled' ? 'pause' : 'resume'
    const r = await fetch(`/api/v1/broadcasts/${id}/${action}`, { method: 'POST' })
    const b = await r.json()
    if (r.ok && b?.data?.status) {
      setBroadcast((prev) => ({ ...prev, status: b.data.status }))
    }
  }, [broadcast.status, id])

  const audienceTagsArr = broadcast.audience?.tags ?? []
  const audienceContactIdsArr = broadcast.audience?.contactIds ?? []

  function setAudience(patch: Partial<Broadcast['audience']>): void {
    setBroadcast((prev) => ({
      ...prev,
      audience: { ...prev.audience, ...patch },
    }))
  }
  function setContent(patch: Partial<Broadcast['content']>): void {
    setBroadcast((prev) => ({
      ...prev,
      content: { ...prev.content, ...patch },
    }))
  }

  const sentStat = broadcast.stats?.sent ?? 0
  const audienceStat = broadcast.stats?.audienceSize ?? 0
  const headerSubtext = useMemo(() => {
    if (broadcast.status === 'sent' || broadcast.status === 'sending') {
      return `${sentStat}/${audienceStat} sent`
    }
    if (preview) return `${preview.audienceSize} recipients in current audience`
    return broadcast.description || ''
  }, [audienceStat, broadcast.description, broadcast.status, preview, sentStat])

  const TABS: { key: Tab; label: string; show: boolean }[] = [
    { key: 'audience', label: 'Audience', show: true },
    { key: 'content', label: 'Content', show: true },
    { key: 'schedule', label: 'Schedule', show: true },
    { key: 'preflight', label: 'Preflight', show: true },
    {
      key: 'stats',
      label: 'Stats',
      show: ['sending', 'sent', 'paused', 'scheduled'].includes(broadcast.status),
    },
  ]

  const preflightBlocking = preflight !== null && !preflight.pass

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <button onClick={onBack} className="text-sm text-on-surface-variant hover:underline">
          ← Broadcasts
        </button>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[broadcast.status] ?? ''}`}>
            {broadcast.status}
          </span>
          {savedAt && <span className="text-xs text-on-surface-variant">Saved</span>}
          {!readOnly && (
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          {broadcast.status === 'scheduled' && (
            <button
              onClick={pauseToggle}
              className="px-3 py-2 rounded-lg bg-surface-container text-on-surface text-sm"
            >
              Pause
            </button>
          )}
          {broadcast.status === 'paused' && (
            <button
              onClick={pauseToggle}
              className="px-3 py-2 rounded-lg bg-surface-container text-on-surface text-sm"
            >
              Resume
            </button>
          )}
          <button onClick={remove} className="px-3 py-2 rounded-lg bg-surface-container text-red-600 text-sm font-medium">
            Delete
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <input
          value={broadcast.name}
          disabled={readOnly}
          onChange={(e) => setBroadcast({ ...broadcast, name: e.target.value })}
          className="w-full text-xl font-semibold bg-transparent border-b border-outline-variant text-on-surface outline-none pb-1 disabled:opacity-70"
          placeholder="Broadcast name"
        />
        <p className="text-sm text-on-surface-variant">{headerSubtext}</p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-on-surface-variant font-medium">Channel:</span>
        <div className="inline-flex rounded-lg border border-outline-variant overflow-hidden">
          <button
            type="button"
            disabled={readOnly}
            onClick={() => setBroadcast((prev) => ({ ...prev, channel: 'email' }))}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              channel === 'email'
                ? 'bg-primary text-on-primary'
                : 'bg-surface text-on-surface-variant hover:text-on-surface'
            } disabled:opacity-50`}
          >
            Email
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => setBroadcast((prev) => ({ ...prev, channel: 'sms' }))}
            className={`px-3 py-1.5 text-xs font-medium border-l border-outline-variant transition-colors ${
              channel === 'sms'
                ? 'bg-primary text-on-primary'
                : 'bg-surface text-on-surface-variant hover:text-on-surface'
            } disabled:opacity-50`}
          >
            SMS
          </button>
        </div>
      </div>

      <PageTabs
        ariaLabel="Broadcast editor sections"
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        tabs={TABS.filter((item) => item.show).map((item) => ({ label: item.label, value: item.key }))}
      />

      {tab === 'audience' && (
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-on-surface mb-1">Segment ID</label>
            <input
              value={broadcast.audience?.segmentId ?? ''}
              disabled={readOnly}
              onChange={(e) => setAudience({ segmentId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
              placeholder="(optional) paste a segment id"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-on-surface mb-1">Contact IDs</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {audienceContactIdsArr.map((cid) => (
                <span
                  key={cid}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-surface-container text-on-surface"
                >
                  {cid}
                  {!readOnly && (
                    <button
                      onClick={() => setAudience({ contactIds: audienceContactIdsArr.filter((x) => x !== cid) })}
                      className="text-on-surface-variant hover:text-on-surface"
                      aria-label={`Remove ${cid}`}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={contactInput}
                disabled={readOnly}
                onChange={(e) => setContactInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && contactInput.trim()) {
                    e.preventDefault()
                    if (!audienceContactIdsArr.includes(contactInput.trim())) {
                      setAudience({ contactIds: [...audienceContactIdsArr, contactInput.trim()] })
                    }
                    setContactInput('')
                  }
                }}
                placeholder="Contact id, press Enter"
                className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-on-surface mb-1">Tags (OR)</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {audienceTagsArr.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary-container text-on-primary-container"
                >
                  {t}
                  {!readOnly && (
                    <button
                      onClick={() => setAudience({ tags: audienceTagsArr.filter((x) => x !== t) })}
                      className="hover:opacity-80"
                      aria-label={`Remove ${t}`}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={tagInput}
                disabled={readOnly}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tagInput.trim()) {
                    e.preventDefault()
                    if (!audienceTagsArr.includes(tagInput.trim())) {
                      setAudience({ tags: [...audienceTagsArr, tagInput.trim()] })
                    }
                    setTagInput('')
                  }
                }}
                placeholder="Tag, press Enter"
                className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
              />
            </div>
          </div>

          <div className="flex items-center gap-6 pt-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={broadcast.audience?.excludeUnsubscribed ?? true}
                onChange={(e) => setAudience({ excludeUnsubscribed: e.target.checked })}
              />
              Exclude unsubscribed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={broadcast.audience?.excludeBouncedAt ?? true}
                onChange={(e) => setAudience({ excludeBouncedAt: e.target.checked })}
              />
              Exclude bounced
            </label>
          </div>

          <div className="border-t border-outline-variant pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide">
                Audience preview
              </h3>
              <button
                onClick={refreshPreview}
                disabled={previewing}
                className="px-3 py-1 rounded-lg bg-surface-container text-on-surface text-xs disabled:opacity-50"
              >
                {previewing ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            {preview ? (
              <div className="text-sm">
                <p className="text-on-surface mb-2">
                  <span className="font-semibold">{preview.audienceSize}</span> contact
                  {preview.audienceSize === 1 ? '' : 's'} will receive this broadcast.
                </p>
                {preview.sampleContacts.length > 0 && (
                  <ul className="space-y-1 text-xs text-on-surface-variant">
                    {preview.sampleContacts.map((c, i) => (
                      <li key={i}>
                        {c.email}
                        {c.name && ` — ${c.name}`}
                        {c.company && ` (${c.company})`}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-sm text-on-surface-variant">Save first, then refresh to see the audience.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'content' && !isSms && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-on-surface mb-1">From domain</label>
              <select
                disabled={readOnly}
                value={broadcast.fromDomainId}
                onChange={(e) => setBroadcast({ ...broadcast, fromDomainId: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
              >
                <option value="">— Shared PIB domain —</option>
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-on-surface mb-1">From local (before @)</label>
              <input
                disabled={readOnly}
                value={broadcast.fromLocal}
                onChange={(e) => setBroadcast({ ...broadcast, fromLocal: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
                placeholder="broadcasts"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-on-surface mb-1">From name</label>
              <input
                disabled={readOnly}
                value={broadcast.fromName}
                onChange={(e) => setBroadcast({ ...broadcast, fromName: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
                placeholder="Org name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-on-surface mb-1">Reply-to</label>
              <input
                disabled={readOnly}
                value={broadcast.replyTo}
                onChange={(e) => setBroadcast({ ...broadcast, replyTo: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
                placeholder="hello@example.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-on-surface mb-1">Use template</label>
            <select
              disabled={readOnly}
              value={broadcast.content.templateId}
              onChange={(e) => setContent({ templateId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
            >
              <option value="">— Inline content (no template) —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {!broadcast.content.templateId && (
            <>
              <div className="flex justify-end">
                <button
                  onClick={() => setAiOpen(true)}
                  disabled={readOnly}
                  className="px-3 py-1.5 rounded-md bg-primary-container text-on-primary-container text-xs font-medium disabled:opacity-50"
                >
                  ✨ Generate with AI
                </button>
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Subject</label>
                <input
                  disabled={readOnly}
                  value={broadcast.content.subject}
                  onChange={(e) => setContent({ subject: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Preheader</label>
                <input
                  disabled={readOnly}
                  value={broadcast.content.preheader}
                  onChange={(e) => setContent({ preheader: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
                  placeholder="(optional inbox preview text)"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Body (HTML)</label>
                <textarea
                  disabled={readOnly}
                  value={broadcast.content.bodyHtml}
                  onChange={(e) => setContent({ bodyHtml: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm font-mono disabled:opacity-70"
                  rows={10}
                  placeholder="Use {{firstName}}, {{orgName}}, {{unsubscribeUrl}} for personalisation."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Body (plain text fallback)</label>
                <textarea
                  disabled={readOnly}
                  value={broadcast.content.bodyText}
                  onChange={(e) => setContent({ bodyText: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm font-mono disabled:opacity-70"
                  rows={5}
                />
              </div>
            </>
          )}

          <div className="border-t border-outline-variant pt-4">
            <h3 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide mb-2">
              Send a test
            </h3>
            <div className="flex gap-2">
              <input
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="your@email.com"
                className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
              />
              <button onClick={sendTest} className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm">
                Send test
              </button>
            </div>
            {testStatus && <p className="text-xs text-on-surface-variant mt-2">{testStatus}</p>}
          </div>
        </div>
      )}

      {tab === 'content' && isSms && (
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-on-surface mb-1">
              SMS body
            </label>
            <textarea
              disabled={readOnly}
              value={broadcast.content?.bodyText ?? ''}
              onChange={(e) => setContent({ bodyText: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm font-mono disabled:opacity-70"
              rows={6}
              placeholder="Use {{firstName}}, {{orgName}} for personalisation. Reply STOP to opt out."
            />
            <div className="mt-1 flex items-center justify-between text-xs text-on-surface-variant">
              <span>
                {smsSegInfo.characters} chars · {smsSegInfo.segments} segment
                {smsSegInfo.segments === 1 ? '' : 's'} · {smsSegInfo.encoding.toUpperCase()}
              </span>
              {smsSegInfo.segments > 1 && (
                <span className="text-amber-600 dark:text-amber-400">
                  Multi-segment SMS bills per segment.
                </span>
              )}
            </div>
            <p className="text-xs text-on-surface-variant mt-2">
              SMS broadcasts skip the template, subject, preheader, and From-domain fields. Contacts
              without a phone number are silently skipped at send time. The org&apos;s configured
              Twilio messaging service (or default From number) is used.
            </p>
          </div>
        </div>
      )}

      {tab === 'schedule' && (
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-on-surface mb-1">Schedule for</label>
            <input
              type="datetime-local"
              disabled={readOnly}
              value={scheduledForLocal}
              onChange={(e) => setScheduledForLocal(e.target.value)}
              className="px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm disabled:opacity-70"
            />
            <p className="text-xs text-on-surface-variant mt-1">
              Times use your browser&apos;s local timezone. The cron runs every 15 minutes.
            </p>
          </div>

          <div className="rounded-xl border border-outline-variant p-3 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={broadcast.audienceLocalDelivery ?? false}
                onChange={(e) =>
                  setBroadcast((prev) => ({ ...prev, audienceLocalDelivery: e.target.checked }))
                }
                className="mt-1 h-4 w-4 rounded border-outline text-primary"
              />
              <div className="text-sm">
                <div className="font-medium text-on-surface">Deliver at recipient&apos;s local time</div>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Send to each contact only once their local clock reaches the scheduled hour
                  (e.g. 9am in their timezone). Falls back to send-anyway after the window expires.
                </p>
              </div>
            </label>
            {broadcast.audienceLocalDelivery && (
              <div className="ml-7">
                <label className="block text-xs text-on-surface-variant mb-1">
                  Local delivery window (hours)
                </label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  disabled={readOnly}
                  value={broadcast.localDeliveryWindowHours ?? 24}
                  onChange={(e) =>
                    setBroadcast((prev) => ({
                      ...prev,
                      localDeliveryWindowHours: Math.max(1, Math.min(168, parseInt(e.target.value, 10) || 24)),
                    }))
                  }
                  className="w-24 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
                />
                <p className="text-xs text-on-surface-variant mt-1">
                  After this many hours past the scheduled time, anyone still outside their local
                  window gets sent regardless.
                </p>
              </div>
            )}
          </div>

          {preflightBlocking && (
            <div className="rounded-xl border border-red-400/40 bg-red-50/60 dark:bg-red-500/10 p-3 text-sm">
              <div className="font-semibold text-red-700 dark:text-red-300">
                Preflight found {preflight?.errorCount} issue{preflight?.errorCount === 1 ? '' : 's'} that block sending.
              </div>
              <button
                onClick={() => setTab('preflight')}
                className="mt-1 text-xs text-red-700 dark:text-red-300 underline"
              >
                View preflight report →
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={schedule}
              disabled={readOnly || preflightBlocking || preflightLoading}
              title={preflightBlocking ? 'Fix preflight errors first' : ''}
              className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-medium disabled:opacity-50"
            >
              Schedule
            </button>
            <button
              onClick={sendNow}
              disabled={readOnly || preflightBlocking || preflightLoading}
              title={preflightBlocking ? 'Fix preflight errors first' : ''}
              className="px-4 py-2 rounded-lg bg-surface-container text-on-surface text-sm font-medium disabled:opacity-50"
            >
              Send now
            </button>
          </div>
          {scheduleError && (
            <p className="text-sm text-red-600 whitespace-pre-wrap">{scheduleError}</p>
          )}
        </div>
      )}

      {tab === 'preflight' && (
        <PreflightPanel
          report={preflight}
          loading={preflightLoading}
          onRefresh={runPreflight}
          onJumpToTab={(target) => {
            if (target === 'content' || target === 'audience' || target === 'schedule') {
              setTab(target)
            }
          }}
        />
      )}

      {aiOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setAiOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="h-full">
            <AiAssistantPanel
              mode="email"
              orgId={broadcast.orgId}
              existingBody={broadcast.content.bodyHtml}
              onClose={() => setAiOpen(false)}
              onApply={(r) => {
                setContent({
                  subject: r.subject ?? broadcast.content.subject,
                  preheader: r.preheader ?? broadcast.content.preheader,
                  bodyHtml: r.bodyHtml ?? broadcast.content.bodyHtml,
                  bodyText: r.bodyText ?? broadcast.content.bodyText,
                })
                setAiOpen(false)
              }}
            />
          </div>
        </div>
      )}

      {tab === 'stats' && (
        <div className="space-y-4">
          {!stats ? (
            <div className="h-20 rounded-xl bg-surface-container animate-pulse" />
          ) : (
            <>
              <div className="grid grid-cols-4 gap-3">
                <Stat label="Audience" value={stats.audienceSize} />
                <Stat label="Sent" value={stats.stats.sent} />
                <Stat label="Delivered" value={stats.stats.delivered} />
                <Stat label="Failed" value={stats.stats.failed} />
                <Stat label="Opened" value={stats.stats.opened} />
                <Stat label="Clicked" value={stats.stats.clicked} />
                <Stat label="Bounced" value={stats.stats.bounced} />
                <Stat label="Unsubscribed" value={stats.stats.unsubscribed} />
              </div>
              <div className="grid grid-cols-4 gap-3">
                <Stat label="Delivery rate" value={`${(stats.rates.deliveryRate * 100).toFixed(1)}%`} />
                <Stat label="Open rate" value={`${(stats.rates.openRate * 100).toFixed(1)}%`} />
                <Stat label="Click rate" value={`${(stats.rates.clickRate * 100).toFixed(1)}%`} />
                <Stat label="Unsub rate" value={`${(stats.rates.unsubRate * 100).toFixed(1)}%`} />
              </div>
              <p className="text-xs text-on-surface-variant">Updates every 10 seconds.</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="p-3 rounded-xl bg-surface-container">
      <p className="text-xs text-on-surface-variant">{label}</p>
      <p className="text-xl font-semibold text-on-surface tabular-nums">{value}</p>
    </div>
  )
}
