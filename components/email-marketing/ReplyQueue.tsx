'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

type Classification = 'positive' | 'negative' | 'out_of_office' | 'neutral'
type Reply = {
  id: string; inboundId: string; contactId: string; ownerUserId: string | null; queueId: string | null; salespersonUid: string | null
  campaignId: string; programId: string; sequenceId: string; broadcastId: string; subject: string; bodyText: string; fromEmail: string
  receivedAt: number | null; classification: Classification; modelClassification: Classification; confidence: number | null
  corrected: boolean; correctedBy: string | null; slaDueAt: number | null; slaState: 'due' | 'missed' | 'completed'
  escalationState: 'not_due' | 'escalation_due' | 'completed'; escalationPath: string[]
}

const CLASSIFICATIONS: Classification[] = ['positive', 'neutral', 'negative', 'out_of_office']
const label = (value: string) => value.replaceAll('_', ' ')

export function ReplyQueue({ scope }: { scope: PortalOrgRouteScope }) {
  const [items, setItems] = useState<Reply[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [classification, setClassification] = useState('')
  const [sla, setSla] = useState('')
  const [owner, setOwner] = useState('')
  const [queue, setQueue] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? items[0] ?? null, [items, selectedId])

  const load = useCallback(async (cursor: string | null = null, append = false) => {
    setLoading(true); setError('')
    const params = new URLSearchParams()
    if (scope.orgId) params.set('orgId', scope.orgId)
    if (classification) params.set('classification', classification)
    if (sla) params.set('sla', sla)
    if (owner.trim()) params.set('ownerUserId', owner.trim())
    if (queue.trim()) params.set('queueId', queue.trim())
    if (cursor) params.set('cursor', cursor)
    try {
      const response = await fetch(`/api/v1/email-marketing/replies?${params}`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not load replies')
      setItems((current) => append ? [...current, ...(payload.data.items ?? [])] : (payload.data.items ?? []))
      setNextCursor(payload.data.nextCursor ?? null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load replies') }
    finally { setLoading(false) }
  }, [classification, owner, queue, scope.orgId, sla])

  useEffect(() => { void load(null, false) }, [load])

  async function correct(item: Reply, next: Classification) {
    const response = await fetch(`/api/v1/email-marketing/replies/${encodeURIComponent(item.id)}/classification${scope.orgId ? `?orgId=${encodeURIComponent(scope.orgId)}` : ''}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ classification: next }),
    })
    if (!response.ok) { setError('Could not save classification correction'); return }
    const payload = await response.json()
    const effective = payload.data?.reply
    setItems((current) => current.map((entry) => entry.id === item.id ? {
      ...entry,
      classification: effective?.classification ?? entry.classification,
      corrected: effective?.corrected ?? entry.corrected,
      correctedBy: effective?.correctedBy ?? entry.correctedBy,
    } : entry))
  }

  return (
    <section className="grid min-h-[620px] min-w-0 lg:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)]">
      <div className="min-w-0 border-b border-[var(--color-card-border)] lg:border-b-0 lg:border-r">
        <div className="border-b border-[var(--color-card-border)] p-3">
          <div className="flex items-center justify-between gap-2"><h1 className="text-sm">Sales reply queue</h1><button onClick={() => void load(null, false)} className="text-xs text-primary">Refresh</button></div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <select aria-label="Classification" value={classification} onChange={(e) => setClassification(e.target.value)} className="rounded-md border border-[var(--color-card-border)] bg-transparent px-2 py-1.5 text-xs"><option value="">All classifications</option>{CLASSIFICATIONS.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select>
            <select aria-label="SLA state" value={sla} onChange={(e) => setSla(e.target.value)} className="rounded-md border border-[var(--color-card-border)] bg-transparent px-2 py-1.5 text-xs"><option value="">Any SLA</option><option value="due">Due</option><option value="missed">Missed</option></select>
            <input aria-label="Owner user ID" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Owner user ID" className="rounded-md border border-[var(--color-card-border)] bg-transparent px-2 py-1.5 text-xs" />
            <input aria-label="Queue ID" value={queue} onChange={(e) => setQueue(e.target.value)} placeholder="Queue ID" className="rounded-md border border-[var(--color-card-border)] bg-transparent px-2 py-1.5 text-xs" />
          </div>
          {error ? <p role="alert" className="mt-2 text-xs text-error">{error}</p> : null}
        </div>
        <div className="max-h-[540px] overflow-auto">
          {loading ? <p className="p-4 text-xs text-[var(--color-pib-text-muted)]">Loading replies…</p> : items.length === 0 ? <p className="p-4 text-xs text-[var(--color-pib-text-muted)]">No replies match these filters.</p> : items.map((item) => (
            <button key={item.id} onClick={() => setSelectedId(item.id)} className={`block w-full border-b border-[var(--color-card-border)] p-3 text-left ${selected?.id === item.id ? 'bg-primary/[0.06]' : 'hover:bg-white/[0.025]'}`}>
              <div className="flex items-center gap-2"><span className="rounded bg-[var(--color-pib-blue-soft)] px-1.5 py-0.5 text-[10px] capitalize text-[var(--color-pib-blue)]">{label(item.classification)}</span><span className={`ml-auto text-[10px] font-medium uppercase ${item.slaState === 'missed' ? 'text-error' : 'text-[var(--color-pib-text-muted)]'}`}>{item.slaState === 'missed' ? 'SLA missed' : item.slaState}</span></div>
              <p className="mt-1 truncate text-xs font-medium">{item.subject || '(no subject)'}</p><p className="truncate text-[11px] text-[var(--color-pib-text-muted)]">{item.fromEmail}</p>
            </button>
          ))}{nextCursor ? <button aria-label="Load more replies" onClick={() => void load(nextCursor, true)} className="w-full p-3 text-xs font-medium text-primary">Load more</button> : null}
        </div>
      </div>
      <div className="min-w-0 p-4">
        {!selected ? <p className="text-sm text-[var(--color-pib-text-muted)]">Select a reply to inspect its CRM handoff.</p> : <div className="space-y-4">
          <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-base">{selected.subject || '(no subject)'}</h2>{selected.corrected ? <span className="text-[10px] text-[var(--color-pib-text-muted)]">Human-corrected</span> : null}</div><p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">From {selected.fromEmail}{selected.receivedAt ? ` · ${new Date(selected.receivedAt).toLocaleString()}` : ''}</p></div>
          <div className="grid gap-2 sm:grid-cols-3"><Fact title="Owner" value={selected.ownerUserId || 'Unassigned'} /><Fact title="Queue" value={selected.queueId || 'No queue'} /><Fact title="Salesperson" value={selected.salespersonUid || 'Unresolved'} /><Fact title="Escalation" value={selected.escalationState === 'escalation_due' ? 'Due now' : selected.escalationState || 'Not due'} /><Fact title="Escalation path" value={selected.escalationPath?.join(' → ') || 'Organisation fallback'} /></div>
          <div className="rounded-lg border border-[var(--color-card-border)] p-3"><p className="text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">Classification</p><div className="mt-2 flex flex-wrap items-center gap-2"><select aria-label="Correct classification" value={selected.classification} onChange={(e) => void correct(selected, e.target.value as Classification)} className="rounded-md border border-[var(--color-card-border)] bg-transparent px-2 py-1 text-xs">{CLASSIFICATIONS.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select><span className="text-[11px] text-[var(--color-pib-text-muted)]">Model: {label(selected.modelClassification)}{Number.isFinite(selected.confidence) ? ` · ${Math.round((selected.confidence ?? 0) * 100)}% confidence` : ''}</span></div></div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><Lineage scope={scope} label="Contact" id={selected.contactId} path="/portal/contacts" /><Lineage scope={scope} label="Campaign" id={selected.campaignId} path="/portal/campaigns" /><Lineage scope={scope} label="Program" id={selected.programId} path="/portal/marketing" /><Lineage scope={scope} label="Journey" id={selected.sequenceId} path="/portal/sequences" /><Lineage scope={scope} label="Broadcast" id={selected.broadcastId} path="/portal/broadcasts" /></div>
          <div className="rounded-lg border border-[var(--color-card-border)] bg-black/[0.08] p-4"><p className="whitespace-pre-wrap text-sm leading-6">{selected.bodyText || '(No plain-text body)'}</p></div>
        </div>}
      </div>
    </section>
  )
}

function Fact({ title, value }: { title: string; value: string }) { return <div className="rounded-md bg-white/[0.025] p-2"><p className="text-[10px] uppercase text-[var(--color-pib-text-muted)]">{title}</p><p className="mt-1 truncate text-xs">{value}</p></div> }
function Lineage({ scope, label: title, id, path }: { scope: PortalOrgRouteScope; label: string; id: string; path: string }) { return <div className="rounded-md border border-[var(--color-card-border)] p-2"><p className="text-[10px] uppercase text-[var(--color-pib-text-muted)]">{title}</p>{id ? <Link className="mt-1 block truncate text-xs text-primary" href={scopedPortalPath(`${path}/${id}`, scope)}>{id}</Link> : <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Not linked</p>}</div> }
