'use client'

import { useEffect, useState } from 'react'
import type { MobileAppRecord } from '@/lib/mobile-apps/types'

export default function PortalMobileAppsPage() {
  const [apps, setApps] = useState<MobileAppRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [clientNotes, setClientNotes] = useState('')
  const [clientFeedback, setClientFeedback] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    const res = await fetch('/api/v1/portal/mobile-apps')
    const body = await res.json().catch(() => ({}))
    setApps(Array.isArray(body.data?.apps) ? body.data.apps : [])
    setLoading(false)
  }

  useEffect(() => {
    async function loadInitial() {
      await load()
    }
    loadInitial()
  }, [])

  function startFeedback(app: MobileAppRecord) {
    setEditingId(app.id ?? null)
    setClientNotes(app.clientNotes ?? '')
    setClientFeedback(app.listing?.clientFeedback ?? '')
    setNotice('')
  }

  async function saveFeedback() {
    if (!editingId) return
    const res = await fetch('/api/v1/portal/mobile-apps', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingId, clientNotes, clientFeedback }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setNotice(body.error ?? 'Could not save feedback')
      return
    }
    setEditingId(null)
    setNotice('Feedback saved for the PiB team.')
    await load()
  }

  if (loading) return <div className="p-6"><div className="pib-skeleton h-80" /></div>

  return (
    <main className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Digital presence</p>
          <h1 className="text-3xl font-headline font-bold text-[var(--color-pib-text)]">Mobile apps</h1>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-2 max-w-2xl">Store links, listing copy, ratings, release notes and app tasks that need client review.</p>
        </div>
        <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] px-4 py-3 text-sm text-[var(--color-pib-text-muted)]">
          {apps.length} app{apps.length === 1 ? '' : 's'} tracked
        </div>
      </div>

      {notice && <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-4 text-sm">{notice}</div>}

      {apps.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">smartphone</span>
          <h2 className="font-headline text-xl font-bold mt-3">No mobile app profile yet</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-2">When the PiB team adds your App Store or Google Play presence, it will appear here for review.</p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {apps.map(app => (
            <article key={app.id} className="rounded-3xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-5 space-y-5">
              <div className="flex gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {app.assets?.iconUrl ? <img src={app.assets.iconUrl} alt="" className="h-16 w-16 rounded-2xl object-cover" /> : <div className="h-16 w-16 rounded-2xl bg-white/[0.04] flex items-center justify-center"><span className="material-symbols-outlined">apps</span></div>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-headline text-xl font-bold">{app.name}</h2>
                    <span className="pill pill-accent uppercase">{app.platform}</span>
                    <span className="pill capitalize">{app.status}</span>
                  </div>
                  <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">{app.listing?.subtitle || app.listing?.shortDescription || 'Listing details are being prepared.'}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {app.appStoreUrl && <a href={app.appStoreUrl} target="_blank" rel="noreferrer" className="pib-btn-primary text-sm">Open App Store</a>}
                {app.playStoreUrl && <a href={app.playStoreUrl} target="_blank" rel="noreferrer" className="pib-btn-primary text-sm">Open Google Play</a>}
                {app.supportUrl && <a href={app.supportUrl} target="_blank" rel="noreferrer" className="pib-btn-ghost text-sm">Support</a>}
              </div>

              <div className="grid grid-cols-3 gap-3 text-sm">
                <Metric label="Version" value={app.releaseManagement?.currentVersion || '—'} />
                <Metric label="Rating" value={app.analyticsSnapshot?.averageRating ? `${app.analyticsSnapshot.averageRating}` : '—'} />
                <Metric label="Reviews" value={app.analyticsSnapshot?.reviewCount ? `${app.analyticsSnapshot.reviewCount}` : '—'} />
              </div>

              {app.listing?.longDescription && (
                <section>
                  <p className="eyebrow !text-[10px]">Store listing</p>
                  <p className="text-sm text-[var(--color-pib-text-muted)] whitespace-pre-line mt-2 line-clamp-6">{app.listing.longDescription}</p>
                </section>
              )}

              {app.releaseManagement?.releaseNotes && (
                <section>
                  <p className="eyebrow !text-[10px]">Release notes</p>
                  <p className="text-sm text-[var(--color-pib-text-muted)] whitespace-pre-line mt-2">{app.releaseManagement.releaseNotes}</p>
                </section>
              )}

              {app.clientNotes && <p className="text-sm rounded-2xl bg-white/[0.04] p-3">{app.clientNotes}</p>}

              {editingId === app.id ? (
                <div className="space-y-3 rounded-2xl border border-[var(--color-pib-line)] p-3">
                  <label className="block text-sm"><span className="eyebrow !text-[10px]">Notes for PiB</span><textarea value={clientNotes} onChange={e => setClientNotes(e.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3" /></label>
                  <label className="block text-sm"><span className="eyebrow !text-[10px]">Listing feedback</span><textarea value={clientFeedback} onChange={e => setClientFeedback(e.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3" /></label>
                  <div className="flex gap-2"><button type="button" onClick={saveFeedback} className="pib-btn-primary text-sm">Save feedback</button><button type="button" onClick={() => setEditingId(null)} className="pib-btn-ghost text-sm">Cancel</button></div>
                </div>
              ) : (
                <button type="button" onClick={() => startFeedback(app)} className="pib-btn-ghost text-sm">Leave feedback / request changes</button>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3"><p className="text-[11px] text-[var(--color-pib-text-muted)]">{label}</p><p className="font-semibold mt-1">{value}</p></div>
}
