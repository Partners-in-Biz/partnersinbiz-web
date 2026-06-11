'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'

type Intent = 'reply' | 'auto-reply' | 'bounce-reply' | 'unsubscribe-reply' | 'unknown' | ''

interface InboundRow {
  id: string
  orgId: string
  fromEmail: string
  fromName: string
  toEmail: string
  subject: string
  bodyText: string
  intent: Exclude<Intent, ''>
  contactId: string
  sequenceId: string
  campaignId: string
  broadcastId: string
  processed: boolean
  receivedAt?: { _seconds?: number; toMillis?: () => number }
  createdAt?: { _seconds?: number; toMillis?: () => number }
}

const INTENT_BADGE: Record<Exclude<Intent, ''>, string> = {
  reply: 'bg-emerald-100 text-emerald-800',
  'auto-reply': 'bg-sky-100 text-sky-800',
  'bounce-reply': 'bg-amber-100 text-amber-800',
  'unsubscribe-reply': 'bg-rose-100 text-rose-800',
  unknown: 'bg-surface-container text-on-surface-variant',
}

function tsToMillis(ts: InboundRow['receivedAt']): number {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts._seconds === 'number') return ts._seconds * 1000
  return 0
}

export default function InboundEmailsPage() {
  const [items, setItems] = useState<InboundRow[]>([])
  const [loading, setLoading] = useState(true)
  const [intent, setIntent] = useState<Intent>('')
  const [processed, setProcessed] = useState<'' | 'true' | 'false'>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (intent) params.set('intent', intent)
      if (processed) params.set('processed', processed)
      params.set('limit', '200')
      const res = await fetch(`/api/v1/email/inbound?${params.toString()}`)
      const body = await res.json()
      if (res.ok && Array.isArray(body.data)) {
        setItems(body.data as InboundRow[])
      } else {
        setItems([])
      }
    } finally {
      setLoading(false)
    }
  }, [intent, processed])

  useEffect(() => {
    load()
  }, [load])

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId])

  return (
    <div className="flex h-full -m-6 overflow-hidden">
      <div className="w-[460px] border-r border-outline-variant flex flex-col">
        <div className="p-4 border-b border-outline-variant space-y-2">
          <h1 className="text-lg font-headline font-semibold text-on-surface">Inbound replies</h1>
          <div className="flex gap-2">
            <select
              value={intent}
              onChange={(e) => setIntent(e.target.value as Intent)}
              className="text-xs rounded-md border border-outline-variant bg-surface px-2 py-1"
            >
              <option value="">All intents</option>
              <option value="reply">Reply</option>
              <option value="auto-reply">Auto-reply</option>
              <option value="bounce-reply">Bounce</option>
              <option value="unsubscribe-reply">Unsubscribe</option>
              <option value="unknown">Unknown</option>
            </select>
            <select
              value={processed}
              onChange={(e) => setProcessed(e.target.value as '' | 'true' | 'false')}
              className="text-xs rounded-md border border-outline-variant bg-surface px-2 py-1"
            >
              <option value="">Any state</option>
              <option value="true">Processed</option>
              <option value="false">Unprocessed</option>
            </select>
            <button
              onClick={load}
              className="ml-auto text-xs px-3 py-1 rounded-md bg-surface-container text-on-surface hover:bg-surface-container-high"
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-4 text-sm text-on-surface-variant">Loading…</div>
          ) : items.length === 0 ? (
            <div className="p-4 text-sm text-on-surface-variant">No inbound emails yet.</div>
          ) : (
            <ul className="divide-y divide-outline-variant">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    onClick={() => setSelectedId(it.id)}
                    className={`w-full text-left p-3 hover:bg-surface-container transition ${selectedId === it.id ? 'bg-surface-container' : ''}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`inline-block text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${INTENT_BADGE[it.intent] ?? INTENT_BADGE.unknown}`}
                      >
                        {it.intent}
                      </span>
                      {!it.processed && (
                        <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">
                          Queued
                        </span>
                      )}
                      <span className="ml-auto text-[11px] text-on-surface-variant tabular-nums">
                        {new Date(tsToMillis(it.receivedAt) || tsToMillis(it.createdAt)).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-on-surface truncate">
                      {it.fromName ? `${it.fromName} <${it.fromEmail}>` : it.fromEmail}
                    </div>
                    <div className="text-sm text-on-surface-variant truncate">{it.subject || '(no subject)'}</div>
                    <div className="text-xs text-on-surface-variant truncate mt-1">
                      {(it.bodyText ?? '').slice(0, 120)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {!selected ? (
          <div className="p-8 text-sm text-on-surface-variant">Select an inbound email to view details.</div>
        ) : (
          <div className="p-6 space-y-5 max-w-3xl">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${INTENT_BADGE[selected.intent] ?? INTENT_BADGE.unknown}`}
              >
                {selected.intent}
              </span>
              <span className="text-[11px] text-on-surface-variant">
                Received {new Date(tsToMillis(selected.receivedAt) || tsToMillis(selected.createdAt)).toLocaleString()}
              </span>
            </div>

            <div>
              <h2 className="text-xl font-headline font-semibold text-on-surface">
                {selected.subject || '(no subject)'}
              </h2>
              <p className="text-sm text-on-surface-variant mt-1">
                From {selected.fromName ? `${selected.fromName} <${selected.fromEmail}>` : selected.fromEmail}
              </p>
              <p className="text-sm text-on-surface-variant">To {selected.toEmail}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <Pair label="Contact" value={selected.contactId} link={selected.contactId ? `/portal/contacts/${selected.contactId}` : ''} />
              <Pair label="Sequence" value={selected.sequenceId} link={selected.sequenceId ? `/portal/sequences/${selected.sequenceId}` : ''} />
              <Pair label="Campaign" value={selected.campaignId} link={selected.campaignId ? `/portal/campaigns/${selected.campaignId}` : ''} />
              <Pair label="Broadcast" value={selected.broadcastId} link={selected.broadcastId ? `/portal/broadcasts/${selected.broadcastId}` : ''} />
            </div>

            <div className="rounded-xl border border-outline-variant bg-surface-container p-4">
              <pre className="whitespace-pre-wrap text-sm text-on-surface font-mono">
                {selected.bodyText || '(no text body — original was HTML-only)'}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Pair({ label, value, link }: { label: string; value: string; link: string }) {
  return (
    <div className="p-2 rounded-lg bg-surface-container">
      <div className="text-[10px] uppercase tracking-wide text-on-surface-variant">{label}</div>
      {value ? (
        link ? (
          <a href={link} className="text-on-surface hover:underline">
            {value}
          </a>
        ) : (
          <span className="text-on-surface">{value}</span>
        )
      ) : (
        <span className="text-on-surface-variant">—</span>
      )}
    </div>
  )
}
