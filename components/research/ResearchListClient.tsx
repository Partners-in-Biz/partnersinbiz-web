'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { ResearchItem, ResearchKind, ResearchStatus, ResearchVisibility } from '@/lib/research/types'
import { RESEARCH_KINDS, RESEARCH_STATUSES, RESEARCH_VISIBILITIES } from '@/lib/research/types'

type OrgOption = { id: string; name: string; slug?: string }

type Props = {
  mode: 'admin' | 'portal'
  title: string
  description: string
  basePath: string
  orgId?: string
  orgName?: string
  orgs?: OrgOption[]
  itemHref?: (item: ResearchItem) => string
}

function label(value: string) {
  return value.replaceAll('_', ' ')
}

function formatDate(value: unknown) {
  if (!value || typeof value !== 'string') return 'Not dated'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not dated'
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

export function ResearchListClient({ mode, title, description, basePath, orgId, orgName, orgs = [], itemHref }: Props) {
  const [activeOrgId, setActiveOrgId] = useState(orgId ?? orgs[0]?.id ?? '')
  const [items, setItems] = useState<ResearchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<ResearchStatus | 'all'>('all')
  const [kind, setKind] = useState<ResearchKind | 'all'>('all')
  const [visibility, setVisibility] = useState<ResearchVisibility | 'all'>('all')
  const [q, setQ] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (activeOrgId) params.set('orgId', activeOrgId)
    if (status !== 'all') params.set('status', status)
    if (kind !== 'all') params.set('kind', kind)
    if (visibility !== 'all' && mode === 'admin') params.set('visibility', visibility)
    if (q.trim()) params.set('q', q.trim())
    return params.toString()
  }, [activeOrgId, kind, mode, q, status, visibility])

  useEffect(() => {
    if (mode === 'admin' && !activeOrgId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    const path = mode === 'portal' ? '/api/v1/portal/research' : '/api/v1/research'
    fetch(query ? `${path}?${query}` : path)
      .then((res) => res.json().then((body) => ({ res, body })))
      .then(({ res, body }) => {
        if (cancelled) return
        if (!res.ok) throw new Error(body?.error ?? 'Could not load research')
        setItems(body.data ?? [])
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load research')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [activeOrgId, mode, query])

  async function createResearch() {
    if (!newTitle.trim() || !activeOrgId || creating) return
    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/v1/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orgId: activeOrgId,
          title: newTitle,
          kind: kind === 'all' ? 'other' : kind,
          visibility: 'internal',
          summary: '',
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Could not create research')
      const id = body?.data?.id
      if (id) window.location.href = `${basePath}/${id}`
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create research')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{orgName || (mode === 'portal' ? 'Research' : 'Intelligence')}</p>
          <h1 className="pib-page-title mt-2">{title}</h1>
          <p className="pib-page-sub mt-2 max-w-2xl">{description}</p>
        </div>
      </header>

      {mode === 'admin' && (
        <section className="bento-card grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder="New research title"
            className="pib-input"
          />
          <button type="button" onClick={createResearch} disabled={!newTitle.trim() || creating} className="btn-pib-accent disabled:opacity-50">
            <span className="material-symbols-outlined text-base">{creating ? 'progress_activity' : 'add'}</span>
            New Research
          </button>
        </section>
      )}

      <section className="bento-card grid gap-3 md:grid-cols-5">
        {mode === 'admin' && orgs.length > 0 && (
          <select value={activeOrgId} onChange={(event) => setActiveOrgId(event.target.value)} className="pib-select">
            {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
        )}
        <select value={kind} onChange={(event) => setKind(event.target.value as ResearchKind | 'all')} className="pib-select">
          <option value="all">All kinds</option>
          {RESEARCH_KINDS.map((value) => <option key={value} value={value}>{label(value)}</option>)}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value as ResearchStatus | 'all')} className="pib-select">
          <option value="all">All statuses</option>
          {RESEARCH_STATUSES.map((value) => <option key={value} value={value}>{label(value)}</option>)}
        </select>
        {mode === 'admin' && (
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as ResearchVisibility | 'all')} className="pib-select">
            <option value="all">All visibility</option>
            {RESEARCH_VISIBILITIES.map((value) => <option key={value} value={value}>{label(value)}</option>)}
          </select>
        )}
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search research" className="pib-input" />
      </section>

      {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="pib-skeleton h-32" />)}</div>
      ) : items.length === 0 ? (
        <div className="bento-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">travel_explore</span>
          <h2 className="mt-4 font-display text-2xl">No research matches this view.</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-pib-text-muted)]">Research findings, evidence, and recommendations will appear here once they are captured.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article key={item.id} className="bento-card flex min-h-[250px] flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">{label(item.kind)}</p>
                  <h2 className="mt-2 font-display text-xl leading-snug">
                    <Link href={itemHref?.(item) ?? `${basePath}/${item.id}`} className="hover:text-[var(--color-pib-accent)]">{item.title}</Link>
                  </h2>
                </div>
                <span className="material-symbols-outlined shrink-0 text-[var(--color-pib-accent)]">travel_explore</span>
              </div>
              <p className="line-clamp-3 text-sm text-[var(--color-pib-text-muted)]">{item.summary || item.notesMarkdown || 'No summary captured yet.'}</p>
              <div className="mt-auto grid grid-cols-2 gap-3 text-sm">
                <span className="pib-pill">{label(item.status)}</span>
                <span className="pib-pill">{label(item.visibility)}</span>
                <span className="text-[var(--color-pib-text-muted)]">{item.findings?.length ?? 0} findings</span>
                <span className="text-[var(--color-pib-text-muted)]">{formatDate(item.updatedAt ?? item.createdAt)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
