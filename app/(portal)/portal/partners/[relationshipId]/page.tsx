'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import { StatCard } from '@/components/ui/StatCard'
import { SystemLinkBadge } from '@/components/crm/SystemLinkBadge'
import {
  Button,
  ButtonLink,
  Field,
  Notice,
  Panel,
  Select,
  Skeleton,
  Status,
  Textarea,
  Title,
} from '@/components/studio'

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

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton height="3rem" />
        <Skeleton height="8rem" />
      </div>
    )
  }

  if (error && !overview) {
    return (
      <div className="space-y-4">
        <ButtonLink href="/portal/partners" variant="ghost" size="sm">Back to partners</ButtonLink>
        <EmptyState title="Not available." description={error} />
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
    <div className="space-y-8">
      <ButtonLink href="/portal/partners" variant="ghost" size="sm">Back to partners</ButtonLink>

      <PageHeader
        title={`${overview.partnerOrgName}.`}
        description={`You share: ${overview.sharedCapabilities.join(', ') || 'nothing yet'}.`}
        meta={
          <>
            <SystemLinkBadge kind="org" size="md" />
            <Status>{overview.status}</Status>
          </>
        }
        actions={
          <>
            <ButtonLink href={`/portal/partners/catalog/${relationshipId}`} variant="secondary" size="sm">
              Order from them
            </ButtonLink>
            <ButtonLink href="/portal/partners/orders" variant="ghost" size="sm">Orders</ButtonLink>
            <ButtonLink href="/portal/partners/settlements" variant="ghost" size="sm">Settlements</ButtonLink>
            {overview.companyId ? (
              <ButtonLink href={`/portal/companies/${overview.companyId}`} variant="ghost" size="sm">
                Company record
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="info">{notice}</Notice> : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <StatCard key={t.label} label={t.label} value={t.value} />
        ))}
      </div>

      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="sc-tiny">Confirmed sales to them</p>
            <p className="st-num mt-1 text-[1.25rem] text-[var(--sc-ink)]">
              {money(overview.tradeValue.received, overview.tradeValue.currency)}
            </p>
          </div>
          <div>
            <p className="sc-tiny">Confirmed purchases from them</p>
            <p className="st-num mt-1 text-[1.25rem] text-[var(--sc-ink)]">
              {money(overview.tradeValue.placed, overview.tradeValue.currency)}
            </p>
          </div>
        </div>
      </Panel>

      <Panel>
        <Title>Shared projects</Title>

        {outForThisPartner.length === 0 && inFromThisPartner.length === 0 ? (
          <p className="mb-4 mt-4 sc-body">No projects shared either way yet.</p>
        ) : (
          <div className="mb-4 mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 sc-tiny">You shared</p>
              {outForThisPartner.length === 0 ? (
                <p className="sc-body text-[0.875rem]">None.</p>
              ) : (
                <ul className="space-y-2">
                  {outForThisPartner.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 text-[0.875rem]">
                      <ButtonLink href={`/portal/projects/${p.projectId}`} variant="ghost" size="sm" className="min-w-0 flex-1 truncate !justify-start !px-0">
                        {p.projectName || p.projectId}
                      </ButtonLink>
                      <Status>{p.role}</Status>
                      <Button type="button" variant="ghost" size="sm" onClick={() => void unshareProject(p)} disabled={busy}>
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-2 sc-tiny">They shared</p>
              {inFromThisPartner.length === 0 ? (
                <p className="sc-body text-[0.875rem]">None.</p>
              ) : (
                <ul className="space-y-2">
                  {inFromThisPartner.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 text-[0.875rem]">
                      <ButtonLink href={`/portal/projects/${p.projectId}`} variant="ghost" size="sm" className="min-w-0 flex-1 truncate !justify-start !px-0">
                        {p.projectName || p.projectId}
                      </ButtonLink>
                      <Status>{p.role}</Status>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[200px] flex-1">
            <Field id="share-project" label="Share a project with them">
              <Select id="share-project" aria-label="Share a project with them" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Choose a project…</option>
                {shareable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>
          <Button type="button" size="sm" onClick={() => void shareProject()} disabled={busy || !projectId} loading={busy && Boolean(projectId)}>
            Share
          </Button>
        </div>
        <p className="mt-2 sc-tiny text-[var(--sc-ink-soft)]">
          Partners get contributor access at most, never owner or manager.
        </p>
      </Panel>

      <Panel>
        <Title>
          Conversation {messages.length > 0 ? `(${messages.length})` : ''}
        </Title>
        {messages.length === 0 ? (
          <p className="mt-4 sc-body">No messages yet.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {messages.map((m) => (
              <li key={m.id} className="st-panel st-panel--flat p-4">
                <div className="mb-2 flex flex-wrap items-baseline gap-2">
                  <span className="sc-body text-[var(--sc-ink)]">
                    {m.authorRef?.displayName || 'Someone'}
                  </span>
                  <Status>
                    {m.authorOrgId === overview.partnerOrgId ? overview.partnerOrgName : 'You'}
                  </Status>
                </div>
                <p className="sc-body whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 space-y-4">
          <Field id="partner-msg" label={`Message ${overview.partnerOrgName}`}>
            <Textarea
              id="partner-msg"
              aria-label={`Message ${overview.partnerOrgName}`}
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Anything about the relationship as a whole: pricing, timelines, introductions."
            />
          </Field>
          <Button type="button" onClick={() => void send()} disabled={busy || !draft.trim()} loading={busy}>
            Send
          </Button>
        </div>
      </Panel>
    </div>
  )
}
