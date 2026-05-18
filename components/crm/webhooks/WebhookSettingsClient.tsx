'use client'

import { useEffect, useMemo, useState } from 'react'
import type { WebhookEvent } from '@/lib/webhooks/types'
import { VALID_WEBHOOK_EVENTS } from '@/lib/webhooks/types'

type CatalogEvent = {
  event: string
  label: string
  description: string
  group: 'Contacts' | 'Deals' | 'Quotes'
  example: Record<string, unknown>
}

type OutboundWebhook = {
  id: string
  name: string
  url: string
  events: WebhookEvent[]
  active: boolean
  failureCount?: number
  lastDeliveredAt?: unknown
  lastFailureAt?: unknown
  autoDisabledAt?: unknown
}

const CRM_EVENT_CATALOG: CatalogEvent[] = [
  {
    event: 'contact.created',
    label: 'Contact created',
    description: 'A new CRM contact is added to the workspace.',
    group: 'Contacts',
    example: {
      id: 'contact_123',
      firstName: 'Ava',
      lastName: 'Naidoo',
      email: 'ava@example.com',
      company: 'Northstar Studio',
      source: 'portal',
    },
  },
  {
    event: 'contact.lifecycle_changed',
    label: 'Contact lifecycle changed',
    description: 'A contact moves between lead, prospect, customer, or similar lifecycle stages.',
    group: 'Contacts',
    example: {
      id: 'contact_123',
      previousLifecycleStage: 'lead',
      lifecycleStage: 'customer',
      changedByRef: { type: 'user', id: 'user_456', label: 'Peet Stander' },
    },
  },
  {
    event: 'deal.created',
    label: 'Deal created',
    description: 'A new deal is created in the CRM pipeline.',
    group: 'Deals',
    example: {
      id: 'deal_123',
      title: 'Website growth retainer',
      value: 18000,
      currency: 'ZAR',
      pipelineId: 'pipeline_sales',
      stageId: 'stage_discovery',
    },
  },
  {
    event: 'deal.stage_changed',
    label: 'Deal stage changed',
    description: 'A deal moves from one pipeline stage to another.',
    group: 'Deals',
    example: {
      id: 'deal_123',
      title: 'Website growth retainer',
      pipelineId: 'pipeline_sales',
      stageId: 'stage_proposal',
      stageLabel: 'Proposal',
      previousStageId: 'stage_discovery',
      previousStageLabel: 'Discovery',
    },
  },
  {
    event: 'deal.won',
    label: 'Deal won',
    description: 'A deal reaches a won stage.',
    group: 'Deals',
    example: {
      id: 'deal_123',
      title: 'Website growth retainer',
      value: 18000,
      currency: 'ZAR',
      stageKind: 'won',
    },
  },
  {
    event: 'deal.lost',
    label: 'Deal lost',
    description: 'A deal reaches a lost stage.',
    group: 'Deals',
    example: {
      id: 'deal_123',
      title: 'Website growth retainer',
      value: 18000,
      currency: 'ZAR',
      lostReason: 'Budget shifted',
      stageKind: 'lost',
    },
  },
  {
    event: 'quote.created',
    label: 'Quote created',
    description: 'A quote is created for a CRM contact or deal.',
    group: 'Quotes',
    example: {
      id: 'quote_123',
      quoteNumber: 'Q-2026-0042',
      contactId: 'contact_123',
      dealId: 'deal_123',
      total: 18000,
      currency: 'ZAR',
      status: 'draft',
    },
  },
  {
    event: 'quote.accepted',
    label: 'Quote accepted',
    description: 'A sent quote is accepted.',
    group: 'Quotes',
    example: {
      id: 'quote_123',
      quoteNumber: 'Q-2026-0042',
      contactId: 'contact_123',
      dealId: 'deal_123',
      acceptedAt: '2026-05-18T10:00:00.000Z',
    },
  },
  {
    event: 'quote.rejected',
    label: 'Quote rejected',
    description: 'A sent quote is rejected.',
    group: 'Quotes',
    example: {
      id: 'quote_123',
      quoteNumber: 'Q-2026-0042',
      contactId: 'contact_123',
      dealId: 'deal_123',
      rejectedAt: '2026-05-18T10:00:00.000Z',
      rejectionReason: 'Timing is not right',
    },
  },
]

const SUPPORTED_EVENTS = new Set<string>(VALID_WEBHOOK_EVENTS)

function eventLabel(event: string) {
  return CRM_EVENT_CATALOG.find((item) => item.event === event)?.label ?? event
}

function formatDate(value: unknown) {
  if (!value) return 'Never'
  if (typeof value === 'string') return new Date(value).toLocaleString()
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    const seconds = Number((value as { seconds?: unknown }).seconds)
    if (Number.isFinite(seconds)) return new Date(seconds * 1000).toLocaleString()
  }
  return 'Recorded'
}

function parseApiError(body: unknown, fallback: string) {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: unknown }).error
    if (typeof error === 'string' && error.trim()) return error
  }
  return fallback
}

export function WebhookSettingsClient() {
  const [orgId, setOrgId] = useState('')
  const [webhooks, setWebhooks] = useState<OutboundWebhook[]>([])
  const [selectedEvent, setSelectedEvent] = useState(CRM_EVENT_CATALOG[0].event)
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['contact.created'])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [secretOnce, setSecretOnce] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedCatalogEvent = CRM_EVENT_CATALOG.find((item) => item.event === selectedEvent) ?? CRM_EVENT_CATALOG[0]
  const supportedCatalog = useMemo(
    () => CRM_EVENT_CATALOG.filter((item) => SUPPORTED_EVENTS.has(item.event)),
    [],
  )
  const subscribedEvents = useMemo(
    () => new Set(webhooks.flatMap((item) => item.events ?? [])),
    [webhooks],
  )

  async function loadWebhooks(nextOrgId = orgId) {
    if (!nextOrgId) return
    setError(null)
    const res = await fetch(`/api/v1/crm/webhooks?limit=100&orgId=${encodeURIComponent(nextOrgId)}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(parseApiError(body, 'Failed to load webhook subscriptions.'))
    const items: OutboundWebhook[] = body.data?.items ?? body.items ?? []
    setWebhooks(Array.isArray(items) ? items : [])
  }

  useEffect(() => {
    let cancelled = false

    async function boot() {
      setLoading(true)
      setError(null)
      try {
        const activeOrgRes = await fetch('/api/v1/portal/active-org')
        const activeOrgBody = await activeOrgRes.json().catch(() => ({}))
        if (!activeOrgRes.ok || !activeOrgBody.orgId) {
          throw new Error(parseApiError(activeOrgBody, 'No active workspace found.'))
        }
        if (cancelled) return
        setOrgId(activeOrgBody.orgId)
        await loadWebhooks(activeOrgBody.orgId)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load webhook settings.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    boot()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleEvent(event: string) {
    if (!SUPPORTED_EVENTS.has(event)) return
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((item) => item !== event) : [...prev, event],
    )
  }

  async function createWebhook() {
    if (!orgId || saving) return
    setSaving(true)
    setError(null)
    setMessage(null)
    setSecretOnce('')

    try {
      const events = selectedEvents.filter((event): event is WebhookEvent =>
        VALID_WEBHOOK_EVENTS.includes(event as WebhookEvent),
      )
      const res = await fetch('/api/v1/crm/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          url: url.trim(),
          events,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(parseApiError(body, 'Failed to create webhook.'))
      setSecretOnce(body.data?.secretOnce ?? '')
      setName('')
      setUrl('')
      setSelectedEvents(['contact.created'])
      setMessage('Webhook subscription created.')
      await loadWebhooks(orgId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook.')
    } finally {
      setSaving(false)
    }
  }

  async function postAction(webhook: OutboundWebhook, action: 'enable' | 'disable' | 'test') {
    if (busyId) return
    setBusyId(`${webhook.id}:${action}`)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/v1/crm/webhooks/${webhook.id}/${action}`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(parseApiError(body, `Failed to ${action} webhook.`))
      setMessage(action === 'test' ? 'Test delivery queued.' : `Webhook ${action === 'enable' ? 'enabled' : 'disabled'}.`)
      await loadWebhooks(orgId)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} webhook.`)
    } finally {
      setBusyId(null)
    }
  }

  const canCreate = Boolean(name.trim() && url.trim() && selectedEvents.length > 0 && !saving)

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-lg font-semibold mb-1">Webhook subscriptions</h1>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            Send CRM events to external systems with signed outbound webhooks.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadWebhooks()}
          disabled={loading || !orgId}
          className="cursor-pointer btn-pib-secondary flex items-center gap-1.5 text-sm w-fit disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg border border-red-400/25 bg-red-400/10 text-sm text-red-200">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 px-4 py-3 rounded-lg border border-emerald-400/25 bg-emerald-400/10 text-sm text-emerald-200">
          {message}
        </div>
      )}
      {secretOnce && (
        <div className="mb-6 bento-card border-amber-400/30 bg-amber-400/10">
          <p className="text-sm font-medium text-amber-100 mb-2">Save this signing secret now</p>
          <code className="block text-xs text-amber-50 break-all rounded-lg bg-black/30 border border-amber-400/20 px-3 py-2">
            {secretOnce}
          </code>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <section className="space-y-5">
          <div className="bento-card !p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--color-pib-line)] flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Event catalog</h2>
                <p className="text-xs text-[var(--color-pib-text-muted)]">Choose an event to preview its payload.</p>
              </div>
              <span className="text-[10px] px-2 py-1 rounded-full bg-[var(--color-pib-line-strong)] text-[var(--color-pib-text-muted)]">
                {supportedCatalog.length} subscribable
              </span>
            </div>

            <div className="divide-y divide-[var(--color-pib-line)]">
              {CRM_EVENT_CATALOG.map((item) => {
                const supported = SUPPORTED_EVENTS.has(item.event)
                const selected = selectedEvent === item.event
                const subscribed = subscribedEvents.has(item.event as WebhookEvent)

                return (
                  <button
                    key={item.event}
                    type="button"
                    onClick={() => setSelectedEvent(item.event)}
                    className={[
                      'cursor-pointer w-full text-left px-4 py-3 transition-colors',
                      selected ? 'bg-[var(--color-pib-accent-soft)]' : 'hover:bg-white/[0.03]',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-sm font-medium">{item.label}</span>
                          <code className="text-[10px] text-[var(--color-pib-text-muted)] bg-black/20 border border-[var(--color-pib-line)] rounded px-1.5 py-0.5">
                            {item.event}
                          </code>
                          {!supported && (
                            <span className="text-[10px] text-amber-300 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5">
                              catalog only
                            </span>
                          )}
                          {subscribed && (
                            <span className="text-[10px] text-emerald-300 bg-emerald-400/10 border border-emerald-400/20 rounded-full px-2 py-0.5">
                              subscribed
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--color-pib-text-muted)]">{item.description}</p>
                      </div>
                      <span className="text-[10px] text-[var(--color-pib-text-muted)] shrink-0">{item.group}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="bento-card">
            <h2 className="text-sm font-semibold mb-1">Payload example</h2>
            <p className="text-xs text-[var(--color-pib-text-muted)] mb-3">
              Deliveries are signed with <code>X-PIB-Signature</code> and include the selected event payload.
            </p>
            <pre className="max-h-[360px] overflow-auto rounded-lg border border-[var(--color-pib-line)] bg-black/30 p-4 text-xs leading-relaxed text-[var(--color-pib-text)]">
{JSON.stringify(
  {
    event: selectedCatalogEvent.event,
    payload: selectedCatalogEvent.example,
  },
  null,
  2,
)}
            </pre>
          </div>
        </section>

        <aside className="space-y-5">
          <div className="bento-card">
            <h2 className="text-sm font-semibold mb-1">Create subscription</h2>
            <p className="text-xs text-[var(--color-pib-text-muted)] mb-4">
              Use an HTTPS endpoint that accepts signed POST requests.
            </p>

            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-[var(--color-pib-text-muted)]">Name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="CRM events to Zapier"
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-pib-accent)]"
                />
              </label>
              <label className="block">
                <span className="text-xs text-[var(--color-pib-text-muted)]">Endpoint URL</span>
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/pib-webhook"
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-pib-accent)]"
                />
              </label>

              <div>
                <p className="text-xs text-[var(--color-pib-text-muted)] mb-2">Events</p>
                <div className="grid gap-2">
                  {CRM_EVENT_CATALOG.map((item) => {
                    const supported = SUPPORTED_EVENTS.has(item.event)
                    const checked = selectedEvents.includes(item.event)
                    return (
                      <label
                        key={item.event}
                        className={[
                          'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
                          supported
                            ? 'cursor-pointer border-[var(--color-pib-line)] hover:bg-white/[0.03]'
                            : 'cursor-not-allowed border-[var(--color-pib-line)] opacity-55',
                        ].join(' ')}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!supported}
                          onChange={() => toggleEvent(item.event)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">{item.label}</span>
                          <code className="block text-[10px] text-[var(--color-pib-text-muted)] truncate">{item.event}</code>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={createWebhook}
                disabled={!canCreate}
                className="cursor-pointer btn-pib-accent w-full flex items-center justify-center gap-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                {saving ? 'Creating...' : 'Create webhook'}
              </button>
            </div>
          </div>

          <div className="bento-card !p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--color-pib-line)]">
              <h2 className="text-sm font-semibold">Subscriptions</h2>
              <p className="text-xs text-[var(--color-pib-text-muted)]">Existing outbound CRM webhook endpoints.</p>
            </div>

            {loading ? (
              <p className="p-4 text-sm text-[var(--color-pib-text-muted)]">Loading...</p>
            ) : webhooks.length === 0 ? (
              <div className="p-6 text-center">
                <span className="material-symbols-outlined block text-[32px] text-[var(--color-pib-text-muted)] mb-2">
                  webhook
                </span>
                <p className="text-sm text-[var(--color-pib-text-muted)]">No webhook subscriptions yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-pib-line)]">
                {webhooks.map((webhook) => (
                  <div key={webhook.id} className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{webhook.name}</p>
                        <p className="text-xs text-[var(--color-pib-text-muted)] truncate">{webhook.url}</p>
                      </div>
                      <span
                        className={[
                          'text-[10px] rounded-full border px-2 py-0.5 shrink-0',
                          webhook.active
                            ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                            : 'border-amber-400/20 bg-amber-400/10 text-amber-300',
                        ].join(' ')}
                      >
                        {webhook.active ? 'Active' : 'Paused'}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {(webhook.events ?? []).map((event) => (
                        <span
                          key={event}
                          className="text-[10px] rounded-full border border-[var(--color-pib-line)] bg-black/20 px-2 py-0.5 text-[var(--color-pib-text-muted)]"
                        >
                          {eventLabel(event)}
                        </span>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--color-pib-text-muted)] mb-3">
                      <span>Last delivery: {formatDate(webhook.lastDeliveredAt)}</span>
                      <span>Failures: {webhook.failureCount ?? 0}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => postAction(webhook, 'test')}
                        disabled={busyId !== null}
                        className="cursor-pointer btn-pib-secondary flex items-center gap-1.5 text-xs disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[14px]">send</span>
                        Test
                      </button>
                      <button
                        type="button"
                        onClick={() => postAction(webhook, webhook.active ? 'disable' : 'enable')}
                        disabled={busyId !== null}
                        className="cursor-pointer btn-pib-secondary flex items-center gap-1.5 text-xs disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {webhook.active ? 'pause' : 'play_arrow'}
                        </span>
                        {webhook.active ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
