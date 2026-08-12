'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { SystemLinkBadge } from '@/components/crm/SystemLinkBadge'

interface Overview {
  relationshipId: string
  partnerOrgId: string
  partnerOrgName: string
  companyId?: string
  sharedCapabilities: string[]
  status: string
  counts: {
    sharedOut: number
    sharedWithMe: number
    projectsSharedOut: number
    projectsSharedWithMe: number
    catalogItems: number
    ordersPlaced: number
    ordersReceived: number
    openOrders: number
    messages: number
  }
  tradeValue: { placed: number; received: number; currency: string }
}

interface Message {
  id: string
  authorOrgId: string
  authorRef?: { displayName?: string }
  body: string
  createdAt?: { seconds?: number; _seconds?: number }
}

interface ProjectAccess {
  id: string
  projectId: string
  projectName?: string
  orgId: string
  ownerOrgId?: string
  role: string
}

interface OrgProject { id: string; name: string }

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return (b.data as Record<string, unknown>) ?? b
}

function money(v: number, c: string): string {
  try { return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: c }).format(v) }
  catch { return `${c} ${(v ?? 0).toFixed(2)}` }
}

const CARD = 'rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)]'

export default function PartnerOverviewPage({ params }: { params: Promise<{ relationshipId: string }> }) {
  const { relationshipId } = use(params)

  const [overview, setOverview] = useState<Overview | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [projects, setProjects] = useState<{ sharedOut: ProjectAccess[]; sharedWithMe: ProjectAccess[] }>(
    { sharedOut: [], sharedWithMe: [] })
  const [myProjects, setMyProjects] = useState<OrgProject[]>([])
  const [draft, setDraft] = useState('')
  const [projectId, setProjectId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ovRes, msgRes, projRes, mineRes] = await Promise.all([
        fetch(`/api/v1/crm/partner-links/${relationshipId}/overview`),
        fetch(`/api/v1/crm/partner-links/${relationshipId}/messages`),
        fetch('/api/v1/crm/partner-projects'),
        fetch('/api/v1/projects'),
      ])
      const ov = unwrap(await ovRes.json().catch(() => null))
      if (!ovRes.ok) { setError((ov?.error as string) || 'This partner is not available.'); return }
      setOverview(ov as unknown as Overview)

      const msg = unwrap(await msgRes.json().catch(() => null))
      if (msgRes.ok) setMessages((msg?.messages as Message[]) ?? [])

      const proj = unwrap(await projRes.json().catch(() => null))
      if (projRes.ok) {
        setProjects({
          sharedOut: (proj?.sharedOut as ProjectAccess[]) ?? [],
          sharedWithMe: (proj?.sharedWithMe as ProjectAccess[]) ?? [],
        })
      }
      // /api/v1/projects returns a bare array in `data`, not { projects }.
      const mineBody = await mineRes.json().catch(() => null) as Record<string, unknown> | null
      const mineList = Array.isArray(mineBody?.data) ? mineBody.data : Array.isArray(mineBody) ? mineBody : []
      if (mineRes.ok) setMyProjects(mineList as OrgProject[])
    } catch {
      setError('This partner is not available.')
    } finally {
      setLoading(false)
    }
  }, [relationshipId])

  useEffect(() => { void load() }, [load])

  async function send() {
    if (!draft.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/v1/crm/partner-links/${relationshipId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft.trim() }),
      })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) { setError((data?.error as string) || 'Could not send.'); return }
      setDraft('')
      await load()
    } finally { setBusy(false) }
  }

  async function shareProject() {
    if (!projectId) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/v1/crm/partner-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relationshipId, projectId }),
      })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) { setError((data?.error as string) || 'Could not share the project.'); return }
      setNotice('Project shared.'); setProjectId('')
      await load()
    } finally { setBusy(false) }
  }

  async function unshareProject(access: ProjectAccess) {
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await fetch(
        `/api/v1/crm/partner-projects?projectId=${encodeURIComponent(access.projectId)}&partnerOrgId=${encodeURIComponent(access.orgId)}`,
        { method: 'DELETE' })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) { setError((data?.error as string) || 'Could not remove access.'); return }
      setNotice('Access removed.')
      await load()
    } finally { setBusy(false) }
  }

  if (loading) return <div className="p-4 text-sm text-[var(--color-pib-text-muted)]">Loading…</div>
  if (error && !overview) {
    return (
      <div className="p-4">
        <Link href="/portal/partners" className="text-xs text-[var(--color-pib-text-muted)]">← Back to partners</Link>
        <p className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
      </div>
    )
  }
  if (!overview) return null

  const c = overview.counts
  const outForThisPartner = projects.sharedOut.filter((p) => p.orgId === overview.partnerOrgId)
  const inFromThisPartner = projects.sharedWithMe.filter((p) => p.ownerOrgId === overview.partnerOrgId)
  const shareable = myProjects.filter((p) => !outForThisPartner.some((a) => a.projectId === p.id))

  const tiles = [
    { label: 'Shared out', value: c.sharedOut },
    { label: 'Shared with you', value: c.sharedWithMe },
    { label: 'Catalogue items', value: c.catalogItems },
    { label: 'Open orders', value: c.openOrders },
    { label: 'Orders received', value: c.ordersReceived },
    { label: 'Orders placed', value: c.ordersPlaced },
  ]

  return (
    <div className="space-y-5 p-4">
      <header>
        <Link href="/portal/partners" className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
          ← Back to partners
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--color-pib-text)]">
            {overview.partnerOrgName}
          </h1>
          <SystemLinkBadge kind="org" size="md" />
          <span className="pib-pill px-2 py-0.5 text-[10px]">{overview.status}</span>
        </div>
        <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
          You share: {overview.sharedCapabilities.join(', ') || 'nothing yet'}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link href={`/portal/partners/catalog/${relationshipId}`} className="rounded-lg border border-[var(--color-pib-line)] px-3 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition hover:text-[var(--color-pib-text)]">
            Order from them
          </Link>
          <Link href="/portal/partners/orders" className="rounded-lg border border-[var(--color-pib-line)] px-3 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition hover:text-[var(--color-pib-text)]">
            Orders
          </Link>
          <Link href="/portal/partners/settlements" className="rounded-lg border border-[var(--color-pib-line)] px-3 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition hover:text-[var(--color-pib-text)]">
            Settlements
          </Link>
          {overview.companyId ? (
            <Link href={`/portal/companies/${overview.companyId}`} className="rounded-lg border border-[var(--color-pib-line)] px-3 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition hover:text-[var(--color-pib-text)]">
              Company record
            </Link>
          ) : null}
        </div>
      </header>

      {error ? <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p> : null}
      {notice ? <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p> : null}

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className={`${CARD} p-3`}>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">{t.label}</p>
            <p className="mt-1 text-lg font-semibold text-[var(--color-pib-text)]">{t.value}</p>
          </div>
        ))}
      </section>

      <section className={`${CARD} grid gap-4 p-4 sm:grid-cols-2`}>
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">Confirmed sales to them</p>
          <p className="mt-1 font-mono text-lg text-[var(--color-pib-text)]">
            {money(overview.tradeValue.received, overview.tradeValue.currency)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">Confirmed purchases from them</p>
          <p className="mt-1 font-mono text-lg text-[var(--color-pib-text)]">
            {money(overview.tradeValue.placed, overview.tradeValue.currency)}
          </p>
        </div>
      </section>

      <section className={`${CARD} p-4`}>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-pib-text)]">Shared projects</h2>

        {outForThisPartner.length === 0 && inFromThisPartner.length === 0 ? (
          <p className="mb-3 text-sm text-[var(--color-pib-text-muted)]">No projects shared either way yet.</p>
        ) : (
          <div className="mb-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">You shared</p>
              {outForThisPartner.length === 0 ? (
                <p className="text-xs text-[var(--color-pib-text-muted)]">None.</p>
              ) : (
                <ul className="space-y-1">
                  {outForThisPartner.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 text-xs">
                      <Link href={`/portal/projects/${p.projectId}`} className="min-w-0 flex-1 truncate text-[var(--color-pib-text)] hover:text-[var(--color-accent-v2)]">
                        {p.projectName || p.projectId}
                      </Link>
                      <span className="pib-pill px-1.5 py-0.5 text-[9px]">{p.role}</span>
                      <button type="button" onClick={() => void unshareProject(p)} disabled={busy}
                        className="text-[var(--color-pib-text-muted)] transition hover:text-rose-300 disabled:opacity-50">
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">They shared</p>
              {inFromThisPartner.length === 0 ? (
                <p className="text-xs text-[var(--color-pib-text-muted)]">None.</p>
              ) : (
                <ul className="space-y-1">
                  {inFromThisPartner.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 text-xs">
                      <Link href={`/portal/projects/${p.projectId}`} className="min-w-0 flex-1 truncate text-[var(--color-pib-text)] hover:text-[var(--color-accent-v2)]">
                        {p.projectName || p.projectId}
                      </Link>
                      <span className="pib-pill px-1.5 py-0.5 text-[9px]">{p.role}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label htmlFor="share-project" className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
              Share a project with them
            </label>
            <select id="share-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}
              className="w-full rounded-md border border-[var(--color-pib-line)] bg-black/30 px-2 py-1.5 text-xs text-[var(--color-pib-text)]">
              <option value="">Choose a project…</option>
              {shareable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <button type="button" onClick={() => void shareProject()} disabled={busy || !projectId}
            className="rounded-md bg-[var(--color-accent-v2)] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">
            Share
          </button>
        </div>
        <p className="mt-1 text-[10px] text-[var(--color-pib-text-muted)]">
          Partners get contributor access at most, never owner or manager.
        </p>
      </section>

      <section className={`${CARD} p-4`}>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-pib-text)]">
          Conversation {messages.length > 0 ? `(${messages.length})` : ''}
        </h2>
        {messages.length === 0 ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">No messages yet.</p>
        ) : (
          <ul className="space-y-2">
            {messages.map((m) => (
              <li key={m.id} className="rounded-lg border border-[var(--color-pib-line)] bg-black/20 p-3">
                <div className="mb-1 flex flex-wrap items-baseline gap-2">
                  <span className="text-xs font-medium text-[var(--color-pib-text)]">
                    {m.authorRef?.displayName || 'Someone'}
                  </span>
                  <span className="pib-pill px-1.5 py-0.5 text-[9px]">
                    {m.authorOrgId === overview.partnerOrgId ? overview.partnerOrgName : 'You'}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-[var(--color-pib-text-muted)]">{m.body}</p>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4">
          <label htmlFor="partner-msg" className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
            Message {overview.partnerOrgName}
          </label>
          <textarea id="partner-msg" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder="Anything about the relationship as a whole — pricing, timelines, introductions."
            className="w-full rounded-lg border border-[var(--color-pib-line)] bg-black/20 px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-[var(--color-accent-v2)]" />
          <button type="button" onClick={() => void send()} disabled={busy || !draft.trim()}
            className="mt-2 rounded-lg bg-[var(--color-accent-v2)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </section>
    </div>
  )
}
